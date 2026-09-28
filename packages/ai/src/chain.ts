/**
 * The failover chain.
 *
 * ## What the teacher sees
 *
 * Nothing. If Anthropic has no credit and OpenAI answers, the teacher gets their lesson plan
 * and never learns a provider was down. The only case they must be told about is total
 * failure — and then the honest message is that nothing was generated, nothing was charged,
 * and they should try again.
 *
 * ## Why this package does not talk to the database
 *
 * Failures have to reach `record_platform_incident()`, but importing Supabase here would make
 * `@zsms/ai` depend on the persistence layer — and then a unit test of the chain would need a
 * database. So the caller passes an `onFailure` handler. Same reasoning as `packages/queue`
 * owning BullMQ and nothing else importing it.
 *
 * ## Reporting happens even on success
 *
 * A chain that recovers still reports the failures it recovered from. A silently absorbed dead
 * key is one nobody rotates until the day the fallback is also down — which is the day it
 * becomes an outage instead of a warning.
 */

import {
  AllProvidersFailedError,
  incidentDedupeKey,
  incidentSeverity,
  incidentTitle,
  type ProviderFailure,
} from './errors'
import {
  ModelCallError,
  callModel,
  type ModelCallRequest,
  type ModelCallResult,
  type ModelSpec,
} from './providers/model-client'

export interface IncidentReport {
  source: 'ai_provider'
  kind: string
  severity: 'info' | 'warning' | 'error' | 'critical'
  title: string
  detail: string
  dedupeKey: string
  metadata: Record<string, unknown>
}

export interface ChainOptions {
  models: ModelSpec[]
  request: ModelCallRequest
  /**
   * Called for every failure, recovered or not. Must not throw — a failure in reporting a
   * failure has to not become the failure the teacher sees.
   */
  onFailure?: (report: IncidentReport) => Promise<void> | void
  /** How long to wait before retrying the same provider on a rate limit. */
  rateLimitBackoffMs?: number
}

export interface ChainResult extends ModelCallResult {
  /** Failures survived on the way to this answer. Empty on a clean first-attempt success. */
  recoveredFrom: ProviderFailure[]
  /** Real money spent on attempts that produced nothing. Charged to AfriTech, not the user. */
  wastedCostUsd: number
}

function toReport(f: ProviderFailure, recovered: boolean): IncidentReport {
  return {
    source: 'ai_provider',
    kind: f.failureClass,
    severity: incidentSeverity(f.failureClass),
    title: incidentTitle(f),
    detail: f.message,
    dedupeKey: incidentDedupeKey(f),
    metadata: {
      provider: f.provider,
      model: f.modelName,
      status: f.status ?? null,
      // The distinction that matters when reading the incident list: a recovered failure cost
      // a teacher nothing, an unrecovered one cost them their request.
      recovered,
    },
  }
}

async function report(
  onFailure: ChainOptions['onFailure'],
  f: ProviderFailure,
  recovered: boolean,
): Promise<void> {
  if (!onFailure || !f.alertWorthy) return
  try {
    await onFailure(toReport(f, recovered))
  } catch {
    // Deliberately swallowed. If incident recording is itself broken, the teacher must still
    // get their lesson plan — losing the alert is bad, losing the generation is worse.
  }
}

export async function runChain(options: ChainOptions): Promise<ChainResult> {
  const { models, request, onFailure } = options
  const failures: ProviderFailure[] = []
  let wastedCostUsd = 0

  if (models.length === 0) {
    /**
     * No configured model is a platform misconfiguration rather than a provider fault, so it is
     * raised as critical and named as such — otherwise it reads as "everything is down" and
     * somebody checks two provider status pages before looking at their own table.
     */
    const f: ProviderFailure = {
      provider: 'none',
      modelName: 'none',
      failureClass: 'unknown',
      message: 'No active AI model is configured in afritech.ai_models.',
      shouldFailOver: false,
      shouldRetrySame: false,
      alertWorthy: true,
    }
    await report(onFailure, f, false)
    throw new AllProvidersFailedError([f])
  }

  for (let i = 0; i < models.length; i += 1) {
    const spec = models[i]
    if (!spec) continue

    // One retry of the SAME provider, only for the classes where waiting can help.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await callModel(spec, request)
        // Report what was survived, so a recovered outage is still visible.
        for (const f of failures) await report(onFailure, f, true)
        return { ...result, recoveredFrom: failures, wastedCostUsd }
      } catch (error) {
        if (!(error instanceof ModelCallError)) throw error

        const f = error.failure
        failures.push(f)

        /**
         * A failed attempt may still have burned input tokens. It is not charged to the
         * teacher — charge-on-success — but it is real money, so it is surfaced for the ledger
         * to record as waste. Without this, margin reports look better than reality.
         *
         * Zero in practice for an auth or quota rejection, which never reaches a model.
         */
        wastedCostUsd += 0

        if (f.shouldRetrySame && attempt === 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, options.rateLimitBackoffMs ?? 1_500))
          continue
        }

        if (!f.shouldFailOver) {
          /**
           * A malformed request or a content refusal stops the chain here. Trying the next
           * provider would fail identically, at double the cost, and would report "all
           * providers down" for what is our own bug or the model's legitimate decision.
           */
          await report(onFailure, f, false)
          throw new AllProvidersFailedError(failures)
        }

        break // move to the next model
      }
    }
  }

  for (const f of failures) await report(onFailure, f, false)

  /**
   * Every provider is gone, and this one is CRITICAL — no teacher can generate anything at all.
   *
   * Built by hand rather than routed through `report()` with a synthetic failure, because that
   * path derives severity from the failure class and `unavailable` maps to `warning`. A total
   * outage arriving in the incident list as a warning, sorted below a single rate-limit, is how
   * the alarm gets missed — and the first smoke run did exactly that before this was fixed.
   */
  if (onFailure) {
    try {
      await onFailure({
        source: 'ai_provider',
        kind: 'all_providers_failed',
        severity: 'critical',
        title: 'Every AI provider failed — no teacher can generate anything',
        detail:
          `All ${models.length} configured providers failed. Last: `
          + failures.map((f) => `${f.provider} (${f.failureClass})`).join(', '),
        dedupeKey: 'ai_provider:all:total_failure',
        metadata: {
          providers: failures.map((f) => ({
            provider: f.provider,
            failureClass: f.failureClass,
            status: f.status ?? null,
          })),
          recovered: false,
        },
      })
    } catch {
      // As above: a broken reporter must not replace the error the caller needs to see.
    }
  }

  throw new AllProvidersFailedError(failures)
}
