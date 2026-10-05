'use client'

/**
 * A teacher's own week.
 *
 * Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
 *
 * ## Laid out as a week, not a list
 *
 * A teacher's question is "where am I at eleven on Tuesday", which a column per day
 * answers at a glance and a chronological list does not.
 *
 * ## Two empty states, because they mean different things
 *
 * A school with no published timetable and a teacher who has not been given any lesson
 * in one that exists are different problems with different remedies, and a single
 * "nothing here" would send the second person to ask the wrong question.
 */

import type { JSX } from 'react'
import { useMemo } from 'react'
import { CalendarDays } from 'lucide-react'

import { Badge } from '../../../../components/ui/badge'
import { Card, CardContent } from '../../../../components/ui/card'
import { ErrorState, PageHeader, TableSkeleton } from '../../../../components/ui/data-states'
import { EmptyState } from '../../../../components/ui/empty-state'
import { useApi } from '../../../../lib/use-api'

const DAYS = [
  { n: 1, label: 'Monday' },
  { n: 2, label: 'Tuesday' },
  { n: 3, label: 'Wednesday' },
  { n: 4, label: 'Thursday' },
  { n: 5, label: 'Friday' },
] as const

interface Slot {
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

const hhmm = (t: string): string => t.slice(0, 5)

export default function MyTimetablePage(): JSX.Element {
  const { data, loading, error, code, reload } = useApi<{
    slots: Slot[]
    lessons: number
    hasAny: boolean
  }>('/api/teacher/timetable')

  const byDay = useMemo(() => {
    const map = new Map<number, Slot[]>()
    for (const s of data?.slots ?? []) {
      const list = map.get(s.out_day_of_week) ?? []
      list.push(s)
      map.set(s.out_day_of_week, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.out_period_order - b.out_period_order)
    return map
  }, [data])

  if (loading) return <TableSkeleton rows={6} columns={5} />
  if (error) return <ErrorState message={error} code={code} onRetry={reload} />

  return (
    <>
      <PageHeader
        title="My timetable"
        description="Where you are, through the week."
        note="This is the published timetable. If your school is still building one, it will not appear here until they publish it."
      />

      {!data?.hasAny ? (
        <EmptyState
          icon={CalendarDays}
          title="No lessons on your timetable"
          /* Both possibilities, because the remedy differs and this screen cannot tell
             which applies. */
          description="Either your school has not published a timetable yet, or you have not been assigned to any lessons on it. The school office can check."
        />
      ) : (
        <div className="grid gap-cards lg:grid-cols-5">
          {DAYS.map((d) => {
            const slots = byDay.get(d.n) ?? []
            return (
              <Card key={d.n}>
                <CardContent className="flex flex-col gap-stack pt-card">
                  <p className="font-semibold">{d.label}</p>

                  {slots.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing scheduled.</p>
                  ) : (
                    slots.map((s, i) => (
                      <div
                        key={`${s.out_period_order}-${i}`}
                        className="rounded-md border border-border p-stack"
                      >
                        <p className="text-sm text-muted-foreground">
                          {hhmm(s.out_start_time)}–{hhmm(s.out_end_time)}
                        </p>
                        <p className="font-medium">{s.out_subject_name ?? s.out_slot_type}</p>
                        <p className="text-sm">{s.out_class_id}</p>
                        {s.out_room && <Badge variant="neutral">{s.out_room}</Badge>}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}
