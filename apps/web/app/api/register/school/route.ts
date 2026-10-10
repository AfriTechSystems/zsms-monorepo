/**
 * POST /api/register/school — a school owner registers their own school.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md` → Path 2
 *       `Official Documentation/06 School and Tenant Management/TRIAL.md`
 *
 * ## This is the only route in the product that creates a tenant for an arbitrary caller
 *
 * `/api/admin/schools/provision` does the same work behind `is_afritech_admin()`. This one is
 * reachable by anybody with an account, so its guards are the product's outer wall:
 *
 *   * **A verified session is required.** `register_school()` is granted to `authenticated` and
 *     revoked from `anon`, so the visitor must have completed Clerk's email OTP first. There is no
 *     rate limiter to put in front of this yet — Upstash Redis does not exist (see
 *     `CREDENTIALS_CHECKLIST.md`) — and a verified email is the substitute.
 *   * **One open trial per person**, enforced in the function against
 *     `school_onboarding.created_by`.
 *   * **A caller who already belongs to a school is refused here**, before any work begins. Somebody
 *     signed in as a teacher at one school should not be able to spawn another from that session;
 *     if they genuinely run a school of their own, they register it from an account that is theirs.
 *   * **Both consents are timestamped in the database**, not merely validated in this file.
 *
 * ## The owner is added, not invited
 *
 * They are signed in and looking at the screen. Emailing them an invitation to a school they created
 * ten seconds ago would be a worse flow to the same end state.
 *
 * ## Ordering, and what a failure leaves behind
 *
 * Same three-step shape as admin provisioning, and for the same unavoidable reason — Postgres
 * cannot roll back an HTTP call:
 *
 *   1. `register_school()`               — database. Identifier, school, onboarding row, checklist
 *   2. `createOrganisation()`            — Clerk
 *   3. `attach_own_registered_school()`  — database, then the membership
 *
 * A failure at 2 leaves a school holding a `pending_` placeholder for `clerk_org_id`, which matches
 * no JWT — so it is reachable by nobody, including the person who just registered it. They can
 * retry, because `attach_own_registered_school()` stays open for exactly the school they registered
 * and exactly while the placeholder is there.
 */

import { z } from 'zod'

import { addOrganisationMember, createOrganisation } from '@zsms/auth-provider/organisations'
import { getAuthProvider } from '@zsms/auth-provider'
import { getCountryConfig } from '@zsms/config'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../lib/api-response'

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

  referralSource: z
    .enum(['word_of_mouth', 'social_media', 'referred_by_school', 'search', 'other'])
    .nullable()
    .optional(),

  /**
   * Both must be literally `true`. `z.boolean()` would accept `false` and leave the decision to a
   * later `if`; `z.literal(true)` makes an unticked box a validation failure with a message naming
   * which one, which is also what the person needs to hear.
   */
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Terms of Service.' }),
  }),
  acceptedPrivacy: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the Privacy Policy.' }),
  }),
})

interface RegisteredSchool {
  out_id: string
  out_school_id: string
  out_clerk_slug: string
  out_trial_ends_at: string
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) {
      return fail(
        'UNAUTHORIZED',
        'Create your account first. Registration needs a verified email address.',
      )
    }

    /**
     * Already in a school. Refused before anything is created, and phrased as a redirect rather
     * than a denial — the common case is somebody who is signed in as staff somewhere and did not
     * realise it, not somebody attacking anything.
     */
    if (session.organisationSlug) {
      return fail(
        'CONFLICT',
        'This account already belongs to a school. Sign out and register from a personal account, ' +
          'or ask AfriTech to add a second school to your existing one.',
      )
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)
    const input = parsed.data

    // The city code becomes part of the school identifier permanently, so this is the last point
    // at which a wrong one is still a typo rather than a permanent record.
    const country = getCountryConfig()
    if (country.cityProvince[input.cityCode] !== input.provinceCode) {
      return fail(
        'VALIDATION_ERROR',
        'That city is not in the province you chose. Pick the province first, then the city.',
      )
    }

    // ---- Step 1: the database side, atomically -----------------------------
    const { data: created, error: registerError } = await client.rpc('register_school', {
      p_name: input.name,
      p_type: input.type,
      p_level: input.level,
      p_province_code: input.provinceCode,
      p_city_code: input.cityCode,
      p_owner_first_name: input.ownerFirstName,
      p_owner_last_name: input.ownerLastName,
      p_owner_email: input.ownerEmail,
      p_owner_phone_e164: input.ownerPhone ?? null,
      p_referral_source: input.referralSource ?? null,
      p_country_code: country.code,
    })

    if (registerError) return fromPostgrestError(registerError)

    const school = (created as unknown as RegisteredSchool[])[0]
    if (!school) return fail('SERVER_ERROR', 'The school was not created.')

    // ---- Step 2: the Clerk organisation ------------------------------------
    let organisationId: string
    try {
      const org = await createOrganisation({
        name: input.name,
        slug: school.out_clerk_slug,
        schoolCode: school.out_school_id,
      })
      organisationId = org.id
    } catch (error) {
      return fail(
        'SERVER_ERROR',
        `${school.out_school_id} was reserved for you, but setting up your workspace failed: ` +
          `${message(error)}. Try again — your details are saved.`,
        { schoolId: school.out_id, schoolCode: school.out_school_id, failedAt: 'workspace' },
      )
    }

    // ---- Step 3: join them together, then make the caller its owner --------
    const { error: attachError } = await client.rpc('attach_own_registered_school', {
      p_school_id: school.out_id,
      p_clerk_org_id: organisationId,
    })

    if (attachError) return fromPostgrestError(attachError)

    try {
      await addOrganisationMember({
        organisationId,
        userId: session.userId,
        role: 'org:owner',
      })
    } catch (error) {
      /**
       * The worst partial state in this route, and worth naming: the school exists and is attached,
       * but the person who registered it is not a member — so `get_school_id()` returns nothing for
       * them and their own school is invisible. Reported as a failure rather than a success,
       * because a "welcome!" screen in front of an empty portal is the least useful thing to show.
       */
      return fail(
        'SERVER_ERROR',
        `${school.out_school_id} was created but your account could not be linked to it: ` +
          `${message(error)}. Contact AfriTech and quote that code — the school is safe.`,
        { schoolId: school.out_id, schoolCode: school.out_school_id, failedAt: 'membership' },
      )
    }

    return ok(
      {
        id: school.out_id,
        schoolCode: school.out_school_id,
        slug: school.out_clerk_slug,
        trialEndsAt: school.out_trial_ends_at,
      },
      { total: 1 },
    )
  })
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
