/**
 * Product analytics (PostHog).
 *
 * Spec: `Official Documentation/01 Foundation Layer/ARCHITECTURE.md` (layer 12),
 *       `Official Documentation/01 Foundation Layer/COMPLIANCE.md`,
 *       `Official Documentation/03 Infrastructure Services/POSTHOG.md`
 *
 * ## Autocapture is OFF, and that is the whole design
 *
 * PostHog's default is to capture every click and input on the page, with the surrounding
 * DOM text as context. On a ZSMS screen that DOM is a class register with children's
 * names on it, a fee ledger with amounts against those names, and a pupil record carrying
 * an NRC and medical notes.
 *
 * `instrumentation-client.ts` already refuses Sentry session replay for exactly this
 * reason — "a recording of that leaving `af-south-1` is a ZDPA question, not a debugging
 * convenience". Autocapture is the same question with a different label, so it gets the
 * same answer.
 *
 * So: **autocapture off, input capture off, URLs stripped of their query string, and
 * every event named explicitly in code.** Nothing reaches PostHog that a developer did
 * not deliberately send.
 *
 * ## Why not the wizard
 *
 * `npx @posthog/wizard` requires Node >= 22.22.0 (this machine runs 22.17.1), is
 * interactive, and writes its own `instrumentation-client.ts` — which would have
 * overwritten the Sentry setup already in that file. It also enables autocapture by
 * default, which is the one thing that must not happen here.
 *
 * ## What is safe to send
 *
 * A route path, a role, and a count. Never a name, an amount, an identifier of a child,
 * or anything free-text a user typed. `track()` takes a closed set of event names so a
 * careless call site cannot invent one carrying a payload nobody reviewed.
 */

import posthog from 'posthog-js'

/**
 * The events ZSMS sends.
 *
 * A closed union rather than a free string: analytics grows by somebody adding an event,
 * and a reviewer seeing a new member of this type is the moment to ask what it carries.
 */
export type AnalyticsEvent =
  | 'school_registered'
  | 'pupil_enrolled'
  | 'payment_recorded'
  | 'payment_verified'
  | 'attendance_marked'
  | 'marks_saved'
  | 'results_published'
  | 'announcement_sent'
  | 'report_cards_generated'
  | 'timetable_published'
  | 'loan_application_submitted'
  | 'assistant_question_asked'
  | 'resource_generated'
  | 'onboarding_step_completed'

/** Properties an event may carry. Deliberately narrow. */
export interface AnalyticsProps {
  /** A role, never a user id. */
  role?: string
  /** A count — how many pupils, how many marks. Never an amount of money. */
  count?: number
  /** A coarse outcome, such as `success` or `refused`. */
  outcome?: string
  /** Which module, for funnel analysis. */
  module?: string
}

let started = false

/**
 * Starts PostHog, if it is configured.
 *
 * Called from `instrumentation-client.ts`. Silent when the key is absent, which is the
 * normal state in development and on any deployment that has not opted in — analytics is
 * not load-bearing and a missing key must not surface as an error.
 */
export function startAnalytics(): void {
  if (started || typeof window === 'undefined') return

  const key = process.env['NEXT_PUBLIC_POSTHOG_KEY']
  if (!key) return

  started = true

  posthog.init(key, {
    api_host: process.env['NEXT_PUBLIC_POSTHOG_HOST'] ?? 'https://eu.i.posthog.com',

    /*
      OFF. See the header.

      These three are the difference between product analytics and a covert copy of every
      school's roll.
    */
    autocapture: false,
    capture_pageview: false,
    disable_session_recording: true,

    /*
      No element text, no input values, no clipboard.

      `mask_all_element_attributes` also stops `data-*` attributes travelling, which on
      this codebase includes `data-numeric` on money.
    */
    mask_all_text: true,
    mask_all_element_attributes: true,

    /*
      Strip the query string from every URL before it leaves the browser.

      ZSMS puts `?childId=`, `?classId=` and `?feeRecordId=` in query strings, and each of
      those identifies a child. The path alone is what analytics actually needs.
    */
    sanitize_properties: (properties) => {
      const clean = { ...properties }
      for (const field of ['$current_url', '$referrer', '$pathname']) {
        const value = clean[field]
        if (typeof value === 'string') {
          clean[field] = value.split('?')[0]
        }
      }
      return clean
    },

    /*
      No cross-site cookie, and no identification by default.

      A parent is not tracked across the web because they paid school fees. The person is
      only ever identified by `identifyRole()` below, which sends a ROLE and not an
      identity.
    */
    persistence: 'localStorage',
    disable_surveys: true,
  })
}

/**
 * Records a page view, with the path only.
 *
 * `capture_pageview` is off because PostHog's own version sends the full URL including
 * the query string. This sends the path.
 */
export function trackPageView(pathname: string): void {
  if (!started) return
  posthog.capture('$pageview', { $current_url: pathname.split('?')[0] })
}

/** Records one named event. */
export function track(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  if (!started) return
  posthog.capture(event, props)
}

/**
 * Groups this session by ROLE and school, without identifying the person.
 *
 * `COMPLIANCE.md` keeps substantive personal data in `af-south-1`; PostHog is neither
 * that region nor a processor named in the DPA, so no name, email or Clerk id goes to it.
 * A role and a school code are enough to answer "do accountants use this screen" and
 * "which schools have stopped marking registers", which is what the analytics is for.
 */
export function identifyRole(role: string, schoolCode?: string): void {
  if (!started) return
  posthog.setPersonProperties({ role })
  if (schoolCode) posthog.group('school', schoolCode)
}
