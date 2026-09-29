/**
 * Recovery for a school whose Clerk organisation was never created.
 *
 *   POST   /api/admin/schools/[id]/provisioning — retry: create the organisation and attach it
 *   DELETE /api/admin/schools/[id]/provisioning — discard the reservation entirely
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
 * That is also what makes DELETE safe here rather than a soft delete. Prohibition 8 protects
 * pupils, fee records, payments and exam results; a school nobody could ever write to has none of
 * those. `admin_discard_unprovisioned_school()` enforces the precondition rather than trusting
 * this file to have checked it — it refuses the moment a real organisation is attached.
 *
 * ## The identifier is spent either way
 *
 * Discarding `ZM-LSK-0007` does not release the number. The next school gets `0008`. Business
 * rule 1 makes identifiers permanent, and a reused number would mean two different schools held
 * the same one at different times — which is exactly the property that rule exists to prevent.
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

    const { error } = await client.rpc('admin_discard_unprovisioned_school', {
      p_school_id: id,
    })

    if (error) return fromPostgrestError(error)

    return ok({ discarded: true })
  })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
