/**
 * The school's own settings.
 *
 *   GET   /api/school/settings — profile, academic structure, term dates
 *   PATCH /api/school/settings — edit the profile or the academic structure
 *
 * Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_CONFIG.md`
 *
 * ## What this route cannot change, and why that is enforced elsewhere
 *
 * Nothing here can touch `subscription_tier`, `status`, `trial_ends_at`, the paid module flags or
 * the pupil ceiling — not because this file omits them, but because `0140` **revoked the column
 * grants**. A request naming one is refused by Postgres before RLS is consulted.
 *
 * That ordering matters. Before `0140` the grant was table-level, and a school owner could set
 * their own tier to `enterprise` and extend their own trial by a decade. A validation list in this
 * file would have looked like the same protection and been none: it would have stopped this route
 * and nothing else, including a direct PostgREST call from a browser holding the same token.
 *
 * **The rule the fix leaves behind: a table holding both user-editable and commercially significant
 * columns needs a column-level grant, not a row policy and certainly not a schema in TypeScript.**
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/** Exactly the columns `0140` and `0141` grant. Kept in step with the grant deliberately. */
const profileSchema = z.object({
  name: z.string().trim().min(2).max(160),
  displayName: z.string().trim().max(60).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +260971234567')
    .nullable()
    .optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  logoUrl: z.string().trim().url().max(500).nullable().optional(),
  ministryRegNumber: z.string().trim().max(60).nullable().optional(),
  type: z.enum(['day', 'boarding', 'hybrid']).optional(),
  level: z.enum(['primary', 'secondary', 'combined']).optional(),
})

const academicSchema = z.object({
  curriculumType: z.string().trim().min(1).max(40).optional(),
  structureType: z.string().trim().min(1).max(40).optional(),
  highestLevelOffered: z.string().trim().min(1).max(40).optional(),
  gradingSystem: z.string().trim().min(1).max(40).optional(),
  reportCardFormat: z.string().trim().min(1).max(40).optional(),
  classNamingConvention: z.string().trim().min(1).max(40).optional(),
})

const patchSchema = z
  .object({ profile: profileSchema.optional(), academic: academicSchema.optional() })
  .refine((v) => v.profile !== undefined || v.academic !== undefined, {
    message: 'Nothing to update.',
  })

export async function GET(): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const [school, academic, terms, current] = await Promise.all([
      client
        .from('schools')
        .select(
          'id, school_id, name, display_name, address, phone, email, logo_url, '
            + 'ministry_reg_number, type, level, city_code, country_code, status, '
            + 'subscription_tier, created_at',
        )
        .maybeSingle(),
      client.from('school_academic_config').select('*').maybeSingle(),
      client
        .from('school_term_dates')
        .select('id, academic_year, term_number, starts_on, ends_on')
        .order('academic_year', { ascending: false })
        .order('term_number'),
      client.rpc('current_term').maybeSingle(),
    ])

    if (school.error) return fromPostgrestError(school.error)
    if (!school.data) return fail('NOT_FOUND', 'No school in this session.')

    return ok({
      profile: school.data,
      academic: academic.data ?? null,
      terms: terms.data ?? [],
      currentTerm: current.data ?? null,
      /**
       * Returned so the screen can render fields read-only rather than hiding them. A school owner
       * seeing their tier greyed out learns something true — that it exists and AfriTech sets it.
       * Hiding it would make them think ZSMS has no record of what they are paying for.
       */
      readOnly: {
        commercial: ['subscription_tier', 'status', 'trial_ends_at', 'max_students'],
        identity: ['school_id', 'city_code', 'country_code'],
        reason:
          'AfriTech sets commercial terms. Identity fields appear inside every pupil number and '
          + 'receipt ever issued, so changing one would orphan them.',
      },
      role: session.role,
    })
  })
}

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)
    const { profile, academic } = parsed.data

    if (profile) {
      const patch: Record<string, unknown> = { name: profile.name }
      if (profile.displayName !== undefined) patch['display_name'] = profile.displayName || null
      if (profile.address !== undefined) patch['address'] = profile.address || null
      if (profile.phone !== undefined) patch['phone'] = profile.phone || null
      if (profile.email !== undefined) patch['email'] = profile.email || null
      if (profile.logoUrl !== undefined) patch['logo_url'] = profile.logoUrl || null
      if (profile.ministryRegNumber !== undefined) {
        patch['ministry_reg_number'] = profile.ministryRegNumber || null
      }
      if (profile.type !== undefined) patch['type'] = profile.type
      if (profile.level !== undefined) patch['level'] = profile.level

      // No `.eq()` on the school. `owner_update_own_school` scopes the statement to the caller's
      // own school, so a filter here would duplicate a rule the policy already enforces.
      const { data, error } = await client.from('schools').update(patch).select('id')

      if (error) {
        if (error.code === '42501') {
          // A column the grant does not cover. Means this file and `0140` have drifted apart.
          return fail('FORBIDDEN', 'That field is not yours to change.')
        }
        return fromPostgrestError(error)
      }

      /**
       * An UPDATE a policy refuses raises nothing and affects no rows — the trap pinned in
       * `teacher_hub_test`. Here it means the caller is not the owner, since
       * `owner_update_own_school` is owner-only.
       */
      if (!data || data.length === 0) {
        return fail('FORBIDDEN', 'Only the school owner can change these details.')
      }
    }

    if (academic) {
      const patch: Record<string, unknown> = {}
      if (academic.curriculumType !== undefined) patch['curriculum_type'] = academic.curriculumType
      if (academic.structureType !== undefined) patch['structure_type'] = academic.structureType
      if (academic.highestLevelOffered !== undefined) {
        patch['highest_level_offered'] = academic.highestLevelOffered
      }
      if (academic.gradingSystem !== undefined) patch['grading_system'] = academic.gradingSystem
      if (academic.reportCardFormat !== undefined) {
        patch['report_card_format'] = academic.reportCardFormat
      }
      if (academic.classNamingConvention !== undefined) {
        patch['class_naming_convention'] = academic.classNamingConvention
      }

      if (Object.keys(patch).length > 0) {
        const { data, error } = await client
          .from('school_academic_config')
          .update(patch)
          .select('id')

        if (error) return fromPostgrestError(error)
        if (!data || data.length === 0) {
          return fail(
            'FORBIDDEN',
            'Only the owner, principal or administrator can change the academic structure.',
          )
        }
      }
    }

    return ok({ updated: true })
  })
}
