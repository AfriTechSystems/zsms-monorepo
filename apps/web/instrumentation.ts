/**
 * Server and edge error reporting.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/SENTRY.md`
 *       `Official Documentation/01 Foundation Layer/ENV.md`
 *
 * ## What was missing until now
 *
 * `CLAUDE.md` and `ENV.md` both implied Sentry was wired. It was not installed at all — no dependency,
 * no config, no `captureException`, no `global-error.tsx`. An unhandled exception reached the console of
 * whichever machine happened to be running the process and nobody else.
 *
 * The cost of that is not hypothetical. The sign-in lockout — an authenticated user with no
 * organisation bounced between `/school` and `/sign-in` forever — was found by a person trying to use
 * the product and reporting it. It is exactly the shape Sentry surfaces on the first occurrence.
 *
 * ## Absent DSN means absent, not broken
 *
 * `Sentry.init()` is skipped entirely when `SENTRY_DSN` is unset, and that is the load-bearing line in
 * this file. CI has no DSN and must not acquire one — the build proves it needs no real secret — and
 * neither does a contributor running `npm run dev` for the first time. Initialising with an empty DSN
 * would either throw or queue events forever, and the failure would look like an application fault in
 * an environment that was configured correctly.
 *
 * ## Why `instrumentation.ts` rather than `sentry.server.config.ts`
 *
 * The three-file `sentry.*.config.ts` layout is the older convention. Next 15 runs
 * `register()` from this file once per runtime before anything else, which is the only hook that fires
 * early enough to catch an exception thrown while a route module is still being evaluated.
 */

import * as Sentry from '@sentry/nextjs'

export async function register(): Promise<void> {
  const dsn = process.env['SENTRY_DSN']

  /**
   * No DSN, no Sentry. Silent rather than a warning: a warning on every cold start in development
   * trains people to ignore the log, and the absence is the normal case locally.
   */
  if (!dsn) return

  Sentry.init({
    dsn,

    /**
     * `VERCEL_GIT_COMMIT_SHA` when deployed, so a stack trace can be pinned to a commit. `/api/health`
     * already reads this for the same purpose, and falls back the same way.
     */
    release: process.env['VERCEL_GIT_COMMIT_SHA'] ?? 'dev',
    environment: process.env['NODE_ENV'] ?? 'development',

    /**
     * No performance tracing. It multiplies the event volume against a free tier and answers a
     * question nobody is asking yet — ZSMS has no latency complaints, it has unreported crashes.
     * Turn it on when there is a slow page somebody has noticed.
     */
    tracesSampleRate: 0,

    /**
     * Every error, always. Sampling is for products with enough traffic that the tail is
     * representative; with a handful of pilot schools, a dropped event is a bug nobody ever hears
     * about again.
     */
    sampleRate: 1,

    /**
     * THE PART THAT MATTERS MOST IN THIS FILE.
     *
     * ZSMS holds several hundred children's names, dates of birth and in some cases medical notes,
     * under the Zambia Data Protection Act. Sentry is a processor outside `af-south-1`, and an
     * exception's local variables and request body are exactly where a pupil's row ends up.
     *
     * The first version of this set `sendDefaultPii: false`. That option **does not exist in SDK v11**
     * — `type-check` rejected it — and rather than look up what the new default is and trust it, the
     * scrubbing below is exhaustive and explicit. A privacy control that depends on a library default
     * is one library upgrade away from silently reversing, and the thing it would leak is a child's
     * record.
     *
     * So: everything that could carry personal data is removed by name, whether or not the SDK would
     * have attached it.
     */
    beforeSend(event) {
      /**
       * Query strings go entirely. A school code is harmless, but `?school_id=…` sits beside `?q=`
       * searches and, on the parent side, identifiers that name a child. Dropping the whole string is
       * easier to reason about than deciding per parameter, and the path alone identifies the failing
       * route — which is all a stack trace needs.
       */
      if (event.request?.url) {
        const [path] = event.request.url.split('?')
        event.request.url = path
      }

      if (event.request) {
        // The request body. On a fee or enrolment route this is the pupil's record verbatim.
        delete event.request.data
        delete event.request.cookies
        // Headers carry the session token and the caller's address.
        delete event.request.headers
        delete event.request.query_string
      }

      /**
       * `event.user` is the Clerk id, email and IP when the SDK can find them. The id alone would be
       * genuinely useful for support — but it is only useful next to the school and the pupil, and
       * that combination is the thing this whole block exists to keep out. The `digest` on
       * `global-error.tsx` is how a specific crash gets identified instead.
       */
      delete event.user

      return event
    },

    /**
     * Noise that tells us nothing. `NEXT_NOT_FOUND` and `NEXT_REDIRECT` are how the App Router
     * implements `notFound()` and `redirect()` — they are control flow thrown as exceptions, and
     * every one of them is a page working correctly.
     */
    ignoreErrors: ['NEXT_NOT_FOUND', 'NEXT_REDIRECT'],
  })
}

/**
 * Required by Next 15 so a nested React Server Component error keeps its stack when it reaches Sentry.
 * Without it the report points at the boundary that caught the error rather than the code that threw.
 */
export const onRequestError = Sentry.captureRequestError
