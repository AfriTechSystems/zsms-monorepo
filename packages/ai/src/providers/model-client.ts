/**
 * Anthropic and OpenAI, over raw `fetch`.
 *
 * ## Why no SDK
 *
 * Both APIs are a single POST of JSON. An SDK each would add two dependencies that need
 * version-tracking, pull in their own transitive trees, and — the deciding factor — make the
 * failover chain depend on two libraries' differing retry, timeout and error-shape behaviour,
 * which is precisely the behaviour `errors.ts` exists to own. One `fetch` per provider is about
 * forty lines and the error handling is ours.
 *
 * ## The one real difference between them
 *
 * Structured output is requested differently:
 *
 *   - **OpenAI** takes `response_format: { type: 'json_schema', strict: true }` and returns the
 *     JSON as the message content.
 *   - **Anthropic** has no equivalent, so the schema is passed as a **tool** with
 *     `tool_choice` forcing its use, and the JSON arrives as the tool call's `input`.
 *
 * Both are normalised here so the chain and every caller see one shape. Getting this wrong is
 * how you end up with a fallback provider that technically answers and returns prose the
 * renderer cannot use.
 */

import { classifyFailure, type ProviderFailure } from '../errors'

export interface ModelSpec {
  provider: 'anthropic' | 'openai'
  model_name: string
  input_usd_per_million: number | string
  output_usd_per_million: number | string
  max_output_tokens: number
}

export interface ModelCallRequest {
  systemPrompt: string
  userPrompt: string
  schema: unknown
  schemaName: string
  temperature?: number
  /** Hard ceiling on the whole call. A provider hanging must not hang a teacher's screen. */
  timeoutMs?: number
}

export interface ModelCallResult {
  json: Record<string, unknown>
  modelName: string
  provider: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

/** Thrown by a single provider call. The chain catches it and decides what to do. */
export class ModelCallError extends Error {
  readonly failure: ProviderFailure
  constructor(failure: ProviderFailure) {
    super(failure.message)
    this.name = 'ModelCallError'
    this.failure = failure
  }
}

const DEFAULT_TIMEOUT_MS = 60_000

function cost(spec: ModelSpec, inputTokens: number, outputTokens: number): number {
  const inRate = Number(spec.input_usd_per_million)
  const outRate = Number(spec.output_usd_per_million)
  // Rates come from the database as NUMERIC, which PostgREST serialises as a string. Coerced
  // rather than trusted: `"2.5" * x` is not what it looks like in JavaScript.
  return (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  provider: string,
  modelName: string,
  timeoutMs: number,
): Promise<{ status: number; body: unknown }> {
  /**
   * An explicit timeout, because neither API guarantees one and a hung socket would otherwise
   * hold a teacher's request open until the platform's own limit killed it — producing a
   * failure with no classification and no incident.
   */
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const text = await response.text()
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text) as unknown
    } catch {
      // Left as text. A provider returning HTML — a proxy error page, say — must still be
      // classifiable rather than crashing on a parse.
    }

    if (!response.ok) {
      throw new ModelCallError(
        classifyFailure(provider, modelName, response.status, parsed,
          `HTTP ${response.status} from ${provider}`),
      )
    }

    return { status: response.status, body: parsed }
  } catch (error) {
    if (error instanceof ModelCallError) throw error

    const aborted = error instanceof Error && error.name === 'AbortError'
    throw new ModelCallError(
      classifyFailure(provider, modelName, undefined, null,
        aborted
          ? `${provider} did not respond within ${timeoutMs}ms`
          : `${provider} could not be reached: ${error instanceof Error ? error.message : 'unknown'}`),
    )
  } finally {
    clearTimeout(timer)
  }
}

