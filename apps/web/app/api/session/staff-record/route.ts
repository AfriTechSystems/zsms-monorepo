/**
 * POST /api/session/staff-record — make sure the signed-in person is on their school's roll.
 *
 * Spec: `Official Documentation/08 Staff Management/INVITATIONS.md`
 *       `Official Documentation/08 Staff Management/STAFF.md`
 *
 * ## The gap this closes
 *
 * Accepting a Clerk invitation creates an organisation membership and **nothing else**. The
 * only INSERT into `staff_members` was a manual administrative action on a route no screen
 * calls, so an accepted teacher held a role, passed RLS, and was invisible on the Staff
 * screen, unassignable to a class, and absent from every recipient list — because all of
 * those read `staff_members`, not Clerk.
 *
 * ## Called on arrival, not on every request
 *
 * A dedicated route rather than folding the reconciliation into each dashboard load: this
 * runs once when a client starts, where one extra round trip is unnoticed, instead of on
 * every page of every session forever.
 *
 * ## The name comes from the client, and that is safe
 *
 * `SessionUser` carries an email but no name — Clerk's `auth()` returns claims, and the
 * full profile needs a second API call this route should not make on every sign-in. So the
 * client passes what Clerk already told it.
 *
 * That is not a trust problem, because `ensure_my_staff_record()` takes identity DETAILS
 * and never the identity: `clerk_user_id` comes from `get_user_id()` and `school_id` from
 * `current_school_uuid()` inside the function. There is no argument that could write a row
 * for somebody else, or at another school. The worst a caller can do is misspell their own
 * name, which the school can correct — and which the reconciler then leaves alone.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(25).optional(),
})

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    // An empty body is valid: a client that knows no name still wants the record created,
    // and the function substitutes a correctable placeholder rather than refusing.
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .rpc('ensure_my_staff_record', {
        p_first_name: parsed.data.firstName ?? null,
        p_last_name: parsed.data.lastName ?? null,
        // From the session, not the body. The email is the one identity detail the
        // server already knows, so there is no reason to take the client's word for it.
        p_email: session.email,
        p_phone: parsed.data.phone ?? null,
      })
      .maybeSingle()

    if (error) return fromPostgrestError(error)

    const row = (data ?? {}) as {
      out_staff_id?: string
      out_created?: boolean
      out_message?: string
    }

    return ok({
      staffId: row.out_staff_id ?? null,
      // True only the first time. A client can use it to say "welcome" once rather than
      // on every launch.
      created: row.out_created ?? false,
      message: row.out_message ?? null,
    })
  })
}
