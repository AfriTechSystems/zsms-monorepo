/**
 * The school's own control over what it publishes in the directory.
 *
 *   GET   /api/school/public-profile — current settings, plus the metrics as they would appear
 *   PATCH /api/school/public-profile — change them
 *
 * Spec: `Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md`
 *
 * ## GET returns the metrics whether or not they are published
 *
 * A school deciding whether to publish its pupils-per-teacher needs to see the number first. So this
 * route calls `school_verified_metrics()` — which returns the raw counts as well as the ratios, and is
 * reachable only with an account, because a count beside a ratio reconstructs a roll the directory
 * deliberately withholds.
 *
 * The public functions never touch it. This is the one place the counts are shown, to the school that
 * owns them.
 *
 * ## Authorisation is the policy's, as usual
 *
 * `set_school_public_profile()` is SECURITY INVOKER, so `management_write_own_public_profile` decides.
 * A teacher calling it gets 42501 from the function's own row-count check — an RLS-blocked UPDATE
 * matches nothing and raises nothing, so the function looks at what it affected rather than trusting
 * the absence of an error.
 */

import { z } from 'zod'

import { getAuthProvider } from '@zsms/auth-provider'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

interface MetricsRow {
  out_pupils: number
  out_teachers: number
  out_classes: number
  out_pupils_per_teacher: string | number | null
  out_avg_class_size: string | number | null
}

function num(value: string | number | null): number | null {
  if (value === null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export async function GET(): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const [profile, school] = await Promise.all([
      client.from('school_public_profiles').select('*').maybeSingle(),
      client.from('schools').select('id, school_id, name').maybeSingle(),
    ])

    if (profile.error) return fromPostgrestError(profile.error)
    if (school.error) return fromPostgrestError(school.error)
    if (!school.data) return fail('NOT_FOUND', 'No school in this session.')

    const row = school.data as unknown as { id: string; school_id: string; name: string }

    const { data: metrics, error: metricsError } = await client.rpc('school_verified_metrics', {
      p_school_id: row.id,
    })
    if (metricsError) return fromPostgrestError(metricsError)

    const m = (metrics as unknown as MetricsRow[])[0]

    return ok({
      schoolCode: row.school_id,
      schoolName: row.name,
      // Null when the school has never opened this screen. The UI treats that as "everything
      // withheld", which is what the column defaults say.
      profile: profile.data ?? null,
      metrics: m
        ? {
            pupils: m.out_pupils,
            teachers: m.out_teachers,
            classes: m.out_classes,
            pupilsPerTeacher: num(m.out_pupils_per_teacher),
            avgClassSize: num(m.out_avg_class_size),
          }
        : null,
    })
  })
}

/**
 * Every field optional, because the function treats NULL as "leave it alone" — so a screen can save
 * one toggle without resending the rest, and two people editing different sections cannot overwrite
 * each other's work.
 */
const schema = z.object({
  isPublished: z.boolean().optional(),
  about: z.string().trim().max(2000).optional(),
  establishedYear: z
    .number()
    .int()
    .min(1850)
    .max(new Date().getFullYear())
    .nullable()
    .optional(),
  websiteUrl: z.string().trim().url().max(300).optional(),
  publishRatio: z.boolean().optional(),
  publishClassSizes: z.boolean().optional(),
  publishFeeBand: z.boolean().optional(),
  feeBandMin: z.number().min(0).max(1_000_000).nullable().optional(),
  feeBandMax: z.number().min(0).max(1_000_000).nullable().optional(),
  hasBoarding: z.boolean().optional(),
  hasTransport: z.boolean().optional(),
  hasScienceLab: z.boolean().optional(),
  hasComputerLab: z.boolean().optional(),
  hasLibrary: z.boolean().optional(),
  hasSports: z.boolean().optional(),
  hasFeeding: z.boolean().optional(),
  hasSpecialNeeds: z.boolean().optional(),
})

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)
    const i = parsed.data

    const { data, error } = await client.rpc('set_school_public_profile', {
      p_is_published: i.isPublished ?? null,
      p_about: i.about ?? null,
      p_established_year: i.establishedYear ?? null,
      p_website_url: i.websiteUrl ?? null,
      p_publish_ratio: i.publishRatio ?? null,
      p_publish_class_sizes: i.publishClassSizes ?? null,
      p_publish_fee_band: i.publishFeeBand ?? null,
      p_fee_band_min: i.feeBandMin ?? null,
      p_fee_band_max: i.feeBandMax ?? null,
      p_has_boarding: i.hasBoarding ?? null,
      p_has_transport: i.hasTransport ?? null,
      p_has_science_lab: i.hasScienceLab ?? null,
      p_has_computer_lab: i.hasComputerLab ?? null,
      p_has_library: i.hasLibrary ?? null,
      p_has_sports: i.hasSports ?? null,
      p_has_feeding: i.hasFeeding ?? null,
      p_has_special_needs: i.hasSpecialNeeds ?? null,
    })

    if (error) {
      /**
       * `school_public_profiles_fee_band_complete` fires when a school switches the fee band on
       * without giving both ends of it. Named here as a sentence, because a constraint name in a
       * toast tells a head teacher nothing.
       */
      if (error.message.includes('fee_band_complete')) {
        return fail('VALIDATION_ERROR', 'Give both a lowest and a highest fee before publishing the range.')
      }
      if (error.message.includes('fee_band_ordered')) {
        return fail('VALIDATION_ERROR', 'The lowest fee cannot be more than the highest.')
      }
      return fromPostgrestError(error)
    }

    return ok(data)
  })
}
