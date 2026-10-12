'use client'

/**
 * Pupil roll.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
 *       `Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md`
 *
 * ## The ceiling is read, never known
 *
 * Nothing on this screen contains a pupil limit. The number in the banner, the
 * number in the disabled button's explanation, and the number the database
 * enforces are the same value, resolved once by `school_student_capacity()` and
 * carried in the list response's `meta`. Change the tier's limit from the admin
 * pricing screen, or grant this school an override, and this screen says
 * something different on the next load with nothing rebuilt.
 *
 * That is the property worth protecting. A literal here — even a sensible one,
 * even in a comparison — would be a second source of truth that drifts silently,
 * and the drift only surfaces when a school is at its limit and being told two
 * different things by the button and the error.
 *
 * ## Filters live in the URL
 *
 * So a filtered roll can be linked, bookmarked, and sent to a colleague. The
 * same reasoning as the admin schools list.
 */

import type { FormEvent, JSX } from 'react'
import { Suspense, use, useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Search, UserPlus, Users, Upload } from 'lucide-react'

import { Pagination } from '../../../../components/ui/pagination'
import { Avatar } from '../../../../components/ui/avatar'
import { useApi } from '../../../../lib/use-api'
import { can } from '../../../../lib/roles'
import { YearEnd } from './year-end'
import type { Role } from '@zsms/auth-provider'
import { Alert } from '../../../../components/ui/alert'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent } from '../../../../components/ui/card'
import { DataTable } from '../../../../components/ui/data-table'
import { BulkBar } from '../../../../components/ui/bulk-bar'
import { SavedViews } from '../../../../components/ui/saved-views'
import { RailPanel, RailStats, WithRail } from '../../../../components/ui/context-rail'
import { SectionLink } from '../../../../components/ui/section-link'
import { EmptyState } from '../../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
import { Field, Input, Select } from '../../../../components/ui/field'
import { FormGrid, FormSection } from '../../../../components/ui/form'
import {
  STUDENT_STATUSES,
  STUDENT_STATUS_LABEL,
  StudentStatusBadge,
  formatCount,
  formatLevel,
} from '../school-shared'

interface Student {
  /** Already returned by `/api/students`; nothing rendered it until now. */
  photo_url?: string | null
  id: string
  student_id: string
  first_name: string
  last_name: string
  grade_id: string
  class_id: string
  status: string
  is_boarding: boolean
  enrolment_date: string
}

interface Structure {
  role: string
  gradeLevels: Array<{ level_id: string; display_name: string; level_order: number }>
  classesByGrade: Record<string, string[]>
}

