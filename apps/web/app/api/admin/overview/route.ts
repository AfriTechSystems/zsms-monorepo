/**
 * GET /api/admin/overview — the dashboard headline.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/PLATFORM_METRICS.md`
 *       `Official Documentation/15 Super Admin and Platform/SCHOOL_HEALTH_SCORES.md`
 *
 * One request rather than three. The overview screen needs metrics, the health
 * ranking, and the at-risk count together or not at all — three round trips on a
 * Lusaka connection is three chances to render a half-populated dashboard, and a
 * partially-loaded revenue figure is worse than a spinner.
 */

import { createUserClient } from '../../../../lib/supabase'
import { resolveAdminContext } from '../../../../lib/admin-context'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    // Both functions are SECURITY INVOKER, so RLS scopes them to what this
    // operator may see. The 403 above is the courtesy; this is the boundary.
    const [metrics, health, integrations, consent, trials, business, byTier, history] =
      await Promise.all([
      client.rpc('platform_metrics'),
      client.rpc('school_health_scores'),
      /*
        Two aggregates that had no caller.

        `admin_integration_health()` (`0230`) and `admin_marketing_consent_summary()`
        (`0229`) were both built with no route and no screen — correct, tested, and
        unreachable, which `npm run gaps` flagged and this fixes. They belong here
        because the overview is where platform-wide numbers live, and because a
        failing integration at one school is an operational fact somebody should meet
        without going looking for it.
      */
      client.rpc('admin_integration_health'),
      client.rpc('admin_marketing_consent_summary'),
      /*
        Trials, with days remaining computed in the database.

        TRIAL.md's notification schedule turns on exact day counts — 25, 28, 30, 33,
        37 — and a browser clock in another timezone would put a school on the wrong
        rung. One answer for the overview and for the notifier when it exists.
      */
      client.rpc('admin_trial_status'),
      /*
        AfriTech's own business metrics (`0261`).

        PLATFORM_METRICS.md is mostly about these -- MRR, ARR, revenue by tier,
        trial conversion, loan commission revenue -- and none of them were computed
        anywhere. `platform_metrics()` counts schools and pupils, which is a
        different question.

        Both are gated on the `billing:read` capability rather than on being an
        AfriTech administrator, so a support agent's overview simply omits revenue
        instead of failing. That is why their errors are tolerated below.
      */
      client.rpc('admin_business_metrics'),
      client.rpc('admin_revenue_by_tier'),
      /*
        The daily snapshots behind the growth chart (`0267`).

        365 days is the window, not the chart's resolution: the component thins it to
        one point per month. Asking for a year and thinning here means changing the
        chart's granularity needs no API change.
      */
      client.rpc('admin_platform_history', { p_days: 365 }),
    ])

    if (metrics.error) return fromPostgrestError(metrics.error)
    if (health.error) return fromPostgrestError(health.error)

    const rows = (health.data ?? []) as Array<Record<string, unknown>>

    return ok({
      /*
        Revenue is absent rather than fatal when the caller lacks `billing:read`.

        A support agent has a legitimate overview; refusing the whole page because
        they cannot see MRR would make the capability split (`0237`) a worse
        experience than not having it. The screen renders what it was given.
      */
      business: business.error
        ? null
        : ((business.data as Array<Record<string, unknown>>)?.[0] ?? null),
      revenueByTier: byTier.error
        ? []
        : ((byTier.data as Array<Record<string, unknown>>) ?? []),
      /*
        Only days that were actually captured — `admin_platform_history()` does no gap
        filling. A line through interpolated points looks exactly like a line through
        measured ones, and this chart's whole value is being believed.
      */
      history: history.error
        ? []
        : ((history.data as Array<Record<string, unknown>>) ?? []),
      metrics: (metrics.data as Array<Record<string, unknown>>)?.[0] ?? null,
      health: rows,
      // Counted here rather than in the component so the number on the card and
      // the length of the list beneath it cannot disagree.
      atRisk: rows.filter((r) => r['band'] === 'at_risk' || r['band'] === 'critical').length,

      /*
        Both are capability-gated in the database — `admin_marketing_consent_summary()`
        is AfriTech-only and `admin_integration_health()` likewise — so a caller
        without the role gets an error rather than data. That is not a reason to fail
        the whole page: the overview is useful without them, and a role that cannot
        see one number should still see the rest.
      */
      integrations: integrations.error
        ? []
        : ((integrations.data ?? []) as Array<Record<string, unknown>>),
      integrationsLoaded: !integrations.error,

      // A COUNT, never a list. `0169` set that precedent and `0229` follows it: a
      // function returning the opted-in parents would be a marketing list assembled
      // from every school's roll.
      marketingConsent: consent.error
        ? null
        : ((consent.data as Array<Record<string, unknown>>)?.[0] ?? null),

      trials: trials.error ? [] : ((trials.data ?? []) as Array<Record<string, unknown>>),
      trialsLoaded: !trials.error,
      /*
        Surfaced separately because it is the one that needs acting on. A trial that
        has run out and has NOT been expired means the job is not running — which was
        the state of the world until `0244`, with one school past its date and nobody
        aware.
      */
      trialsOverdue: trials.error
        ? 0
        : ((trials.data ?? []) as Array<Record<string, unknown>>).filter(
            (t) => t['out_is_overdue'] === true,
          ).length,
    })
  })
}
