/**
 * `@zsms/ai` — the seam between ZSMS and whatever generates teaching resources.
 *
 * Nothing outside this package imports a model SDK or talks to a provider, for the same reason
 * nothing outside `packages/auth-provider` imports Clerk and nothing outside `packages/queue`
 * imports BullMQ: the vendor must be changeable in one place. ADR-032's rule, applied to a
 * third dependency.
 *
 * This package also does **not** import Supabase. The model chain, the prompt and the incident
 * handler are passed in, so a unit test of the chain needs no database.
 *
 * ## Two generators
 *
 * `templateGenerator` — a deterministic scaffold. No model, no cost, honest about being a
 * structure rather than written prose. This is the default and the fallback.
 *
 * `createLiveGenerator(config)` — the model chain. Needs configuration from the database, which
 * is why it is a factory rather than a constant.
 *
 * ## `AI_GENERATOR` is the master switch and is independent of the keys
 *
 * `template` (or unset) keeps the scaffold. `live` permits the chain — **and only if the caller
 * also supplies models and a prompt.** The keys alone switch nothing on, deliberately: a key
 * appearing in an environment is not the same as a curriculum knowledge base having been
 * ingested and a prompt reviewed, and a generator that enables itself when a variable appears is
 * how an untested path reaches a paying teacher.
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

export type { FailureClass, ProviderFailure } from './errors'
export { AllProvidersFailedError } from './errors'
export type { ChainResult, IncidentReport } from './chain'
export { runChain } from './chain'
export type { ModelSpec } from './providers/model-client'
export type { LiveGeneratorConfig, PromptTemplate } from './providers/live'
export { createLiveGenerator } from './providers/live'
export { TEACHING_PACK_SCHEMA } from './schema'
export type { CurriculumExtraction, ExtractedTopic } from './curriculum'
export {
  CURRICULUM_EXTRACTION_SCHEMA,
  CURRICULUM_EXTRACTION_SYSTEM_PROMPT,
  curriculumExtractionPrompt,
} from './curriculum'

import type { GenerationRequest, GenerationResult, Generator } from './types'
import { templateGenerator } from './providers/template'
import { createLiveGenerator, type LiveGeneratorConfig } from './providers/live'

export { templateGenerator }

/* The role-based assistant: intents, classification and narration (`AI_ASSISTANT.md`). */
export type { IntentSpec, IntentClass, ClassifiedIntent } from './assistant'
export {
  INTENTS,
  INTENT_SCHEMA,
  INTENT_SYSTEM_PROMPT,
  NARRATION_SYSTEM_PROMPT,
  intentsForRole,
  intentPrompt,
  narrationPrompt,
} from './assistant'

/**
 * Whether the ENVIRONMENT forbids live generation outright.
 *
 * `AI_GENERATOR=off` is a ceiling, not a switch. It exists so an instance that must
 * never call a model — a staging deployment sharing production keys, a developer's
 * machine — cannot be switched on from a web page by somebody who does not know which
 * environment they are looking at.
 *
 * Anything else, including unset, leaves the decision to the database.
 */
export function liveGenerationForbidden(): boolean {
  return process.env.AI_GENERATOR?.trim().toLowerCase() === 'off'
}

/**
 * Whether configuration permits the model chain to run at all.
 *
 * `enabled` comes from `public.ai_live_generation()` — the toggle AfriTech moves from
 * the admin dashboard (migration `0210`). This package has no database client, so the
 * caller resolves it and passes it in.
 *
 * ## It used to read the environment variable alone
 *
 * `AI_GENERATOR=live` was a DEPLOYMENT setting, which is the wrong grain for a switch
 * whose purpose is operational: "stop spending money right now" should not wait for a
 * build, and neither should "the curriculum importer needs the model for ten minutes".
 * It was also invisible — nothing in the product said whether AI was on, so the answer
 * lived in a file one person could read.
 *
 * Omitting `enabled` is treated as OFF rather than as "ask the environment". A caller
 * that forgets to resolve the flag must degrade to the template scaffold, which is a
 * working product, rather than start spending because a variable happened to be set.
 */
export function liveGenerationEnabled(enabled?: boolean): boolean {
  if (liveGenerationForbidden()) return false
  return enabled === true
}

/**
 * Picks a generator.
 *
 * Passing `config` is not enough on its own, and neither is the switch: **both** are required.
 * That asymmetry is the guardrail — an admin publishing a prompt does not thereby turn the
 * model on, and setting the switch on an environment with no prompt row degrades to a working
 * scaffold rather than to a 500.
 */
export function resolveGenerator(
  config?: LiveGeneratorConfig | null,
  enabled?: boolean,
): Generator {
  if (!liveGenerationEnabled(enabled)) return templateGenerator

  if (!config || config.models.length === 0 || !config.prompt) {
    /**
     * Said once, loudly. Someone has set `AI_GENERATOR=live` and expects AI; silently serving
     * scaffolds would leave them wondering why nothing changed — the same class of confusion as
     * the `turbo.json` globalEnv gap, where a variable was set and had no effect.
     */
    console.warn(
      '[@zsms/ai] Live generation is switched ON but no model chain or active prompt was '
        + 'supplied. Falling back to the scaffold. Check afritech.ai_models and '
        + 'ai_prompt_templates.',
    )
    return templateGenerator
  }

  return createLiveGenerator(config)
}

/** What a caller actually uses. */
export async function generateTeachingResource(
  request: GenerationRequest,
  config?: LiveGeneratorConfig | null,
  /** From `public.ai_live_generation()`. Omitted means OFF — see above. */
  enabled?: boolean,
): Promise<GenerationResult> {
  return resolveGenerator(config, enabled).generate(request)
}

/**
 * Whether a real model is behind the seam for THIS call. A function of the configuration rather
 * than a constant, so it stays correct per request — a school whose prompt row is missing gets a
 * scaffold and is told so, even while another request is model-backed.
 */
export function isModelBacked(config?: LiveGeneratorConfig | null): boolean {
  return resolveGenerator(config).name !== templateGenerator.name
}
