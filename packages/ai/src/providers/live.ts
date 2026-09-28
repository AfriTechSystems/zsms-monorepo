/**
 * The model-backed generator.
 *
 * ## It is constructed, not looked up
 *
 * Unlike `templateGenerator`, this one cannot be a module-level constant: it needs the model
 * chain, the active prompt version and the incident handler, all of which come from the
 * database per request. So it is a factory, and `resolveGenerator()` falls back to the scaffold
 * whenever that configuration is absent — a missing prompt row degrades to a working scaffold
 * rather than to an error page.
 *
 * ## The prompt is data, and the output records which version produced it
 *
 * `promptVersion` travels out on the result and is stored on the resource row. Without it, an
 * admin improving the prompt silently changes what every past artefact claims to be, and a
 * complaint about a plan from three weeks ago cannot be reproduced. ADR-041's rule, fourth
 * application.
 */

import type {
  GeneratedContent,
  GenerationRequest,
  GenerationResult,
  Generator,
} from '../types'
import { TEACHING_PACK_SCHEMA } from '../schema'
import { runChain, type ChainOptions, type IncidentReport } from '../chain'
import type { ModelSpec } from './model-client'

export interface PromptTemplate {
  version: number
  system_prompt: string
  user_template: string
  model_params: Record<string, unknown>
}

export interface LiveGeneratorConfig {
  models: ModelSpec[]
  prompt: PromptTemplate
  onFailure?: (report: IncidentReport) => Promise<void> | void
  /**
   * Syllabus outcomes for this subject/grade/topic, from `curriculum_topics`. Empty until the
   * curriculum store is ingested — and the prompt is told so explicitly, because a model given
   * an empty "official outcomes" section will helpfully invent one, and an invented ECZ topic
   * code is worse than no citation: a teacher will repeat it to a head of department.
   */
  curriculumOutcomes?: string[]
}

/** `{{name}}` substitution. Unknown placeholders are left alone so a typo is visible. */
function render(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : match)
}

export function createLiveGenerator(config: LiveGeneratorConfig): Generator {
  const name = 'model-chain'

  return {
    name,
    // The prompt version IS the generator version, so two plans made by different prompts are
    // distinguishable on the row without joining anything.
    version: `prompt-v${config.prompt.version}`,

    async generate(request: GenerationRequest): Promise<GenerationResult> {
      const outcomes = config.curriculumOutcomes ?? []

      const userPrompt = render(config.prompt.user_template, {
        subject: request.subject,
        grade_level: request.gradeLevel,
        topic: request.topic,
        curriculum: request.curriculumType,
        duration_minutes: String(request.durationMinutes ?? 40),
        lesson_type: request.lessonType ?? 'core',
        kind: request.kind,
        context: request.context?.trim() || 'No additional context was given.',
        curriculum_outcomes: outcomes.length > 0
          ? outcomes.map((o) => `- ${o}`).join('\n')
          : 'NONE SUPPLIED. Do not cite any syllabus reference, code or page number. '
            + 'Leave `citations` empty.',
      })

      const options: ChainOptions = {
        models: config.models,
        request: {
          systemPrompt: config.prompt.system_prompt,
          userPrompt,
          schema: TEACHING_PACK_SCHEMA,
          schemaName: 'teaching_pack',
          temperature: typeof config.prompt.model_params['temperature'] === 'number'
            ? (config.prompt.model_params['temperature'] as number)
            : 0.4,
        },
        onFailure: config.onFailure,
      }

      const result = await runChain(options)

      /**
       * The model is asked for phases summing to the requested duration, and mostly obliges.
       * It is NOT corrected here if it does not: silently rewriting the numbers would make the
       * plan disagree with itself in a way the teacher cannot see, and the schema already
       * constrains the shape. The renderer shows the total, so a mismatch is visible where a
       * human can judge it.
       */
      const content = result.json as unknown as GeneratedContent

      return {
        title: `${request.gradeLevel} ${request.subject}: ${request.topic}${
          request.kind === 'quiz' ? ' — Quiz' : request.kind === 'homework' ? ' — Homework' : ''
        }`,
        content,
        generatorName: `${name}:${result.provider}`,
        generatorVersion: `prompt-v${config.prompt.version}`,
        knowledgeSources: outcomes.length > 0 ? outcomes : null,
        modelGenerated: true,
        usage: {
          modelName: result.modelName,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
        },
      }
    },
  }
}
