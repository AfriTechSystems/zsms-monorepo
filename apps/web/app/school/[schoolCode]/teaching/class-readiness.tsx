'use client'

/**
 * Which classes are behind — the top of the drill-down.
 *
 * Spec: `Official Documentation/10 Attendance Management/ATTENDANCE.md`
 *       `Official Documentation/11 Examinations and Results/RESULTS.md`
 *
 * ## What this replaces
 *
 * An owner could see a pupil, a class, a mark sheet — one at a time, by choosing it. What
 * they could not see is the thing they open the portal for: **which classes are behind**.
 * Finding out meant opening the attendance register for each class in turn and looking.
 *
 * So the drill-down had no top. This is it: grades first, with the counts that matter, and
 * a tap into the class that needs attention.
 *
 * ## Grades collapse, classes expand
 *
 * A secondary school has twelve grades and perhaps forty classes. Forty rows is a list to
 * read, not a thing to act on. Grades summarise their classes, and open only when something
 * is outstanding — so a school fully up to date shows twelve quiet rows and a school three
 * weeks behind on Grade 9 shows it immediately.
 *
 * ## The numbers are not a score
 *
 * `SCHOOL_HEALTH_SCORES.md` computes similar signals for AfriTech's view of a school, and
 * this deliberately does not reproduce that: no percentage, no rating, no colour-graded
 * ranking of one teacher against another. "Four registers behind" is a fact somebody can act
 * on this afternoon. "62% compliance" is a judgement, and a staffroom is not improved by one.
 */

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarX, ChevronRight, ClipboardList, CircleCheck } from 'lucide-react'

import { Badge } from '../../../../components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card'
import { useApi } from '../../../../lib/use-api'
import { formatLevel } from '../school-shared'

interface ClassRow {
  out_grade_id: string
  out_class_id: string
  out_pupils: number
  out_register_days: number
  out_register_days_missing: number
  out_subjects_assigned: number
  out_subjects_with_marks: number
  out_marks_missing: number
}

export function ClassReadiness({ base }: { base: string }): JSX.Element | null {
  const { data } = useApi<{ classes: ClassRow[] }>('/api/school/classes')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const rows = useMemo(() => data?.classes ?? [], [data])

  /** Grades, each carrying its classes and the totals across them. */
  const grades = useMemo(() => {
    const byGrade = new Map<string, ClassRow[]>()
    for (const row of rows) {
      const list = byGrade.get(row.out_grade_id)
      if (list) list.push(row)
      else byGrade.set(row.out_grade_id, [row])
    }
    return [...byGrade.entries()]
      .map(([gradeId, classes]) => ({
        gradeId,
        classes,
        pupils: classes.reduce((t, c) => t + c.out_pupils, 0),
        registersBehind: classes.filter((c) => c.out_register_days_missing > 0).length,
        marksBehind: classes.filter((c) => c.out_marks_missing > 0).length,
      }))
      // Grades with something outstanding first — the screen exists to surface them.
      .sort(
        (a, b) =>
          b.registersBehind + b.marksBehind - (a.registersBehind + a.marksBehind) ||
          a.gradeId.localeCompare(b.gradeId),
      )
  }, [rows])

  // A school with no classes yet has nothing to be behind on.
  if (grades.length === 0) return null

  const totalBehind = grades.reduce((t, g) => t + g.registersBehind + g.marksBehind, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardList aria-hidden="true" className="size-5 text-primary" />
          Classes this term
        </CardTitle>
        <CardDescription>
          {totalBehind === 0 ? (
            'Every class is up to date on registers and marks.'
          ) : (
            <>
              <span data-numeric>{totalBehind}</span>{' '}
              {totalBehind === 1 ? 'class needs' : 'classes need'} attention. Open a grade to
              see which.
            </>
          )}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ul className="flex flex-col gap-1">
          {grades.map((grade) => {
            const behind = grade.registersBehind + grade.marksBehind
            const isOpen = open.has(grade.gradeId)

            return (
              <li key={grade.gradeId}>
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setOpen((current) => {
                      const next = new Set(current)
                      if (next.has(grade.gradeId)) next.delete(grade.gradeId)
                      else next.add(grade.gradeId)
                      return next
                    })
                  }
                  className="flex min-h-tap w-full flex-wrap items-center gap-2 rounded-md px-2 text-left transition-colors hover:bg-muted"
                >
                  <ChevronRight
                    aria-hidden="true"
                    className={
                      'size-4 shrink-0 text-muted-foreground transition-transform '
                      + (isOpen ? 'rotate-90' : '')
                    }
                  />
                  <span className="font-medium">{formatLevel(grade.gradeId)}</span>
                  <span className="text-sm text-muted-foreground">
                    <span data-numeric>{grade.classes.length}</span>{' '}
                    {grade.classes.length === 1 ? 'class' : 'classes'} ·{' '}
                    <span data-numeric>{grade.pupils}</span> pupils
                  </span>

                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    {behind === 0 ? (
                      <Badge variant="success">
                        <CircleCheck aria-hidden="true" className="mr-1 inline size-3" />
                        Up to date
                      </Badge>
                    ) : (
                      <>
                        {grade.registersBehind > 0 && (
                          <Badge variant="warning">
                            <span data-numeric>{grade.registersBehind}</span> behind on
                            registers
                          </Badge>
                        )}
                        {grade.marksBehind > 0 && (
                          <Badge variant="neutral">
                            <span data-numeric>{grade.marksBehind}</span> missing marks
                          </Badge>
                        )}
                      </>
                    )}
                  </span>
                </button>

                {isOpen && (
                  <ul className="mb-1 ml-6 flex flex-col gap-1 border-l border-border pl-3">
                    {grade.classes.map((c) => (
                      <li
                        key={c.out_class_id}
                        className="flex flex-wrap items-center gap-2 py-1 text-sm"
                      >
                        <span className="min-w-[4rem] font-medium">
                          {formatLevel(c.out_class_id)}
                        </span>
                        <span className="text-muted-foreground">
                          <span data-numeric>{c.out_pupils}</span> pupils
                        </span>

                        {c.out_register_days_missing > 0 && (
                          <span className="flex items-center gap-1 text-warning">
                            <CalendarX aria-hidden="true" className="size-3.5" />
                            <span data-numeric>{c.out_register_days_missing}</span> registers
                            not marked
                          </span>
                        )}

                        {c.out_marks_missing > 0 && (
                          <span className="text-muted-foreground">
                            <span data-numeric>{c.out_marks_missing}</span> of{' '}
                            <span data-numeric>{c.out_subjects_assigned}</span> subjects have
                            no marks
                          </span>
                        )}

                        {/*
                          Straight into the work, with the class already chosen. The point of
                          an overview is that acting on it does not mean starting the
                          navigation again from the top.
                        */}
                        <span className="ml-auto flex gap-2">
                          <Link
                            href={`${base}/attendance?classId=${encodeURIComponent(c.out_class_id)}`}
                            className="rounded px-2 py-0.5 text-sm font-medium text-primary hover:bg-primary/10"
                          >
                            Register
                          </Link>
                          <Link
                            href={`${base}/results?gradeId=${encodeURIComponent(c.out_grade_id)}&classId=${encodeURIComponent(c.out_class_id)}`}
                            className="rounded px-2 py-0.5 text-sm font-medium text-primary hover:bg-primary/10"
                          >
                            Marks
                          </Link>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
