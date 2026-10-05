'use client'

/**
 * A teacher's own week.
 *
 * Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`, and the agreed
 *       design.
 *
 * ## The same grid as the builder
 *
 * Asked for on 2026-10-05. A teacher reads the week the same way a deputy does — rows
 * are periods, columns are days, colour carries the subject — so it is the same
 * component, read-only, rather than a second layout that drifts from the first.
 *
 * Empty cells are shown rather than skipped: a free period is information, and a list
 * that omits it makes a teacher count their way down the day to find out when they are
 * not teaching.
 *
 * ## Two empty states
 *
 * A school with no published timetable and a teacher assigned to nothing in one that
 * exists are different problems with different remedies, and one "nothing here" would
 * send the second person to ask the wrong question at the office.
 */

import type { JSX } from 'react'
import { useMemo } from 'react'
import { CalendarDays } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../../components/ui/card'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
import { EmptyState } from '../../../../components/ui/empty-state'
import { useApi } from '../../../../lib/use-api'
import { WeekGrid, type Period, type Slot } from '../timetable/week-grid'

interface Row {
  out_day_of_week: number
  out_period_name: string
  out_start_time: string
  out_end_time: string
  out_period_order: number
  out_class_id: string
  out_subject_name: string | null
  out_room: string | null
  out_slot_type: string
}

export default function MyTimetablePage(): JSX.Element {
  const { data, loading, error, code, reload } = useApi<{
    slots: Row[]
    lessons: number
    hasAny: boolean
  }>('/api/teacher/timetable')

  /*
    The periods this teacher actually appears in.

    `my_timetable()` returns only their own slots, so the row labels have to be derived
    from those rather than from the school's full period list — a teacher who never
    teaches period 1 should not read an empty first row every morning.
  */
  const periods: Period[] = useMemo(() => {
    const seen = new Map<string, Period>()
    for (const r of data?.slots ?? []) {
      const key = `${r.out_period_order}`
      if (seen.has(key)) continue
      seen.set(key, {
        id: key,
        name: r.out_period_name,
        startTime: r.out_start_time,
        endTime: r.out_end_time,
        order: r.out_period_order,
        teaching: r.out_slot_type === 'lesson' || r.out_slot_type === 'exam',
        // Every weekday: the grid draws a cell per day and fills the ones that exist.
        appliesDays: [1, 2, 3, 4, 5],
        levels: [],
      })
    }
    return [...seen.values()].sort((a, b) => a.order - b.order)
  }, [data])

  const slots: Slot[] = useMemo(
    () =>
      (data?.slots ?? []).map((r, i) => ({
        id: `${r.out_period_order}-${r.out_day_of_week}-${i}`,
        periodId: `${r.out_period_order}`,
        day: r.out_day_of_week,
        subjectName: r.out_subject_name,
        // A teacher's week is defined by WHICH CLASS they are with.
        teacherName: r.out_class_id,
        room: r.out_room,
        slotType: r.out_slot_type,
      })),
    [data],
  )

  if (loading && !data) return <TableSkeleton rows={6} columns={6} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />

  return (
    <>
      <PageHeader
        title="My timetable"
        description="Where you are, through the week."
        note="This is the published timetable. If your school is still arranging one, it does not appear here until they publish it."
      />

      {!data?.hasAny ? (
        <EmptyState
          icon={CalendarDays}
          title="No lessons on your timetable"
          /* Both possibilities, because the remedy differs and this screen cannot tell
             which applies. */
          description="Either your school has not published a timetable yet, or you have not been put on any lessons in it. The school office can check."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays aria-hidden="true" className="size-5 text-primary" />
              Your week
            </CardTitle>
            <CardDescription>
              {data.lessons} lesson{data.lessons === 1 ? '' : 's'}. The class is shown under
              each subject.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {/* Read-only: a teacher sees the same grid a deputy builds, and cannot
                edit it. `canEdit` false also stops the cells looking tappable. */}
            <WeekGrid periods={periods} slots={slots} canEdit={false} onOpen={() => {}} />
          </CardContent>
        </Card>
      )}
    </>
  )
}
