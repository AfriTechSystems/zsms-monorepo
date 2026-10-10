/**
 * A teacher's two credit balances.
 *
 *   GET /api/teacher/credits
 *
 * Spec: `Official Documentation/18 AI Module/AI_OVERVIEW.md`
 *       `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## Why one call returns two balances
 *
 * `ai_credit_account_for_caller()` (0132) returns the SCHOOL wallet whenever the caller has
 * an organisation. A teacher who belongs to a school therefore has no reachable personal
 * wallet through it — every spend would land on the school, including personal Hub work on
 * credits the teacher bought themselves.
 *
 * `teacher_credit_balances()` (0164) resolves both, which is what lets the generator offer
 * a choice at all. The default is school-first, and there is a reason beyond deference:
 * school credits expire at the end of the period the school paid for, personal ones do not,
 * so spending the perishable balance first is also what is best for the teacher.
 */

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('teacher_credit_balances').maybeSingle()
    if (error) return fromPostgrestError(error)

    const row = (data ?? {}) as Record<string, unknown>

    return ok({
      school: row['out_school_id']
        ? {
            schoolName: row['out_school_name'],
            allocated: row['out_school_allocated'] ?? 0,
            spent: row['out_school_spent'] ?? 0,
            available: row['out_school_available'] ?? 0,
            expiresOn: row['out_school_expires_on'] ?? null,
            reserveAvailable: row['out_reserve_available'] ?? 0,
          }
        : null,
      personal: { available: row['out_personal_available'] ?? 0 },
    })
  })
}
