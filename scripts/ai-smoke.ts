/**
 * Proves the AI chain against the real providers, without a UI, a database or a credit.
 *
 * ## Why this script exists
 *
 * I cannot run it. The API keys live in `.env.local`, which is gitignored and which I have no
 * read access to — so every line of the provider code and the failover logic is type-checked
 * and reviewed but has **never made a real HTTP request**. This is the shortest path from that
 * state to certainty, and it is deliberately the smallest thing that could tell you:
 *
 *   - which provider actually answered;
 *   - what it cost, in real dollars, at the rates in `afritech.ai_models`;
 *   - and — the interesting part — whether failing over WORKED.
 *
 * With Anthropic first and out of credit, a correct run prints one recovered failure classified
 * `quota` and then an answer from OpenAI. That single line exercises classification, the
 * failover decision, and the incident report all at once.
 *
 * ## Running it
 *
 *   node --env-file=.env.local --import tsx scripts/ai-smoke.ts
 *
 * `--env-file` is what loads the keys; `tsx` is required because `node
 * --experimental-strip-types` has silently broken two scripts in this repository (see
 * CLAUDE.md). It talks to no database — the model list below is a copy of the seeded rows, so
 * a failure here is a provider or key problem and nothing else.
 */

import { runChain } from '../packages/ai/src/chain'
import type { ModelSpec } from '../packages/ai/src/providers/model-client'

// Mirrors afritech.ai_models as seeded by 0134, in the same priority order.
const MODELS: ModelSpec[] = [
  {
    provider: 'openai',
    model_name: 'gpt-4o',
    input_usd_per_million: 2.5,
    output_usd_per_million: 10,
    max_output_tokens: 4096,
  },
  {
    provider: 'anthropic',
    model_name: 'claude-sonnet-4-5',
    input_usd_per_million: 3,
    output_usd_per_million: 15,
    max_output_tokens: 4096,
  },
]

/**
 * A deliberately tiny schema, not the real teaching pack. This script is testing transport,
 * classification and failover — not output quality — and a small schema keeps the token cost of
 * running it near zero. Quality is what the teacher evaluation set is for.
 */
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['objectives', 'diagram'],
  properties: {
    objectives: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string' } },
    diagram: {
      type: 'string',
      description: 'A valid Mermaid flowchart, 3-4 nodes, no styling.',
    },
  },
} as const

async function main(): Promise<void> {
  const order = process.argv.includes('--anthropic-first') ? [...MODELS].reverse() : MODELS

  console.log('Chain order:', order.map((m) => `${m.provider}/${m.model_name}`).join(' → '))
  console.log(
    'Keys present:',
    `OPENAI=${process.env.OPENAI_API_KEY ? 'yes' : 'NO'}`,
    `ANTHROPIC=${process.env.ANTHROPIC_API_KEY ? 'yes' : 'NO'}`,
  )
  console.log('')

  const started = Date.now()

  try {
    const result = await runChain({
      models: order,
      request: {
        systemPrompt:
          'You write Zambian ECZ lesson content. Be concise and concrete. Diagrams must be '
          + 'valid Mermaid with no styling directives.',
        userPrompt:
          'Grade 9 Mathematics, topic: simultaneous equations. Give two observable objectives '
          + 'and one Mermaid flowchart of the solving method.',
        schema: SCHEMA,
        schemaName: 'smoke_test',
        temperature: 0.3,
      },
      // Printed rather than persisted: this script must not need a database to tell you what
      // the chain decided.
      onFailure: (report) => {
        console.log(
          `  ! ${report.severity.toUpperCase()} [${report.kind}] ${report.title}\n`
          + `    ${report.detail}\n`
          + `    dedupe: ${report.dedupeKey}  recovered: ${String(report.metadata['recovered'])}`,
        )
      },
    })

    console.log('')
    console.log(`✓ Answered by ${result.provider} (${result.modelName}) in ${Date.now() - started}ms`)
    console.log(`  tokens: ${result.inputTokens} in / ${result.outputTokens} out`)
    console.log(`  cost:   $${result.costUsd.toFixed(6)}`)
    console.log(`  recovered from ${result.recoveredFrom.length} failure(s)`)
    console.log('')
    console.log('Output:')
    console.log(JSON.stringify(result.json, null, 2))

    if (result.recoveredFrom.length > 0) {
      console.log('')
      console.log(
        'Failover WORKED: the first provider failed, the chain moved on, and a teacher would '
        + 'have seen none of it.',
      )
    }
  } catch (error) {
    console.error('')
    console.error('✗ The whole chain failed.')
    console.error(error instanceof Error ? error.message : String(error))
    // Non-zero, so this is usable in a shell conditional or a future CI smoke job.
    process.exitCode = 1
  }
}

void main()
