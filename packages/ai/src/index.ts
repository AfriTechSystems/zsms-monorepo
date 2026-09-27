/**
 * `@zsms/ai` — the seam between ZSMS and whatever generates teaching resources.
 *
 * Nothing outside this package imports a model SDK, for the same reason nothing outside
 * `packages/auth-provider` imports Clerk and nothing outside `packages/queue` imports
 * BullMQ: the choice of vendor must be changeable in one place. ADR-032's rule, applied
 * to a third dependency.
 *
 * ## Selecting a generator
 *
 * There is exactly one today. `resolveGenerator()` reads `AI_GENERATOR` and falls back to
 * the scaffold, so wiring Claude later means adding `providers/claude.ts` and one case —
 * no caller changes.
 *
 * It deliberately does NOT silently prefer a model when `ANTHROPIC_API_KEY` happens to be
 * set. A key in the environment is not the same as a curriculum knowledge base being
 * ingested and a prompt being reviewed, and a generator that switches itself on when a
 * variable appears is how an untested code path reaches a paying teacher.
 */

export type {
  CurriculumType,
  GeneratedContent,
  GenerationRequest,
  GenerationResult,
  Generator,
  LessonPhase,
  LessonType,
  QuizQuestion,
  ResourceKind,
} from './types'

import type { GenerationRequest, GenerationResult, Generator } from './types'
import { templateGenerator } from './providers/template'

export { templateGenerator }

export function resolveGenerator(): Generator {
  const configured = process.env.AI_GENERATOR?.trim().toLowerCase()

  switch (configured) {
    case 'template':
    case undefined:
    case '':
      return templateGenerator
    default:
      /**
       * Naming a generator that does not exist is a configuration mistake, and falling
       * back silently would hide it until somebody wondered why output looked templated.
       * Say so once, then use the one that works.
       */
      console.warn(
        `[@zsms/ai] AI_GENERATOR="${configured}" is not a generator this build knows. ` +
          `Using "${templateGenerator.name}".`,
      )
      return templateGenerator
  }
}

/** What a caller actually uses. */
export async function generateTeachingResource(
  request: GenerationRequest,
): Promise<GenerationResult> {
  return resolveGenerator().generate(request)
}

/**
 * Whether a real model is behind the seam right now. The Hub uses this to tell the teacher
 * the truth about what they are about to receive, and it is a function rather than a
 * constant so it stays correct when a model is added.
 */
export function isModelBacked(): boolean {
  return resolveGenerator().name !== templateGenerator.name
}
