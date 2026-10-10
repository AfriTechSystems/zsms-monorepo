/**
 * AfriTech's view of one school's AI usage.
 *
 *   GET /api/admin/schools/[id]/ai-usage
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/PLATFORM_METRICS.md`
 *       `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *
 * ## Aggregates only, and the route could not widen it if it tried
 *
 * Decided 2026-09-30: AfriTech sees totals, breakdowns and the usage distribution; the
 * school sees its own staff by name. None of the three functions called here returns a user
 * identifier, none takes a parameter that narrows to one person, and `0169` asserts both
 * structurally — so "just add the teacher names" is a migration somebody has to argue for,
 * not a line somebody adds to this file on a Friday.
 *
 * The reasoning is in `0169`'s header: named per-teacher behavioural profiles across every
 * customer school need a documented ZDPA purpose, and aggregates answer every pricing and
 * roadmap question that the names would.
 */

import { createUserClient } from '../../../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import { fail, fromPostgrestError, guard, ok } from '../../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { id } = await params

    /*
      No role check here. `is_afritech_admin()` inside each function is the gate, and it
      reads the organisation SLUG rather than a role claim — a check in this route would be
      a second rule stating the same thing, in a different vocabulary, that nothing tests.
      A non-AfriTech caller gets 42501 from the database, which `fromPostgrestError` renders
      as FORBIDDEN.
    */
    const [summary, byFeature, bySubject, byGrade, distribution] = await Promise.all([
      client.rpc('admin_school_ai_summary', { p_school_id: id }).maybeSingle(),
      client.rpc('admin_ai_usage_breakdown', { p_school_id: id, p_dimension: 'feature' }),
      client.rpc('admin_ai_usage_breakdown', { p_school_id: id, p_dimension: 'subject' }),
      client.rpc('admin_ai_usage_breakdown', { p_school_id: id, p_dimension: 'grade' }),
      client.rpc('admin_ai_usage_distribution', { p_school_id: id }),
    ])

    if (summary.error) return fromPostgrestError(summary.error)

    return ok({
      summary: summary.data ?? null,
      byFeature: byFeature.data ?? [],
      bySubject: bySubject.data ?? [],
      byGrade: byGrade.data ?? [],
      distribution: distribution.data ?? [],
    })
  })
}
