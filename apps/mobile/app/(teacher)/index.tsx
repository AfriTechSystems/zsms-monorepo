/**
 * Today — the classes a teacher has to mark.
 *
 * Spec: `Official Documentation/10 Attendance/ATTENDANCE.md`
 *       `Official Documentation/08 Staff Management/ASSIGNMENTS.md`
 *
 * ## The first screen answers one question
 *
 * "What do I have to do now." Not a dashboard, not a summary — a list of the classes this
 * teacher is assigned to, each one tap from its register. A teacher opens this between
 * lessons with a class waiting, which is the whole design constraint.
 *
 * ## Assignments come from the server, never from a filter here
 *
 * `teacher_assignments` is what RLS uses to decide which pupils this teacher may see at
 * all. Re-deriving "my classes" on the phone would be a second rule that drifts from the
 * policy — and the phone's copy is the one that can be wrong without anybody noticing.
 */

import type { JSX } from 'react'
import { useMemo } from 'react'
import { Link } from 'expo-router'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { CalendarCheck, ChevronRight, GraduationCap, LogOut } from 'lucide-react-native'

import { useApi } from '../../lib/use-api'
import { useSession } from '../../lib/auth'
import {
  Badge,
  Body,
  Caption,
  Card,
  Empty,
  ErrorNote,
  Loading,
  Row,
  Screen,
  Title,
  usePalette,
} from '../../components/ui'
import { RADIUS, SPACE, TAP, TYPE } from '../../theme'

interface Assignment {
  id: string
  scope: string
  classId: string | null
  subjectCode: string | null
  subjectName: string | null
  termNumber: number
  academicYear: string
}

interface Overview {
  school: { name?: string; school_id?: string } | null
  role: string
  today: string
  assignments: Assignment[]
}

export default function Today(): JSX.Element {
  const c = usePalette()
  const { fullName, signOut } = useSession()
  const { data, loading, error, reload } = useApi<Overview>('/api/teacher/overview')

  /**
   * One card per CLASS, not per assignment.
   *
   * A teacher taking three subjects in Grade 8A has three assignment rows and one
   * register to mark. Listing the rows would offer the same register three times and
   * make the day look three times longer than it is.
   */
  const classes = useMemo(() => {
    const byClass = new Map<string, { classId: string; subjects: string[] }>()
    for (const a of data?.assignments ?? []) {
      if (!a.classId) continue
      const entry = byClass.get(a.classId) ?? { classId: a.classId, subjects: [] }
      if (a.subjectName && !entry.subjects.includes(a.subjectName)) {
        entry.subjects.push(a.subjectName)
      }
      byClass.set(a.classId, entry)
    }
    return [...byClass.values()].sort((x, y) => x.classId.localeCompare(y.classId))
  }, [data])

  const today = useMemo(
    () =>
      new Date().toLocaleDateString('en-ZM', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
    [],
  )

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.cards, paddingBottom: SPACE.xxl }}
        refreshControl={
          // Pull to refresh, because the alternative on a phone is closing the app.
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
        }
      >
        <View style={{ gap: SPACE.xs }}>
          <Caption>{today}</Caption>
          <Title>{firstNameOf(fullName) ? `Hello, ${firstNameOf(fullName)}` : 'Your classes'}</Title>
          {data?.school?.name && <Body muted>{data.school.name}</Body>}
        </View>

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
            href={{ pathname: '/(teacher)/register/[classId]', params: { classId: entry.classId } }}
            asChild
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Mark the register for ${formatClass(entry.classId)}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <Card>
                <Row gap={SPACE.md}>
                  {/* The icon is in a tinted circle rather than bare: at a glance down a
                      list, the shape is what the eye finds, not the glyph. */}
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
                    <Text style={[TYPE.caption, { color: c.textMuted }]} numberOfLines={1}>
                      {entry.subjects.length > 0 ? entry.subjects.join(' · ') : 'Class teacher'}
                    </Text>
                  </View>

                  <ChevronRight size={20} color={c.textSubtle} />
                </Row>
              </Card>
            </Pressable>
          </Link>
        ))}

        {data && (
          <Pressable
            onPress={() => void signOut()}
            accessibilityRole="button"
            style={{
              minHeight: TAP,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: SPACE.sm,
              marginTop: SPACE.lg,
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.border,
            }}
          >
            <LogOut size={16} color={c.textMuted} />
            <Text style={[TYPE.label, { color: c.textMuted }]}>Sign out</Text>
          </Pressable>
        )}
      </ScrollView>
    </Screen>
  )
}

// ---------------------------------------------------------------------------

/** `grade_8a` reads as "Grade 8A" to a teacher and as nothing at all as it stands. */
function formatClass(id: string): string {
  return id
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function firstNameOf(full: string | null): string | null {
  return full?.trim().split(/\s+/)[0] ?? null
}

export { formatClass }