export async function callOpenAI(
  spec: ModelSpec,
  request: ModelCallRequest,
  apiKey: string,
): Promise<ModelCallResult> {
  const { body } = await postJson(
    'https://api.openai.com/v1/chat/completions',
    { Authorization: `Bearer ${apiKey}` },
    {
      model: spec.model_name,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      // `strict: true` makes the schema a guarantee rather than a request, which is what lets
      // the renderer trust the shape without defensive checks on every field.
      response_format: {
        type: 'json_schema',
        json_schema: { name: request.schemaName, schema: request.schema, strict: true },
      },
      temperature: request.temperature ?? 0.4,
      max_tokens: spec.max_output_tokens,
    },
    'openai',
    spec.model_name,
    request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )

  const payload = body as {
    choices?: Array<{ message?: { content?: string; refusal?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }

  const choice = payload.choices?.[0]

  /**
   * A refusal arrives as HTTP 200 with `refusal` set and no content. Classified as `content` so
   * the chain does NOT fail over: another provider asked the same thing would likely refuse
   * too, and if it did not, the product's behaviour would depend on which key had credit.
   */
  if (choice?.message?.refusal) {
    throw new ModelCallError(
      classifyFailure('openai', spec.model_name, 200, choice.message.refusal,
        `openai declined: ${choice.message.refusal}`),
    )
  }

  const content = choice?.message?.content
  if (!content) {
    throw new ModelCallError(
      classifyFailure('openai', spec.model_name, 200, payload,
        'openai returned no content'),
    )
  }

  let json: Record<string, unknown>
  try {
    json = JSON.parse(content) as Record<string, unknown>
  } catch {
    // `strict` should prevent this, so it means the contract was not honoured — our problem to
    // notice, not something another provider would fix.
    throw new ModelCallError(
      classifyFailure('openai', spec.model_name, 400, content,
        'openai returned content that is not valid JSON despite a strict schema'),
    )
  }

  const inputTokens = payload.usage?.prompt_tokens ?? 0
  const outputTokens = payload.usage?.completion_tokens ?? 0

  return {
    json,
    provider: 'openai',
    modelName: spec.model_name,
    inputTokens,
    outputTokens,
    costUsd: cost(spec, inputTokens, outputTokens),
  }
}

export async function callAnthropic(
  spec: ModelSpec,
  request: ModelCallRequest,
  apiKey: string,
): Promise<ModelCallResult> {
  const { body } = await postJson(
    'https://api.anthropic.com/v1/messages',
    {
      'x-api-key': apiKey,
      // Pinned deliberately: Anthropic's API is versioned by header, and leaving it off or
      // floating means a future change to response shape arrives unannounced.
      'anthropic-version': '2023-06-01',
    },
    {
      model: spec.model_name,
      system: request.systemPrompt,
      messages: [{ role: 'user', content: request.userPrompt }],
      /**
       * Anthropic has no `response_format`, so the schema becomes a tool and `tool_choice`
       * forces it. The JSON then arrives as the tool call's `input` rather than as message
       * text — which is why this cannot simply share OpenAI's parsing.
       */
      tools: [
        {
          name: request.schemaName,
          description: 'Return the completed teaching pack.',
          input_schema: request.schema,
        },
      ],
      tool_choice: { type: 'tool', name: request.schemaName },
      temperature: request.temperature ?? 0.4,
      max_tokens: spec.max_output_tokens,
    },
    'anthropic',
    spec.model_name,
    request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  )

  const payload = body as {
    content?: Array<{ type?: string; name?: string; input?: Record<string, unknown> }>
    stop_reason?: string
    usage?: { input_tokens?: number; output_tokens?: number }
  }

  const toolUse = payload.content?.find((b) => b.type === 'tool_use')

  if (!toolUse?.input) {
    throw new ModelCallError(
      classifyFailure('anthropic', spec.model_name, 200, payload,
        payload.stop_reason === 'max_tokens'
          // Worth distinguishing: the answer was too long for the budget, which is a
          // configuration problem (raise max_output_tokens) rather than a provider fault.
          ? 'anthropic hit max_tokens before completing the structured answer'
          : 'anthropic returned no tool_use block despite a forced tool choice'),
    )
  }

  const inputTokens = payload.usage?.input_tokens ?? 0
  const outputTokens = payload.usage?.output_tokens ?? 0

  return {
    json: toolUse.input,
    provider: 'anthropic',
    modelName: spec.model_name,
    inputTokens,
    outputTokens,
    costUsd: cost(spec, inputTokens, outputTokens),
  }
}

/** Dispatch by provider, with the key resolved from the environment. */
export async function callModel(
  spec: ModelSpec,
  request: ModelCallRequest,
): Promise<ModelCallResult> {
  const key = spec.provider === 'openai'
    ? process.env.OPENAI_API_KEY
    : process.env.ANTHROPIC_API_KEY

  if (!key) {
    /**
     * A missing key is classified as `auth` on purpose, so it behaves exactly like a rejected
     * one: the chain moves on and AfriTech is told. The alternative — throwing something
     * unclassified — would stop the chain dead over a configuration gap that the next provider
     * could have covered.
     */
    throw new ModelCallError(
      classifyFailure(spec.provider, spec.model_name, 401, null,
        `${spec.provider.toUpperCase()}_API_KEY is not set`),
    )
  }

  return spec.provider === 'openai'
    ? callOpenAI(spec, request, key)
    : callAnthropic(spec, request, key)
}
