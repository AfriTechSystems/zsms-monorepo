/**
 * Marking a register.
 *
 * Spec: `Official Documentation/10 Attendance/ATTENDANCE.md`
 *       ADR-004 — offline-first attendance
 *
 * ## The screen the app exists for
 *
 * Everything here is shaped by one fact: a teacher marks this standing up, holding a
 * phone in one hand, in front of thirty restless children. So:
 *
 *   * **Four big targets per pupil**, not a dropdown. A picker costs two taps and a
 *     moment's reading; a row of marks costs one tap and no reading at all.
 *   * **"Mark all present" first**, because most days most pupils are there. The work is
 *     then correcting the four who are not, which is thirty-four taps saved.
 *   * **Nothing saves until it is saved.** A register half-written by a mis-tap must not
 *     become the day's record.
 *
 * ## An unmarked pupil is not an absent one
 *
 * `null` status means nobody has said. The API is explicit that an unopened register must
 * not read as a full attendance, and the screen keeps that distinction: unmarked rows are
 * visibly unanswered and the save button counts them.
 *
 * ## Online only, and it says so
 *
 * ADR-004 wants this queued locally and synced. PowerSync is not configured, so a save
 * needs signal — and when it fails the screen says the marks are still on the phone and
 * the teacher should try again, rather than implying they are stored.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Stack, useLocalSearchParams } from 'expo-router'
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Check,
  CircleSlash,
  Clock,
  FileText,
  Users,
} from 'lucide-react-native'

import { api } from '../../../lib/api'
import { useApi } from '../../../lib/use-api'
import { useSession } from '../../../lib/auth'
import {
  Badge,
  Body,
  Button,
  Caption,
  Empty,
  ErrorNote,
  Loading,
  Row,
  Screen,
  usePalette,
} from '../../../components/ui'
import { RADIUS, SPACE, TAP, TYPE } from '../../../theme'
import { formatClass } from '../attendance'

type Status = 'present' | 'absent' | 'late' | 'excused'

interface RegisterRow {
  studentId: string
  studentNumber: string
  firstName: string
  lastName: string
  onLeave: boolean
  status: Status | 'holiday' | null
  excuseReason: string | null
}

interface RegisterPayload {
  classId: string
  date: string
  register: RegisterRow[]
  alreadyMarked: boolean
  canMark: boolean
}

/**
 * The four marks, in the order a teacher thinks of them.
 *
 * Present first because it is most of the class; excused last because it needs a reason
 * and is therefore the slowest. `holiday` is deliberately absent — it applies to a whole
 * school day, not one pupil, and offering it per row invites a register where three
 * children had a holiday and twenty-seven did not.
 */
const MARKS: Array<{ value: Status; label: string; icon: typeof Check; tone: string }> = [
  { value: 'present', label: 'In', icon: Check, tone: 'success' },
  { value: 'absent', label: 'Out', icon: CircleSlash, tone: 'danger' },
  { value: 'late', label: 'Late', icon: Clock, tone: 'warning' },
  { value: 'excused', label: 'Exc.', icon: FileText, tone: 'primary' },
]

