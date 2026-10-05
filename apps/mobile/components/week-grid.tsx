/**
 * A week of lessons, on a phone.
 *
 * Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`, and the agreed
 *       mobile design.
 *
 * ## One day at a time, chosen from a strip
 *
 * A five-column grid on a phone is five unreadable columns. The design picks a day
 * from a row of chips and lists that day's lessons — which is also how somebody thinks
 * about it: "what have I got today", then occasionally "what about Thursday".
 *
 * The strip opens on today, and a Today button returns there once you have wandered.
 * At the weekend it opens on Monday, which is what somebody checking on a Sunday
 * evening wants.
 *
 * ## Colour carries the subject
 *
 * The same palette as the web grid, derived from the subject name rather than stored,
 * so a school gets a full set without configuring one and Mathematics is the same
 * colour on both.
 */

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { ChevronLeft, ChevronRight } from 'lucide-react-native'

import { Caption, usePalette } from './ui'
import { subjectTone } from '../lib/subject-tone'
import { RADIUS, SPACE, TAP, TYPE } from '../theme'

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
  /** False for break, lunch and assembly — drawn flat, with no colour. */
  teaching: boolean
}

const DAYS = [
  { n: 1, short: 'Mon', label: 'Monday' },
  { n: 2, short: 'Tue', label: 'Tuesday' },
  { n: 3, short: 'Wed', label: 'Wednesday' },
  { n: 4, short: 'Thu', label: 'Thursday' },
  { n: 5, short: 'Fri', label: 'Friday' },
] as const

const hhmm = (t: string): string => t.slice(0, 5)

/** Monday-based date for a weekday number, in the current week. */
function dateFor(day: number): Date {
  const now = new Date()
  const todayIso = now.getDay() === 0 ? 7 : now.getDay()
  const d = new Date(now)
  d.setDate(now.getDate() + (day - todayIso))
  return d
}

export function WeekGrid({ slots }: { slots: WeekSlot[] }): JSX.Element {
  const c = usePalette()

  // Today, or Monday at the weekend.
  const todayIso = new Date().getDay()
  const [day, setDay] = useState(todayIso >= 1 && todayIso <= 5 ? todayIso : 1)

  const forDay = useMemo(
    () => slots.filter((s) => s.day === day).sort((a, b) => a.periodOrder - b.periodOrder),
    [slots, day],
  )

  const chosen = dateFor(day)
  const isToday = day === todayIso

  return (
    <View style={{ flex: 1 }}>
      {/* ---- the day strip ---- */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: SPACE.xs,
          paddingHorizontal: SPACE.gutter,
          paddingVertical: SPACE.sm,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous day"
          disabled={day <= 1}
          onPress={() => setDay((d) => Math.max(1, d - 1))}
          style={{
            width: TAP,
            height: TAP,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: RADIUS.md,
            opacity: day <= 1 ? 0.3 : 1,
          }}
        >
          <ChevronLeft size={20} color={c.textMuted} />
        </Pressable>

        {DAYS.map((d) => {
          const active = d.n === day
          const date = dateFor(d.n)
          return (
            <Pressable
              key={d.n}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={d.label}
              onPress={() => setDay(d.n)}
              style={{
                flex: 1,
                minHeight: TAP,
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: SPACE.xs,
                borderRadius: RADIUS.md,
                backgroundColor: active ? c.primary : c.surface,
                borderWidth: 1,
                borderColor: active ? c.primary : c.border,
              }}
            >
              <Text
                style={[TYPE.caption, { color: active ? c.onPrimary : c.textMuted }]}
              >
                {d.short}
              </Text>
              <Text
                style={[
                  TYPE.body,
                  { color: active ? c.onPrimary : c.text, fontWeight: '700' },
                ]}
              >
                {date.getDate()}
              </Text>
            </Pressable>
          )
        })}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next day"
          disabled={day >= 5}
          onPress={() => setDay((d) => Math.min(5, d + 1))}
          style={{
            width: TAP,
            height: TAP,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: RADIUS.md,
            opacity: day >= 5 ? 0.3 : 1,
          }}
        >
          <ChevronRight size={20} color={c.textMuted} />
        </Pressable>
      </View>

      {/* ---- the chosen day ---- */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: SPACE.gutter,
          paddingBottom: SPACE.sm,
        }}
      >
        <Text style={[TYPE.heading, { color: c.text }]}>
          {DAYS.find((d) => d.n === day)?.label},{' '}
          {chosen.toLocaleDateString('en-ZM', { day: 'numeric', month: 'long' })}
        </Text>

        {/* Only when it would do something — a button that returns you where you
            already are is noise. */}
        {!isToday && todayIso >= 1 && todayIso <= 5 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setDay(todayIso)}
            style={{
              minHeight: TAP,
              justifyContent: 'center',
              paddingHorizontal: SPACE.md,
              borderRadius: RADIUS.full,
              backgroundColor: c.primaryTint,
            }}
          >
            <Text style={[TYPE.label, { color: c.primaryMark }]}>Today</Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SPACE.gutter,
          gap: SPACE.sm,
          paddingBottom: SPACE.xxl,
        }}
      >
        {forDay.length === 0 ? (
          <Caption>Nothing scheduled.</Caption>
        ) : (
          forDay.map((s, i) => {
            const tone = subjectTone(s.teaching ? s.title : null, c)

            return (
              <View
                key={`${s.periodOrder}-${i}`}
                style={{ flexDirection: 'row', alignItems: 'stretch', gap: SPACE.sm }}
              >
                {/* The time, stacked, in its own column — so the eye runs down the
                    day rather than reading each row twice. */}
                <View
                  style={{
                    width: 62,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingVertical: SPACE.sm,
                    borderRadius: RADIUS.md,
                    backgroundColor: c.surfaceSunken,
                  }}
                >
                  <Text style={[TYPE.caption, { color: c.textMuted }]}>
                    {hhmm(s.startTime)}
                  </Text>
                  <Text style={[TYPE.caption, { color: c.textSubtle }]}>–</Text>
                  <Text style={[TYPE.caption, { color: c.textMuted }]}>
                    {hhmm(s.endTime)}
                  </Text>
                </View>

                <View
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: SPACE.sm,
                    padding: SPACE.card,
                    borderRadius: RADIUS.lg,
                    backgroundColor: tone.background,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[TYPE.body, { color: tone.text, fontWeight: '700' }]}>
                      {s.title}
                    </Text>
                    {s.subtitle && (
                      <Text style={[TYPE.caption, { color: tone.text, opacity: 0.85 }]}>
                        {s.subtitle}
                      </Text>
                    )}
                  </View>

                  {s.room && (
                    <View
                      style={{
                        paddingHorizontal: SPACE.sm,
                        paddingVertical: 4,
                        borderRadius: RADIUS.md,
                        backgroundColor: tone.badge,
                      }}
                    >
                      <Text style={[TYPE.caption, { color: tone.text, fontWeight: '600' }]}>
                        {s.room}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )
          })
        )}
      </ScrollView>
    </View>
  )
}
