/**
 * What is outstanding, by grade and class.
 *
 *   GET /api/school/classes?year=2026&term=2
 *
 * Spec: `Official Documentation/10 Attendance Management/ATTENDANCE.md`
 *       `Official Documentation/11 Examinations and Results/RESULTS.md`
 *
 * Both parameters are optional: `school_class_readiness()` defaults to the term the school
 * is actually in, resolved from its own term dates. A screen that had to know the term before
 * it could ask what was outstanding would be asking the user the question it exists to answer.
 */

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider, type Role } from '@zsms/auth-provider'
import { can } from '../../../../lib/roles'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    // Seeing which classes are behind is a teaching-oversight act, not a financial one.
    if (!can(caller.role as Role, 'attendance:read')) {
      return fail('FORBIDDEN', 'Your role does not include class records.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const params = new URL(request.url).searchParams
    const year = params.get('year')
    const term = Number(params.get('term'))

    const { data, error } = await client.rpc('school_class_readiness', {
      p_academic_year: year && /^\d{4}/.test(year) ? year : null,
      p_term_number: Number.isInteger(term) && term >= 1 && term <= 4 ? term : null,
    })

    if (error) return fromPostgrestError(error)

    return ok({ classes: data ?? [] })
  })
}
