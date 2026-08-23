/**
 * GET /api/school/overview — the school dashboard's figures.
 *
 * Spec: `Official Documentation/06 School and Tenant Module/SCHOOL.md`
 *       `Official Documentation/01 Foundation Layer/RLS.md`
 *
 * ## Every panel is optional, because every panel is a different policy
 *
 * A dashboard that assembles five queries and 403s if any one of them is denied
 * is a dashboard only an owner can open. An accountant may read fee records and
 * not the staff list; a teacher may read their own classes' attendance and no
 * fees at all. So each section is fetched independently and a denial produces
 * `null` for that section rather than an error for the page.
 *
 * That is not the application deciding who sees what — RLS already did. A
 * teacher's fee query returns **zero rows**, not an error, because a SELECT
 * blocked by policy is empty rather than forbidden (see `api-response.ts`). The
 * shape here simply lets the page render what came back.
 *
 * The one consequence to be careful of: an empty section is ambiguous between
 * "nothing to show" and "not visible to you". So each section reports `visible`
 * alongside its figures, resolved from the caller's role, and the screen says
 * "no arrears" only when it is entitled to know that.
 */

import { getAuthProvider } from '@zsms/auth-provider'

import { createUserClient } from '../../../../lib/supabase'
import { toCapacity } from '../../../../lib/school-session'
import { can } from '../../../../lib/roles'
import { AFRITECH_ORG_SLUG } from '../../../../lib/admin-context'
import { fail, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/** Local YYYY-MM-DD. Attendance is a school-local date, not a UTC instant. */
function today(): string {
  const now = new Date()
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
}

export async function GET(): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    // An AfriTech operator has no "own school". Their policies match EVERY
    // school, so the `.maybeSingle()` below would fail with "multiple rows" and
    // surface as an unexplained 500 — a confusing answer to a request that is
    // simply addressed to the wrong surface. `/api/admin/overview` is theirs.
    if (session.organisationSlug === AFRITECH_ORG_SLUG) {
      return fail('FORBIDDEN', 'This is a school endpoint. Platform administrators use /api/admin/overview.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data: school } = await client
      .from('schools')
      .select('id, school_id, name, status, subscription_tier, finance_module_enabled, whatsapp_enabled')
      .maybeSingle()

    if (!school) return fail('NOT_FOUND', 'This session is not associated with a school.')

    const schoolId = school.id as string
    const role = session.role

    const [capacityRes, rollRes, feesRes, attendanceRes, announcementRes] = await Promise.all([
      client.rpc('school_student_capacity', { p_school_id: schoolId }),

      // Status breakdown. `head: false` because the counts come from the rows;
      // five separate count queries would be five round trips for six numbers.
      client.from('students').select('status').eq('is_deleted', false),

      can(role, 'fees:read')
        ? client
            .from('fee_records')
            .select('amount_due, amount_paid, discount_amount, status, due_date')
            .eq('is_deleted', false)
        : Promise.resolve({ data: null, error: null }),

      can(role, 'attendance:read')
        ? client
            .from('attendance_records')
            .select('status')
            .eq('attendance_date', today())
        : Promise.resolve({ data: null, error: null }),

      client
        .from('announcements')
        .select('id, title, importance, sent_at, status')
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(5),
    ])

    // --- Roll -------------------------------------------------------------
    const byStatus: Record<string, number> = {}
    for (const row of (rollRes.data ?? []) as Array<{ status: string }>) {
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1
    }

    // --- Fees -------------------------------------------------------------
    //
    // Arrears are surfaced, never acted on. CONVENTIONS and the arrears model
    // are explicit that an outstanding balance does not gate results,
    // certificates, or anything else unless a school turns that on itself. This
    // route returns figures; nothing downstream of it may read them as a lock.
    let fees: {
      visible: boolean
      totalDue: number
      totalPaid: number
      outstanding: number
      overdueCount: number
      studentsInArrears: number
    } | null = null

    if (can(role, 'fees:read')) {
      const rows = (feesRes.data ?? []) as Array<{
        amount_due: string | number
        amount_paid: string | number
        discount_amount: string | number | null
        status: string
        due_date: string | null
      }>

      const num = (v: string | number | null | undefined): number => {
        const n = typeof v === 'string' ? Number(v) : (v ?? 0)
        return Number.isFinite(n) ? n : 0
      }

      let totalDue = 0
      let totalPaid = 0
      let overdueCount = 0
      const day = today()

      for (const r of rows) {
        // Discount reduces what is owed. Omitting it overstates arrears, which
        // is the direction that produces a reminder to a parent who paid what
        // they were actually asked for.
        totalDue += num(r.amount_due) - num(r.discount_amount)
        totalPaid += num(r.amount_paid)
        if (r.status !== 'paid' && r.due_date && r.due_date < day) overdueCount += 1
      }

      fees = {
        visible: true,
        totalDue: Math.round(totalDue * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        outstanding: Math.round((totalDue - totalPaid) * 100) / 100,
        overdueCount,
        studentsInArrears: rows.filter((r) => r.status !== 'paid').length,
      }
    }

    // --- Attendance -------------------------------------------------------
    let attendance: { visible: boolean; date: string; present: number; absent: number; late: number; total: number } | null =
      null

    if (can(role, 'attendance:read')) {
      const rows = (attendanceRes.data ?? []) as Array<{ status: string }>
      attendance = {
        visible: true,
        date: today(),
        present: rows.filter((r) => r.status === 'present').length,
        absent: rows.filter((r) => r.status === 'absent').length,
        late: rows.filter((r) => r.status === 'late').length,
        total: rows.length,
      }
    }

    return ok({
      school: {
        id: schoolId,
        code: school.school_id,
        name: school.name,
        status: school.status,
        tier: school.subscription_tier,
        financeModuleEnabled: school.finance_module_enabled,
        whatsappEnabled: school.whatsapp_enabled,
      },
      role,
      capacity: toCapacity(capacityRes.data),
      roll: {
        total: (rollRes.data ?? []).length,
        // Only these two occupy a place — the same rule
        // `school_student_capacity()` counts by, stated once more here so the
        // dashboard's "enrolled" and the ceiling's "enrolled" cannot disagree.
        enrolled: (byStatus['active'] ?? 0) + (byStatus['on_leave'] ?? 0),
        byStatus,
      },
      fees,
      attendance,
      announcements: announcementRes.data ?? [],
    })
  })
}
