'use client'

/**
 * Schools list.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *
 * The cross-school view `/api/schools` deliberately does not offer. Filters are
 * held in the URL rather than in component state, so a link to "every suspended
 * school on Growth" is a thing an operator can paste into a ticket — which is
 * most of what a support tool is for.
 */

import type { JSX } from 'react'
import { Suspense, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Building2, ChevronLeft, ChevronRight, Search } from 'lucide-react'

import { useApi } from '../../../lib/use-api'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { Field, Input, Select } from '../../../components/ui/field'
import { FormGrid, FormSection } from '../../../components/ui/form'
import { StatusBadge, TIER_LABEL } from '../health-shared'

interface School {
  id: string
  school_id: string
  name: string
  type: string
  level: string
  city_code: string
  status: string
  subscription_tier: string
  created_at: string
  capacity: {
    student_limit: number | null
    is_unlimited: boolean
    current_count: number
    at_capacity: boolean
  } | null
}

function SchoolsTable(): JSX.Element {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const status = params.get('status') ?? 'all'
  const tier = params.get('tier') ?? 'all'
  const q = params.get('q') ?? ''
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)

  const url = useMemo(() => {
    const search = new URLSearchParams()
    if (status !== 'all') search.set('status', status)
    if (tier !== 'all') search.set('tier', tier)
    if (q) search.set('q', q)
    if (page > 1) search.set('page', String(page))
    const qs = search.toString()
    return `/api/admin/schools${qs ? `?${qs}` : ''}`
  }, [status, tier, q, page])

  const { data, meta, loading, error, code, reload } = useApi<School[]>(url)

  const setParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString())
      if (!value || value === 'all') next.delete(key)
      else next.set(key, value)
      // Any filter change invalidates the page number — otherwise a narrower
      // filter lands the operator on page 3 of a 1-page result and reads as
      // "no schools".
      if (key !== 'page') next.delete('page')
      router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  const total = meta?.total ?? 0
  const perPage = meta?.perPage ?? 25
  const lastPage = Math.max(1, Math.ceil(total / perPage))

  return (
    <>
      <PageHeader
        title="Schools"
        description="Every school on the platform. Filters are held in the URL, so a filtered view can be linked."
      />

      <FormSection className="mb-cards">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const value = new FormData(e.currentTarget).get('q')
            setParam('q', typeof value === 'string' ? value.trim() : '')
          }}
        >
          <FormGrid columns={4}>
            <Field id="school-search" label="Search" hint="Name or school code">
              {(props) => (
                <Input
                  {...props}
                  name="q"
                  type="search"
                  defaultValue={q}
                  placeholder="Test Academy, ZM-LSK-9001"
                />
              )}
            </Field>

            <Field id="school-status" label="Status">
              {(props) => (
                <Select
                  {...props}
                  value={status}
                  onChange={(e) => setParam('status', e.target.value)}
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="trial">Trial</option>
                  <option value="pending_verification">Pending verification</option>
                  <option value="suspended">Suspended</option>
                  <option value="terminated">Terminated</option>
                </Select>
              )}
            </Field>

            <Field id="school-tier" label="Tier">
              {(props) => (
                <Select
                  {...props}
                  value={tier}
                  onChange={(e) => setParam('tier', e.target.value)}
                >
                  <option value="all">All tiers</option>
                  <option value="starter">Starter</option>
                  <option value="growth">Growth</option>
                  <option value="professional">Professional</option>
                  <option value="enterprise">Enterprise</option>
                </Select>
              )}
            </Field>

            {/*
              The button occupies a grid cell like any field, with an invisible
              label holding its row position. `items-end` on a bare div was what
              made this column sit a hint's height above the others — the button
              was aligning to a box the grid had stretched, not to the controls.
            */}
            <div className="flex flex-col gap-1.5">
              <span aria-hidden="true" className="hidden text-sm font-medium sm:block">
                &nbsp;
              </span>
              <Button type="submit" className="w-full">
                <Search aria-hidden="true" />
                Search
              </Button>
            </div>
          </FormGrid>
        </form>
      </FormSection>

      {error && <ErrorState message={error} code={code} onRetry={reload} />}

      {loading && !data && !error && <TableSkeleton rows={8} columns={5} />}

      {!error && data && data.length === 0 && (
        <EmptyState
          icon={Building2}
          title="No schools match these filters"
          description={
            q || status !== 'all' || tier !== 'all'
              ? 'Try widening the search, or clear the filters to see every school.'
              : 'No schools exist yet. Run npm run db:seed to load synthetic fixtures for development.'
          }
          action={
            (q || status !== 'all' || tier !== 'all') && (
              <Button variant="outline" onClick={() => router.replace(pathname, { scroll: false })}>
                Clear filters
              </Button>
            )
          }
        />
      )}

      {!error && data && data.length > 0 && (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Schools on the platform, {total} in total, page {page} of {lastPage}
                  </caption>
                  <thead className="border-b border-border bg-sunken text-left">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-medium">School</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Tier</th>
                      <th scope="col" className="px-4 py-2.5 font-medium">Type</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">Roll</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((school) => (
                      <tr key={school.id} className="border-b border-border last:border-0">
                        <th scope="row" className="px-4 py-3 text-left font-normal">
                          <Link
                            href={`/admin/schools/${school.id}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {school.name}
                          </Link>
                          <span className="block font-mono text-xs text-subtle">{school.school_id}</span>
                        </th>
                        <td className="px-4 py-3">
                          <StatusBadge status={school.status} />
                        </td>
                        <td className="px-4 py-3">
                          {TIER_LABEL[school.subscription_tier] ?? school.subscription_tier}
                        </td>
                        <td className="px-4 py-3 capitalize text-muted-foreground">
                          {school.type} · {school.level}
                        </td>
                        <td data-numeric className="px-4 py-3 text-right">
                          {/* Roll against the RESOLVED ceiling — the number the
                              enrolment guard enforces, not the unenforced copy
                              in `schools.max_students` this column used to show.
                              "No limit" is spelled out rather than left as a
                              dash: a cap of zero and no cap are opposites, and
                              a dash reads as neither. */}
                          {school.capacity ? (
                            <>
                              {school.capacity.current_count}
                              <span className="text-muted-foreground">
                                {' / '}
                                {school.capacity.is_unlimited
                                  ? '∞'
                                  : school.capacity.student_limit}
                              </span>
                              {school.capacity.at_capacity && (
                                <span className="ml-1.5 align-middle">
                                  <Badge variant="warning">Full</Badge>
                                </span>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <nav
            aria-label="Pagination"
            className="mt-cards flex flex-wrap items-center justify-between gap-3"
          >
            <p className="text-sm text-muted-foreground">
              Showing <span data-numeric>{(page - 1) * perPage + 1}</span>–
              <span data-numeric>{Math.min(page * perPage, total)}</span> of{' '}
              <span data-numeric>{total}</span>
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setParam('page', String(page - 1))}
              >
                <ChevronLeft aria-hidden="true" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= lastPage}
                onClick={() => setParam('page', String(page + 1))}
              >
                Next
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>
          </nav>
        </>
      )}
    </>
  )
}

export default function AdminSchoolsPage(): JSX.Element {
  // `useSearchParams` needs a Suspense boundary or the whole route opts out of
  // static rendering with a build-time warning.
  return (
    <Suspense fallback={<TableSkeleton rows={8} columns={5} />}>
      <SchoolsTable />
    </Suspense>
  )
}
