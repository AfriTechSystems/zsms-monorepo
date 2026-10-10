/**
 * Who spent the school's AI credits.
 *
 *   GET /api/school/credits/usage?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Spec: `Official Documentation/18 AI Module/AI_OVERVIEW.md`
 *       `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *
 * ## The school's own credits, never a teacher's
 *
 * The filter that keeps a teacher's personally-funded Hub usage out of this lives inside
 * `school_credit_usage()` (0166), not here. That is deliberate: a route is one forgotten
 * WHERE clause away from showing a principal what a teacher spent their own money on, and
 * this endpoint would be the obvious place to add "and also their personal usage" to a
 * screen that asked for completeness.
 *
 * The function has no parameter that could widen it. There is nothing this route can pass
 * to see more.
 */

import { createUserClient } from '../../../../../lib/supabase'
import { getAuthProvider, type Role } from '@zsms/auth-provider'
import { can } from '../../../../../lib/roles'
import { fail, fromPostgrestError, guard, ok } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/** `YYYY-MM-DD`, or null. A malformed date is dropped rather than rejected: a bad bookmark
 *  should show the default range, not an error page. */
function asDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  return value
}

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    if (!can(caller.role as Role, 'fees:read')) {
      return fail('FORBIDDEN', 'Your role does not include billing.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const params = new URL(request.url).searchParams

    const { data, error } = await client.rpc('school_credit_usage', {
      p_from: asDate(params.get('from')),
      p_to: asDate(params.get('to')),
    })

    if (error) return fromPostgrestError(error)

    return ok({ usage: data ?? [] })
  })
}
