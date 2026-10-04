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
import { CalendarCheck, ChevronRight, GraduationCap } from 'lucide-react-native'

import { useApi } from '../../../lib/use-api'
import {
  Caption,
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
    const byClass = new Map<string, { classId: string; subjects: string[] }>()
    for (const a of data?.assignments ?? []) {
      if (!a.classId) continue
      const entry = byClass.get(a.classId) ?? { classId: a.classId, subjects: [] }
      if (a.subjectName && !entry.subjects.includes(a.subjectName)) entry.subjects.push(a.subjectName)
      byClass.set(a.classId, entry)
    }
    return [...byClass.values()].sort((x, y) => x.classId.localeCompare(y.classId))
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
                  {/* The shape is what the eye finds down a list, not the glyph. */}
                  <View
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: RADIUS.md,
                      backgroundColor: c.primaryTint,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <CalendarCheck size={22} color={c.primaryMark} strokeWidth={2} />
                  </View>

                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[TYPE.heading, { color: c.text }]}>
                      {formatClass(entry.classId)}
                    </Text>
                    <Caption>
                      {entry.subjects.length > 0 ? entry.subjects.join(' · ') : 'Class teacher'}
                    </Caption>
                  </View>

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
