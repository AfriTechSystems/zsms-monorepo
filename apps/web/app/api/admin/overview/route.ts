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
    const [metrics, health] = await Promise.all([
      client.rpc('platform_metrics'),
      client.rpc('school_health_scores'),
    ])

    if (metrics.error) return fromPostgrestError(metrics.error)
    if (health.error) return fromPostgrestError(health.error)

    const rows = (health.data ?? []) as Array<Record<string, unknown>>

    return ok({
      metrics: (metrics.data as Array<Record<string, unknown>>)?.[0] ?? null,
      health: rows,
      // Counted here rather than in the component so the number on the card and
      // the length of the list beneath it cannot disagree.
      atRisk: rows.filter((r) => r['band'] === 'at_risk' || r['band'] === 'critical').length,
    })
  })
}
