/**
 * Organisation administration — members, roles, invitations.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/CLERK.md`
 *       `Official Documentation/02 Authentication and Identity/ROLES.md`
 *       `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
 * Decision: ADR-032 — this package is the only permitted importer of `@clerk/*`
 *
 * ## Why this is server-side, and why that is the whole point
 *
 * Clerk's prebuilt `<OrganizationProfile>` is the obvious way to invite staff,
 * and it does not work here. It is gated on Clerk's **system** permissions —
 * `org:sys_memberships:manage` and friends — and ZSMS's seven `org:*` roles are
 * configured with deliberately empty permission sets, because enforcement is
 * RLS plus `lib/roles.ts` and a second permission model in Clerk would be a rule
 * nothing tests. A school owner therefore cannot invite a teacher through
 * Clerk's own UI, which is not a bug in that decision so much as its
 * consequence.
 *
 * Every call below goes through the **Backend API** with the secret key, which
 * has no such gate. `CLERK.md` already specified this: ZSMS invites
 * server-side. So the authorisation question moves to where the rest of it
 * lives — the calling route checks the caller's role before it calls anything
 * here, exactly as it checks before writing a row.
 *
 * **Nothing in this file authorises anything.** It is plumbing that will do what
 * it is told, and it must only ever be reached from a route that has already
 * decided the caller may. That is stated here because the opposite mistake —
 * an "isAllowed" check buried in a helper, bypassed by the next caller — is the
 * one this codebase has taken pains to avoid everywhere else.
 *
 * ## Provider-neutral by shape, not by accident
 *
 * The exported functions speak in ZSMS terms: an organisation id, an email, an
 * `org:*` role. Nothing Clerk-specific crosses the boundary, so the Keycloak
 * swap ADR-032 exists for stays a change to this file.
 */

import { createClerkClient } from '@clerk/backend'

import type { OrgRole } from './types'

export interface OrgMember {
  /** Clerk user id — the same value `staff_members.clerk_user_id` carries. */
  userId: string
  membershipId: string
  email: string | null
  firstName: string | null
  lastName: string | null
  imageUrl: string | null
  /** Fully qualified, e.g. `org:principal`. Normalised — see below. */
  role: string
  createdAt: number
}

export interface OrgInvitation {
  id: string
  email: string
  role: string
  status: string
  createdAt: number
}

/**
 * Clerk's v2 session token carries the BARE role (`admin`), while ZSMS compares
 * against `org:admin` everywhere. The Backend API is inconsistent about which
 * form it returns, so both are normalised on the way out — the same rule
 * `get_user_role()` applies in the database since migration `0105`, and for the
 * same reason: one representation reaching the rest of the system.
 */
function qualify(role: string): string {
  return role.includes(':') ? role : `org:${role}`
}

let cached: ReturnType<typeof createClerkClient> | null = null

function client(): ReturnType<typeof createClerkClient> {
  if (cached) return cached
  const secretKey = process.env['CLERK_SECRET_KEY']
  if (!secretKey) {
    throw new Error(
      'CLERK_SECRET_KEY is not set. Organisation administration needs the Backend API — see ENV.md.',
    )
  }
  cached = createClerkClient({ secretKey })
  return cached
}

/** Everyone currently in the organisation, with the role they hold. */
export async function listOrganisationMembers(organisationId: string): Promise<OrgMember[]> {
  const page = await client().organizations.getOrganizationMembershipList({
    organizationId: organisationId,
    limit: 200,
  })

  return page.data.map((m) => {
    const u = m.publicUserData
    return {
      userId: u?.userId ?? '',
      membershipId: m.id,
      email: u?.identifier ?? null,
      firstName: u?.firstName ?? null,
      lastName: u?.lastName ?? null,
      imageUrl: u?.imageUrl ?? null,
      role: qualify(m.role),
      createdAt: m.createdAt,
    }
  })
}

/** Invitations sent but not yet accepted. */
export async function listPendingInvitations(organisationId: string): Promise<OrgInvitation[]> {
  const page = await client().organizations.getOrganizationInvitationList({
    organizationId: organisationId,
    status: ['pending'],
    limit: 200,
  })

  return page.data.map((i) => ({
    id: i.id,
    email: i.emailAddress,
    role: qualify(i.role),
    status: i.status ?? 'pending',
    createdAt: i.createdAt,
  }))
}

/**
 * Invites someone to the organisation with a ZSMS role.
 *
 * `inviterUserId` is passed so Clerk attributes the invitation, which is what
 * makes "who let this person in" answerable six months later. It is taken from
 * the session by the calling route and never from a request body.
 */
export async function inviteToOrganisation(params: {
  organisationId: string
  email: string
  role: OrgRole
  inviterUserId: string
  redirectUrl?: string
}): Promise<OrgInvitation> {
  const i = await client().organizations.createOrganizationInvitation({
    organizationId: params.organisationId,
    emailAddress: params.email,
    // Clerk stores the role key exactly as given, and every ZSMS policy compares
    // against the qualified form. Sending the bare name here is how a member
    // ends up with a role the database does not recognise.
    role: params.role,
    inviterUserId: params.inviterUserId,
    redirectUrl: params.redirectUrl,
  })

  return {
    id: i.id,
    email: i.emailAddress,
    role: qualify(i.role),
    status: i.status ?? 'pending',
    createdAt: i.createdAt,
  }
}

/** Withdraws an invitation that has not been accepted. */
export async function revokeInvitation(params: {
  organisationId: string
  invitationId: string
  requestingUserId: string
}): Promise<void> {
  await client().organizations.revokeOrganizationInvitation({
    organizationId: params.organisationId,
    invitationId: params.invitationId,
    requestingUserId: params.requestingUserId,
  })
}

/** Changes an existing member's role. */
export async function updateMemberRole(params: {
  organisationId: string
  userId: string
  role: OrgRole
}): Promise<void> {
  await client().organizations.updateOrganizationMembership({
    organizationId: params.organisationId,
    userId: params.userId,
    role: params.role,
  })
}

/**
 * Removes someone from the organisation.
 *
 * This revokes access; it does not delete anything. Their `staff_members` row,
 * the attendance they marked, and the marks they entered all remain — those are
 * school records, not the person's, and CONVENTIONS.md prohibition 8 exists
 * because someone always asks for last year's register.
 */
export async function removeFromOrganisation(params: {
  organisationId: string
  userId: string
}): Promise<void> {
  await client().organizations.deleteOrganizationMembership({
    organizationId: params.organisationId,
    userId: params.userId,
  })
}
