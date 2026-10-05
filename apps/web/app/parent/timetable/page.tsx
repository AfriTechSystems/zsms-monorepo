'use client'

/**
 * A child's week, for a parent.
 *
 * Spec: `Official Documentation/07 Students and Parents/PARENT_PORTAL.md`
 *       `Official Documentation/08 Staff Management/TIMETABLE.md`
 *
 * ## Published only
 *
 * A draft is the school rearranging next term. A parent who read one and planned around
 * it would be planning around a guess, so `child_timetable()` returns nothing until the
 * school publishes — and this screen says that rather than implying there is no
 * timetable at all.
 *
 * ## The teacher's name, not their id
 *
 * A parent is entitled to know who teaches their child. They are not entitled to a
 * Clerk identifier, which is a handle for addressing that person elsewhere in the
 * system — the function returns the name and nothing else.
 */

import type { JSX } from 'react'
import { useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { CalendarDays } from 'lucide-react'

import { Badge } from '../../../components/ui/badge'
import { Card, CardContent } from '../../../components/ui/card'
import { ErrorState, TableSkeleton } from '../../../components/ui/data-states'
import { EmptyState } from '../../../components/ui/empty-state'
import { ParentPageHeader } from '../parent-shared'
import { useApi } from '../../../lib/use-api'

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
  out_subject_name: string | null
  out_teacher_name: string | null
  out_room: string | null
  out_slot_type: string
}

interface Child {
  id: string
  firstName: string
  lastName: string
  schoolName: string | null
}

const hhmm = (t: string): string => t.slice(0, 5)

export default function ParentTimetablePage(): JSX.Element {
  /*
    The chosen child lives in the URL, not in this component.

    `ChildSwitcher` is in the parent shell and writes `?childId=`, so every page reads
    it the same way. Holding a second copy here would be two pieces of state meaning
    one thing, and the one that drifts is whichever is read last.
  */
  const params = useSearchParams()
  const childId = params.get('childId')

  const { data, loading, error, code, reload } = useApi<{
    children: Child[]
    selected: Child | null
    slots: Slot[]
  }>(childId ? `/api/parent/timetable?childId=${childId}` : '/api/parent/timetable')

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
      <ParentPageHeader
        title="Timetable"
        childName={
          data?.selected ? `${data.selected.firstName} ${data.selected.lastName}` : undefined
        }
        note="Only a published timetable appears here. While your school is still arranging one, nothing is shown rather than a version that will change."
      />

      {(data?.slots.length ?? 0) === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No timetable published"
          description="Your school has not published a timetable for this class yet. It appears here as soon as they do."
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
                        <p className="font-medium">{s.out_subject_name ?? s.out_period_name}</p>
                        {s.out_teacher_name && (
                          <p className="text-sm text-muted-foreground">{s.out_teacher_name}</p>
                        )}
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
