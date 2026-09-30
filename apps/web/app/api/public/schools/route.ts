/**
 * GET /api/public/schools — the school directory search. No account required.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md`
 *
 * ## The only unauthenticated read surface in ZSMS
 *
 * Every other route here calls `createUserClient()` and gets a client carrying the caller's Clerk
 * token, so RLS answers as them. This one deliberately does not: a parent searching for their
 * child's school has no account, and requiring one would defeat the directory's purpose.
 *
 * It uses the **anon key** and calls `search_schools()`, a SECURITY DEFINER function whose
 * `RETURNS TABLE` names every column it will ever emit. That list — not a policy, not this file — is
 * the disclosure boundary. `public.schools` keeps its RLS with no `anon` policy, because RLS decides
 * which *rows* a caller sees and what this needs is a restriction on *columns*.
 *
 * ## No rate limiter, and what stands in for one
 *
 * `PUBLIC_DIRECTORY.md` specifies 30 requests a minute per IP. That needs Upstash Redis, which does
 * not exist yet (`CREDENTIALS_CHECKLIST.md`). So the controls available are how much a single request
 * can carry and how little it costs to serve:
 *
 *   * the page size is capped **inside the SQL function**, not here, so a hand-rolled request cannot
 *     raise it;
 *   * responses are cached at the edge, so repeated scraping mostly never reaches the database;
 *   * nothing sensitive is behind it, which is the real mitigation — a scraper gets a list of school
 *     names and cities, which is a list of schools.
 *
 * The student-ID lookup that document also specifies is **deliberately not built here.** At 10
 * requests a minute it is safe; with no limiter at all it is an enumeration oracle for valid pupil
 * identifiers, and that is a different category of thing to leave open.
 */

import { createAnonClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

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


interface SearchRow {
  out_school_code: string
  out_name: string
  out_city_code: string
  out_province_code: string
  out_type: string
  out_level: string
  out_logo_url: string | null
  out_status: string
  out_about: string | null
  out_pupils_per_teacher: string | number | null
  out_avg_class_size: string | number | null
  out_fee_band_min: string | number | null
  out_fee_band_max: string | number | null
  out_has_boarding: boolean | null
  out_has_transport: boolean | null
  out_total: number
}

/** NUMERIC arrives from PostgREST as a string. Parsed once here so no screen has to remember. */
function num(value: string | number | null): number | null {
  if (value === null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const client = createAnonClient()
    if (!client) return fail('SERVER_ERROR', 'The directory is not configured.')

    const p = new URL(request.url).searchParams
    const page = Math.max(1, Number(p.get('page') ?? '1') || 1)
    const perPage = 20

    const { data, error } = await client.rpc('search_schools', {
      p_country_code: p.get('country') ?? 'ZM',
      // Two characters minimum, per the document. A single letter matches most of the directory and
      // makes the query a full scan for no useful result.
      p_search: (p.get('q') ?? '').trim().length >= 2 ? (p.get('q') ?? '').trim() : null,
      p_province: p.get('province') || null,
      p_city: p.get('city') || null,
      p_type: p.get('type') || null,
      p_level: p.get('level') || null,
      // `true` or absent. `false` would mean "schools that said no", which nobody searches for.
      p_boarding: p.get('boarding') === 'true' ? true : null,
      p_transport: p.get('transport') === 'true' ? true : null,
      p_fee_max: p.get('feeMax') ? Number(p.get('feeMax')) : null,
      p_limit: perPage,
      p_offset: (page - 1) * perPage,
    })

    if (error) return fromPostgrestError(error)

    const rows = (data ?? []) as unknown as SearchRow[]

    const response = ok(
      rows.map((r) => ({
        schoolCode: r.out_school_code,
        name: r.out_name,
        cityCode: r.out_city_code,
        provinceCode: r.out_province_code,
        type: r.out_type,
        level: r.out_level,
        logoUrl: r.out_logo_url,
        status: r.out_status,
        about: r.out_about,
        pupilsPerTeacher: num(r.out_pupils_per_teacher),
        avgClassSize: num(r.out_avg_class_size),
        feeBandMin: num(r.out_fee_band_min),
        feeBandMax: num(r.out_fee_band_max),
        hasBoarding: r.out_has_boarding,
        hasTransport: r.out_has_transport,
      })),
      // `out_total` is the pre-pagination count, repeated on every row by the SQL function. Zero
      // rows means zero results, which is the one case it cannot report.
      { total: rows[0]?.out_total ?? 0, page, perPage },
    )

    response.headers.set('Cache-Control', PUBLIC_CACHE)
    return response
  })
}
