/**
 * GET /api/public/schools/[code] — one school's public profile. No account required.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md`
 *       → *School Profile Page*
 *
 * Same shape as the search route: anon key, a SECURITY DEFINER function whose `RETURNS TABLE` is the
 * disclosure boundary, cached at the edge.
 *
 * ## Why NOT_FOUND covers three different situations
 *
 * `school_public_profile()` returns no row for a school that does not exist, one that is suspended or
 * terminated, and one still awaiting verification. This route reports all three identically.
 *
 * That is deliberate rather than lazy. Distinguishing them would turn the endpoint into a status
 * oracle — anyone could learn that a named school had been suspended, which is commercially damaging
 * information about a customer and nobody's business but theirs and AfriTech's.
 */

import { createAnonClient } from '../../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * Cached by the CDN per URL, not by Next's route-level ISR.
 *
 * `revalidate` asks Next to render the route statically, which a route reading query parameters
 * cannot be — `next build` says so outright: "couldn't be rendered statically because it used
 * request.url". An explicit `Cache-Control` achieves the actual goal instead, and does it per
 * query string, which is what a search endpoint needs.
 *
 * This is also the nearest thing to a rate limiter available until Upstash Redis exists: most
 * repeated traffic is served from the edge and never reaches Postgres. `stale-while-revalidate`
 * means a school publishing a new fee band never causes a cache stampede.
 */
const PUBLIC_CACHE = 'public, s-maxage=300, stale-while-revalidate=600'


interface ProfileRow {
  out_school_code: string
  out_name: string
  out_city_code: string
  out_province_code: string
  out_type: string
  out_level: string
  out_logo_url: string | null
  out_status: string
  out_about: string | null
  out_established_year: number | null
  out_website_url: string | null
  out_pupils_per_teacher: string | number | null
  out_avg_class_size: string | number | null
  out_fee_band_min: string | number | null
  out_fee_band_max: string | number | null
  out_has_boarding: boolean | null
  out_has_transport: boolean | null
  out_has_science_lab: boolean | null
  out_has_computer_lab: boolean | null
  out_has_library: boolean | null
  out_has_sports: boolean | null
  out_has_feeding: boolean | null
  out_has_special_needs: boolean | null
  out_grade_levels: string[] | null
}

function num(value: string | number | null): number | null {
  if (value === null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  return guard(async () => {
    const client = createAnonClient()
    if (!client) return fail('SERVER_ERROR', 'The directory is not configured.')

    const { code } = await params

    const { data, error } = await client.rpc('school_public_profile', {
      // Case folding happens in the function, so a code typed by hand or pasted from a receipt both
      // work. Trimmed here only to keep an accidental space out of the cache key.
      p_school_code: code.trim(),
    })

    if (error) return fromPostgrestError(error)

    const row = (data as unknown as ProfileRow[])[0]
    if (!row) return fail('NOT_FOUND', 'No school with that code is listed.')

    const response = ok({
      schoolCode: row.out_school_code,
      name: row.out_name,
      cityCode: row.out_city_code,
      provinceCode: row.out_province_code,
      type: row.out_type,
      level: row.out_level,
      logoUrl: row.out_logo_url,
      status: row.out_status,
      about: row.out_about,
      establishedYear: row.out_established_year,
      websiteUrl: row.out_website_url,
      pupilsPerTeacher: num(row.out_pupils_per_teacher),
      avgClassSize: num(row.out_avg_class_size),
      feeBandMin: num(row.out_fee_band_min),
      feeBandMax: num(row.out_fee_band_max),
      gradeLevels: row.out_grade_levels ?? [],
      facilities: {
        boarding: row.out_has_boarding,
        transport: row.out_has_transport,
        scienceLab: row.out_has_science_lab,
        computerLab: row.out_has_computer_lab,
        library: row.out_has_library,
        sports: row.out_has_sports,
        feeding: row.out_has_feeding,
        specialNeeds: row.out_has_special_needs,
      },
    })

    response.headers.set('Cache-Control', PUBLIC_CACHE)
    return response
  })
}
