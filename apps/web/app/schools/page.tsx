'use client'

/**
 * `/schools` — the public school directory.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md`
 *
 * ## The highest-traffic page in the product, and the one with no login
 *
 * A parent looking for a school arrives here from a search engine knowing nothing about ZSMS. So the
 * page has to answer their question before it explains itself: what schools are near me, what do they
 * cost, how big are the classes. The ZSMS story is a line at the bottom, not a banner at the top.
 *
 * ## Filters live in the URL
 *
 * Same reasoning as the admin lists: "every boarding secondary school in Lusaka under K3,000" becomes
 * a link a parent can send to their spouse. It is also what makes the page shareable in WhatsApp,
 * which in Zambia is the distribution channel that matters.
 *
 * ## What is absent, deliberately
 *
 * No score, no stars, no ranking. The metric ZSMS could compute — the school health score — measures
 * whether a school uses the software, from attendance-marking compliance and fee collection rate. It
 * would rank a good school badly for a slow bursar and broadcast how many of its parents are in
 * arrears. Decided 2026-09-30: verified facts, no rank.
 *
 * A number here means the school chose to publish it and ZSMS computed it from their live records. A
 * blank means they have not published it — never that the answer is zero, which is why every metric
 * renders as an absent line rather than a dash or a nought.
 */

import type { JSX } from 'react'
import { Suspense, useCallback, useMemo } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BadgeCheck, Bus, School, Search, Users } from 'lucide-react'

import { getCountryConfig } from '@zsms/config'

import { useApi } from '../../lib/use-api'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/empty-state'
import { ErrorState, TableSkeleton } from '../../components/ui/data-states'
import { Field, Input, Select } from '../../components/ui/field'
import { FormGrid, FormSection } from '../../components/ui/form'

interface DirectorySchool {
  schoolCode: string
  name: string
  cityCode: string
  provinceCode: string
  type: string
  level: string
  logoUrl: string | null
  status: string
  about: string | null
  pupilsPerTeacher: number | null
  avgClassSize: number | null
  feeBandMin: number | null
  feeBandMax: number | null
  hasBoarding: boolean | null
  hasTransport: boolean | null
}

const LEVEL_LABEL: Record<string, string> = {
  pre: 'Pre-school',
  primary: 'Primary',
  secondary: 'Secondary',
  combined: 'Primary & Secondary',
}

const TYPE_LABEL: Record<string, string> = {
  day: 'Day',
  boarding: 'Boarding',
  both: 'Day & Boarding',
}

