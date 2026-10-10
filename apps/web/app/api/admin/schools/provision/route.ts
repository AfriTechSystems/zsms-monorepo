/**
 * POST /api/admin/schools/provision — creates a school.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md` (Path 1)
 *       `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
 *
 * Until this route existed, **nothing in the repository could create a school.** Every school in
 * `zsms-dev` came from `dev_seed.sql`.
 *
 * ## Four steps, two systems, and no transaction across them
 *
 *   1. `admin_create_school()`          — database. Allocates `ZM-LSK-0007`, inserts the school,
 *                                         the onboarding record and all fourteen checklist items
 *   2. `createOrganisation()`           — Clerk. Uses the slug step 1 returned
 *   3. `admin_attach_clerk_org()`       — database. Records the real `org_…` id
 *   4. `inviteToOrganisation()`         — Clerk. The owner's invitation
 *
 * Step 1 is atomic. Steps 2–4 are not, and cannot be: Postgres cannot roll back an HTTP call.
 * So the route reports **which step it reached**, and every partial state is recoverable:
 *
 * | Failed at | State | Recovery |
 * |---|---|---|
 * | 2 | School row with a placeholder `clerk_org_id` — reachable by nobody | Retry or discard |
 * | 3 | Clerk organisation exists, school still placeholder | Retry attach with the returned id |
 * | 4 | School fully provisioned, owner not invited | Resend the invitation |
 *
 * A failure at step 2 is the only one that leaves something worth cleaning up, and
 * `admin_discard_unprovisioned_school()` refuses to touch anything past that point.
 *
 * ## Why the owner is invited rather than created
 *
 * `SCHOOL_SETUP.md` describes creating a Clerk user for the owner. This invites instead. Clerk's
 * email-OTP-only configuration means a created user has no password to send and must verify their
 * email before they can do anything — which is an invitation with extra steps, and one that leaves
 * an orphan user account behind if the school is later discarded. An invitation expires on its own.
 *
 * The edge case that document raises is handled by Clerk rather than here: if the email already
 * has an account, accepting the invitation adds that existing user to the organisation.
 */

import { z } from 'zod'

import { createOrganisation, inviteToOrganisation } from '@zsms/auth-provider/organisations'
import { getCountryConfig } from '@zsms/config'

import { createUserClient } from '../../../../../lib/supabase'
import { resolveAdminContext } from '../../../../../lib/admin-context'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const schema = z.object({
  name: z.string().trim().min(2).max(160),
  type: z.enum(['day', 'boarding', 'both']),
  level: z.enum(['pre', 'primary', 'secondary', 'combined']),
  provinceCode: z.string().trim().length(3),
  cityCode: z.string().trim().length(3),

  ownerFirstName: z.string().trim().min(1).max(80),
  ownerLastName: z.string().trim().min(1).max(80),
  ownerEmail: z.string().trim().email().max(200),
  ownerPhone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +260971234567')
    .nullable()
    .optional(),

  subscriptionTier: z.enum(['starter', 'growth', 'professional', 'enterprise']).default('starter'),
  address: z.string().trim().max(300).nullable().optional(),
  ministryRegNumber: z.string().trim().max(80).nullable().optional(),
  internalNotes: z.string().trim().max(2000).nullable().optional(),
})

