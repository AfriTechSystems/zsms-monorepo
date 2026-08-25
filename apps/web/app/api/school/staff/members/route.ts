/**
 * PATCH  /api/school/staff/members — change a member's role.
 * DELETE /api/school/staff/members — revoke a pending invitation, or remove a member.
 *
 * Spec: `Official Documentation/08 Staff Management/STAFF.md`
 *       `Official Documentation/02 Authentication and Identity/ROLES.md`
 *
 * Separated from the collection route because these act on Clerk memberships
 * and invitations, which are identified by Clerk ids rather than by anything in
 * `public`. Folding them into `/api/school/staff/[id]` would put a Clerk user id
 * in a path segment that reads like a `staff_members.id`, and the two are not
 * interchangeable.
 *
 * ## The safeguards here are the point of the file
 *
 * Three ways a role change can lock a school out of its own account, all of them
 * refused below: demoting yourself, touching the owner, and promoting anyone to
 * owner. None is enforced by Clerk — the Backend API will do exactly as asked —
 * so they are enforced here or nowhere.
 */

import type { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAuthProvider } from '@zsms/auth-provider'
import {
  listOrganisationMembers,
  removeFromOrganisation,
  revokeInvitation,
  updateMemberRole,
} from '@zsms/auth-provider/organisations'

import { AFRITECH_ORG_SLUG } from '../../../../../lib/admin-context'
import { can } from '../../../../../lib/roles'
import { fail, guard, ok, validationFailed } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  userId: z.string().trim().min(1),
  role: z.enum(['org:principal', 'org:admin', 'org:accountant', 'org:teacher', 'org:staff']),
})

const deleteSchema = z
  .object({
    invitationId: z.string().trim().min(1).optional(),
    userId: z.string().trim().min(1).optional(),
  })
  .refine((v) => Boolean(v.invitationId) !== Boolean(v.userId), {
    message: 'Give exactly one of invitationId or userId.',
  })

async function resolveManager(): Promise<
  { ok: true; organisationId: string; userId: string } | { ok: false; response: NextResponse }
> {
  const session = await getAuthProvider().getSessionUser()
  if (!session) return { ok: false, response: fail('UNAUTHORIZED', 'Authentication required.') }

  if (session.organisationSlug === AFRITECH_ORG_SLUG || !session.organisationId) {
    return { ok: false, response: fail('FORBIDDEN', 'This is a school endpoint.') }
  }

  if (!can(session.role, 'staff:write')) {
    return {
      ok: false,
      response: fail('FORBIDDEN', 'Only the school owner and the principal can change staff access.'),
    }
  }

  return { ok: true, organisationId: session.organisationId, userId: session.userId }
}

export async function PATCH(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveManager()
    if (!caller.ok) return caller.response

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const { userId, role } = parsed.data

    // Demoting yourself is how a school ends up with nobody who can invite
    // anyone. Refused outright rather than confirmed, because the person who
    // would have to fix it is the person who just lost the ability to.
    if (userId === caller.userId) {
      return fail(
        'CONFLICT',
        'You cannot change your own role. Ask the school owner, or AfriTech support.',
      )
    }

    // The owner is not reassignable from this screen. Ownership carries billing
    // and is transferred as a support action, not from a staff list.
    const members = await listOrganisationMembers(caller.organisationId).catch(() => null)
    if (members === null) {
      return fail('SERVER_ERROR', 'Could not read the current members. Try again shortly.')
    }

    const target = members.find((m) => m.userId === userId)
    if (!target) return fail('NOT_FOUND', 'That person is not a member of this school.')

    if (target.role === 'org:owner') {
      return fail('FORBIDDEN', "The school owner's role cannot be changed here. Contact AfriTech.")
    }

    try {
      await updateMemberRole({ organisationId: caller.organisationId, userId, role })
      return ok({ userId, role })
    } catch (err) {
      console.error('[api] clerk role update failed', err instanceof Error ? err.message : err)
      return fail('SERVER_ERROR', 'The role could not be changed. Try again shortly.')
    }
  })
}

export async function DELETE(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveManager()
    if (!caller.ok) return caller.response

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = deleteSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const { invitationId, userId } = parsed.data

    if (invitationId) {
      try {
        await revokeInvitation({
          organisationId: caller.organisationId,
          invitationId,
          requestingUserId: caller.userId,
        })
        return ok({ invitationId, revoked: true })
      } catch (err) {
        console.error('[api] clerk invitation revoke failed', err instanceof Error ? err.message : err)
        return fail('SERVER_ERROR', 'The invitation could not be withdrawn. Try again shortly.')
      }
    }

    if (userId === caller.userId) {
      return fail('CONFLICT', 'You cannot remove your own access.')
    }

    const members = await listOrganisationMembers(caller.organisationId).catch(() => null)
    if (members === null) {
      return fail('SERVER_ERROR', 'Could not read the current members. Try again shortly.')
    }

    const target = members.find((m) => m.userId === userId)
    if (!target) return fail('NOT_FOUND', 'That person is not a member of this school.')
    if (target.role === 'org:owner') {
      return fail('FORBIDDEN', 'The school owner cannot be removed here. Contact AfriTech.')
    }

    try {
      // Access only. The `staff_members` row, the registers they marked, and the
      // marks they entered all stay — those are the school's records, not the
      // person's, and someone always asks for last year's register.
      await removeFromOrganisation({ organisationId: caller.organisationId, userId: userId! })
      return ok({ userId, removed: true })
    } catch (err) {
      console.error('[api] clerk membership removal failed', err instanceof Error ? err.message : err)
      return fail('SERVER_ERROR', 'Access could not be revoked. Try again shortly.')
    }
  })
}
