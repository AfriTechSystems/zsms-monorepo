/**
 * Who changed this school's settings, and when.
 *
 *   GET /api/school/settings/history            — the caller's own school
 *   GET /api/school/settings/history?schoolId=… — AfriTech naming a school
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *       `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *
 * ## The `schoolId` parameter is not a permission
 *
 * `school_settings_history()` ignores it for anybody who is not AfriTech and answers from
 * `current_school_uuid()` instead. That matters because the function is SECURITY DEFINER:
 * taking the argument on trust would let any school read any other school's settings history
 * by changing a query string.
 *
 * So this route passes it straight through rather than checking the caller's role first. The
 * check belongs in one place, and that place is the function — a route that also checked
 * would be a second rule to keep in step, and the one that can be bypassed by calling
 * PostgREST directly is the route.
 */

import { createUserClient } from '../../../../../lib/supabase'
import { getAuthProvider, type Role } from '@zsms/auth-provider'
import { can } from '../../../../../lib/roles'
import { fail, fromPostgrestError, guard, ok } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      `settings:write`, not a read permission — there is no `settings:read` in the matrix and
      inventing one here would put a rule in a route that `CONVENTIONS.md` says belongs in
      `roles.ts`. The people who may change settings are the people who should see who changed
      them, which makes the write permission the right gate rather than a convenient one.

      Scoped to school users: AfriTech has no organisation and is admitted by the function.
      The role gate is about who WITHIN a school may read its history, which is a different
      question from tenant scope.
    */
    const isSchoolUser = caller.organisationId !== null
    if (isSchoolUser && !can(caller.role as Role, 'settings:write')) {
      return fail('FORBIDDEN', 'Your role does not include school settings.')
    }

    const raw = new URL(request.url).searchParams.get('schoolId')
    // A malformed id is dropped rather than rejected: a bad bookmark should show the
    // caller's own history, not an error page.
    const schoolId = raw && UUID_RE.test(raw) ? raw : null

    const { data, error } = await client.rpc('school_settings_history', {
      p_school_id: schoolId,
      p_limit: 50,
    })

    if (error) return fromPostgrestError(error)

    return ok({ history: data ?? [] })
  })
}
