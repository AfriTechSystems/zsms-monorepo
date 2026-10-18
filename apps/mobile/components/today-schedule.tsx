/**
 * Today's lessons, as the timeline the reference designs put on the home screen.
 *
 * Spec: `Official Documentation/19 Design System/ZSMS Teacher App Dashboard Flow.png`
 *       `Official Documentation/19 Design System/ZSMS Parent Dashboard Showcase.png`
 *
 * Both mockups lead their home screen with this, and they are right to: it is the one
 * thing on the screen that answers "what am I doing in the next ten minutes". The
 * action grid answers "what can this app do", which is a question somebody asks once.
 *
 * ## The "Now" badge is the whole point
 *
 * A list of times makes the reader do the arithmetic against their own watch. The
 * badge does it for them, and it is computed from the device clock in local time —
 * `startTime`/`endTime` arrive as `HH:MM:SS` wall-clock strings with no timezone,
 * which is correct for a school day and means they must be compared against local
 * wall-clock, never against a UTC instant.
 *
 * ## A non-teaching slot is drawn, not filtered
 *
 * Break and lunch appear in the mockup as muted rows, and that is deliberate — a gap
 * in a timeline reads as missing data, whereas "Lunch 12:00" reads as a day. They are
 * shown without an action, because there is nothing to do with them.
 */

import type { JSX } from 'react'
import { Pressable, Text, View } from 'react-native'
import { BookOpen, Coffee } from 'lucide-react-native'

import { RADIUS, SPACE, TYPE } from '../theme'
import { usePalette } from './ui'
import { IconTile } from './shell'

export interface ScheduleEntry {
  /** `HH:MM:SS` or `HH:MM`, local wall-clock. */
  startTime: string
  endTime: string
  title: string
  /** Class, room, teacher — whatever identifies it on this portal. */
  subtitle?: string | null
  /** Break, lunch, assembly: drawn muted and never actionable. */
  nonTeaching?: boolean
  onPress?: () => void
  actionLabel?: string
}

/** `HH:MM[:SS]` → minutes since midnight. NaN-safe: a malformed time sorts last
 *  rather than throwing on a screen somebody opened between lessons. */
function minutes(time: string): number {
  const [h, m] = time.split(':')
  const hours = Number(h)
  const mins = Number(m)
  return Number.isFinite(hours) && Number.isFinite(mins) ? hours * 60 + mins : Number.MAX_SAFE_INTEGER
}

function nowMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

export function TodaySchedule({
  entries,
  emptyLabel = 'Nothing scheduled today.',
}: {
  entries: ScheduleEntry[]
  emptyLabel?: string
}): JSX.Element {
  const c = usePalette()
  const now = nowMinutes()

  if (entries.length === 0) {
    return (
      <View style={{ paddingVertical: SPACE.lg, alignItems: 'center' }}>
        <Text style={[TYPE.body, { color: c.textMuted }]}>{emptyLabel}</Text>
      </View>
    )
  }

  const sorted = [...entries].sort((a, b) => minutes(a.startTime) - minutes(b.startTime))
  const currentIndex = sorted.findIndex(
    (e) => now >= minutes(e.startTime) && now < minutes(e.endTime),
  )

  return (
    <View style={{ gap: SPACE.sm }}>
      {sorted.map((entry, i) => {
        const isNow = i === currentIndex
        const past = minutes(entry.endTime) <= now
        const Icon = entry.nonTeaching ? Coffee : BookOpen

        const body = (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SPACE.md,
              padding: SPACE.md,
              borderRadius: RADIUS.lg,
              backgroundColor: entry.nonTeaching ? c.surfaceSunken : c.surface,
              borderWidth: 1,
              // The current lesson is called out with the primary border rather than a
              // filled background: a filled row would outrank the primary button
              // underneath it, and the eye should land on the action, not the label.
              borderColor: isNow ? c.primary : c.border,
              // Finished lessons recede. They are kept rather than hidden so the day
              // still reads as a day, and so "nothing left" is visibly different from
              // "nothing scheduled".
              opacity: past && !isNow ? 0.55 : 1,
            }}
          >
            <IconTile icon={Icon} tone={entry.nonTeaching ? 'neutral' : 'primary'} size={40} />

            <View style={{ flex: 1, gap: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.sm }}>
                <Text style={[TYPE.caption, { color: c.textMuted }]}>
                  {entry.startTime.slice(0, 5)} – {entry.endTime.slice(0, 5)}
                </Text>
                {isNow && (
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: RADIUS.full,
                      backgroundColor: c.primary,
                    }}
                  >
                    <Text style={{ fontSize: 10, fontWeight: '700', color: c.onPrimary }}>NOW</Text>
                  </View>
                )}
              </View>
              <Text numberOfLines={1} style={[TYPE.heading, { color: c.text }]}>
                {entry.title}
              </Text>
              {entry.subtitle ? (
                <Text numberOfLines={1} style={[TYPE.caption, { color: c.textMuted }]}>
                  {entry.subtitle}
                </Text>
              ) : null}
            </View>

            {entry.onPress && entry.actionLabel ? (
              <View
                style={{
                  paddingHorizontal: SPACE.md,
                  paddingVertical: 8,
                  borderRadius: RADIUS.full,
                  backgroundColor: isNow ? c.primary : c.primaryTint,
                }}
              >
                <Text
                  style={[
                    TYPE.label,
                    { color: isNow ? c.onPrimary : c.primaryText, fontWeight: '600' },
                  ]}
                >
                  {entry.actionLabel}
                </Text>
              </View>
            ) : null}
          </View>
        )

        if (!entry.onPress) return <View key={`${entry.startTime}-${entry.title}`}>{body}</View>

        return (
          <Pressable
            key={`${entry.startTime}-${entry.title}`}
            accessibilityRole="button"
            accessibilityLabel={`${entry.title}, ${entry.startTime.slice(0, 5)}${
              isNow ? ', happening now' : ''
            }`}
            onPress={entry.onPress}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            {body}
          </Pressable>
        )
      })}
    </View>
  )
}
