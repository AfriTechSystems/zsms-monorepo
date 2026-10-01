/**
 * GET  /api/school/staff — everyone at this school, and every pending invitation.
 * POST /api/school/staff — invite someone, with a ZSMS role.
 *
 * Spec: `Official Documentation/08 Staff Management/STAFF.md`
 *       `Official Documentation/03 Infrastructure Services/CLERK.md`
 *       `Official Documentation/02 Authentication and Identity/ROLES.md`
 *
 * ## Two sources, joined on the Clerk user id
 *
 * A member of staff exists in two places and neither is redundant. Clerk holds
 * the **account and the role** — who can sign in and what claim their token
 * carries. `staff_members` holds the **employment record** — staff number,
 * department, join date, the fields a school actually administers. They are
 * joined on `clerk_user_id`, and the join is deliberately outer in both
 * directions, because both halves can legitimately exist alone:
 *
 *   - In Clerk, not in `staff_members` — invited and signed in, but nobody has
 *     filled in their employment details yet. They can already use the product.
 *   - In `staff_members`, not in Clerk — a record kept for a teacher who has
 *     left, or one imported ahead of the invitation. They must not disappear
 *     from the list simply because they cannot sign in.
 *
 * Showing only the intersection would hide exactly the rows someone is looking
 * for when they open this screen.
 *
 * ## Authorisation is here, not in the provider
 *
 * `@zsms/auth-provider/organisations` talks to Clerk's Backend API with the
 * secret key, which bypasses every permission gate — that is the point of it,
 * since ZSMS's roles carry no Clerk permissions. So the role check has to live
 * in the route, and it does: `staff:write` before anything that changes Clerk,
 * `staff:read` before anything that reads it.
 *
 * The database half is still governed by RLS regardless. Only the *Clerk* half
 * depends on the check below, which is why it is not a courtesy here the way it
 * is on the screens.
 */

import type { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAuthProvider, ORG_ROLES, type OrgRole, type Role } from '@zsms/auth-provider'
import {
  inviteToOrganisation,
  listOrganisationMembers,
  listPendingInvitations,
} from '@zsms/auth-provider/organisations'

import { createUserClient } from '../../../../lib/supabase'
import { AFRITECH_ORG_SLUG } from '../../../../lib/admin-context'
import { can } from '../../../../lib/roles'
import { created, fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * Roles a school may hand out from this screen.
 *
 * `org:owner` is absent deliberately. A school has one owner, ownership transfer
 * is a support action with commercial consequences, and an invite form is not
 * where it should be possible. `org:parent` and `org:student` are absent because
 * they are provisioned by the pupil and guardian flows, not by staff invitation
 * — inviting a parent here would create a member with no linked child.
 */
const ASSIGNABLE: readonly OrgRole[] = [
  'org:principal',
  'org:admin',
  'org:accountant',
  'org:teacher',
  'org:staff',
]

const inviteSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(['org:principal', 'org:admin', 'org:accountant', 'org:teacher', 'org:staff']),
})

interface SessionContext {
  organisationId: string
  /** Already narrowed, so `can()` does not need a cast at each call site. */
  role: Role | 'none'
  userId: string
}

/** The caller's school session, or a reason it is not one. */
async function resolveCaller(): Promise<
  { ok: true; ctx: SessionContext } | { ok: false; response: NextResponse }
> {
  const session = await getAuthProvider().getSessionUser()
  if (!session) return { ok: false, response: fail('UNAUTHORIZED', 'Authentication required.') }

  if (session.organisationSlug === AFRITECH_ORG_SLUG) {
    return {
      ok: false,
      response: fail('FORBIDDEN', 'This is a school endpoint. Platform administrators use the admin dashboard.'),
    }
  }

  if (!session.organisationId) {
    return { ok: false, response: fail('FORBIDDEN', 'This session is not associated with a school.') }
  }

  return {
    ok: true,
    ctx: { organisationId: session.organisationId, role: session.role, userId: session.userId },
  }
}

