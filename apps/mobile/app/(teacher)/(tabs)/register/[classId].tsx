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

import { api } from '../../../../lib/api'
import { useApi } from '../../../../lib/use-api'
import { todayIso } from '../../../../lib/dates'
import { useSession } from '../../../../lib/auth'
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  Empty,
  ErrorNote,
  Loading,
  Row,
  Screen,
  usePalette,
} from '../../../../components/ui'
import { Donut, ProgressBar, StatTile } from '../../../../components/stats'
import { Segmented } from '../../../../components/shell'
import { RADIUS, SPACE, TAP, TYPE } from '../../../../theme'
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

  /*
    Local, not `toISOString()`. That is UTC and Zambia is UTC+2, so before 02:00 this
    opened YESTERDAY's register — seeding yesterday's marks into a sheet a teacher was
    about to correct. See lib/dates.
  */
  const today = useMemo(() => todayIso(), [])
  const { data, loading, error, reload } = useApi<RegisterPayload>(
    classId ? `/api/school/attendance/register?classId=${encodeURIComponent(classId)}&date=${today}` : null,
  )

  const [marks, setMarks] = useState<Record<string, Status>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  /*
    Students | Summary, as the reference designs have it.

    A tab rather than a second screen: the summary is ABOUT the marks on this sheet,
    and pushing a route would make "go back and fix one" a navigation rather than a
    tap. It switches the view and does not scroll to a section — the same rule the web
    carries for SectionTabs.
  */
  const [view, setView] = useState<'students' | 'summary'>('students')

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
  const late = rows.filter((r) => marks[r.studentId] === 'late').length
  const excused = rows.filter((r) => marks[r.studentId] === 'excused').length

  /*
    The attendance rate, over the pupils actually assessed.

    Present and late both count as attending — a late pupil came to school, and
    counting them absent would make punctuality and attendance the same measure when
    the register already separates them. Unmarked pupils are excluded from the
    denominator entirely: an unmarked pupil is not an absent one, which is the rule
    this screen's header has carried since it was written.
  */
  const assessed = present + late + absent + excused
  const attendingRate = assessed === 0 ? null : Math.round(((present + late) / assessed) * 100)

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
            <Segmented
              options={[
                { value: 'students', label: `Pupils (${rows.length})` },
                { value: 'summary', label: 'Summary' },
              ]}
              value={view}
              onChange={setView}
            />

            {view === 'summary' ? (
              <RegisterSummary
                total={rows.length}
                present={present}
                absent={absent}
                late={late}
                excused={excused}
                unmarked={unmarked}
                rate={attendingRate}
                notes={rows
                  .filter((r) => {
                    const mark = marks[r.studentId]
                    return mark && mark !== 'present'
                  })
                  .map((r) => ({
                    id: r.studentId,
                    name: `${r.firstName} ${r.lastName}`,
                    status: marks[r.studentId] as Status,
                  }))}
              />
            ) : (
            <>
            <Row gap={SPACE.sm} style={{ flexWrap: 'wrap' }}>
              <Badge label={`${present} in`} tone={present > 0 ? 'success' : 'neutral'} />
              <Badge label={`${absent} out`} tone={absent > 0 ? 'danger' : 'neutral'} />
              {unmarked > 0 && <Badge label={`${unmarked} not marked`} tone="warning" />}
              {data.alreadyMarked && <Badge label="Already saved today" tone="primary" />}
            </Row>

            {/*
              How far through the register the teacher is.

              The badges say how many are in and out; neither says how much is LEFT,
              which on a class of forty is the thing somebody standing in front of the
              room wants. Hidden once everything is marked — a full bar is a
              congratulation nobody needs and the Save button already says the sheet is
              complete.

              Deliberately no avatars on the rows here, unlike the parent lists. This is
              a work surface worked down at speed, and a picture on every row would add
              about a third to the height of a forty-pupil list for recognition a
              teacher does not need of their own class.
            */}
            {unmarked > 0 && (
              <View style={{ gap: 4 }}>
                <ProgressBar
                  value={((rows.length - unmarked) / rows.length) * 100}
                  tone="primary"
                />
                <Caption>
                  {`${rows.length - unmarked} of ${rows.length} marked`}
                </Caption>
              </View>
            )}

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

/**
 * What the register adds up to.
 *
 * Spec: `Official Documentation/19 Design System/ZSMS Teacher App Dashboard Flow.png`
 *
 * ## It describes the sheet on screen, not the saved one
 *
 * Every figure here is computed from `marks` — what the teacher has tapped — rather
 * than from the server's copy. That is deliberate and it is why the caption says
 * "on this sheet": a teacher correcting four pupils wants the total to move as they
 * work, and a summary that only updated on save would disagree with the list directly
 * above it until they pressed the button.
 *
 * ## Unmarked is a slice, and it is not absence
 *
 * The donut carries `unmarked` as its own grey slice and the rate excludes those
 * pupils from the denominator entirely. Folding them into absence would report a
 * half-finished register as a day of mass truancy, and the teacher would be looking at
 * an accusation about thirty children who are sitting in front of them.
 */
function RegisterSummary({
  total,
  present,
  absent,
  late,
  excused,
  unmarked,
  rate,
  notes,
}: {
  total: number
  present: number
  absent: number
  late: number
  excused: number
  unmarked: number
  rate: number | null
  notes: Array<{ id: string; name: string; status: Status }>
}): JSX.Element {
  const c = usePalette()

  return (
    <View style={{ gap: SPACE.cards }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
        <View style={{ flexBasis: '48%', flexGrow: 1 }}>
          <StatTile label="Present" value={String(present)} icon={Check} tone="success" />
        </View>
        <View style={{ flexBasis: '48%', flexGrow: 1 }}>
          <StatTile label="Absent" value={String(absent)} icon={CircleSlash} tone="danger" />
        </View>
        <View style={{ flexBasis: '48%', flexGrow: 1 }}>
          <StatTile label="Late" value={String(late)} icon={Clock} tone="warning" />
        </View>
        <View style={{ flexBasis: '48%', flexGrow: 1 }}>
          <StatTile
            label="Not marked"
            value={String(unmarked)}
            icon={Users}
            tone={unmarked > 0 ? 'warning' : 'neutral'}
          />
        </View>
      </View>

      <Card>
        <Donut
          centreValue={String(total)}
          centreLabel={total === 1 ? 'pupil' : 'pupils'}
          slices={[
            { label: 'Present', value: present, colour: c.success },
            { label: 'Late', value: late, colour: c.warning },
            { label: 'Excused', value: excused, colour: c.primaryMark },
            { label: 'Absent', value: absent, colour: c.danger },
            { label: 'Not marked', value: unmarked, colour: c.textSubtle },
          ]}
        />
        <View style={{ marginTop: SPACE.md }}>
          <Caption>
            {rate === null
              ? 'Nothing marked yet, so there is no rate to show.'
              : `${rate}% attending on this sheet — present and late, out of those marked.`}
          </Caption>
        </View>
      </Card>

      {/*
        Who was not simply present. The mockup lists these under "Notes", and the
        reason it earns its place is that it is the list a teacher reads back to the
        office — four names out of forty, rather than scrolling the whole register
        hunting for the red chips.
      */}
      {notes.length > 0 && (
        <View style={{ gap: SPACE.sm }}>
          <Text style={[TYPE.heading, { color: c.text }]}>
            {notes.length === 1 ? 'One pupil to mention' : `${notes.length} pupils to mention`}
          </Text>
          <Card style={{ gap: SPACE.sm }}>
            {notes.map((note) => (
              <View
                key={note.id}
                style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}
              >
                <Text style={[TYPE.body, { color: c.text, flex: 1 }]} numberOfLines={1}>
                  {note.name}
                </Text>
                <Badge
                  label={STATUS_LABEL[note.status]}
                  tone={
                    note.status === 'absent'
                      ? 'danger'
                      : note.status === 'late'
                        ? 'warning'
                        : 'primary'
                  }
                />
              </View>
            ))}
          </Card>
        </View>
      )}
    </View>
  )
}

/** The word, not the abbreviation the marking chips use. A chip has room for "Exc."
 *  and a summary read back to the office does not. */
const STATUS_LABEL: Record<Status, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  excused: 'Excused',
}