function StudentsTable({ base }: { base: string }): JSX.Element {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const status = params.get('status') ?? 'all'
  const gradeId = params.get('gradeId') ?? 'all'
  const search = params.get('q') ?? ''
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)

  const query = useMemo(() => {
    const q = new URLSearchParams({ page: String(page), perPage: '25' })
    if (status !== 'all') q.set('status', status)
    if (gradeId !== 'all') q.set('gradeId', gradeId)
    if (search.trim()) q.set('search', search.trim())
    return q.toString()
  }, [page, status, gradeId, search])

  const { data, meta, loading, error, code, reload } = useApi<Student[]>(`/api/students?${query}`)
  const { data: structure } = useApi<Structure>('/api/school/structure')

  // Straight from the API's `meta`. Never recomputed, never defaulted to a
  // number — a missing capacity renders as unknown, not as unlimited.
  const capacity = meta?.capacity ?? null
  const atCapacity = capacity?.at_capacity === true
  // Undefined while the structure loads, which renders as "cannot" — the safe
  // direction. A button that appears and then vanishes is worse than one that
  // appears a moment late.
  const mayEnrol = can(structure?.role as Role | undefined, 'students:write')

  /*
    Promotion is the owner's and principal's act — `promote_students()` refuses anybody
    else inside the function. `results:publish` is exactly that pair, so it is reused
    rather than adding a `students:promote` nobody else would ever check.
  */
  const canPromote = can(structure?.role as Role | undefined, 'results:publish')

  /*
    Selection is gated on `announcements:write`, not on `students:write`.

    The only bulk action is messaging parents, so the capability that matters is the
    one that sends it. Gating on pupil write access would show checkboxes and a
    "Message their parents" button to a registrar who cannot send an announcement —
    a control that fails at the end of the journey rather than being absent.
  */
  const canBulkMessage = can(structure?.role as Role | undefined, 'announcements:write')
  const ceiling = capacity?.is_unlimited ? null : (capacity?.student_limit ?? null)

  /*
    The rail's two datasets, shaped once rather than inside the JSX.

    Sorted by year group as a NUMBER where possible: a plain string sort puts Year 10
    between Year 1 and Year 2, which looks like a bug in the data rather than in the
    sort. Zambian grade ids are numeric today; anything non-numeric falls back to
    alphabetical rather than disappearing.
  */
  const distributionRows = useMemo(() => {
    const dist = meta?.distribution
    if (!dist) return []
    const entries = Object.entries(dist)
    const totalCounted = entries.reduce((sum, [, n]) => sum + n, 0)

    return entries
      .sort(([a], [b]) => {
        const na = Number(a)
        const nb = Number(b)
        if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
        return a.localeCompare(b)
      })
      .map(([grade, n], i) => ({
        label: grade === 'Unassigned' ? 'No year group' : `Year ${grade}`,
        value: String(n),
        percent: totalCounted > 0 ? (n / totalCounted) * 100 : 0,
        // The validated series order, so the rail agrees with every chart.
        colour: [
          'bg-success-fill',
          'bg-primary-fill',
          'bg-warning-fill',
          'bg-accent-fill',
          'bg-danger-fill',
        ][i % 5],
      }))
  }, [meta?.distribution])

  const recentRows = useMemo(
    () =>
      ((meta?.recent ?? []) as Array<{
        id: string
        first_name: string
        last_name: string
        grade_id: string | null
        photo_url: string | null
      }>),
    [meta?.recent],
  )

  /*
    Selected pupils, for the bulk bar.

    Keyed by pupil id and NOT reset when the page changes, so a reader can gather
    pupils across pages. It IS reset by the filters, further down — a selection made
    under one filter means something different under another, and acting on rows the
    reader can no longer see is how the wrong parents get messaged.
  */
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const total = meta?.total ?? 0
  const perPage = meta?.perPage ?? 25

  const setParam = useCallback(
    (next: Record<string, string>) => {
      const q = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(next)) {
        if (!v || v === 'all') q.delete(k)
        else q.set(k, v)
      }
      // Any filter change returns to page 1. Staying on page 4 of a result set
      // that now has one page shows an empty table that looks like no matches.
      if (!('page' in next)) {
        q.delete('page')
        /*
          A filter change also clears the selection; a page change does NOT.

          Paging keeps it on purpose, so pupils can be gathered across pages. But a
          selection made under one filter means something different under another,
          and carrying it forward would let somebody message parents of pupils the
          list no longer shows — the mistake is invisible, because the bar's count is
          the only evidence those rows are still selected.
        */
        setSelected(new Set())
      }
      router.push(`${pathname}?${q.toString()}`)
    },
    [params, pathname, router],
  )

  const submitSearch = useCallback(
    (event: FormEvent) => {
      event.preventDefault()
      const value = new FormData(event.target as HTMLFormElement).get('q')
      setParam({ q: typeof value === 'string' ? value : '' })
    },
    [setParam],
  )

  return (
    <>
      <PageHeader
        title="Pupils"
        description="Everyone on the roll, and everyone who has left."
        note="Active and on-leave pupils occupy a place against the school's limit; transferred, graduated and withdrawn pupils do not. Tap a name to open a pupil."
        actions={
          <div className="flex flex-col items-end gap-1">
            {/* Two different reasons not to offer enrolment, and they are not
                interchangeable. A role that cannot enrol never sees the button
                at all; a school that is full sees it disabled, because the
                action is theirs and the obstacle is temporary. */}
            {/* Import sits beside enrolment rather than inside it: adding one
                pupil and adding a term's intake are different jobs, and burying
                the second behind the first is how a school types 300 rows by
                hand. Disabled at capacity for the same reason as enrolment. */}
            {mayEnrol && !atCapacity && (
              <Button variant="outline" asChild>
                <Link href={`${base}/students/import`}>
                  <Upload aria-hidden="true" />
                  Import from a spreadsheet
                </Link>
              </Button>
            )}
            {mayEnrol && (
              <Button asChild disabled={atCapacity}>
                {atCapacity ? (
                  // A disabled anchor is still clickable, so at capacity the
                  // control becomes a real button that does nothing rather than
                  // a link to a form which cannot succeed.
                  <button type="button" disabled>
                    <UserPlus aria-hidden="true" />
                    Enrol pupil
                  </button>
                ) : (
                  <Link href={`${base}/students/new`}>
                    <UserPlus aria-hidden="true" />
                    Enrol pupil
                  </Link>
                )}
              </Button>
            )}
            {capacity && (
              <p className="text-xs text-muted-foreground">
                <span data-numeric>{formatCount(capacity.current_count)}</span>
                {' of '}
                <span data-numeric>{capacity.is_unlimited ? 'no limit' : formatCount(ceiling ?? 0)}</span>
              </p>
            )}
          </div>
        }
      />

      {atCapacity && capacity && (
        <Alert variant="warning" title="The roll is full" className="mb-cards">
          This school has {formatCount(capacity.current_count)} pupils on the roll, and its plan
          allows {formatCount(ceiling ?? 0)}. Enrolment is paused until a place is freed, the
          subscription is upgraded, or AfriTech sets a limit for this school alone.
        </Alert>
      )}

      <FormSection className="mb-cards">
        <form onSubmit={submitSearch} noValidate>
          <FormGrid columns={3}>
            <Field id="student-search" label="Search" hint="Name or pupil number">
              {(props) => (
                <Input
                  {...props}
                  name="q"
                  type="search"
                  defaultValue={search}
                  maxLength={100}
                  placeholder="Banda, STU-ZM-LSK-9001-00042"
                />
              )}
            </Field>

            <Field id="student-status" label="Status">
              {(props) => (
                <Select {...props} value={status} onChange={(e) => setParam({ status: e.target.value })}>
                  <option value="all">All statuses</option>
                  {STUDENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STUDENT_STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {/* Grades come from this school's own configuration, never a
                constant — Zambia runs two systems at once and most private
                schools are mid-transition. See /api/school/structure. */}
            <Field id="student-grade" label="Grade">
              {(props) => (
                <Select {...props} value={gradeId} onChange={(e) => setParam({ gradeId: e.target.value })}>
                  <option value="all">All grades</option>
                  {(structure?.gradeLevels ?? []).map((g) => (
                    <option key={g.level_id} value={g.level_id}>
                      {g.display_name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </FormGrid>

          <div className="mt-stack">
            <Button type="submit" variant="outline">
              <Search aria-hidden="true" />
              Search
            </Button>
          </div>
        </form>
      </FormSection>

      {/*
        Saved filter views (reference W2).

        Above the error and the table on purpose: a view is how somebody gets BACK to
        a list, so it has to be reachable when the list itself has failed to load.
      */}
      <SavedViews
        surface="students"
        current={{ status, gradeId, q: search }}
        canSave={mayEnrol}
        onApply={(f) =>
          setParam({
            status: f.status ?? 'all',
            gradeId: f.gradeId ?? 'all',
            q: f.q ?? '',
          })
        }
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={8} columns={5} />}

      {!error && data && (
        <WithRail
          rail={
            <>
              {/*
                The roll's shape, from `meta.distribution` — computed over the WHOLE
                roll in the route, not from the rows on screen. A distribution derived
                from ten visible pupils would read "Year 7: 4" meaning four on this
                page, which nobody could distinguish from four in the school.
              */}
              <RailPanel
                title="Year groups"
                action={<SectionLink href={`${base}/settings`}>Structure</SectionLink>}
              >
                {meta?.distribution === null ? (
                  <p className="text-sm text-muted-foreground">
                    The breakdown could not be loaded. The list above is unaffected.
                  </p>
                ) : (
                  <RailStats stats={distributionRows} />
                )}
              </RailPanel>

              {/*
                Recently enrolled. Useful on the day a school is onboarding a cohort,
                and the fastest way back to a pupil somebody has just created.
              */}
              <RailPanel title="Recently enrolled">
                {recentRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nobody has been enrolled yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {recentRows.map((r) => (
                      <li key={r.id}>
                        <Link
                          href={`${base}/students/${r.id}`}
                          className="flex min-h-tap items-center gap-2.5 rounded-md text-sm transition-colors hover:bg-neutral-tint"
                        >
                          <Avatar
                            name={`${r.first_name} ${r.last_name}`}
                            src={r.photo_url}
                            size="sm"
                          />
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {r.first_name} {r.last_name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {r.grade_id ? `Year ${r.grade_id}` : 'No year group'}
                            </span>
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </RailPanel>
            </>
          }
        >
          <Card>
            <CardContent className="p-0">
              {/* One component, two layouts: a real table from `sm` up, a card
                  per pupil below it. See components/ui/data-table.tsx for why a
                  horizontally scrolling table is not a mobile table. */}
              <DataTable
                selected={canBulkMessage ? selected : undefined}
                onSelectedChange={canBulkMessage ? setSelected : undefined}
                selectNoun="pupils"
                caption="Pupils at this school"
                rows={data}
                rowKey={(s) => s.id}
                href={(s) => `${base}/students/${s.id}`}
                columns={[
                  {
                    key: 'pupil',
                    header: 'Pupil',
                    primary: true,
                    cell: (s) => (
                      /*
                        Picture, name, number — the shape every reference list uses.

                        The name stays an ordinary link rather than becoming a button:
                        it is the row's subject, and a button in every row would be a
                        wall of chrome. The agreed principle promotes links that are
                        ACTIONS beside a heading, not the identity of a record.

                        The avatar is not editable here. A pupil's photo is set on their
                        record, where there is room to see what is being replaced —
                        changing a face from a list of forty is how the wrong child gets
                        the wrong picture.
                      */
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Avatar
                          name={`${s.first_name} ${s.last_name}`}
                          src={s.photo_url}
                          size="sm"
                        />
                        <span className="min-w-0">
                          <Link
                            href={`${base}/students/${s.id}`}
                            className="block truncate font-medium text-foreground hover:underline"
                          >
                            {s.last_name}, {s.first_name}
                          </Link>
                          <span className="block font-mono text-xs text-subtle">
                            {s.student_id}
                          </span>
                        </span>
                      </span>
                    ),
                  },
                  { key: 'grade', header: 'Grade', cell: (s) => formatLevel(s.grade_id) },
                  { key: 'class', header: 'Class', cell: (s) => formatLevel(s.class_id) },
                  { key: 'status', header: 'Status', cell: (s) => <StudentStatusBadge status={s.status} /> },
                  {
                    key: 'boarding',
                    header: 'Boarding',
                    cell: (s) => (s.is_boarding ? 'Boarding' : 'Day'),
                  },
                ]}
                empty={
                  <EmptyState
                    icon={Users}
                    title={search || status !== 'all' || gradeId !== 'all' ? 'No pupils match' : 'No pupils yet'}
                    description={
                      search || status !== 'all' || gradeId !== 'all'
                        ? 'Try a wider filter.'
                        : 'Enrol the first pupil to start the roll.'
                    }
                  />
                }
              />
            </CardContent>
          </Card>

          <Pagination
            page={page}
            total={total}
            perPage={perPage}
            noun="pupils"
            onPageChange={(next) => setParam({ page: String(next) })}
          />

          {/*
            The one bulk action that has a backend.

            `/api/school/announcements` already accepts an `individuals` audience with
            explicit `targetIds`, so this hands the composer a real audience rather
            than being a button that needs an endpoint written for it. Everything else
            a reader might expect here — bulk status change, bulk export, bulk class
            move — has no endpoint, and offering it would be a control that cannot work.
          */}
          <BulkBar count={selected.size} noun="pupil" onClear={() => setSelected(new Set())}>
            <Button asChild size="sm">
              <Link href={`${base}/announcements?to=${[...selected].join(',')}`}>
                Message their parents
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </Button>
          </BulkBar>
        </WithRail>
      )}

      {/* Once a year, and reserved to the people who run the school — the function
          refuses anybody but the owner or principal, so the panel follows the same
          pair rather than inventing a third rule. */}
      {canPromote && <YearEnd onDone={reload} />}
    </>
  )
}

export default function StudentsPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  const { schoolCode } = use(params)

  // `useSearchParams` forces a Suspense boundary in the App Router; without one
  // the whole route opts out of static optimisation and the build says so.
  return (
    <Suspense fallback={<TableSkeleton rows={8} columns={5} />}>
      <StudentsTable base={`/school/${schoolCode}`} />
    </Suspense>
  )
}