export default function Register(): JSX.Element {
  const { classId } = useLocalSearchParams<{ classId: string }>()
  const c = usePalette()
  const insets = useSafeAreaInsets()
  const { getToken } = useSession()

  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const { data, loading, error, reload } = useApi<RegisterPayload>(
    classId ? `/api/school/attendance/register?classId=${encodeURIComponent(classId)}&date=${today}` : null,
  )

  const [marks, setMarks] = useState<Record<string, Status>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Seed from what the server already holds, so re-opening a marked register shows the
  // marks rather than an empty one a teacher would dutifully fill in again.
  useEffect(() => {
    if (!data?.register) return
    const seed: Record<string, Status> = {}
    for (const row of data.register) {
      if (row.status && row.status !== 'holiday') seed[row.studentId] = row.status
    }
    setMarks(seed)
  }, [data])

  const rows = data?.register ?? []
  const unmarked = rows.filter((r) => !marks[r.studentId]).length
  const present = rows.filter((r) => marks[r.studentId] === 'present').length
  const absent = rows.filter((r) => marks[r.studentId] === 'absent').length

  const markAllPresent = useCallback(() => {
    setSaved(false)
    setMarks((current) => {
      const next = { ...current }
      for (const row of rows) {
        // Only the unanswered. Overwriting a mark a teacher has already made is the one
        // thing a bulk action must never do.
        if (!next[row.studentId]) next[row.studentId] = 'present'
      }
      return next
    })
  }, [rows])

  const save = useCallback(async () => {
    if (!classId) return
    setSaving(true)
    setSaveError(null)
    try {
      const payload = Object.entries(marks).map(([studentId, status]) => ({ studentId, status }))
      const result = await api.post<{ saved: number }>(
        '/api/school/attendance/register',
        getToken,
        { classId, date: today, marks: payload },
      )

      if (result.error) {
        setSaveError(
          result.code === 'OFFLINE'
            ? 'No connection, so nothing was saved. Your marks are still here — try again when you have signal.'
            : result.error,
        )
        return
      }

      setSaved(true)
      reload()
    } finally {
      setSaving(false)
    }
  }, [classId, marks, today, getToken, reload])

  return (
    <Screen>
      <Stack.Screen options={{ title: classId ? formatClass(classId) : 'Register' }} />

      <ScrollView
        contentContainerStyle={{
          padding: SPACE.gutter,
          gap: SPACE.md,
          // Clear of the save bar pinned at the bottom.
          paddingBottom: TAP + insets.bottom + SPACE.xxl,
        }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />}
      >
        {error && <ErrorNote message={error} onRetry={reload} />}
        {loading && !data && <Loading label="Opening the register" />}

        {data && rows.length === 0 && (
          <Empty icon={Users} title="No pupils in this class" body="Nobody is enrolled here yet." />
        )}

        {data && rows.length > 0 && (
          <>
            <Row gap={SPACE.sm} style={{ flexWrap: 'wrap' }}>
              <Badge label={`${present} in`} tone={present > 0 ? 'success' : 'neutral'} />
              <Badge label={`${absent} out`} tone={absent > 0 ? 'danger' : 'neutral'} />
              {unmarked > 0 && <Badge label={`${unmarked} not marked`} tone="warning" />}
              {data.alreadyMarked && <Badge label="Already saved today" tone="primary" />}
            </Row>

            {/* Most days most pupils are present, so the work is correcting the few who
                are not. This turns thirty-eight taps into four. */}
            {unmarked > 0 && data.canMark && (
              <Button label="Mark everyone in" icon={Check} tone="outline" onPress={markAllPresent} full />
            )}

            {!data.canMark && (
              <Body muted>
                You can see this register but not mark it. Your school sets who may.
              </Body>
            )}

            <View style={{ gap: SPACE.sm }}>
              {rows.map((row) => (
                <PupilRow
                  key={row.studentId}
                  row={row}
                  value={marks[row.studentId] ?? null}
                  disabled={!data.canMark}
                  onChange={(status) => {
                    setSaved(false)
                    setMarks((m) => ({ ...m, [row.studentId]: status }))
                  }}
                />
              ))}
            </View>
          </>
        )}

        {saveError && <ErrorNote message={saveError} onRetry={() => void save()} />}
      </ScrollView>

      {/* Pinned, because the save is the point of the screen and a teacher must never
          scroll thirty-eight pupils to find it. */}
      {data && rows.length > 0 && data.canMark && (
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            padding: SPACE.gutter,
            paddingBottom: insets.bottom + SPACE.md,
            backgroundColor: c.surface,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
          }}
        >
          <Button
            label={
              saved
                ? 'Saved'
                : unmarked > 0
                  ? `Save — ${unmarked} still unmarked`
                  : 'Save the register'
            }
            icon={saved ? Check : undefined}
            onPress={() => void save()}
            busy={saving}
            // Saving a half-marked register is allowed: a teacher interrupted mid-class
            // should keep what they have. The label says what is missing rather than
            // the button refusing.
            disabled={Object.keys(marks).length === 0}
            full
          />
        </View>
      )}
    </Screen>
  )
}

// ---------------------------------------------------------------------------

function PupilRow({
  row,
  value,
  disabled,
  onChange,
}: {
  row: RegisterRow
  value: Status | null
  disabled: boolean
  onChange: (status: Status) => void
}): JSX.Element {
  const c = usePalette()

  const toneColours: Record<string, { bg: string; fg: string }> = {
    success: { bg: c.successTint, fg: c.successText },
    danger: { bg: c.dangerTint, fg: c.dangerText },
    warning: { bg: c.warningTint, fg: c.warningText },
    primary: { bg: c.primaryTint, fg: c.primaryText },
  }

  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderRadius: RADIUS.md,
        borderWidth: StyleSheet.hairlineWidth,
        // An unanswered row is visibly unanswered. `null` is not absent, and the register
        // must not let a teacher mistake one for the other at a glance.
        borderColor: value ? c.border : c.warning,
        padding: SPACE.md,
        gap: SPACE.sm,
      }}
    >
      <Row>
        <View style={{ flex: 1 }}>
          <Text style={[TYPE.heading, { color: c.text }]} numberOfLines={1}>
            {row.firstName} {row.lastName}
          </Text>
          <Caption>{row.studentNumber}</Caption>
        </View>
        {row.onLeave && <Badge label="On leave" tone="neutral" />}
      </Row>

      <Row gap={SPACE.xs}>
        {MARKS.map((mark) => {
          const active = value === mark.value
          const t = toneColours[mark.tone] ?? { bg: c.surfaceSunken, fg: c.textMuted }
          const Icon = mark.icon

          return (
            <Pressable
              key={mark.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled }}
              accessibilityLabel={`${mark.label} for ${row.firstName} ${row.lastName}`}
              disabled={disabled}
              onPress={() => onChange(mark.value)}
              style={({ pressed }) => ({
                flex: 1,
                minHeight: TAP,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
                borderRadius: RADIUS.sm,
                backgroundColor: active ? t.bg : 'transparent',
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: active ? t.bg : c.border,
                opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
              })}
            >
              <Icon
                size={18}
                color={active ? t.fg : c.textSubtle}
                strokeWidth={active ? 2.6 : 1.9}
              />
              <Text
                style={[
                  TYPE.caption,
                  { color: active ? t.fg : c.textSubtle, fontWeight: active ? '700' : '500' },
                ]}
              >
                {mark.label}
              </Text>
            </Pressable>
          )
        })}
      </Row>
    </View>
  )
}
