/**
 * The school's queue of teachers asking to be linked to it.
 *
 *   GET  /api/school/join-requests — pending requests for this school
 *   POST /api/school/join-requests — approve or decline one
 *
 * Spec: `Official Documentation/13 Teacher Portal/TEACHER_PORTAL.md`
 *       `Official Documentation/04 Staff Management/STAFF.md`
 *
 * ## Approval issues an ordinary invitation — it does not grant anything
 *
 * `school_decide_join_request()` marks the row and returns the detail needed to invite.
 * The actual membership is created by `inviteToOrganisation()`, the same Clerk Backend API
 * call the staff screen already uses.
 *
 * That is deliberate. There is one way to become a member of a school in this product, it
 * goes through Clerk, and it is the path that is already tested. A second mechanism that
 * granted membership directly would be a second thing to get wrong, and the thing it would
 * get wrong is access control.
 *
 * ## Why the row is marked before the invitation is sent
 *
 * Mark, then invite. The reverse — invite, then mark — leaves an invitation sent against a
 * request still showing `pending` if the second statement fails, and the next press invites
 * the same person twice.
 *
 * This ordering has its own failure, and it is the better one: if the Clerk call fails the
 * request reads `approved` with no invitation behind it. That is visible on the screen (the
 * teacher never appears in staff) and recoverable by inviting them from the staff screen,
 * which is where the school would go anyway. A duplicate invitation is not as easily undone.
 *
 * The route says so in the response rather than returning a bare 500, because "approved but
 * the invitation did not send" is a state somebody has to act on.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider, type OrgRole, type Role } from '@zsms/auth-provider'
// Subpath, matching the staff route: the organisation helpers are not re-exported from
// the package root, and importing them from there resolves to nothing at runtime.
import { inviteToOrganisation } from '@zsms/auth-provider/organisations'
import { can } from '../../../../lib/roles'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * The roles a join request may grant.
 *
 * Mirrors the CHECK inside `school_decide_join_request()`. Two places state this, which is
 * duplication — but the database one is the enforcement and this one is the error message:
 * a 400 naming the allowed roles is a better answer than a raw SQLSTATE, and the suite pins
 * the database side so they cannot quietly diverge in the direction that matters.
 */
const GRANTABLE = ['org:teacher', 'org:admin', 'org:staff'] as const

const decideSchema = z.object({
  requestId: z.string().uuid(),
  approve: z.boolean(),
  role: z.enum(GRANTABLE).optional(),
})

export async function GET(): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    // Same permission as inviting staff, because that is what approving one does.
    if (!can(caller.role as Role, 'staff:write')) {
      return fail('FORBIDDEN', 'Your role does not include managing staff.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    // No school filter: `school_read_school_join_requests` scopes this to the caller's
    // own school through `current_school_uuid()`.
    const { data, error } = await client
      .from('school_join_requests')
      .select('id, requester_name, requester_email, note, status, requested_at, granted_role')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true })

    if (error) return fromPostgrestError(error)

    return ok({ requests: data ?? [], canDecide: true })
  })
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    if (!can(caller.role as Role, 'staff:write')) {
      return fail('FORBIDDEN', 'Your role does not include managing staff.')
    }

    const parsed = decideSchema.safeParse(await request.json())
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .rpc('school_decide_join_request', {
        p_request_id: parsed.data.requestId,
        p_approve: parsed.data.approve,
        p_role: parsed.data.approve ? (parsed.data.role ?? 'org:teacher') : null,
      })
      .maybeSingle()

    if (error) return fromPostgrestError(error)

    const row = (data ?? {}) as {
      out_decided?: boolean
      out_requester_email?: string | null
      out_requester_name?: string | null
      out_clerk_org_id?: string | null
      out_granted_role?: string | null
    }

    /*
      `decided: false` covers every reason the row did not move: already decided, withdrawn,
      or belonging to a different school. They are one answer on purpose — distinguishing
      "not yours" from "already decided" would confirm that another school's request id
      exists.
    */
    if (!row.out_decided) {
      return fail('NOT_FOUND', 'That request is no longer pending.')
    }

    if (!parsed.data.approve) {
      return ok({ decided: true, approved: false })
    }

    // ----- Approved. Now the invitation. -----
    if (!row.out_clerk_org_id || !row.out_requester_email) {
      // The request was approved but the school has no Clerk organisation, which means it
      // was never fully provisioned. Say so plainly rather than attempting the call.
      return ok({
        decided: true,
        approved: true,
        invited: false,
        message:
          'Approved, but this school has no organisation yet, so no invitation was sent. '
          + 'Contact AfriTech.',
      })
    }

    try {
      await inviteToOrganisation({
        organisationId: row.out_clerk_org_id,
        email: row.out_requester_email,
        role: (row.out_granted_role ?? 'org:teacher') as OrgRole,
        // From the session, never from the body — the audit trail has to name the real actor.
        inviterUserId: caller.userId,
      })
    } catch (cause) {
      /*
        The request is already marked approved and that is not rolled back — see the header.
        Reported as a success with `invited: false` so the screen can tell somebody, because
        a teacher who was approved and never invited will otherwise wait indefinitely for an
        email that was never sent.
      */
      return ok({
        decided: true,
        approved: true,
        invited: false,
        message:
          'Approved, but the invitation email could not be sent. '
          + 'Invite them from the Staff screen.',
        detail: cause instanceof Error ? cause.message : 'Unknown error',
      })
    }

    return ok({
      decided: true,
      approved: true,
      invited: true,
      role: row.out_granted_role,
    })
  })
}
