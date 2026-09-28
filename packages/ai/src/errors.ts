/**
 * Classifying a provider failure, which is the part that decides whether failing over is
 * sensible or wasteful.
 *
 * ## Why "retry the next provider on any error" is wrong
 *
 * A malformed request fails **identically** on every provider. Blind failover therefore turns
 * one bug into two paid failures, and — worse — hides it: the chain reports "all providers
 * failed", the incident says the providers are down, and the actual defect is in our prompt.
 *
 * So the class decides:
 *
 *   - `auth`        invalid or revoked key      → fail over, alert: needs rotation
 *   - `quota`       out of credits / hard limit → fail over, alert: needs topping up
 *   - `rate_limit`  transient throttling        → retry SAME provider with backoff, then over
 *   - `unavailable` 5xx, timeout, network       → fail over, alert if sustained
 *   - `request`     malformed / schema refused  → **do NOT fail over**, alert: our bug
 *   - `content`     safety refusal              → **do NOT fail over**, surface to the caller
 *   - `unknown`     unrecognised                → fail over once, alert
 *
 * `content` deserves a note. A refusal is a *decision*, not a fault, and a teacher asking for
 * something a model declines should be told, not silently served a second provider's answer to
 * the same request. Providers differ at the margins, so failover here would also make the
 * product's behaviour depend on which key happened to have credit.
 */

export type FailureClass =
  | 'auth'
  | 'quota'
  | 'rate_limit'
  | 'unavailable'
  | 'request'
  | 'content'
  | 'unknown'

export interface ProviderFailure {
  provider: string
  modelName: string
  failureClass: FailureClass
  /** HTTP status where there was one. Absent for a network error or a timeout. */
  status?: number
  message: string
  /** Whether trying the NEXT provider could plausibly succeed. */
  shouldFailOver: boolean
  /** Whether retrying THIS provider after a pause could succeed. */
  shouldRetrySame: boolean
  /** Whether AfriTech needs to know. Not every failure is an incident. */
  alertWorthy: boolean
}

/**
 * The severity an incident gets. `quota` and `auth` are `error` rather than `critical` because
 * the chain absorbs them — the teacher still gets their lesson plan from the next provider, so
 * it is urgent for AfriTech and invisible to the user. Only a total chain failure is critical,
 * and that is raised by the chain rather than here.
 */
export function incidentSeverity(cls: FailureClass): 'info' | 'warning' | 'error' | 'critical' {
  switch (cls) {
    case 'auth':
    case 'quota':
      return 'error'
    case 'request':
      // Our bug. Nobody else will fix it, and it fails for every teacher until we do.
      return 'error'
    case 'unavailable':
      return 'warning'
    case 'rate_limit':
      return 'warning'
    case 'content':
    case 'unknown':
      return 'info'
  }
}

/** A short, human sentence for the incident title. AfriTech reads this, not a stack trace. */
export function incidentTitle(f: ProviderFailure): string {
  switch (f.failureClass) {
    case 'auth':
      return `${f.provider} API key rejected — needs rotating`
    case 'quota':
      return `${f.provider} is out of credit — needs topping up`
    case 'rate_limit':
      return `${f.provider} is rate-limiting ZSMS`
    case 'unavailable':
      return `${f.provider} is unavailable`
    case 'request':
      return `ZSMS sent ${f.provider} a request it rejected`
    case 'content':
      return `${f.provider} declined to answer a request`
    case 'unknown':
      return `${f.provider} failed for an unrecognised reason`
  }
}

/**
 * The dedupe key. One incident per provider per failure class — NOT per model, and certainly
 * not per occurrence.
 *
 * Per-model would split one dead key across every model that uses it, which is the same
 * problem deduplication exists to solve one level up.
 */
export function incidentDedupeKey(f: ProviderFailure): string {
  return `ai_provider:${f.provider}:${f.failureClass}`
}

const POLICY: Record<
  FailureClass,
  { shouldFailOver: boolean; shouldRetrySame: boolean; alertWorthy: boolean }
> = {
  auth: { shouldFailOver: true, shouldRetrySame: false, alertWorthy: true },
  quota: { shouldFailOver: true, shouldRetrySame: false, alertWorthy: true },
  rate_limit: { shouldFailOver: true, shouldRetrySame: true, alertWorthy: true },
  unavailable: { shouldFailOver: true, shouldRetrySame: true, alertWorthy: true },
  // The two that must not fan out across providers.
  request: { shouldFailOver: false, shouldRetrySame: false, alertWorthy: true },
  content: { shouldFailOver: false, shouldRetrySame: false, alertWorthy: false },
  unknown: { shouldFailOver: true, shouldRetrySame: false, alertWorthy: true },
}

/**
 * Both providers use broadly the same HTTP vocabulary, so one classifier serves both with a
 * per-provider hint for the cases where they diverge.
 *
 * The important divergence: **OpenAI returns 429 for BOTH rate limiting and a spent quota**,
 * distinguished only by an error code in the body (`insufficient_quota`). Treating that as a
 * rate limit would make ZSMS sit in a backoff loop against a wall it cannot get past, and
 * never fail over — the exact situation this project is in with its Anthropic key, only
 * inverted. Anthropic uses 400 with `credit balance is too low`, which is why the body is
 * inspected and not just the status.
 */
export function classifyFailure(
  provider: string,
  modelName: string,
  status: number | undefined,
  body: unknown,
  message: string,
): ProviderFailure {
  const text = `${message} ${typeof body === 'string' ? body : JSON.stringify(body ?? '')}`
    .toLowerCase()

  let cls: FailureClass

  if (status === 401 || status === 403 || text.includes('invalid api key')
      || text.includes('incorrect api key') || text.includes('authentication')) {
    cls = 'auth'
  } else if (
    status === 402
    // OpenAI: 429 + insufficient_quota. Not a rate limit, and backing off never clears it.
    || text.includes('insufficient_quota')
    || text.includes('exceeded your current quota')
    // Anthropic: 400 + "Your credit balance is too low".
    || text.includes('credit balance is too low')
    || text.includes('billing')
  ) {
    cls = 'quota'
  } else if (status === 429) {
    cls = 'rate_limit'
  } else if (status !== undefined && status >= 500) {
    cls = 'unavailable'
  } else if (status === undefined) {
    // No response at all: DNS, TLS, socket, or our own timeout.
    cls = 'unavailable'
  } else if (text.includes('refus') || text.includes('safety') || text.includes('content_policy')) {
    cls = 'content'
  } else if (status === 400 || status === 404 || status === 422) {
    cls = 'request'
  } else {
    cls = 'unknown'
  }

  return { provider, modelName, failureClass: cls, status, message, ...POLICY[cls] }
}

/** Thrown when every model in the chain has been tried. Carries the whole history. */
export class AllProvidersFailedError extends Error {
  readonly failures: ProviderFailure[]

  constructor(failures: ProviderFailure[]) {
    /**
     * The message names the LAST failure rather than the first. The first is usually the dead
     * key everyone already knows about; the last is the one that stopped the chain, and is the
     * useful thing to read at the top of a log.
     */
    const last = failures[failures.length - 1]
    super(
      last
        ? `Every AI provider failed. Last: ${last.provider} (${last.failureClass}) — ${last.message}`
        : 'No AI provider was configured.',
    )
    this.name = 'AllProvidersFailedError'
    this.failures = failures
  }
}
