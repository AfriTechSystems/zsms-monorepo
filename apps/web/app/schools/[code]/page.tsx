/**
 * `/schools/[code]` — one school's public profile.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md`
 *       → *School Profile Page*
 *
 * ## A server component, and that is the whole point of this page
 *
 * `PUBLIC_DIRECTORY.md` calls these pages "organic marketing — parents searching for a school online
 * may find the ZSMS profile page", and it is the highest-leverage thing in the public site: one page
 * per school, ranking for that school's name, arriving free with every school that signs up.
 *
 * That only works if the content is in the HTML. A client component fetching on mount ships an empty
 * shell to a crawler, so this renders on the server and exports `generateMetadata` so the title,
 * description and Open Graph card are real before any JavaScript runs.
 *
 * ## The copy-the-code block is the page's actual job
 *
 * A parent reaching here is usually trying to sign in and does not know their school's code. The code
 * is the one piece of information they need and cannot guess, so it is large, monospaced and
 * copyable — which is why the document puts it above the fold with a copy button.
 *
 * ## No score
 *
 * Decided 2026-09-30. Every figure shown is one the school chose to publish, computed by ZSMS from
 * their live records. Absent means unpublished, never zero.
 */

import type { JSX } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import {
  BadgeCheck,
  Bus,
  FlaskConical,
  Heart,
  Library,
  Monitor,
  School,
  Trophy,
  UtensilsCrossed,
} from 'lucide-react'

import { getCountryConfig } from '@zsms/config'

import { createAnonClient } from '../../../lib/supabase'
import {
  formatClassSize,
  formatFeeBand,
  formatPupilTeacherRatio,
} from '../../../lib/directory-format'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { CopyCode } from './copy-code'

export const revalidate = 300

/** As `school_public_profile()` returns it. NUMERIC arrives from PostgREST as a string. */
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

interface PublicProfile {
  schoolCode: string
  name: string
  cityCode: string
  provinceCode: string
  type: string
  level: string
  logoUrl: string | null
  status: string
  about: string | null
  establishedYear: number | null
  websiteUrl: string | null
  pupilsPerTeacher: number | null
  avgClassSize: number | null
  feeBandMin: number | null
  feeBandMax: number | null
  gradeLevels: string[]
  facilities: {
    boarding: boolean | null
    transport: boolean | null
    scienceLab: boolean | null
    computerLab: boolean | null
    library: boolean | null
    sports: boolean | null
    feeding: boolean | null
    specialNeeds: boolean | null
  }
}

const LEVEL_LABEL: Record<string, string> = {
  pre: 'Pre-school',
  primary: 'Primary school',
  secondary: 'Secondary school',
  combined: 'Primary and secondary school',
}

const TYPE_LABEL: Record<string, string> = {
  day: 'Day school',
  boarding: 'Boarding school',
  both: 'Day and boarding school',
}

/**
 * Reads the database directly, NOT this app's own API route.
 *
 * ## The bug that produced this comment
 *
 * It was written the other way first — `fetch('/api/public/schools/…')` — reasoning that the route
 * and the SQL function behind it are the single place the disclosure rules live. The reasoning was
 * fine and the implementation was a server component fetching its own server over HTTP, which breaks
 * in two ways that only show up outside development:
 *
 *   * **`next build` hangs.** With no server listening on the base URL, the build-time request retries
 *     until it gives up. Measured: the build went from twenty seconds to over ten minutes the moment
 *     the dev server was stopped, then failed collecting page data.
 *   * **On Vercel there is no localhost.** `NEXT_PUBLIC_ZSMS_URL` is not set today, so the fallback
 *     would point a production render at nothing.
 *
 * The disclosure boundary is not the route. It is `school_public_profile()`'s `RETURNS TABLE`, which
 * this calls directly — the same function, one hop shorter. The API route stays because the client-side
 * directory page needs an HTTP endpoint; this page does not.
 */
