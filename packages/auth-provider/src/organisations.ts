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

export interface CreatedOrganisation {
  /** Clerk organisation id, `org_…`. This becomes `schools.clerk_org_id`. */
  id: string
  name: string
  slug: string | null
}

/**
 * Creates the organisation that backs a school.
 *
 * ## `createdBy` is omitted, and that is the important part
 *
 * Clerk's create endpoint takes an optional `createdBy`, and passing it adds that user to the new
 * organisation as its administrator. The only user available at this point is the **AfriTech**
 * administrator doing the provisioning — so passing it would quietly make an AfriTech employee a
 * member of the school's organisation, appearing in its staff list and satisfying
 * `clerk_org_id = get_school_id()` in every tenant policy in the database.
 *
 * That is a tenancy breach dressed up as a convenience. The organisation is created empty and the
 * school owner is invited into it, which is also what `SCHOOL_SETUP.md` describes.
 *
 * (AfriTech reaches a school through `is_afritech_admin()` and, once built, impersonation — never
 * by holding a membership.)
 *
 * ## `maxAllowedMemberships: 0`
 *
 * Zero means unlimited. Staff are not a priced dimension — decided 2026-08-23 — so no school can
 * ever be blocked from adding a teacher by a seat count. Set explicitly rather than left to the
 * instance default, because the default is a Clerk setting nothing in this repository controls and
 * a school silently capped at five teachers would surface as "invitations stopped working".
 */
export async function createOrganisation(params: {
  name: string
  /** Lowercased school identifier, e.g. `zm-lsk-0001`. */
  slug: string
  /** ZSMS school identifier, stored on the organisation for support lookups. */
  schoolCode: string
}): Promise<CreatedOrganisation> {
  const org = await client().organizations.createOrganization({
    name: params.name,
    slug: params.slug,
    maxAllowedMemberships: 0,
    // So somebody staring at Clerk's dashboard can tell which ZSMS school this is without
    // reverse-engineering the slug. Public rather than private because it is not a secret — it is
    // printed on every receipt the school issues.
    publicMetadata: { schoolCode: params.schoolCode },
  })

  return { id: org.id, name: org.name, slug: org.slug ?? null }
}

/**
 * Adds an existing user to an organisation directly, with no invitation.
 *
 * ## Why this is not `inviteToOrganisation`
 *
 * Self-registration (`SCHOOL_SETUP.md` Path 2) has the owner already signed in and standing in
 * front of the screen. Emailing them an invitation to a school they created ten seconds ago, and
 * then asking them to leave the page and open their inbox, is a worse flow than simply making them
 * a member — and it is the same end state.
 *
 * Invitations remain right for everybody else: an AfriTech-created school's owner and every teacher
 * a school adds are people who are **not** here yet, and an invitation is how you reach them.
 *
 * ## The authorisation is the caller's, as always
 *
 * Nothing here checks anything, in keeping with the rest of this file. The route must already have
 * established that this user is entitled to be this organisation's owner — which for registration
 * means the database confirmed they are the one who registered it.
 */
export async function addOrganisationMember(params: {
  organisationId: string
  userId: string
  role: OrgRole
}): Promise<void> {
  await client().organizations.createOrganizationMembership({
    organizationId: params.organisationId,
    userId: params.userId,
    // Qualified, for the reason `inviteToOrganisation` gives: Clerk stores the key verbatim and
    // every ZSMS policy compares against the `org:` form.
    role: params.role,
  })
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
 * ## `inviterUserId` is recorded, and deliberately NOT sent to Clerk
 *
 * The obvious call passes `inviter_user_id`, and it fails:
 *
 *     403 missing_organization_permission
 *     meta.permissions: ["org:sys_memberships:manage"]
 *
 * Supplying an inviter makes Clerk check **that user's** permissions rather than
 * the secret key's — and ZSMS's org roles carry empty Clerk permission sets by
 * decision, so a school owner has none. Every invitation therefore failed with
 * "the invitation could not be sent", including the school owner's. Measured on
 * the dev instance: identical request without the field returns 200.
 *
 * This is the third time that one decision has surfaced — the org switcher, the
 * `<OrganizationProfile>` gap, and now this. The pattern is worth naming: **any
 * Clerk endpoint that accepts an acting user will authorise against that user,**
 * so anything ZSMS drives on a school's behalf must omit it and carry its own
 * check.
 *
 * Attribution is not lost, only moved. `invitedBy` goes into the invitation's
 * `publicMetadata`, which is the only metadata field this SDK version exposes on
 * creation. **It is readable by the person invited**, and that is acceptable
 * rather than ideal: the value is an opaque Clerk user id, not a name, and
 * somebody being invited to a school already knows a person at that school
 * invited them. It is recorded so "who let this person in" stays answerable.
 *
 * The proper home for this is a ZSMS audit row — `audit_logs` exists and nothing
 * writes to it yet. When it does, this metadata becomes a convenience copy
 * rather than the record.
 */
export async function inviteToOrganisation(params: {
  organisationId: string
  email: string
  role: OrgRole
  /** Recorded in private metadata. Taken from the session, never from a body. */
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
    publicMetadata: { invitedBy: params.inviterUserId, invitedAt: new Date().toISOString() },
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

/**
 * Withdraws an invitation that has not been accepted.
 *
 * `requestingUserId` is omitted for exactly the reason given above — supplying
 * it returns the same `403 missing_organization_permission`. Verified against
 * the dev instance: with the field 403, without it 200.
 */
export async function revokeInvitation(params: {
  organisationId: string
  invitationId: string
}): Promise<void> {
  await client().organizations.revokeOrganizationInvitation({
    organizationId: params.organisationId,
    invitationId: params.invitationId,
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
