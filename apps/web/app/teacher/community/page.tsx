'use client'

/**
 * The Community Library.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *       → *5. Community Library (Phase 3)*
 *
 * ## What a card may show
 *
 * A first name and a subject. Never a full name, a school or any contact detail — the
 * functions behind this screen return nothing else, so there is nothing here to leak
 * even by accident.
 *
 * ## Popular means copied, not liked
 *
 * The default sort is by how many teachers have USED a plan. A rating says somebody
 * approved of it in a list; a copy says somebody took it into a classroom. The star
 * average is shown too, because a plan copied once and rated five times is a different
 * proposition from one copied fifty times and rated twice.
 *
 * ## "Use this plan" says what it does
 *
 * It copies. The original author keeps theirs and never sees it change — which is worth
 * saying on the button's confirmation, because "use" could reasonably be read as
 * "open theirs".
 */

import type { JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Copy, Star, Users } from 'lucide-react'

import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { EmptyState } from '../../../components/ui/empty-state'
import { Field, Input, Select } from '../../../components/ui/field'
import { useToast } from '../../../components/ui/toast'
import { apiSend, useApi } from '../../../lib/use-api'

interface Resource {
  id: string
  title: string
  resourceKind: string
  subject: string
  gradeLevel: string
  topic: string
  curriculumType: string
  durationMinutes: number | null
  authorFirstName: string
  ratingAverage: number
  ratingCount: number
  useCount: number
  myRating: number | null
}

const KINDS = [
  { value: '', label: 'Everything' },
  { value: 'lesson_plan', label: 'Lesson plans' },
  { value: 'quiz', label: 'Quizzes' },
  { value: 'homework', label: 'Homework' },
] as const

const SORTS = [
  { value: 'popular', label: 'Most used' },
  { value: 'rating', label: 'Best rated' },
  { value: 'recent', label: 'Newest' },
] as const

/** Five stars, each a button. Filled to the caller's own rating when they have one. */
function Stars({
  value,
  mine,
  onRate,
  busy,
}: {
  value: number
  mine: number | null
  onRate: (n: number) => void
  busy: boolean
}): JSX.Element {
  return (
    <span className="flex items-center gap-0.5" role="group" aria-label="Rate this resource">
      {[1, 2, 3, 4, 5].map((n) => {
        // The caller's own rating when they have one, otherwise the average — so a
        // teacher sees what they said, not what the crowd said.
        const shown = mine ?? value
        return (
          <button
            key={n}
            type="button"
            disabled={busy}
            onClick={() => onRate(n)}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            className="min-h-tap min-w-[1.75rem] disabled:opacity-60"
          >
            <Star
              aria-hidden="true"
              className={`size-4 ${
                n <= Math.round(shown)
                  ? 'fill-warning text-warning'
                  : 'text-muted-foreground'
              }`}
            />
          </button>
        )
      })}
    </span>
  )
}

export default function CommunityLibraryPage(): JSX.Element {
  const { toast } = useToast()
  const router = useRouter()

  const [kind, setKind] = useState('')
  const [sort, setSort] = useState('popular')
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const query = useMemo(() => {
    const p = new URLSearchParams()
    if (kind) p.set('kind', kind)
    if (sort) p.set('sort', sort)
    if (subject.trim()) p.set('subject', subject.trim())
    if (grade.trim()) p.set('gradeLevel', grade.trim())
    return p.toString()
  }, [kind, sort, subject, grade])

  const { data, loading, error, code, reload } = useApi<{
    resources: Resource[]
    filtered: boolean
  }>(`/api/teacher/community${query ? `?${query}` : ''}`)

  const rate = useCallback(
    async (id: string, rating: number) => {
      setBusyId(id)
      try {
        const result = await apiSend('/api/teacher/community', 'PATCH', {
          action: 'rate',
          id,
          rating,
        })
        if (result.error) {
          toast(result.error, 'danger')
          return
        }
        reload()
      } finally {
        setBusyId(null)
      }
    },
    [toast, reload],
  )

  const use = useCallback(
    async (id: string) => {
      setBusyId(id)
      try {
        const result = await apiSend<{ copyId: string; message: string }>(
          '/api/teacher/community',
          'PATCH',
          { action: 'use', id },
        )
        if (result.error) {
          toast(result.error, 'danger')
          return
        }
        toast(result.data?.message ?? 'Copied to your library.', 'success')
        // Straight to the copy, since editing it is the next thing anybody does.
        router.push('/teacher/library')
      } finally {
        setBusyId(null)
      }
    },
    [toast, router],
  )

  if (loading && !data) return <TableSkeleton rows={4} columns={3} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />

  const resources = data?.resources ?? []

  return (
    <>
      <PageHeader
        title="Community Library"
        description="Lesson plans, quizzes and homework shared by other ZSMS teachers."
        note="Shared resources show a teacher's first name and subject — never their full name, school or contact details. Using one copies it to your library; the original author's copy is untouched."
      />

      <Card className="mb-cards">
        <CardContent className="grid gap-stack pt-card sm:grid-cols-4">
          <Field id="f-kind" label="Kind">
            {(props) => (
              <Select {...props} value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field id="f-subject" label="Subject">
            {(props) => (
              <Input
                {...props}
                value={subject}
                placeholder="Mathematics"
                onChange={(e) => setSubject(e.target.value)}
              />
            )}
          </Field>

          <Field id="f-grade" label="Grade">
            {(props) => (
              <Input
                {...props}
                value={grade}
                placeholder="Grade 9"
                onChange={(e) => setGrade(e.target.value)}
              />
            )}
          </Field>

          <Field id="f-sort" label="Order by">
            {(props) => (
              <Select {...props} value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </CardContent>
      </Card>

      {resources.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={data?.filtered ? 'Nothing matches those filters' : 'Nothing shared yet'}
          /* Two different problems with two different remedies — a narrowed filter
             and a genuinely empty library look identical without this. */
          description={
            data?.filtered
              ? 'Try a broader subject or grade, or clear the filters.'
              : 'When teachers share their plans they appear here. You can share your own from My library.'
          }
        />
      ) : (
        <ul className="flex flex-col gap-cards">
          {resources.map((r) => (
            <li key={r.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {r.title}
                    <Badge variant="neutral">{r.subject}</Badge>
                    <Badge variant="neutral">{r.gradeLevel}</Badge>
                  </CardTitle>
                  <CardDescription>
                    {r.topic}
                    {r.durationMinutes ? ` · ${r.durationMinutes} minutes` : ''}
                    {' · shared by '}
                    {/* A first name. There is nothing else to show. */}
                    {r.authorFirstName}
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex flex-wrap items-center gap-cards">
                  <Stars
                    value={r.ratingAverage}
                    mine={r.myRating}
                    busy={busyId === r.id}
                    onRate={(n) => void rate(r.id, n)}
                  />
                  <span className="text-sm text-muted-foreground">
                    {r.ratingCount > 0 ? (
                      <>
                        <span data-numeric>{r.ratingAverage.toFixed(1)}</span> from{' '}
                        <span data-numeric>{r.ratingCount}</span>
                      </>
                    ) : (
                      'Not rated yet'
                    )}
                  </span>

                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Users aria-hidden="true" className="size-4" />
                    {/* Copies, which is the signal that a plan reached a classroom. */}
                    <span data-numeric>{r.useCount}</span> used it
                  </span>

                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    disabled={busyId === r.id}
                    onClick={() => void use(r.id)}
                  >
                    <Copy aria-hidden="true" />
                    Use this plan
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