interface CreatedSchool {
  id: string
  school_id: string
  clerk_slug: string
  name: string
  status: string
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)
    const input = parsed.data

    /**
     * The city must exist and must be in the province given.
     *
     * Checked here as well as in the form because the city code goes into the school identifier
     * permanently — `ZM-XYZ-0001` for a city that does not exist would be unfixable, since business
     * rule 1 makes the identifier immutable. This is the last point at which it is still a typo
     * rather than a permanent record.
     */
    const country = getCountryConfig()
    if (!(input.cityCode in country.cities)) {
      return fail(
        'VALIDATION_ERROR',
        `${input.cityCode} is not a city in ${country.name}. The city code becomes part of the ` +
          `school identifier and cannot be changed afterwards.`,
      )
    }
    if (!(input.provinceCode in country.provinces)) {
      return fail('VALIDATION_ERROR', `${input.provinceCode} is not a province in ${country.name}.`)
    }
    if (country.cityProvince[input.cityCode] !== input.provinceCode) {
      return fail(
        'VALIDATION_ERROR',
        `${country.cities[input.cityCode]} is not in ${country.provinces[input.provinceCode]}.`,
      )
    }

    // ---- Step 1: the database side, atomically -----------------------------
    const { data: created, error: createError } = await client.rpc('admin_create_school', {
      p_name: input.name,
      p_type: input.type,
      p_level: input.level,
      p_province_code: input.provinceCode,
      p_city_code: input.cityCode,
      p_owner_first_name: input.ownerFirstName,
      p_owner_last_name: input.ownerLastName,
      p_owner_email: input.ownerEmail,
      p_owner_phone_e164: input.ownerPhone ?? null,
      p_subscription_tier: input.subscriptionTier,
      p_address: input.address ?? null,
      p_ministry_reg_number: input.ministryRegNumber ?? null,
      p_internal_notes: input.internalNotes ?? null,
      p_country_code: country.code,
    })

    if (createError) return fromPostgrestError(createError)

    const school = (created as unknown as CreatedSchool[])[0]
    if (!school) return fail('SERVER_ERROR', 'The school was not created.')

    // ---- Step 2: the Clerk organisation ------------------------------------
    let organisationId: string
    try {
      const org = await createOrganisation({
        name: school.name,
        slug: school.clerk_slug,
        schoolCode: school.school_id,
      })
      organisationId = org.id
    } catch (error) {
      /**
       * The school row survives, holding a placeholder tenant key that matches no JWT — so it is
       * invisible to everyone rather than half-open. Returned as a success-shaped failure with the
       * id, because the operator's next action is retry or discard and both need it.
       */
      return fail(
        'SERVER_ERROR',
        `${school.school_id} was reserved, but its Clerk organisation could not be created: ` +
          `${message(error)}. Retry provisioning, or discard it — nobody can reach it meanwhile.`,
        { schoolId: school.id, schoolCode: school.school_id, failedAt: 'clerk_organisation' },
      )
    }

    // ---- Step 3: join the two together -------------------------------------
    const { error: attachError } = await client.rpc('admin_attach_clerk_org', {
      p_school_id: school.id,
      p_clerk_org_id: organisationId,
    })

    if (attachError) {
      return fail(
        'SERVER_ERROR',
        `The Clerk organisation ${organisationId} was created but could not be recorded against ` +
          `${school.school_id}. Attach it before doing anything else, or the school has an ` +
          `organisation nobody can find.`,
        { schoolId: school.id, clerkOrgId: organisationId, failedAt: 'attach' },
      )
    }

    // ---- Step 4: invite the owner ------------------------------------------
    let invitationId: string | null = null
    let invitationError: string | null = null
    try {
      const invitation = await inviteToOrganisation({
        organisationId,
        email: input.ownerEmail,
        role: 'org:owner',
        inviterUserId: admin.userId,
      })
      invitationId = invitation.id

      await client.rpc('admin_record_owner_invitation', {
        p_school_id: school.id,
        p_invitation_id: invitationId,
      })
    } catch (error) {
      /**
       * Not fatal, and deliberately not rolled back. The school is fully provisioned at this
       * point; only the invitation is missing, and re-sending one is an ordinary action the staff
       * screen already supports. Reported so the operator knows to do it rather than assuming the
       * owner has an email waiting.
       */
      invitationError = message(error)
    }

    return ok(
      {
        id: school.id,
        schoolCode: school.school_id,
        name: school.name,
        status: school.status,
        clerkOrgId: organisationId,
        ownerInvited: invitationId !== null,
        ownerInvitationError: invitationError,
      },
      { total: 1 },
    )
  })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