function Directory(): JSX.Element {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const country = getCountryConfig()

  const q = params.get('q') ?? ''
  const province = params.get('province') ?? ''
  const city = params.get('city') ?? ''
  const level = params.get('level') ?? ''
  const type = params.get('type') ?? ''
  const boarding = params.get('boarding') === 'true'
  const transport = params.get('transport') === 'true'
  const feeMax = params.get('feeMax') ?? ''
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)

  const url = useMemo(() => {
    const s = new URLSearchParams()
    if (q) s.set('q', q)
    if (province) s.set('province', province)
    if (city) s.set('city', city)
    if (level) s.set('level', level)
    if (type) s.set('type', type)
    if (boarding) s.set('boarding', 'true')
    if (transport) s.set('transport', 'true')
    if (feeMax) s.set('feeMax', feeMax)
    if (page > 1) s.set('page', String(page))
    const qs = s.toString()
    return `/api/public/schools${qs ? `?${qs}` : ''}`
  }, [q, province, city, level, type, boarding, transport, feeMax, page])

  const { data, meta, loading, error, code, reload } = useApi<DirectorySchool[]>(url)

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString())
      if (!value) next.delete(key)
      else next.set(key, value)
      // Province changes invalidate the city, or a parent ends up filtering by a city that is not in
      // the province they just chose and sees nothing.
      if (key === 'province') next.delete('city')
      if (key !== 'page') next.delete('page')
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  const cities = useMemo(
    () =>
      Object.entries(country.cities)
        .filter(([c]) => !province || country.cityProvince[c] === province)
        .sort((a, b) => a[1].localeCompare(b[1])),
    [country, province],
  )

  const total = meta?.total ?? 0
  const perPage = meta?.perPage ?? 20
  const lastPage = Math.max(1, Math.ceil(total / perPage))

  return (
    <>
      <FormSection className="mb-cards">
        <FormGrid columns={3}>
          <Field id="q" label="School name" hint="Two letters or more.">
            {(props) => (
              <Input
                {...props}
                type="search"
                defaultValue={q}
                placeholder="Sunrise"
                onChange={(e) => setParam('q', e.target.value.trim())}
              />
            )}
          </Field>

          <Field id="province" label="Province">
            {(props) => (
              <Select
                {...props}
                value={province}
                onChange={(e) => setParam('province', e.target.value)}
              >
                <option value="">Anywhere in {country.name}</option>
                {Object.entries(country.provinces)
                  .sort((a, b) => a[1].localeCompare(b[1]))
                  .map(([c, label]) => (
                    <option key={c} value={c}>
                      {label}
                    </option>
                  ))}
              </Select>
            )}
          </Field>

          <Field id="city" label="City or town">
            {(props) => (
              <Select {...props} value={city} onChange={(e) => setParam('city', e.target.value)}>
                <option value="">Anywhere{province ? ' in this province' : ''}</option>
                {cities.map(([c, label]) => (
                  <option key={c} value={c}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="level" label="Level">
            {(props) => (
              <Select {...props} value={level} onChange={(e) => setParam('level', e.target.value)}>
                <option value="">Any level</option>
                <option value="pre">Pre-school</option>
                <option value="primary">Primary</option>
                <option value="secondary">Secondary</option>
                <option value="combined">Primary &amp; Secondary</option>
              </Select>
            )}
          </Field>

          <Field id="type" label="Day or boarding">
            {(props) => (
              <Select {...props} value={type} onChange={(e) => setParam('type', e.target.value)}>
                <option value="">Either</option>
                <option value="day">Day</option>
                <option value="boarding">Boarding</option>
                <option value="both">Both</option>
              </Select>
            )}
          </Field>

          <Field
            id="feeMax"
            label="Fees up to (per term)"
            hint="Only schools that publish a fee range."
          >
            {(props) => (
              <Select {...props} value={feeMax} onChange={(e) => setParam('feeMax', e.target.value)}>
                <option value="">Any</option>
                <option value="1000">K1,000</option>
                <option value="2500">K2,500</option>
                <option value="5000">K5,000</option>
                <option value="10000">K10,000</option>
              </Select>
            )}
          </Field>
        </FormGrid>

        <div className="mt-stack flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={boarding ? 'default' : 'outline'}
            onClick={() => setParam('boarding', boarding ? '' : 'true')}
          >
            Has boarding
          </Button>
          <Button
            size="sm"
            variant={transport ? 'default' : 'outline'}
            onClick={() => setParam('transport', transport ? '' : 'true')}
          >
            <Bus aria-hidden="true" />
            Has transport
          </Button>
        </div>
      </FormSection>

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={5} columns={3} />}

      {!error && data && data.length === 0 && (
        <EmptyState
          icon={Search}
          title="No schools match"
          description="Try a wider area, or fewer filters. Only schools using ZSMS appear here — a school you know may simply not be on the platform yet."
        />
      )}

      {!error && data && data.length > 0 && (
        <>
          <p className="mb-cards text-sm text-muted-foreground">
            <span data-numeric>{total}</span> school{total === 1 ? '' : 's'} on ZSMS
            {city ? ` in ${country.cities[city]}` : province ? ` in ${country.provinces[province]}` : ''}
          </p>

          <ul className="grid grid-cols-1 gap-cards sm:grid-cols-2">
            {data.map((s) => (
              <li key={s.schoolCode}>
                <Card className="h-full">
                  <CardContent className="flex h-full flex-col gap-stack pt-card">
                    <div className="flex items-start gap-3">
                      {s.logoUrl ? (
                        /* A school's logo is an arbitrary external URL on R2, so next/image
                           would need every possible host allowlisted in next.config. */
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.logoUrl}
                          alt=""
                          width={44}
                          height={44}
                          className="size-11 shrink-0 rounded-md object-contain"
                        />
                      ) : (
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted">
                          <School aria-hidden="true" className="size-5 text-muted-foreground" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <h2 className="font-semibold leading-tight">
                          <Link href={`/schools/${s.schoolCode}`} className="hover:underline">
                            {s.name}
                          </Link>
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          {country.cities[s.cityCode] ?? s.cityCode} ·{' '}
                          {LEVEL_LABEL[s.level] ?? s.level} · {TYPE_LABEL[s.type] ?? s.type}
                        </p>
                      </div>
                      {s.status === 'trial' && <Badge variant="neutral">New</Badge>}
                    </div>

                    {s.about && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">{s.about}</p>
                    )}

                    {/* Only what the school published. An absent metric shows nothing at all —
                        never a dash and never a zero, either of which would read as an answer. */}
                    {(s.pupilsPerTeacher !== null ||
                      s.avgClassSize !== null ||
                      s.feeBandMin !== null) && (
                      <dl className="flex flex-wrap gap-x-cards gap-y-1 text-sm">
                        {s.pupilsPerTeacher !== null && (
                          <div className="flex items-center gap-1.5">
                            <Users aria-hidden="true" className="size-3.5 text-muted-foreground" />
                            <dt className="text-muted-foreground">Pupils per teacher</dt>
                            <dd data-numeric className="font-medium">
                              {s.pupilsPerTeacher}
                            </dd>
                          </div>
                        )}
                        {s.avgClassSize !== null && (
                          <div className="flex items-center gap-1.5">
                            <dt className="text-muted-foreground">Average class</dt>
                            <dd data-numeric className="font-medium">
                              {s.avgClassSize}
                            </dd>
                          </div>
                        )}
                        {s.feeBandMin !== null && s.feeBandMax !== null && (
                          <div className="flex items-center gap-1.5">
                            <dt className="text-muted-foreground">Fees</dt>
                            <dd data-numeric className="font-medium">
                              K{s.feeBandMin.toLocaleString()}–{s.feeBandMax.toLocaleString()}
                            </dd>
                          </div>
                        )}
                      </dl>
                    )}

                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      {s.hasBoarding && <Badge variant="neutral">Boarding</Badge>}
                      {s.hasTransport && <Badge variant="neutral">Transport</Badge>}
                      <Button asChild size="sm" variant="outline" className="ml-auto">
                        <Link href={`/schools/${s.schoolCode}`}>View school</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          {lastPage > 1 && (
            <nav aria-label="Pagination" className="mt-cards flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setParam('page', String(page - 1))}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page <span data-numeric>{page}</span> of <span data-numeric>{lastPage}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= lastPage}
                onClick={() => setParam('page', String(page + 1))}
              >
                Next
              </Button>
            </nav>
          )}
        </>
      )}
    </>
  )
}

export default function SchoolsDirectoryPage(): JSX.Element {
  return (
    <main id="main" className="mx-auto w-full max-w-4xl px-gutter py-10">
      <header className="mb-cards flex flex-col gap-3">
        <Link href="/" className="w-fit">
          <Image
            src="/brand/zsms-lockup.png"
            alt="ZSMS — school management by AfriTech Systems"
            width={200}
            height={64}
            priority
            className="h-auto w-[130px]"
          />
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Find a school</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every school here runs on ZSMS, so the numbers below come from their own records rather than
          a brochure.
        </p>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <BadgeCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            <strong className="font-medium text-foreground">Verified by ZSMS</strong> means we
            calculated the figure from the school&rsquo;s live pupil and staff records. Schools choose
            what to publish — a blank means they have not published it, not that the answer is zero.
            We do not rank or score schools.
          </span>
        </p>
      </header>

      {/* `useSearchParams` needs a Suspense boundary or the route opts out of static rendering. */}
      <Suspense fallback={<TableSkeleton rows={5} columns={3} />}>
        <Directory />
      </Suspense>

      <footer className="mt-cards border-t border-border pt-cards text-sm text-muted-foreground">
        <p>
          Is your school not listed?{' '}
          <Link href="/for-schools" className="underline">
            See what ZSMS does for schools
          </Link>
          .
        </p>
      </footer>
    </main>
  )
}
