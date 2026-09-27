/**
 * GET /api/session/schools — the schools this account is connected to.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *       migration `0117`
 *
 * ## Why this is not just a Clerk membership list
 *
 * Clerk knows which organisations a user belongs to, and the client can read that
 * itself through `useOrganizationList`. What Clerk cannot say is *why* — whether
 * this person is a teacher there, a parent there, or a pupil there. That is a ZSMS
 * fact, and a switcher that says "Beta School" is less use than one that says
 * "Teacher at Beta School".
 *
 * `my_schools()` is self-scoped on `get_user_id()` and returns only schools the
 * caller is actually connected to, so this endpoint widens nothing.
 *
 * ## Parents do not need this, and that is worth knowing
 *
 * Every parent policy is keyed on the parent rather than the active school, so the
 * parent portal already spans schools without switching. This endpoint exists for
 * STAFF, whose policies do scope on `current_school_uuid()` — a teacher or owner at
 * more than one school sees one at a time and has to move between them.
 */

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

interface SchoolRow {
  out_school_uuid: string
  out_school_code: string
  out_school_name: string
  out_clerk_org_id: string
  out_relationship: string
}

export async function GET(): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('my_schools')
    if (error) return fromPostgrestError(error)

    const rows = (data ?? []) as unknown as SchoolRow[]

    return ok({
      schools: rows.map((r) => ({
        uuid: r.out_school_uuid,
        code: r.out_school_code,
        name: r.out_school_name,
        // The client matches this against its Clerk memberships to switch. A
        // school listed here with no matching membership cannot be entered, and
        // the switcher says so rather than offering a control that fails.
        organisationId: r.out_clerk_org_id,
        relationship: r.out_relationship,
        current: r.out_clerk_org_id === session.organisationId,
      })),
      currentOrganisationId: session.organisationId ?? null,
      role: session.role,
    })
  })
}
