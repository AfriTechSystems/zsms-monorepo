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

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { CopyCode } from './copy-code'

export const revalidate = 300

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
 * Fetched through the public API route rather than the database directly.
 *
 * One source of truth for what is publishable: the route and the SQL function behind it already
 * decide that, and a server component reaching past them would be a second place where the
 * disclosure rules live — which is how the two drift apart.
 */
async function loadProfile(code: string): Promise<PublicProfile | null> {
  const base = process.env['NEXT_PUBLIC_ZSMS_URL'] ?? 'http://localhost:3000'
  try {
    const response = await fetch(`${base}/api/public/schools/${encodeURIComponent(code)}`, {
      next: { revalidate: 300 },
    })
    if (!response.ok) return null
    const body = (await response.json()) as { data?: PublicProfile }
    return body.data ?? null
  } catch {
    // A directory page that 500s because the API blipped is worse for search ranking than one that
    // reports the school as unlisted. Treated as not found and re-fetched on the next revalidation.
    return null
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
            {school.pupilsPerTeacher !== null && (
              <div className="rounded-lg border border-border p-card">
                <dt className="text-sm text-muted-foreground">Pupils per teacher</dt>
                <dd data-numeric className="text-2xl font-semibold">
                  {school.pupilsPerTeacher}
                </dd>
              </div>
            )}
            {school.avgClassSize !== null && (
              <div className="rounded-lg border border-border p-card">
                <dt className="text-sm text-muted-foreground">Average class size</dt>
                <dd data-numeric className="text-2xl font-semibold">
                  {school.avgClassSize}
                </dd>
              </div>
            )}
            {school.feeBandMin !== null && school.feeBandMax !== null && (
              <div className="rounded-lg border border-border p-card">
                <dt className="text-sm text-muted-foreground">Fees per term</dt>
                <dd data-numeric className="text-2xl font-semibold">
                  K{school.feeBandMin.toLocaleString()}–{school.feeBandMax.toLocaleString()}
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