async function loadProfile(code: string): Promise<PublicProfile | null> {
  const client = createAnonClient()
  if (!client) return null

  const { data, error } = await client.rpc('school_public_profile', {
    p_school_code: code.trim(),
  })
  if (error) return null

  const row = (data as unknown as ProfileRow[] | null)?.[0]
  if (!row) return null

  return {
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
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>
}): Promise<Metadata> {
  const { code } = await params
  const school = await loadProfile(code)

  /**
   * `noindex` is the real protection here, not the status code.
   *
   * `notFound()` is thrown from an async server component that awaits a fetch, so the response has
   * already begun streaming and Next cannot retract the 200 it committed — measured on a clean dev
   * server, the not-found UI renders with HTTP 200. Without this, a crawler that followed a stale or
   * mistyped link would index a "not listed" page as though it were a school.
   */
  if (!school) {
    return {
      title: 'School not listed · ZSMS',
      robots: { index: false, follow: true },
    }
  }

  const country = getCountryConfig()
  const place = country.cities[school.cityCode] ?? school.cityCode

  /**
   * The description is written for the search result, not for this page. A parent scanning Google
   * sees this line and decides whether to click, so it leads with where the school is and what it
   * teaches rather than with ZSMS.
   */
  const description =
    `${school.name} is a ${(TYPE_LABEL[school.type] ?? school.type).toLowerCase()} in ${place}, ` +
    `${country.name}` +
    (school.gradeLevels.length > 0
      ? `, teaching ${school.gradeLevels[0]} to ${school.gradeLevels[school.gradeLevels.length - 1]}`
      : '') +
    `. School code ${school.schoolCode}.`

  return {
    title: `${school.name} — ${place} · ZSMS`,
    description,
    openGraph: { title: `${school.name}, ${place}`, description, type: 'profile' },
    alternates: { canonical: `/schools/${school.schoolCode}` },
  }
}

const FACILITY_LABELS = [
  ['boarding', 'Boarding', School],
  ['transport', 'School transport', Bus],
  ['scienceLab', 'Science laboratory', FlaskConical],
  ['computerLab', 'Computer laboratory', Monitor],
  ['library', 'Library', Library],
  ['sports', 'Sports facilities', Trophy],
  ['feeding', 'Feeding programme', UtensilsCrossed],
  ['specialNeeds', 'Special needs support', Heart],
] as const

