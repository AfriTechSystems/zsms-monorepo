/**
 * Browser error reporting.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/SENTRY.md`
 *
 * ## Why the browser half is worth having separately
 *
 * A server exception is visible in a log somewhere even without Sentry. A browser exception is visible
 * to nobody: a school clerk whose fee screen renders blank closes the tab and telephones AfriTech, and
 * the only account of what happened is theirs. Most of what a school will actually report as "ZSMS is
 * broken today" originates here.
 *
 * ## `NEXT_PUBLIC_SENTRY_DSN`, not `SENTRY_DSN`
 *
 * A browser bundle can only read `NEXT_PUBLIC_*` — Next inlines those at build time and strips
 * everything else, which is the point. So the client half stays dark until that variable is set, and it
 * is deliberately a second decision: a DSN in the bundle is public, readable by anyone who views
 * source, and usable by anyone who wants to post events to your quota. That is the accepted trade for
 * browser reporting, and it should be accepted explicitly rather than inherited from the server key.
 */

import * as Sentry from '@sentry/nextjs'

const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN']

if (dsn) {
  Sentry.init({
    dsn,
    release: process.env['NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA'] ?? 'dev',
    environment: process.env['NODE_ENV'] ?? 'development',

    // Same reasoning as the server: every error, no tracing. See `instrumentation.ts`.
    tracesSampleRate: 0,
    sampleRate: 1,

    /**
     * No session replay. It records the DOM, and the DOM of a ZSMS screen is a class register with
     * children's names on it — a recording of that leaving `af-south-1` is a ZDPA question, not a
     * debugging convenience. If it is ever wanted it needs masking rules decided deliberately, not a
     * default.
     */
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    /**
     * Same reasoning as the server, and the same correction: `sendDefaultPii` does not exist in SDK
     * v11, so the scrubbing is explicit rather than resting on a default. See `instrumentation.ts`.
     */
    beforeSend(event) {
      if (event.request?.url) {
        const [path] = event.request.url.split('?')
        event.request.url = path
      }
      if (event.request) {
        delete event.request.data
        delete event.request.cookies
        delete event.request.headers
        delete event.request.query_string
      }
      delete event.user
      return event
    },

    ignoreErrors: [
      'NEXT_NOT_FOUND',
      'NEXT_REDIRECT',
      /**
       * Extensions and flaky mobile networks, which generate most of the volume on a browser SDK and
       * describe nothing about ZSMS. `Failed to fetch` is the one worth naming: on a Zambian mobile
       * connection it is routine, and treating it as a defect would bury the reports that are.
       */
      'ResizeObserver loop',
      'Non-Error promise rejection captured',
      'Failed to fetch',
      'NetworkError',
      'Load failed',
    ],
  })
}

/** Reports a slow or failed route transition. Required by Next 15's navigation instrumentation. */
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
