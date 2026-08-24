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
import { Suspense, use, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Search, UserPlus, Users } from 'lucide-react'

import { useApi } from '../../../../lib/use-api'
import { can } from '../../../../lib/roles'
import type { Role } from '@zsms/auth-provider'
import { Alert } from '../../../../components/ui/alert'
import { Button } from '../../../../components/ui/button'
import { Card, CardContent } from '../../../../components/ui/card'
import { DataTable } from '../../../../components/ui/data-table'
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
  const ceiling = capacity?.is_unlimited ? null : (capacity?.student_limit ?? null)

  const total = meta?.total ?? 0
  const perPage = meta?.perPage ?? 25
  const lastPage = Math.max(1, Math.ceil(total / perPage))

  const setParam = useCallback(
    (next: Record<string, string>) => {
      const q = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(next)) {
        if (!v || v === 'all') q.delete(k)
        else q.set(k, v)
      }
      // Any filter change returns to page 1. Staying on page 4 of a result set
      // that now has one page shows an empty table that looks like no matches.
      if (!('page' in next)) q.delete('page')
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
        actions={
          <div className="flex flex-col items-end gap-1">
            {/* Two different reasons not to offer enrolment, and they are not
                interchangeable. A role that cannot enrol never sees the button
                at all; a school that is full sees it disabled, because the
                action is theirs and the obstacle is temporary. */}
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

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <TableSkeleton rows={8} columns={5} />}

      {!error && data && (
        <>
          <Card>
            <CardContent className="p-0">
              {/* One component, two layouts: a real table from `sm` up, a card
                  per pupil below it. See components/ui/data-table.tsx for why a
                  horizontally scrolling table is not a mobile table. */}
              <DataTable
                caption="Pupils at this school"
                rows={data}
                rowKey={(s) => s.id}
                columns={[
                  {
                    key: 'pupil',
                    header: 'Pupil',
                    primary: true,
                    cell: (s) => (
                      <>
                        <Link
                          href={`${base}/students/${s.id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {s.last_name}, {s.first_name}
                        </Link>
                        <span className="block font-mono text-xs text-subtle">{s.student_id}</span>
                      </>
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

          {total > perPage && (
            <nav
              aria-label="Pagination"
              className="mt-cards flex flex-wrap items-center justify-between gap-3"
            >
              <p className="text-sm text-muted-foreground">
                Showing <span data-numeric>{(page - 1) * perPage + 1}</span>–
                <span data-numeric>{Math.min(page * perPage, total)}</span> of{' '}
                <span data-numeric>{formatCount(total)}</span>
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setParam({ page: String(page - 1) })}
                >
                  <ChevronLeft aria-hidden="true" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= lastPage}
                  onClick={() => setParam({ page: String(page + 1) })}
                >
                  Next
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </nav>
          )}
        </>
      )}
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
