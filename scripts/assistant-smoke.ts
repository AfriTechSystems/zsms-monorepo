/**
 * Prove the assistant's two model calls work with the REAL prompts.
 *
 * `npm run assistant:smoke`
 *
 * ## Why this is separate from the route
 *
 * The route needs the platform AI toggle on, which spends credits on every question a
 * user asks. This exercises the half that cannot be checked any other way — does the
 * classifier pick the right intent from an ordinary sentence, and does the narrator write
 * a true sentence from real rows — for about two cents, once.
 *
 * The data half is checked separately in SQL, where each role gets a clean session and
 * the question is whether a parent sees one pupil and a bursar sees the school.
 *
 * ## What a pass actually means
 *
 * Three things, and the third is the one that matters:
 *
 * 1. the classifier returns one of the intents it was offered, not an invented one;
 * 2. the narrator produces prose rather than JSON noise;
 * 3. **the narrator uses the numbers it was given and does not invent others.** A model
 *    that writes "attendance is good" when handed 43 marks has failed even though it
 *    produced a sentence.
 */

import {
  INTENT_SCHEMA,
  INTENT_SYSTEM_PROMPT,
  NARRATION_SYSTEM_PROMPT,
  intentPrompt,
  intentsForRole,
  narrationPrompt,
  runChain,
  type ClassifiedIntent,
  type ModelSpec,
} from '../packages/ai/src/index'

const NARRATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer'],
  properties: { answer: { type: 'string' } },
} as const

/**
 * The model chain, read from the environment rather than the database.
 *
 * `ai_generation_config()` needs a signed-in session, and this script has none. The two
 * providers and their order are what the database holds for every AI feature.
 */
function models(): ModelSpec[] {
  const list: ModelSpec[] = []

  /*
    The real `ModelSpec` shape, which is snake_case and prices per MILLION tokens — not
    the camelCase per-thousand shape I first assumed. Taken from
    `packages/ai/src/providers/model-client.ts` rather than from memory.
  */
  if (process.env.OPENAI_API_KEY?.trim()) {
    list.push({
      provider: 'openai',
      model_name: 'gpt-4o',
      input_usd_per_million: 2.5,
      output_usd_per_million: 10,
      max_output_tokens: 1024,
    })
  }

  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    list.push({
      provider: 'anthropic',
      model_name: 'claude-sonnet-5-5',
      input_usd_per_million: 3,
      output_usd_per_million: 15,
      max_output_tokens: 1024,
    })
  }

  return list
}

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

async function main(): Promise<void> {
  const chain = models()
  if (chain.length === 0) {
    console.error('[assistant] No provider key configured. Set OPENAI_API_KEY.')
    process.exit(1)
  }

  console.log(`Assistant smoke test — ${chain.length} provider(s)\n`)

  /* ---------------------------------------------------------- classification */

  const available = intentsForRole('org:teacher')
  console.log(`A teacher may use ${available.length} intents.`)

  const utterance = 'Which pupils in my class are struggling this term?'

  const classified = (
    await runChain({
      models: chain,
      request: {
        systemPrompt: INTENT_SYSTEM_PROMPT,
        userPrompt: intentPrompt({
          message: utterance,
          role: 'org:teacher',
          currentPage: '/school/ZM-LSK-9001/results',
          availableIntents: available,
          history: [],
        }),
        schema: INTENT_SCHEMA,
        schemaName: 'assistant_intent',
        temperature: 0,
        timeoutMs: 20_000,
      },
      onFailure: async () => undefined,
    })
  ).json as unknown as ClassifiedIntent

  console.log(`\n"${utterance}"`)
  check(
    'the classifier returns an offered intent',
    available.some((i) => i.intent === classified.intent),
    classified.intent,
  )
  check(
    'it picked the at-risk intent',
    classified.intent === 'at_risk_students',
    `got ${classified.intent}`,
  )

  /* ---- a navigation utterance, which must NOT be classified as a read ---- */

  const navUtterance = 'take me to fees'
  const nav = (
    await runChain({
      models: chain,
      request: {
        systemPrompt: INTENT_SYSTEM_PROMPT,
        userPrompt: intentPrompt({
          message: navUtterance,
          role: 'org:teacher',
          currentPage: '/school/ZM-LSK-9001',
          availableIntents: available,
          history: [],
        }),
        schema: INTENT_SCHEMA,
        schemaName: 'assistant_intent',
        temperature: 0,
        timeoutMs: 20_000,
      },
      onFailure: async () => undefined,
    })
  ).json as unknown as ClassifiedIntent

  console.log(`\n"${navUtterance}"`)
  check(
    'a navigation request is classified as navigation',
    nav.intent.startsWith('navigate_'),
    `${nav.intent}, target=${nav.parameters?.target ?? 'none'}`,
  )

  /* ------------------------------------------------------------- narration */

  /*
    Real figures, shaped exactly as the executor returns them.

    The assertion below looks for 38 and 45 in the prose: a narrator that writes "some
    pupils are struggling" has produced a sentence and failed the job.
  */
  const data = {
    atRisk: [
      { studentId: 'stu-1', average: 38 },
      { studentId: 'stu-2', average: 45 },
    ],
    threshold: 50,
    assessed: 10,
  }

  const narrated = (
    await runChain({
      models: chain,
      request: {
        systemPrompt: NARRATION_SYSTEM_PROMPT,
        userPrompt: narrationPrompt({
          message: utterance,
          role: 'org:teacher',
          schoolName: 'Test Academy Lusaka',
          data,
          rowCount: 2,
        }),
        schema: NARRATION_SCHEMA,
        schemaName: 'assistant_answer',
        temperature: 0.2,
        timeoutMs: 30_000,
      },
      onFailure: async () => undefined,
    })
  ).json as { answer?: string }

  const answer = String(narrated.answer ?? '')
  console.log(`\nAnswer: ${answer}\n`)

  check('the narrator produced prose', answer.length > 20, `${answer.length} chars`)
  check(
    'it used the real figures',
    answer.includes('38') && answer.includes('45'),
    'looking for 38 and 45',
  )
  check(
    'it did not invent a pupil name',
    // The data has no names, only ids. A model that produces "Mwamba" has fabricated it.
    !/\b(Mwamba|Chanda|Grace|Banda|Phiri)\b/.test(answer),
    'no fabricated names',
  )

  console.log(
    failures === 0
      ? '\nThe assistant pipeline works: classified, routed, and narrated from real figures.'
      : `\n${failures} check(s) failed.`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
