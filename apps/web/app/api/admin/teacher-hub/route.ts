/**
 * Teacher Hub accounts, from AfriTech's side.
 *
 *   GET  /api/admin/teacher-hub — every Hub account, with its plan and usage
 *   POST /api/admin/teacher-hub — record a received payment and activate a subscription
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *       `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *
 * ## Why activation lives here and nowhere else
 *
 * Teacher Hub payment is manual: a teacher sends mobile money or pays into the AfriTech
 * account, and somebody confirms it arrived. That confirmation is the whole control, so it
 * cannot be an action the teacher can take. `teacher_hub_activate_subscription()` raises
 * `42501` for anybody who is not AfriTech — the pgTAP suite asserts a teacher calling it
 * for their own account is refused — and this is the only route that calls it.
 *
 * This is the same shape as `verify_payment()` in the fees module: recording money is a
 * named, privileged act rather than a table write, so there is no path that marks a
 * subscription paid without a decision being attributable.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { resolveAdminContext } from '../../../../lib/admin-context'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

interface HubAccountRow {
  clerk_user_id: string
  full_name: string
  email: string
  phone_e164: string | null
  country_code: string
  plan_code: string
  subscription_status: string
  trial_resources_used: number
  trial_allowance_override: number | null
  resources_created: number
  subscription_started_at: string | null
  subscription_ends_at: string | null
  created_at: string
}

const activateSchema = z.object({
  clerkUserId: z.string().trim().min(1).max(200),
  planCode: z.string().trim().min(1).max(40),
  /**
   * Optional, because a payment sometimes covers an odd period — a teacher paying for two
   * months at once, or a goodwill extension. Absent, the plan's own period applies from now.
   */
  paidUntil: z.string().datetime().optional(),
})

export async function GET(): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const [accounts, plans] = await Promise.all([
      // `afritech_manage_teacher_accounts` and the SELECT policy both admit AfriTech, so
      // this returns every account rather than one.
      client
        .from('standalone_teacher_accounts')
        .select(
          'clerk_user_id, full_name, email, phone_e164, country_code, plan_code, ' +
            'subscription_status, trial_resources_used, trial_allowance_override, ' +
            'resources_created, subscription_started_at, subscription_ends_at, created_at',
        )
        .order('created_at', { ascending: false }),
      client.rpc('my_teacher_hub').maybeSingle(),
    ])

    if (accounts.error) return fromPostgrestError(accounts.error)

    // Narrowed after the error check above — see the note in the resources route.
    const rows = (accounts.data ?? []) as unknown as HubAccountRow[]
    const now = Date.now()

    return ok(
      {
        accounts: rows.map((a) => ({
          ...a,
          /**
           * Lapsed is a date comparison, not a status. Because billing is recorded by
           * hand, a row can easily still say `active` with a date months past — the
           * entitlement function decides on the date, so this list shows the same truth
           * rather than the stale label.
           */
          lapsed:
            (a.subscription_status === 'active' || a.subscription_status === 'cancelled') &&
            (!a.subscription_ends_at || new Date(a.subscription_ends_at).getTime() <= now),
        })),
        // The catalogue comes back on the same call so the activation form has its options
        // without a second round trip; `my_teacher_hub()` carries it already.
        plans:
          (plans.data as { plans?: unknown[] } | null)?.plans ?? [],
        summary: {
          total: rows.length,
          trial: rows.filter((a) => a.subscription_status === 'trial').length,
          active: rows.filter((a) => a.subscription_status === 'active').length,
          cancelled: rows.filter((a) => a.subscription_status === 'cancelled').length,
          suspended: rows.filter((a) => a.subscription_status === 'suspended').length,
        },
      },
      { total: rows.length },
    )
  })
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = activateSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)
    const body = parsed.data

    const { data, error } = await client.rpc('teacher_hub_activate_subscription', {
      p_clerk_user_id: body.clerkUserId,
      p_plan_code: body.planCode,
      p_paid_until: body.paidUntil ?? null,
    })

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === 'P0002') return fail('NOT_FOUND', error.message)
      // 22023 — the trial is not a subscription, so it cannot be activated as one.
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    return ok({ subscriptionEndsAt: data as unknown as string })
  })
}
