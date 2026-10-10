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

/**
 * What a Hub plan's price form may change.
 *
 * `planCode` identifies the row and is not among the editable fields: it is referenced by
 * `standalone_teacher_accounts.plan_code`, so renaming one in place orphans every account.
 * `billingPeriod` and `aiCreditsPeriod` are absent for a different reason — `ai_credit_balance()`
 * reads them to decide the window an allowance is summed over, so changing one on a live plan
 * silently re-prices every teacher holding it.
 */
const planPatchSchema = z.object({
  planCode: z.string().min(1).max(40),
  displayName: z.string().trim().min(1).max(80).optional(),
  price: z.number().min(0).max(1_000_000).optional(),
  includedResources: z.number().int().min(0).max(100_000).optional(),
  aiCreditsIncluded: z.number().int().min(0).max(100_000).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
})

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

    const [accounts, plans, planCatalogue] = await Promise.all([
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
      /*
        The plan catalogue, through a `public` wrapper (0178).

        `afritech.teacher_hub_plans` has granted UPDATE to AfriTech since 0130, but
        `config.toml` sets `schemas = ["public"]` — so PostgREST never saw it and the
        grant was real and unusable. Changing the Hub's price meant editing the
        database by hand.
      */
      client.rpc('admin_teacher_hub_plans'),
    ])

    if (accounts.error) return fromPostgrestError(accounts.error)

    // Narrowed after the error check above — see the note in the resources route.
    const rows = (accounts.data ?? []) as unknown as HubAccountRow[]
    const now = Date.now()

    return ok(
      {
        // The editable catalogue (0178), distinct from `my_teacher_hub()`'s own list.
        planCatalogue: planCatalogue.data ?? [],
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

/**
 * Change a Hub plan's price, allowance or availability.
 *
 * `plan_code` identifies the row and is never changed: `standalone_teacher_accounts.plan_code`
 * references it, so renaming one in place would orphan every account on it.
 *
 * `billing_period` and `ai_credits_period` are deliberately not editable either — both are
 * read by `ai_credit_balance()` to decide the window an allowance is summed over, and
 * changing one on a live plan silently re-prices every teacher holding it.
 */
export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = planPatchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    // No role check here: `admin_update_teacher_hub_plan()` refuses anybody who is not
    // AfriTech, and a second rule in a route is one that can drift from the first — and the
    // route is the half a direct PostgREST call bypasses.
    const { data, error } = await client
      .rpc('admin_update_teacher_hub_plan', {
        p_plan_code: parsed.data.planCode,
        p_display_name: parsed.data.displayName ?? null,
        p_price: parsed.data.price ?? null,
        p_included_resources: parsed.data.includedResources ?? null,
        p_ai_credits_included: parsed.data.aiCreditsIncluded ?? null,
        p_is_active: parsed.data.isActive ?? null,
        p_sort_order: parsed.data.sortOrder ?? null,
      })
      .maybeSingle()

    if (error) return fromPostgrestError(error)

    const row = (data ?? {}) as { out_updated?: boolean; out_subscribers?: number }
    if (!row.out_updated) return fail('NOT_FOUND', 'No such plan.')

    return ok({ updated: true, subscribers: row.out_subscribers ?? 0 })
  })
}
