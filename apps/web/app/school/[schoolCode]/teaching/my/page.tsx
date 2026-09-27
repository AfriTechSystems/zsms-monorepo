'use client'

/**
 * My teaching — a teacher's home.
 *
 * Spec: `Official Documentation/08 Staff Management/ASSIGNMENTS.md`
 *       `Official Documentation/01 Foundation Layer/DECISIONS.md` — ADR-037
 *
 * ## It lives inside the school portal, not at /teacher
 *
 * A teacher at a ZSMS school IS a member of that school, and everything they do —
 * the register, the mark sheet — is a school-scoped screen that already exists. A
 * separate `/teacher` portal would need its own shell, its own theme handling and
 * its own copies of those screens, and a teacher who also holds a form class would
 * be crossing between two products. So this is a landing page that routes into
 * screens already built.
 *
 * (The standalone Teacher Hub in the docs — `platform:teacher`, no school
 * affiliation — is a genuinely different product for teachers with no school, and
 * is not this.)
 *
 * ## Unmarked registers first, because that is the thing that gets forgotten
 *
 * A register with no rows is invisible in the data; the API turns that absence into
 * a fact and this screen puts it at the top. Everything else a teacher can find at
 * their leisure — a register missed on Tuesday cannot be reconstructed on Friday.
 */

import type { JSX } from 'react'
import { use } from 'react'
import Link from 'next/link'
import { CalendarCheck, ClipboardList, GraduationCap } from 'lucide-react'

import { useApi } from '../../../../../lib/use-api'
import { Alert } from '../../../../../components/ui/alert'
import { Badge } from '../../../../../components/ui/badge'
import { Button } from '../../../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card'
import { EmptyState } from '../../../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../../components/ui/data-states'
import { formatLevel } from '../../school-shared'

interface Payload {
  today: string
  classes: Array<{
    classId: string
    registerMarkedToday: boolean
    subjects: Array<{ code: string | null; name: string | null; wholeClass: boolean }>
  }>
  unpublishedSheets: Array<{
    class_id: string
    subject_code: string
    subject_name: string
    academic_year: string
    term_number: number
  }>
  assignments: Array<{ id: string }>
}

export default function MyTeachingPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  const { schoolCode } = use(params)
  const base = `/school/${schoolCode}`
  const { data, loading, error, code, reload } = useApi<Payload>('/api/teacher/overview')

  if (error) return <ErrorState message={error} code={code} onRetry={reload} />
  if (loading && !data) return <TableSkeleton rows={5} columns={2} />

  const unmarked = (data?.classes ?? []).filter((c) => !c.registerMarkedToday)

  return (
    <>
      <PageHeader
        title="My teaching"
        description="Your classes, today's registers, and marks still to publish."
        note="A register that has not been marked shows below as unmarked — there is no record for it at all, which is different from every pupil being present. Marks you have entered stay editable until the head publishes them."
      />

      {(data?.assignments.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={GraduationCap}
              title="You have no classes assigned yet"
              description="The head teacher or school owner assigns classes and subjects. Until then there is no register for you to mark and no marks for you to enter."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-cards">
          {/* First, because a missed register cannot be reconstructed later. */}
          {unmarked.length > 0 && (
            <Alert
              variant="warning"
              title={`${unmarked.length} register${unmarked.length === 1 ? '' : 's'} not marked today`}
            >
              {unmarked.map((c) => formatLevel(c.classId)).join(', ')} — nobody has opened{' '}
              {unmarked.length === 1 ? 'it' : 'them'} today.
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Today&apos;s registers</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {(data?.classes ?? []).map((c) => (
                  <li key={c.classId} className="flex flex-wrap items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{formatLevel(c.classId)}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.subjects.some((s) => s.wholeClass)
                          ? 'Whole class'
                          : c.subjects
                              .map((s) => s.name)
                              .filter(Boolean)
                              .join(', ')}
                      </p>
                    </div>
                    {c.registerMarkedToday ? (
                      <Badge variant="success">Marked</Badge>
                    ) : (
                      <Badge variant="warning">Not marked</Badge>
                    )}
                    <Button variant={c.registerMarkedToday ? 'ghost' : 'default'} size="sm" asChild>
                      <Link href={`${base}/attendance?classId=${encodeURIComponent(c.classId)}`}>
                        <CalendarCheck aria-hidden="true" />
                        {c.registerMarkedToday ? 'Review' : 'Mark register'}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Marks</CardTitle>
              <p className="text-sm text-muted-foreground">
                Sheets you have started and the head has not yet published.
              </p>
            </CardHeader>
            <CardContent>
              {(data?.unpublishedSheets.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing unpublished. Open a class and subject below to enter marks.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {(data?.unpublishedSheets ?? []).map((s) => (
                    <li
                      key={`${s.class_id}-${s.subject_code}-${s.term_number}`}
                      className="flex flex-wrap items-center gap-3 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">
                          {s.subject_name} — {formatLevel(s.class_id)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.academic_year} term {s.term_number}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          href={`${base}/results?classId=${encodeURIComponent(s.class_id)}&subjectCode=${encodeURIComponent(s.subject_code)}&year=${encodeURIComponent(s.academic_year)}&term=${s.term_number}`}
                        >
                          <ClipboardList aria-hidden="true" />
                          Continue
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-stack">
                <Button variant="ghost" asChild>
                  <Link href={`${base}/results`}>
                    <ClipboardList aria-hidden="true" />
                    Enter marks for another class
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
