/**
 * A child's week, on a parent's phone.
 *
 * Spec: `Official Documentation/07 Students and Parents/PARENT_PORTAL.md`
 *       `Official Documentation/08 Staff Management/TIMETABLE.md`
 *
 * Published only. A draft is the school rearranging next term, and a parent planning
 * around one would be planning around a guess — so nothing is shown and the screen says
 * why, rather than implying the school has no timetable at all.
 */

import type { JSX } from 'react'
import { RefreshControl, ScrollView } from 'react-native'
import { CalendarDays } from 'lucide-react-native'

import { ChildSwitcher } from '../../../components/child-switcher'
import { WeekGrid, type WeekSlot } from '../../../components/week-grid'
import { Empty, ErrorNote, Loading, Screen, usePalette } from '../../../components/ui'
import { childQuery, useChild, type Child } from '../../../lib/child'
import { useApi } from '../../../lib/use-api'
import { SPACE } from '../../../theme'

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

export default function ParentTimetable(): JSX.Element {
  const c = usePalette()
  const { childId, setChildId } = useChild()
  const { data, loading, error, reload } = useApi<{
    children: Child[]
    slots: Slot[]
  }>(`/api/parent/timetable${childQuery(childId)}`)

  const slots: WeekSlot[] = (data?.slots ?? []).map((s) => ({
    day: s.out_day_of_week,
    periodName: s.out_period_name,
    startTime: s.out_start_time,
    endTime: s.out_end_time,
    periodOrder: s.out_period_order,
    title: s.out_subject_name ?? s.out_period_name,
    // A parent's question is WHO is teaching it. The function returns a name, never a
    // Clerk id — that is a handle for addressing somebody elsewhere in the system.
    subtitle: s.out_teacher_name,
    room: s.out_room,
  }))

  return (
    <Screen>
      <ChildSwitcher children={data?.children ?? []} selectedId={childId} onSelect={setChildId} />

      {error ? (
        <ScrollView
          contentContainerStyle={{ padding: SPACE.gutter }}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
          }
        >
          <ErrorNote message={error} onRetry={reload} />
        </ScrollView>
      ) : loading && !data ? (
        <Loading label="Loading the week" />
      ) : slots.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ padding: SPACE.gutter }}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
          }
        >
          <Empty
            icon={CalendarDays}
            title="No timetable published"
            body="Your school has not published a timetable for this class yet. It appears here as soon as they do."
          />
        </ScrollView>
      ) : (
        <WeekGrid slots={slots} />
      )}
    </Screen>
  )
}