export default async function SchoolProfilePage({
  params,
}: {
  params: Promise<{ code: string }>
}): Promise<JSX.Element> {
  const { code } = await params
  const school = await loadProfile(code)
  if (!school) notFound()

  const country = getCountryConfig()
  const place = country.cities[school.cityCode] ?? school.cityCode
  const region = country.provinces[school.provinceCode] ?? school.provinceCode

  const facilities = FACILITY_LABELS.filter(([key]) => school.facilities[key] === true)
  const hasMetrics =
    school.pupilsPerTeacher !== null || school.avgClassSize !== null || school.feeBandMin !== null

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-gutter py-10">
      <nav aria-label="Breadcrumb" className="mb-cards flex items-center gap-2 text-sm">
        <Link href="/" className="shrink-0">
          <Image
            src="/brand/zsms-lockup.png"
            alt="ZSMS"
            width={200}
            height={64}
            className="h-auto w-[110px]"
          />
        </Link>
        <span className="text-muted-foreground">/</span>
        <Link href="/schools" className="underline">
          Schools
        </Link>
      </nav>

      <header className="flex flex-col gap-stack sm:flex-row sm:items-start sm:gap-cards">
        {school.logoUrl ? (
          /* An arbitrary R2 URL, so next/image would need every possible host allowlisted. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={school.logoUrl}
            alt=""
            width={64}
            height={64}
            className="size-16 shrink-0 rounded-lg object-contain"
          />
        ) : (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-muted">
            <School aria-hidden="true" className="size-8 text-muted-foreground" />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{school.name}</h1>
          <p className="mt-1 text-muted-foreground">
            {TYPE_LABEL[school.type] ?? school.type} · {LEVEL_LABEL[school.level] ?? school.level}
          </p>
          <p className="text-muted-foreground">
            {place}, {region}
            {school.establishedYear ? ` · established ${school.establishedYear}` : ''}
          </p>
          {school.status === 'trial' && (
            <span className="mt-2 inline-block">
              <Badge variant="neutral">New to ZSMS</Badge>
            </span>
          )}
        </div>
      </header>

      {school.about && <p className="mt-cards whitespace-pre-wrap">{school.about}</p>}

      {/* The code block. Sized and placed for the one job most visitors have. */}
      <Card className="mt-cards">
        <CardContent className="pt-card">
          <p className="text-sm text-muted-foreground">School code</p>
          <CopyCode code={school.schoolCode} />
          <p className="mt-stack text-sm text-muted-foreground">
            Parents need this code to sign in to the ZSMS parent portal.
          </p>
          <div className="mt-stack flex flex-wrap gap-2">
            <Button asChild>
              <Link href={`/sign-in?school_id=${school.schoolCode}`}>My child is here</Link>
            </Button>
            {school.websiteUrl && (
              <Button asChild variant="outline">
                <a href={school.websiteUrl} target="_blank" rel="noreferrer noopener">
                  School website
                </a>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {hasMetrics && (
        <section className="mt-cards">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <BadgeCheck aria-hidden="true" className="size-5 text-success" />
            Verified by ZSMS
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Calculated from this school&rsquo;s own pupil and staff records, not supplied by the
            school. Updated nightly.
          </p>
          <dl className="mt-stack grid grid-cols-1 gap-stack sm:grid-cols-3">
            {formatPupilTeacherRatio(school.pupilsPerTeacher) && (
              <div className="rounded-lg border border-border p-card">
                <dt className="text-sm text-muted-foreground">Teacher to pupils</dt>
                <dd data-numeric className="text-2xl font-semibold">
                  {formatPupilTeacherRatio(school.pupilsPerTeacher)}
                </dd>
                {/* Spelled out underneath, because a ratio is the one number people read backwards.
                    The figure itself used to render as "10.1", which asked a parent to work out both
                    what it was a ratio of and what a tenth of a teacher meant. */}
                <p className="mt-1 text-sm text-muted-foreground">
                  One teacher for every {Math.round(school.pupilsPerTeacher ?? 0)} pupils.
                </p>
              </div>
            )}
            {formatClassSize(school.avgClassSize) && (
              <div className="rounded-lg border border-border p-card">
                <dt className="text-sm text-muted-foreground">Average class size</dt>
                <dd data-numeric className="text-2xl font-semibold">
                  {formatClassSize(school.avgClassSize)}
                </dd>
              </div>
            )}
            {formatFeeBand(school.feeBandMin, school.feeBandMax) && (
              <div className="rounded-lg border border-border p-card">
                <dt className="text-sm text-muted-foreground">Fees per term</dt>
                <dd data-numeric className="text-2xl font-semibold">
                  {formatFeeBand(school.feeBandMin, school.feeBandMax)}
                </dd>
                {/* The one figure on this page ZSMS has NOT verified. Said plainly rather than
                    left to sit under a heading that claims otherwise. */}
                <p className="mt-1 text-sm text-muted-foreground">
                  Stated by the school. Confirm before enrolling.
                </p>
              </div>
            )}
          </dl>
        </section>
      )}

      {school.gradeLevels.length > 0 && (
        <section className="mt-cards">
          <h2 className="text-lg font-semibold tracking-tight">Grades taught</h2>
          <ul className="mt-stack flex flex-wrap gap-2">
            {school.gradeLevels.map((g) => (
              <li key={g}>
                <Badge variant="neutral">{g}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {facilities.length > 0 && (
        <section className="mt-cards">
          <h2 className="text-lg font-semibold tracking-tight">Facilities</h2>
          <ul className="mt-stack grid grid-cols-1 gap-2 sm:grid-cols-2">
            {facilities.map(([key, label, Icon]) => (
              <li key={key} className="flex items-center gap-2 text-sm">
                <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
                {label}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-cards border-t border-border pt-cards text-sm text-muted-foreground">
        <p>
          {school.name} manages its pupils, fees and results with ZSMS.{' '}
          <Link href="/for-schools" className="underline">
            ZSMS for schools
          </Link>
          {' · '}
          <Link href="/schools" className="underline">
            Browse other schools
          </Link>
        </p>
        <p className="mt-2">
          Contact details are not published here. Reach the school directly or through its own
          website.
        </p>
      </footer>
    </main>
  )
}
