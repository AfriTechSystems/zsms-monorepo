/**
 * Where an unhandled route exception goes.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/SENTRY.md`
 *       `Official Documentation/15 Super Admin and Platform/PLATFORM_METRICS.md`
 *
 * ## Two destinations, because they answer different questions
 *
 * `CLAUDE.md` tracked this as one gap and it is two:
 *
 *   * **Sentry** takes the stack trace. It answers *"what line broke and why"* — a developer's question,
 *     with a developer's payload, and nothing an operator wants to read.
 *   * **`platform_incidents`** takes one deduplicated row with an acknowledge/resolve lifecycle. It
 *     answers *"is something wrong that AfriTech must act on"*, and appears on `/admin/incidents` with a
 *     count in the sidebar.
 *
 * Sending only to Sentry means nobody at AfriTech notices until a school telephones. Recording only an
 * incident means somebody notices and has no stack trace to act on. `0134` built the incidents table
 * with this in mind and nothing has ever written to it from a route.
 *
 * ## Deduplication is the reason this is not one line
 *
 * A broken route breaks for everybody. Recording one incident per request would put four hundred rows
 * in front of an operator for one fault and bury every other signal — which is worse than recording
 * none, because it destroys the surface's usefulness rather than just failing to use it.
 *
 * `record_platform_incident()` deduplicates on `dedupe_key` and re-opens on recurrence, so the key has
 * to describe *the fault*, not *the request*. Here that is the route plus the error's shape:
 * `api_route:/api/school/fees:TypeError`. Four hundred failures become one row with a count, and a
 * different error on the same route is a different row.
 *
 * ## Never throws
 *
 * Every call is wrapped. This runs inside the `catch` of a request that has already failed, and an
 * exception raised while reporting an exception replaces a useful 500 with a useless one — and loses
 * the original. The reporting is best-effort by construction.
 */

import * as Sentry from '@sentry/nextjs'

import { createUserClient } from './supabase'

/**
 * A stable, low-cardinality key for one fault.
 *
 * The error's constructor name rather than its message: messages carry ids, names and amounts, so
 * `Cannot read properties of null (reading 'name')` on two different pupils would be two incidents for
 * one bug. The class is the same for both.
 */
function dedupeKey(route: string, error: unknown): string {
  const kind = error instanceof Error ? error.constructor.name : typeof error
  return `api_route:${route}:${kind}`
}

/**
 * Truncated, and only the message.
 *
 * A stack trace belongs in Sentry, not in a Postgres column an operator reads on a phone — and a
 * message can be long enough to make the incidents list unusable. 400 characters is enough to
 * recognise a fault you have seen before.
 */
function shortDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 400 ? `${message.slice(0, 397)}…` : message
}

/**
 * The failing route, read out of the stack.
 *
 * The alternative was `guard(handler, '/api/school/fees')` at every call site — seventy edits, and
 * seventy chances for the string to drift from the folder it names after a rename. Deriving it means
 * a route file needs to know nothing about error reporting, which is the point of `guard()` being the
 * single place this happens.
 *
 * It reads the first frame under `app/api/`, which Next includes in a server stack trace. Returns
 * `unknown` when it cannot tell — the incident is still recorded, just grouped less precisely, which
 * is a better failure than not recording one.
 */
export function routeFromStack(error: unknown): string {
  if (!(error instanceof Error) || !error.stack) return 'unknown'

  // Both separators: the same build runs on Windows locally and Linux on Vercel.
  const match = /app[\\/]+(api[\\/]+[^\s)]*?)[\\/]+route\.(?:ts|js)/.exec(error.stack)
  if (!match?.[1]) return 'unknown'

  return `/${match[1].replace(/\\/g, '/')}`
}

export async function reportRouteError(error: unknown, route: string): Promise<void> {
  // Always first, and never conditional on the incident write succeeding. The stack trace is the
  // thing that cannot be reconstructed later.
  try {
    Sentry.captureException(error, {
      tags: { route },
      // The scrubbing in `instrumentation.ts` removes request data; the route name is what remains
      // useful and carries nothing about a person.
      extra: { route },
    })
  } catch {
    // A failed report must not replace the caller's error.
  }

  try {
    /**
     * The CALLER'S client, not a service-role one.
     *
     * `record_platform_incident()` is granted to `authenticated`, and using the caller's token means a
     * route cannot record an incident from a seat it does not hold. It also means an unauthenticated
     * 500 records no incident — which is the right trade: opening a service-role path here would give
     * every public route a way to write to an AfriTech-visible table, and the public routes are the
     * ones reachable without an account.
     */
    const client = await createUserClient()
    if (!client) return

    await client.rpc('record_platform_incident', {
      p_source: 'api_route',
      // Free text by design in `0134` — the set of distinguishable failures grows weekly and a CHECK
      // would mean a migration to report a new one.
      p_kind: error instanceof Error ? error.constructor.name : 'UnknownError',
      p_title: `${route} is failing`,
      p_dedupe_key: dedupeKey(route, error),
      /**
       * `error`, not `critical`. A 500 on one route is serious and is not the platform being down;
       * reserving `critical` for total-failure conditions is what keeps it meaningful — the same
       * judgement `packages/ai` makes for a whole-chain failure.
       */
      p_severity: 'error',
      p_detail: shortDetail(error),
      p_is_school_visible: false,
    })
  } catch {
    // Best effort, by construction. See the header.
  }
}
