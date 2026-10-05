/**
 * A week of lessons, on a phone.
 *
 * Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
 *
 * ## Days stacked, not a grid
 *
 * A five-column grid on a phone is five unreadable columns. The week is stacked by day
 * instead, with today first — because the question somebody opens this to answer is
 * almost always "what have I got now", and scrolling to Thursday is the rare case.
 *
 * ## Shared by both apps
 *
 * A teacher's week shows the class; a parent's shows the teacher. Everything else —
 * the ordering, today-first, the empty days, the times — is the same question asked
 * about a different person, so it is one component with a `subtitle` the caller
 * supplies rather than two that drift.
 */

import type { JSX } from 'react'
import { useMemo } from 'react'
import { ScrollView, Text, View } from 'react-native'

import { Badge, Caption, Card, usePalette } from './ui'
import { SPACE, TYPE } from '../theme'

export interface WeekSlot {
  day: number
  periodName: string
  startTime: string
  endTime: string
  periodOrder: number
  title: string
  /** The class, for a teacher; the teacher, for a parent. */
  subtitle: string | null
  room: string | null
}

const DAYS = [
  { n: 1, label: 'Monday' },
  { n: 2, label: 'Tuesday' },
  { n: 3, label: 'Wednesday' },
  { n: 4, label: 'Thursday' },
  { n: 5, label: 'Friday' },
] as const

const hhmm = (t: string): string => t.slice(0, 5)

export function WeekGrid({ slots }: { slots: WeekSlot[] }): JSX.Element {
  const c = usePalette()

  /*
    Today first, then the rest of the week in order.

    `getDay()` is 0 for Sunday; the schema uses 1–5 for Monday–Friday. At the weekend
    there is no "today" in that range, so the week simply starts at Monday — which is
    what somebody checking on a Sunday evening wants anyway.
  */
  const ordered = useMemo(() => {
    const today = new Date().getDay()
    const start = today >= 1 && today <= 5 ? today : 1
    const rotated = [...DAYS]
    while (rotated[0] && rotated[0].n !== start) rotated.push(rotated.shift()!)
    return rotated
  }, [])

  const byDay = useMemo(() => {
    const map = new Map<number, WeekSlot[]>()
    for (const s of slots) {
      const list = map.get(s.day) ?? []
      list.push(s)
      map.set(s.day, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.periodOrder - b.periodOrder)
    return map
  }, [slots])

  const todayN = new Date().getDay()

  return (
    <ScrollView
      contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.md, paddingBottom: SPACE.xxl }}
    >
      {ordered.map((d) => {
        const list = byDay.get(d.n) ?? []
        const isToday = d.n === todayN

        return (
          <View key={d.n} style={{ gap: SPACE.sm }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
              <Text style={[TYPE.heading, { color: c.text }]}>{d.label}</Text>
              {isToday && <Badge label="Today" tone="primary" />}
            </View>

            {list.length === 0 ? (
              <Caption>Nothing scheduled.</Caption>
            ) : (
              list.map((s, i) => (
                <Card key={`${s.periodOrder}-${i}`}>
                  <Text style={[TYPE.caption, { color: c.textMuted }]}>
                    {hhmm(s.startTime)}–{hhmm(s.endTime)} · {s.periodName}
                  </Text>
                  <Text style={[TYPE.body, { color: c.text, fontWeight: '600' }]}>
                    {s.title}
                  </Text>
                  {s.subtitle && (
                    <Text style={[TYPE.body, { color: c.textMuted }]}>{s.subtitle}</Text>
                  )}
                  {s.room && <Badge label={s.room} tone="neutral" />}
                </Card>
              ))
            )}
          </View>
        )
      })}
    </ScrollView>
  )
}
