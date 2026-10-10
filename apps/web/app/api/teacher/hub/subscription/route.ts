/**
 * The teacher's own subscription.
 *
 *   DELETE /api/teacher/hub/subscription — cancel at the end of the paid period
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## There is no POST here, and that is the point
 *
 * Activation is not a teacher-facing action. Payment is recorded by hand — mobile money and
 * an AfriTech bank account exist, an integrated gateway does not yet — which is the same
 * decision taken for school billing. If a teacher could call an activate endpoint they
 * would simply grant themselves a paid subscription, so
 * `teacher_hub_activate_subscription()` refuses anybody who is not AfriTech, and the only
 * route that reaches it lives under `/api/admin`.
 *
 * ## Cancelling is not immediate
 *
 * The documented promise is that generation stops at the END of the billing period and
 * saved resources stay readable for good. So the status changes and `subscription_ends_at`
 * is left exactly where it was; `teacher_hub_entitlement()` already treats a cancelled
 * subscription with a future date as still entitled. Cancelling does not refund the trial
 * either — five free resources, ever.
 */

import { createUserClient } from '../../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import { fail, fromPostgrestError, guard, ok } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function DELETE(): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('teacher_hub_cancel_subscription')

    if (error) {
      if (error.code === 'P0002') {
        return fail('CONFLICT', 'There is no active subscription to cancel.')
      }
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      return fromPostgrestError(error)
    }

    return ok({
      // When generation actually stops. The screen shows this date, because "cancelled"
      // without it reads as "cut off now", which is not what happens.
      accessUntil: data as unknown as string | null,
      status: 'cancelled',
    })
  })
}
