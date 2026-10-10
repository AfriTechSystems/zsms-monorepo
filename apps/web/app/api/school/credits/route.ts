/**
 * A school's AI credits — what it holds, what it costs, and buying more.
 *
 *   GET  /api/school/credits — plans, purchases, assignments, settings, in one call
 *   POST /api/school/credits — quote, buy, assign, revoke, or set the reserve
 *
 * Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
 *       `Official Documentation/18 AI Module/AI_OVERVIEW.md`
 *
 * ## Every write is an RPC, and that is the security model
 *
 * None of the three credit tables carries an INSERT or UPDATE policy for a school. The
 * functions in `0164` are the only way in, and they are where the ceiling lives — that
 * assignments can never exceed what was bought, that a school may only touch its own
 * purchase, that the reserve cap is respected.
 *
 * So this route validates shapes and calls functions. It must never reach for `.from(...)`
 * to write: a route that inserted an assignment directly would be ten thousand free credits
 * with nothing in the ledger looking wrong.
 *
 * ## One POST with an `action`, rather than five routes
 *
 * Quote, buy, assign, revoke and the reserve switch all operate on the same screen and the
 * same permission. Five files would share an identical preamble five times. The action is
 * a discriminated union so each shape is validated on its own terms rather than one loose
 * object with everything optional.
 *
 * ## Permission
 *
 * `fees:write` — buying credits spends the school's money, so it is the bursar's
 * permission, not the one for editing a timetable. Assigning is the same gate: deciding
 * which teachers get the credits the school paid for is a financial act.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider, type Role } from '@zsms/auth-provider'
import { can } from '../../../../lib/roles'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('quote'),
    planCode: z.string().min(1),
    seats: z.number().int().min(1).max(2000),
  }),
  z.object({
    action: z.literal('buy'),
    planCode: z.string().min(1),
    seats: z.number().int().min(1).max(2000),
  }),
  z.object({
    action: z.literal('assign'),
    purchaseId: z.string().uuid(),
    // Capped so one request cannot try to write an unbounded number of rows.
    userIds: z.array(z.string().min(1)).min(1).max(500),
  }),
  z.object({
    action: z.literal('revoke'),
    assignmentId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('reserve'),
    enabled: z.boolean(),
    // NULL means no per-teacher limit — the unassigned remainder is the only ceiling.
    perTeacherCap: z.number().int().min(0).max(100000).nullable().optional(),
  }),
])

export async function GET(): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    if (!can(caller.role as Role, 'fees:read')) {
      return fail('FORBIDDEN', 'Your role does not include billing.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      No school filter on any of these: the policies scope every one through
      `current_school_uuid()`. The plan catalogue is a function because the table lives in
      `afritech`, which PostgREST cannot see at all.
    */
    const [plans, purchases, assignments, settings] = await Promise.all([
      client.rpc('school_credit_plan_catalogue'),
      client
        .from('school_credit_purchases')
        .select(
          'id, plan_code, period_kind, seats, credits_per_seat, total_credits, total_amount, '
            + 'currency_code, period_start, period_end, invoice_id, created_at',
        )
        .order('created_at', { ascending: false }),
      client
        .from('school_credit_assignments')
        .select('id, purchase_id, clerk_user_id, credits_allocated, period_start, period_end, assigned_at')
        .is('revoked_at', null),
      client.from('school_credit_settings').select('reserve_enabled, reserve_per_teacher_cap').maybeSingle(),
    ])

    if (plans.error) return fromPostgrestError(plans.error)
    if (purchases.error) return fromPostgrestError(purchases.error)
    if (assignments.error) return fromPostgrestError(assignments.error)

    return ok({
      plans: plans.data ?? [],
      purchases: purchases.data ?? [],
      assignments: assignments.data ?? [],
      // Absent row means the defaults: reserve off.
      settings: settings.data ?? { reserve_enabled: false, reserve_per_teacher_cap: null },
      canBuy: can(caller.role as Role, 'fees:write'),
    })
  })
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return validationFailed(parsed.error)

    // A quote writes nothing and only needs read access — the screen calls it on every
    // keystroke, and requiring write to see a price would hide the price from the person
    // who has to approve the spend.
    const needsWrite = parsed.data.action !== 'quote'
    const permission = needsWrite ? 'fees:write' : 'fees:read'

    if (!can(caller.role as Role, permission)) {
      return fail(
        'FORBIDDEN',
        needsWrite
          ? 'Your role does not include buying or assigning credits.'
          : 'Your role does not include billing.',
      )
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    switch (parsed.data.action) {
      case 'quote': {
        const { data, error } = await client
          .rpc('school_credit_quote', {
            p_plan_code: parsed.data.planCode,
            p_seats: parsed.data.seats,
          })
          .maybeSingle()
        if (error) return fromPostgrestError(error)
        return ok({ quote: data })
      }

      case 'buy': {
        const { data, error } = await client
          .rpc('school_purchase_credits', {
            p_plan_code: parsed.data.planCode,
            p_seats: parsed.data.seats,
          })
          .maybeSingle()
        if (error) return fromPostgrestError(error)
        return ok({ purchase: data })
      }

      case 'assign': {
        const { data, error } = await client
          .rpc('school_assign_credits', {
            p_purchase_id: parsed.data.purchaseId,
            p_user_ids: parsed.data.userIds,
          })
          .maybeSingle()
        if (error) return fromPostgrestError(error)
        return ok({ result: data })
      }

      case 'revoke': {
        const { data, error } = await client
          .rpc('school_revoke_credit_assignment', {
            p_assignment_id: parsed.data.assignmentId,
          })
          .maybeSingle()
        if (error) return fromPostgrestError(error)

        const row = (data ?? {}) as { out_revoked?: boolean }
        if (!row.out_revoked) {
          return fail('NOT_FOUND', 'That assignment is no longer active.')
        }
        return ok({ result: data })
      }

      case 'reserve': {
        /*
          An RPC like the rest, not a direct upsert.

          The first draft wrote to the table directly and would have failed at runtime:
          `0163` gives a school no INSERT policy on any credit table. It surfaced here
          only because `SessionUser` carries `organisationId` (the Clerk org) and not a
          school UUID, so there was nothing to put in `school_id` — and `0165` added the
          function the table was missing.

          The school comes from `current_school_uuid()` inside the function. A school id
          parameter on a SECURITY DEFINER function is an invitation to pass somebody
          else's.
        */
        const { data, error } = await client
          .rpc('school_set_credit_reserve', {
            p_enabled: parsed.data.enabled,
            p_per_teacher_cap: parsed.data.perTeacherCap ?? null,
          })
          .maybeSingle()
        if (error) return fromPostgrestError(error)
        return ok({ settings: data })
      }
    }
  })
}
