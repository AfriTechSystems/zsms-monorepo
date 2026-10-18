/**
 * Attendance — choose a class, then mark it.
 *
 * Spec: `Official Documentation/10 Attendance/ATTENDANCE.md`
 *
 * This was the Home screen before Home became the feature grid. It keeps the job it was
 * good at: list the classes this teacher is assigned to, one tap from each register.
 *
 * Classes come from the server, never a filter here. `teacher_assignments` is what RLS
 * uses to decide which pupils this teacher may see at all, and re-deriving "my classes"
 * on the phone would be a second rule that drifts from the policy — with the phone's copy
 * the one that can be wrong without anybody noticing.
 */

import type { JSX } from 'react'
import { useMemo } from 'react'
import { Link } from 'expo-router'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { CalendarCheck, CheckCheck, ChevronRight, GraduationCap } from 'lucide-react-native'

import { useApi } from '../../../lib/use-api'
import { IconTile } from '../../../components/shell'
import {
  Caption,
  Badge,
  Card,
  Empty,
  ErrorNote,
  Loading,
  Row,
  Screen,
  usePalette,
} from '../../../components/ui'
import { RADIUS, SPACE, TYPE } from '../../../theme'

interface Assignment {
  id: string
  classId: string | null
  subjectName: string | null
}

interface Overview {
  school: { name?: string } | null
  assignments: Assignment[]
  /*
    Already returned by /api/teacher/overview and simply not declared here until
    2026-10-18 — so this screen listed every class identically while the server was
    telling it which ones were done. "Which registers still need me" is the question
    a teacher opens this screen to answer, and the answer was already in the payload.
  */
  classes?: Array<{ classId: string; registerMarkedToday: boolean }>
}

export default function Attendance(): JSX.Element {
  const c = usePalette()
  const { data, loading, error, reload } = useApi<Overview>('/api/teacher/overview')

  /**
   * One card per CLASS, not per assignment.
   *
   * A teacher taking three subjects in Grade 8A has three assignment rows and one
   * register to mark. Listing the rows would offer the same register three times.
   */
  const classes = useMemo(() => {
    const marked = new Set(
      (data?.classes ?? []).filter((k) => k.registerMarkedToday).map((k) => k.classId),
    )

    const byClass = new Map<string, { classId: string; subjects: string[]; marked: boolean }>()
    for (const a of data?.assignments ?? []) {
      if (!a.classId) continue
      const entry =
        byClass.get(a.classId) ?? { classId: a.classId, subjects: [], marked: marked.has(a.classId) }
      if (a.subjectName && !entry.subjects.includes(a.subjectName)) entry.subjects.push(a.subjectName)
      byClass.set(a.classId, entry)
    }

    /*
      Unmarked first, then alphabetical.

      A teacher between lessons is looking for what is outstanding, and a list sorted
      only by class id buries it among the ones already done. Within each group the
      order stays stable so the list does not reshuffle as registers are marked —
      only the group boundary moves.
    */
    return [...byClass.values()].sort(
      (x, y) => Number(x.marked) - Number(y.marked) || x.classId.localeCompare(y.classId),
    )
  }, [data])

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.cards, paddingBottom: SPACE.xxl }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
        }
      >
        {error && <ErrorNote message={error} onRetry={reload} />}
        {loading && !data && <Loading label="Finding your classes" />}

        {!error && data && classes.length === 0 && (
          <Empty
            icon={GraduationCap}
            title="No classes assigned"
            body="Your school assigns classes and subjects on the web. Once they do, your registers appear here."
          />
        )}

        {classes.map((entry) => (
          <Link
            key={entry.classId}
            href={{ pathname: '/(teacher)/(tabs)/register/[classId]', params: { classId: entry.classId } }}
            asChild
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Mark the register for ${formatClass(entry.classId)}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Card>
                <Row gap={SPACE.md}>
                  {/*
                    Green and ticked once the register is in, blue and waiting while it
                    is not. The shape is what the eye finds down a list; the colour is
                    what tells it which half of the list it is in.
                  */}
                  <IconTile
                    icon={entry.marked ? CheckCheck : CalendarCheck}
                    tone={entry.marked ? 'success' : 'primary'}
                    size={44}
                  />

                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[TYPE.heading, { color: c.text }]}>
                      {formatClass(entry.classId)}
                    </Text>
                    <Caption>
                      {entry.subjects.length > 0 ? entry.subjects.join(' · ') : 'Class teacher'}
                    </Caption>
                  </View>

                  {/* Stated, not implied by the colour alone — the two tints are a
                      green and a blue, and that pairing is the common one to lose. */}
                  <Badge
                    label={entry.marked ? 'Marked' : 'To mark'}
                    tone={entry.marked ? 'success' : 'warning'}
                  />

                  <ChevronRight size={20} color={c.textSubtle} />
                </Row>
              </Card>
            </Pressable>
          </Link>
        ))}
      </ScrollView>
    </Screen>
  )
}

/** `grade_8a` reads as "Grade 8A" to a teacher and as nothing at all as it stands. */
export function formatClass(id: string): string {
  return id
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