export async function GET(): Promise<Response> {
  return guard(async () => {
    const caller = await resolveCaller()
    if (!caller.ok) return caller.response
    const { ctx } = caller

    if (!can(ctx.role, 'staff:read')) {
      return fail('FORBIDDEN', 'Only the owner, the principal, and administrators can see the staff list.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    // `management_read_staff` scopes this to the caller's own school, so no
    // filter is applied here — the policy is the filter.
    const { data: records, error } = await client
      .from('staff_members')
      .select(
        'id, clerk_user_id, staff_number, first_name, last_name, email, phone_e164, department, employment_type, join_date, is_active',
      )
      .order('last_name', { ascending: true })

    if (error) return fromPostgrestError(error)

    // Clerk is reached in parallel and is allowed to fail. A staff list that
    // 500s because Clerk is slow is worse than one that shows the employment
    // records and says the account side could not be loaded.
    const [members, invitations] = await Promise.all([
      listOrganisationMembers(ctx.organisationId).catch(() => null),
      can(ctx.role, 'staff:write')
        ? listPendingInvitations(ctx.organisationId).catch(() => null)
        : Promise.resolve([]),
    ])

    const byUserId = new Map((members ?? []).map((m) => [m.userId, m]))
    const seen = new Set<string>()

    const staff = (records ?? []).map((r) => {
      const clerk = byUserId.get(r.clerk_user_id as string)
      if (clerk) seen.add(clerk.userId)
      return {
        ...r,
        // NULL rather than a guessed role. A record with no Clerk account has
        // no role, and rendering a default here would put a role beside a name
        // that cannot sign in — which reads as access somebody has.
        role: clerk?.role ?? null,
        hasAccount: Boolean(clerk),
        imageUrl: clerk?.imageUrl ?? null,
      }
    })

    // Members with an account but no employment record yet. They can already
    // use the product, so leaving them out would make the list wrong in the
    // direction that matters.
    const unrecorded = (members ?? [])
      .filter((m) => !seen.has(m.userId))
      .map((m) => ({
        id: null,
        clerk_user_id: m.userId,
        staff_number: null,
        first_name: m.firstName,
        last_name: m.lastName,
        email: m.email,
        phone_e164: null,
        department: null,
        employment_type: null,
        join_date: null,
        is_active: true,
        role: m.role,
        hasAccount: true,
        imageUrl: m.imageUrl,
      }))

    return ok({
      staff: [...staff, ...unrecorded],
      invitations: invitations ?? [],
      // Told rather than inferred, so the screen never has to guess whether an
      // empty account column means "no accounts" or "Clerk was unreachable".
      accountsLoaded: members !== null,
      assignableRoles: ASSIGNABLE,
      canManage: can(ctx.role, 'staff:write'),
    })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveCaller()
    if (!caller.ok) return caller.response
    const { ctx } = caller

    // The real gate. Everything below reaches Clerk with the secret key, which
    // has no permission model of its own to fall back on.
    if (!can(ctx.role, 'staff:write')) {
      return fail('FORBIDDEN', 'Only the school owner and the principal can invite staff.')
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = inviteSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const { email, role } = parsed.data

    // Belt and braces against the enum drifting from ORG_ROLES. A role Clerk
    // accepts but `get_user_role()` does not recognise produces a member who can
    // sign in and see nothing, which is a confusing thing to debug from the
    // outside.
    if (!(ORG_ROLES as readonly string[]).includes(role)) {
      return fail('VALIDATION_ERROR', `${role} is not a ZSMS role.`)
    }

    try {
      const invitation = await inviteToOrganisation({
        organisationId: ctx.organisationId,
        email,
        role,
        // From the session. An operator cannot attribute an invitation to
        // someone else, which is what makes "who let this person in" answerable.
        inviterUserId: ctx.userId,
        // Where the invitation link lands after Clerk consumes the ticket.
        //
        // Omitting this is not a small default — Clerk falls back to the
        // instance's hosted Account Portal on `*.accounts.dev`, so every invited
        // teacher accepted successfully and then arrived at a Clerk-branded page
        // with no route into ZSMS. Their account existed; there was nowhere to
        // send them.
        //
        // Derived from the request rather than an env var so it is correct on
        // localhost, on a phone hitting the LAN address, and in production
        // without three different values to keep in step.
        redirectUrl: new URL('/sign-up', request.nextUrl.origin).toString(),
      })
      return created(invitation)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''

      // Clerk's duplicate-invitation error is the single most likely failure
      // here and is entirely recoverable, so it is named rather than rendered
      // as "an unexpected error occurred".
      if (/already|duplicate|exists/i.test(message)) {
        return fail('CONFLICT', `${email} has already been invited, or is already a member.`)
      }

      /*
        The membership quota, which on Clerk's free plan is FIVE PER ORGANISATION.

        Verified against the live instance on 2026-10-01: every organisation reports
        `max_allowed_memberships: 5`, and `createOrganisation()` asking for 0 (unlimited)
        does not override it on that plan. So a school with six staff hits this, and it
        will be during onboarding, in front of whoever is setting them up.

        Named rather than rendered as "try again shortly", because retrying is exactly
        what will not help and the operator needs to know the cause is commercial.
      */
      if (/quota|limit|maximum|max_allowed|plan/i.test(message)) {
        return fail(
          'CONFLICT',
          'This school has reached the maximum number of staff accounts its plan allows. '
            + 'Contact AfriTech to raise the limit before inviting anyone else.',
        )
      }

      console.error('[api] clerk invitation failed', message)
      return fail('SERVER_ERROR', 'The invitation could not be sent. Try again shortly.')
    }
  })
}
