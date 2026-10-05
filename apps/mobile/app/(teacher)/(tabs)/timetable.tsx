/**
 * A teacher's week, on their phone.
 *
 * Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
 *
 * The same endpoint the web portal uses. A teacher standing in a corridor between
 * lessons wants one answer — where am I next — and today-first ordering gives it
 * without scrolling.
 *
 * ## Two empty states
 *
 * A school that has published nothing and a teacher who has been assigned nothing are
 * different problems with different remedies. One "nothing here" would send the second
 * person to ask the wrong question at the office.
 */

import type { JSX } from 'react'
import { RefreshControl, ScrollView } from 'react-native'
import { CalendarDays } from 'lucide-react-native'

import { WeekGrid, type WeekSlot } from '../../../components/week-grid'
import { Empty, ErrorNote, Loading, Screen, usePalette } from '../../../components/ui'
import { useApi } from '../../../lib/use-api'
import { SPACE } from '../../../theme'

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

export default function TeacherTimetable(): JSX.Element {
  const c = usePalette()
  const { data, loading, error, reload } = useApi<{
    slots: Slot[]
    lessons: number
    hasAny: boolean
  }>('/api/teacher/timetable')

  const slots: WeekSlot[] = (data?.slots ?? []).map((s) => ({
    day: s.out_day_of_week,
    periodName: s.out_period_name,
    startTime: s.out_start_time,
    endTime: s.out_end_time,
    periodOrder: s.out_period_order,
    title: s.out_subject_name ?? s.out_slot_type,
    // A teacher's week is defined by WHICH CLASS they are with.
    subtitle: s.out_class_id,
    room: s.out_room,
  }))

  if (error) {
    return (
      <Screen>
        <ScrollView
          contentContainerStyle={{ padding: SPACE.gutter }}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
          }
        >
          <ErrorNote message={error} onRetry={reload} />
        </ScrollView>
      </Screen>
    )
  }

  if (loading && !data) {
    return (
      <Screen>
        <Loading label="Loading your week" />
      </Screen>
    )
  }

  if (!data?.hasAny) {
    return (
      <Screen>
        <ScrollView
          contentContainerStyle={{ padding: SPACE.gutter }}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
          }
        >
          <Empty
            icon={CalendarDays}
            title="No lessons on your timetable"
            body="Either your school has not published a timetable yet, or you have not been put on any lessons in it. The school office can check."
          />
        </ScrollView>
      </Screen>
    )
  }

  return (
    <Screen>
      <WeekGrid slots={slots} />
    </Screen>
  )
}
