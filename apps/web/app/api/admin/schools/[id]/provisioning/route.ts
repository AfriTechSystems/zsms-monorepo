/**
 * Recovery for a school whose Clerk organisation was never created.
 *
 *   POST   /api/admin/schools/[id]/provisioning — retry: create the organisation and attach it
 *   DELETE /api/admin/schools/[id]/provisioning — abandon the attempt
 *
 * Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md`
 *
 * ## Why an unprovisioned school is safe to leave lying around
 *
 * `clerk_org_id` is the tenant key every RLS policy in this database resolves through. A school
 * created but not yet attached carries `pending_<uuid>`, which matches no JWT anybody can hold —
 * so it is reachable by no school user at all, and visible only to AfriTech through
 * `is_afritech_admin()`. There is no window in which it is half-open.
 *
 * ## DELETE does not delete, and cannot
 *
 * The verb is HTTP's; the effect is a status change to `terminated`. `0144` did try to delete the
 * row, on the reasoning that a school nobody could reach holds nothing worth protecting — true,
 * and beside the point. Creating a school writes an `audit_logs` row, that table references
 * `schools` by foreign key, and `0131` makes it immutable by trigger. So the delete is refused,
 * the FK cannot be made to cascade, and removing the audit row first is the one thing an audit
 * trail exists to prevent.
 *
 * **A school that was created cannot be erased, because its creation was recorded.** The feature
 * changed rather than the audit trail.
 *
 * `admin_abandon_unprovisioned_school()` enforces the precondition rather than trusting this file
 * to have checked it — it refuses the moment a real organisation is attached.
 *
 * ## The identifier stays spent
 *
 * The abandoned row survives, so `get_next_school_sequence()` counts past it and the next school
 * in that city takes the following number. Which is what business rule 1 wanted, arrived at as a
 * consequence of the audit trail rather than as a rule anybody had to enforce.
 */

import { createOrganisation } from '@zsms/auth-provider/organisations'

import { createUserClient } from '../../../../../../lib/supabase'
import { resolveAdminContext } from '../../../../../../lib/admin-context'
import { fail, fromPostgrestError, guard, ok } from '../../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

interface SchoolRow {
  id: string
  school_id: string
  name: string
  clerk_org_id: string
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { id } = await params

    const { data, error } = await client
      .from('schools')
      .select('id, school_id, name, clerk_org_id')
      .eq('id', id)
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!data) return fail('NOT_FOUND', 'No such school.')

    const school = data as unknown as SchoolRow

    if (!school.clerk_org_id.startsWith('pending_')) {
      return fail(
        'CONFLICT',
        'This school already has a Clerk organisation. Retrying would create a second one.',
      )
    }

    let organisationId: string
    try {
      const org = await createOrganisation({
        // The slug is derived from the identifier, not stored, so it is the same value on every
        // retry — a second attempt reuses the slug the first one failed to claim.
        name: school.name,
        slug: school.school_id.toLowerCase(),
        schoolCode: school.school_id,
      })
      organisationId = org.id
    } catch (err) {
      return fail(
        'SERVER_ERROR',
        `Still could not create the Clerk organisation for ${school.school_id}: ${message(err)}`,
      )
    }

    const { error: attachError } = await client.rpc('admin_attach_clerk_org', {
      p_school_id: school.id,
      p_clerk_org_id: organisationId,
    })

    if (attachError) return fromPostgrestError(attachError)

    return ok({ id: school.id, schoolCode: school.school_id, clerkOrgId: organisationId })
  })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { id } = await params

    const { data, error } = await client.rpc('admin_abandon_unprovisioned_school', {
      p_school_id: id,
    })

    if (error) return fromPostgrestError(error)

    const row = (data as unknown as Array<{ out_school_id: string; out_status: string }>)[0]
    if (!row) return fail('NOT_FOUND', 'No such school.')

    return ok({ schoolCode: row.out_school_id, status: row.out_status, abandoned: true })
  })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
