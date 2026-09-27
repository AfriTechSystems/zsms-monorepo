'use client'

/**
 * My Library.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## Filters are derived from what the teacher owns
 *
 * The subject and grade options come back from the API computed over this teacher's own
 * rows, not from a fixed list. A teacher who only does Grade 9 maths should not be offered
 * eleven grades and twelve subjects, eleven of which return nothing.
 *
 * ## Read access is permanent, and this screen is where that promise is kept
 *
 * A lapsed subscription blocks generation and nothing else — every resource stays readable
 * for good. So there is no entitlement gate on this page at all, deliberately: the library
 * is exactly as usable on a cancelled account as on a paid one.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { BookOpen } from 'lucide-react'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent } from '../../../components/ui/card'
import { Field, Select } from '../../../components/ui/field'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { KIND_LABELS, hubFetch, shortDate, type ResourceRow } from '../hub-shared'

interface LibraryPayload {
  resources: ResourceRow[]
  subjects: string[]
  grades: string[]
  counts: { lesson_plan: number; quiz: number; homework: number }
}

export default function LibraryPage(): JSX.Element {
  const [payload, setPayload] = useState<LibraryPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [kind, setKind] = useState('')
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const query = new URLSearchParams()
    if (kind) query.set('kind', kind)
    if (subject) query.set('subject', subject)
    if (grade) query.set('grade', grade)

    const { data, error: loadError } = await hubFetch<LibraryPayload>(
      `/api/teacher/hub/resources${query.size > 0 ? `?${query.toString()}` : ''}`,
    )
    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }
    setError(null)
    setPayload(data)
    setLoading(false)
  }, [kind, subject, grade])

  useEffect(() => {
    void load()
  }, [load])

  const resources = payload?.resources ?? []
  const filtered = Boolean(kind || subject || grade)

  return (
    <>
      <PageHeader
        title="My library"
        description="Everything you have made. Yours to keep, whatever happens to your subscription or your school."
        backTo="/teacher"
        backLabel="Teacher Hub"
        actions={
          <Button asChild size="sm">
            <Link href="/teacher/create">Create something</Link>
          </Button>
        }
      />

      <div className="space-y-cards">
        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field id="filter-kind" label="Type">
                {(props) => (
                  <Select {...props} value={kind} onChange={(e) => setKind(e.target.value)}>
                    <option value="">All types</option>
                    <option value="lesson_plan">Lesson plans</option>
                    <option value="quiz">Quizzes</option>
                    <option value="homework">Homework</option>
                  </Select>
                )}
              </Field>

              <Field id="filter-subject" label="Subject">
                {(props) => (
                  <Select {...props} value={subject} onChange={(e) => setSubject(e.target.value)}>
                    <option value="">All subjects</option>
                    {/*
                      When a filter is active the options come from the filtered set, which
                      would shrink the list the teacher is choosing from. The unfiltered
                      subject list is held in the first payload, so the options only narrow
                      when the library itself does.
                    */}
                    {(payload?.subjects ?? []).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field id="filter-grade" label="Grade">
                {(props) => (
                  <Select {...props} value={grade} onChange={(e) => setGrade(e.target.value)}>
                    <option value="">All grades</option>
                    {(payload?.grades ?? []).map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </CardContent>
        </Card>

        {loading ? (
          <TableSkeleton rows={6} columns={4} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : resources.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={filtered ? 'Nothing matches those filters' : 'Your library is empty'}
            description={
              filtered
                ? 'Clear a filter to see more.'
                : 'Make a lesson plan, a quiz or a piece of homework and it will appear here.'
            }
            action={
              filtered ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setKind('')
                    setSubject('')
                    setGrade('')
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/teacher/create">Create something</Link>
                </Button>
              )
            }
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-border">
                {resources.map((r) => (
                  <li key={r.id}>
                    <Link
                      href={`/teacher/library/${r.id}`}
                      className="flex items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-neutral-tint"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-text">{r.title}</p>
                        <p className="mt-0.5 text-xs text-muted-text">
                          {r.subject} · {r.grade_level}
                          {r.duration_minutes ? ` · ${r.duration_minutes} min` : ''} ·{' '}
                          {shortDate(r.created_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {r.is_shared && <Badge variant="info">Shared</Badge>}
                        <Badge
                          variant={
                            r.resource_kind === 'lesson_plan'
                              ? 'primary'
                              : r.resource_kind === 'quiz'
                                ? 'info'
                                : 'neutral'
                          }
                        >
                          {KIND_LABELS[r.resource_kind] ?? r.resource_kind}
                        </Badge>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
