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
import { Suspense, useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  BadgeCheck,
  Bus,
  ChevronRight,
  School,
  Search,
  SlidersHorizontal,
  Users,
} from 'lucide-react'

import { getCountryConfig } from '@zsms/config'

import { PublicShell } from '../../components/public/public-shell'
import { useApi } from '../../lib/use-api'
import { formatClassSize, formatFeeBand, formatPupilTeacherRatio } from '../../lib/directory-format'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
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

  /**
   * On a phone the filter block is six stacked dropdowns, and a parent would scroll past all of them
   * before seeing a single school. So on small screens only the name search stays visible and the
   * rest sit behind a toggle; from `sm:` up everything is shown and the toggle disappears.
   *
   * A CSS-driven `sm:block` rather than a media query in JavaScript, so the desktop layout is correct
   * in the first paint and there is no hydration mismatch to reconcile.
   */
  const [filtersOpen, setFiltersOpen] = useState(false)

  // How many filters are actually narrowing the list — worth surfacing on the collapsed toggle, or a
  // parent cannot tell why they are seeing four schools instead of forty.
  const activeFilters = [province, city, level, type, feeMax].filter(Boolean).length +
    (boarding ? 1 : 0) + (transport ? 1 : 0)

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

  /**
   * Schools that published nothing are separated out and collapsed.
   *
   * They are not less relevant — a parent may well be looking for exactly one of them — but a card
   * with no class size, no fees and no description has nothing to compare, and interleaving them
   * broke the scan: every row stretched to its tallest card, so one detailed listing left its
   * neighbour as a name over a band of empty space.
   *
   * Collapsed rather than dropped, because a directory that silently hides schools is lying about
   * what is on ZSMS. The count is in the summary, so the parent knows they exist and can open them.
   */
  const detailed = (data ?? []).filter(
    (s) => s.about || s.pupilsPerTeacher !== null || s.avgClassSize !== null || s.feeBandMin !== null,
  )
  const undetailed = (data ?? []).filter((s) => !detailed.includes(s))

  const total = meta?.total ?? 0
  const perPage = meta?.perPage ?? 20
  const lastPage = Math.max(1, Math.ceil(total / perPage))

  return (
    <>
      <FormSection className="mb-cards">
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

        {/* Visible only on phones. From `sm:` up the filters below are always shown. */}
        <div className="mt-stack sm:hidden">
          <Button
            variant="outline"
            className="w-full"
            aria-expanded={filtersOpen}
            aria-controls="directory-filters"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal aria-hidden="true" />
            {filtersOpen ? 'Hide filters' : 'Area, level and fees'}
            {activeFilters > 0 && !filtersOpen && (
              <Badge variant="primary">{activeFilters}</Badge>
            )}
          </Button>
        </div>

        <div
          id="directory-filters"
          className={(filtersOpen ? 'block' : 'hidden') + ' mt-stack sm:mt-stack sm:block'}
        >
        <FormGrid columns={2}>
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
            {detailed.map((s) => {
              const ratio = formatPupilTeacherRatio(s.pupilsPerTeacher)
              const classSize = formatClassSize(s.avgClassSize)
              const fees = formatFeeBand(s.feeBandMin, s.feeBandMax)
              const hasFacts = Boolean(ratio || classSize || fees)

              return (
                <li key={s.schoolCode}>
                  {/*
                    THE WHOLE CARD IS THE LINK.
                    A card with a small link inside it makes the obvious gesture — tapping the card —
                    do nothing, which on a phone reads as a broken page. The "View school" button is
                    gone for the same reason: it was a second target for the one thing this card does.
                  */}
                  <Link
                    href={`/schools/${s.schoolCode}`}
                    className="group flex h-full flex-col gap-stack rounded-lg border border-border bg-card p-card transition-all hover:-translate-y-0.5 hover:border-foreground/25 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-start gap-3">
                      {s.logoUrl ? (
                        /* A school's logo is an arbitrary external URL on R2, so next/image
                           would need every possible host allowlisted in next.config. */
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.logoUrl}
                          alt=""
                          width={48}
                          height={48}
                          className="size-12 shrink-0 rounded-md object-contain"
                        />
                      ) : (
                        <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted">
                          <School aria-hidden="true" className="size-6 text-muted-foreground" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <h2 className="font-semibold leading-tight group-hover:underline">
                          {s.name}
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

                    {hasFacts ? (
                      <dl className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-3 text-sm">
                        {ratio && (
                          <div>
                            <dt className="flex items-center gap-1.5 text-muted-foreground">
                              <Users aria-hidden="true" className="size-3.5" />
                              Teacher to pupils
                            </dt>
                            <dd data-numeric className="font-semibold">
                              {ratio}
                            </dd>
                          </div>
                        )}
                        {classSize && (
                          <div>
                            <dt className="text-muted-foreground">Average class</dt>
                            <dd data-numeric className="font-semibold">
                              {classSize}
                            </dd>
                          </div>
                        )}
                        {fees && (
                          <div className="col-span-2">
                            <dt className="text-muted-foreground">Fees a term</dt>
                            <dd data-numeric className="font-semibold">
                              {fees}
                            </dd>
                          </div>
                        )}
                      </dl>
                    ) : (
                      /*
                        Fills the gap that made these rows look ragged, and says something true while
                        doing it. Seen in the browser: a school publishing nothing rendered as a name,
                        a wide band of dead space, and a lone button — the grid stretches every row to
                        its tallest card, so one detailed listing left its neighbour looking broken.
                        An absence with a reason reads as a choice; an absence with nothing reads as a
                        fault in the page.
                      */
                      <p className="flex flex-1 items-center rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
                        This school hasn&rsquo;t published class sizes or fees yet.
                      </p>
                    )}

                    <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                      {s.hasBoarding && <Badge variant="neutral">Boarding</Badge>}
                      {s.hasTransport && <Badge variant="neutral">Transport</Badge>}
                      <span className="ml-auto flex items-center gap-1 text-sm font-medium text-foreground">
                        View school
                        <ArrowRight
                          aria-hidden="true"
                          className="size-4 transition-transform group-hover:translate-x-0.5"
                        />
                      </span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>

          {undetailed.length > 0 && (
            /*
              A native <details>. A disclosure built from useState would need the open state, a
              button, aria-expanded and a region association — four things to get wrong for a
              behaviour the element already has, keyboard support included.
            */
            <details className="mt-cards rounded-lg border border-border bg-card/60">
              <summary className="flex min-h-tap cursor-pointer list-none items-center gap-2 px-card py-3 text-sm font-medium transition-colors hover:bg-muted/50 [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-90 [details[open]_&]:rotate-90"
                />
                <span>
                  <span data-numeric>{undetailed.length}</span>
                  {undetailed.length === 1 ? ' school has' : ' schools have'} not published details
                </span>
              </summary>
              <ul className="flex flex-col border-t border-border">
                {undetailed.map((s) => (
                  <li key={s.schoolCode}>
                    <Link
                      href={`/schools/${s.schoolCode}`}
                      className="flex min-h-tap items-center gap-3 px-card py-3 transition-colors hover:bg-muted/50"
                    >
                      {s.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.logoUrl}
                          alt=""
                          width={32}
                          height={32}
                          className="size-8 shrink-0 rounded object-contain"
                        />
                      ) : (
                        <span className="flex size-8 shrink-0 items-center justify-center rounded bg-muted">
                          <School aria-hidden="true" className="size-4 text-muted-foreground" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{s.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {country.cities[s.cityCode] ?? s.cityCode} ·{' '}
                          {LEVEL_LABEL[s.level] ?? s.level}
                        </span>
                      </span>
                      <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}

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
    <PublicShell>
      <header className="mb-cards flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Find a school</h1>
        <p className="max-w-2xl text-muted-foreground">
          Every school here runs on ZSMS, so the numbers come from their own records rather than a
          brochure.
        </p>
        {/*
          One line, not three. The explainer used to be a paragraph above the search box, so the first
          thing a parent met was an essay about our methodology — before they had seen a single school
          or had any reason to care how the numbers were produced. The detail lives on each school's
          page, at the point where somebody is actually reading a figure.
        */}
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <BadgeCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
          Figures are calculated from each school&rsquo;s own records. We don&rsquo;t rank schools.
        </p>
      </header>

      {/* `useSearchParams` needs a Suspense boundary or the route opts out of static rendering. */}
      <Suspense fallback={<TableSkeleton rows={5} columns={3} />}>
        <Directory />
      </Suspense>
    </PublicShell>
  )
}
