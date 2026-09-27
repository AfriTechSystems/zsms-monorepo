/**
 * GET /api/network/overview — every school in the caller's network, and the totals.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DATABASE.md` — school-group views
 *       migrations `0119`–`0122`
 *
 * ## Two calls, not one per school
 *
 * `network_school_summary()` is five grouped scans over the whole network and
 * `network_overview()` derives the totals from it, so a 100-school network costs the
 * same as a 5-school one. The existing N+1 against `/api/admin/schools/[id]` — one
 * `school_has_feature()` per feature — is the mistake this route exists not to
 * repeat.
 *
 * ## No membership check here, deliberately
 *
 * Both functions resolve `my_network_id()` internally and return nothing for a
 * caller outside a network. Re-checking in this route would put the rule in two
 * places, and the version here would be the one that drifts. The route reports
 * `hasNetwork: false` so the page can say "this does not apply to you" rather than
 * rendering an empty dashboard.
 *
 * ## The money columns can be null, and that is the answer
 *
 * When the network's `data_scope` or the member's role does not permit financial
 * figures, the aggregate returns NULL rather than 0 — a zero would read as "this
 * school is owed nothing". The route passes the nulls through untouched.
 */

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

interface AccessRow {
  out_network_id: string
  out_network_name: string
  out_network_slug: string
  out_role: string
  out_role_label: string
  out_data_scope: string
  out_can_manage: boolean
  out_can_attach: boolean
  out_can_see_money: boolean
  out_can_see_academic: boolean
}

export async function GET(): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const [access, schools, totals, billing] = await Promise.all([
      client.rpc('my_network_access'),
      client.rpc('network_school_summary'),
      client.rpc('network_overview'),
      // The consolidated ZSMS bill. Per the agreed model each school is invoiced
      // separately and the network merely SUMS them — so this is a read, exactly as
      // the dashboard aggregates are, and there is no network-level billing logic.
      client.rpc('network_billing_summary'),
    ])

    if (access.error) return fromPostgrestError(access.error)

    const a = ((access.data ?? []) as unknown as AccessRow[])[0]
    if (!a) {
      // Not an error. Most accounts belong to no network, and the page says so.
      return ok({ hasNetwork: false, network: null, schools: [], totals: null })
    }

    if (schools.error) return fromPostgrestError(schools.error)

    const rows = (schools.data ?? []) as unknown as Array<Record<string, unknown>>
    const t = ((totals.data ?? []) as unknown as Array<Record<string, unknown>>)[0] ?? null

    return ok({
      hasNetwork: true,
      network: {
        id: a.out_network_id,
        name: a.out_network_name,
        slug: a.out_network_slug,
        role: a.out_role,
        roleLabel: a.out_role_label,
        dataScope: a.out_data_scope,
        canManageMembers: a.out_can_manage,
        canSeeMoney: a.out_can_see_money,
      },
      schools: rows.map((r) => ({
        id: r['out_school_uuid'],
        code: r['out_school_code'],
        name: r['out_school_name'],
        cityCode: r['out_city_code'],
        status: r['out_status'],
        tier: r['out_tier'],
        // Carried so the dashboard can offer a drill-down that switches into the
        // school. The switcher itself decides whether the account may enter.
        organisationId: r['out_clerk_org_id'],
        pupils: r['out_pupils'],
        staff: r['out_staff'],
        capacity: r['out_capacity'],
        atCapacity: r['out_at_capacity'],
        feesBilled: r['out_fees_billed'],
        feesCollected: r['out_fees_collected'],
        feesOutstanding: r['out_fees_outstanding'],
        collectionRate: r['out_collection_rate'],
        attendanceRate: r['out_attendance_rate'],
        resultsPublished: r['out_results_published'],
      })),
      // Per school, so an owner can see which one is behind rather than only a total.
      billing: ((billing.data ?? []) as unknown as Array<Record<string, unknown>>).map((b) => ({
        schoolId: b['out_school_uuid'],
        schoolCode: b['out_school_code'],
        schoolName: b['out_school_name'],
        invoices: b['out_invoices'],
        billed: b['out_billed'],
        paid: b['out_paid'],
        outstanding: b['out_outstanding'],
        overdue: b['out_overdue'],
      })),
      totals: t
        ? {
            schools: t['out_schools'],
            pupils: t['out_pupils'],
            staff: t['out_staff'],
            feesBilled: t['out_fees_billed'],
            feesCollected: t['out_fees_collected'],
            feesOutstanding: t['out_fees_outstanding'],
            collectionRate: t['out_collection_rate'],
            attendanceRate: t['out_attendance_rate'],
            schoolsAtCapacity: t['out_schools_at_capacity'],
          }
        : null,
    })
  })
}
