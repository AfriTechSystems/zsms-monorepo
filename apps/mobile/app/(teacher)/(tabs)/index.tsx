/**
 * Home — every feature, as a grid.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## Why a grid rather than a dashboard of numbers
 *
 * A teacher opens this to DO something, not to read a summary. The web dashboard leads
 * with figures because a head teacher is monitoring; a phone is held by somebody between
 * lessons with a class waiting.
 *
 * ## The layout does not change when a school is linked
 *
 * Linking ungates the school half rather than rearranging anything, so a teacher who
 * joins a school in March recognises the screen they used in February with more of it
 * available. That is why the gating lives in `lib/features.ts` as data.
 *
 * ## Unbuilt features are shown, greyed, and say which kind of unavailable they are
 *
 * "Coming soon" and "needs your school" are different answers and a teacher can act on
 * exactly one of them. Hiding the unbuilt ones would make every release reshuffle the
 * grid, which is worse than an honest placeholder.
 */

import type { JSX } from 'react'
import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { CalendarCheck, ClipboardList, Megaphone, School } from 'lucide-react-native'

import { FEATURES, featureState } from '../../../lib/features'
import { FeatureGrid } from '../../../components/feature-grid'
import { StatTile } from '../../../components/stats'
import { AppHeader, Greeting, ListRow, RowDivider, SectionHeader } from '../../../components/shell'
import { TodaySchedule, type ScheduleEntry } from '../../../components/today-schedule'
import { Avatar } from '../../../components/avatar'
import { Mark } from '../../../components/wordmark'
import { useApi } from '../../../lib/use-api'
import { useSession } from '../../../lib/auth'
import { Caption, Card, ErrorNote, Row, Screen, usePalette } from '../../../components/ui'
import { RADIUS, SPACE, TAP, TYPE } from '../../../theme'

interface Slot {
  out_day_of_week: number
  out_period_name: string
  out_start_time: string
  out_end_time: string
  out_class_id: string
  out_subject_name: string | null
  out_slot_type: string
}

interface Overview {
  school: { name?: string } | null
  assignments: Array<{ classId: string | null }>
  /** Per class, whether today's register has been marked. */
  classes?: Array<{ classId: string; registerMarkedToday: boolean }>
  /** Sheets with marks entered that the head has not published. */
  unpublishedSheets?: unknown[]
}

export default function Home(): JSX.Element {
  const c = usePalette()
  const router = useRouter()
  const { firstName } = useSession()
  const { data, loading, error, reload } = useApi<Overview>('/api/teacher/overview')

  /*
    Two more reads, deliberately.

    The reference home screen leads with today's lessons and a notification count, and
    neither is in `/api/teacher/overview`. Three parallel requests on a screen opened
    once a lesson is the right trade against inventing a fourth aggregate endpoint
    whose only consumer is this screen — and each one degrades on its own, so a failed
    timetable does not blank the grid.
  */
  const timetable = useApi<{ slots: Slot[] }>('/api/teacher/timetable')
  const notices = useApi<{
    unread: number
    notices: Array<{ id: string; title: string; importance: string; sentAt: string | null; read: boolean }>
  }>('/api/session/notices')

  /* Three is what fits above the fold under the grid; the bell and "View all" carry
     the rest. A home screen that lists every notice is a notices screen. */
  const noticeList = (notices.data?.notices ?? []).slice(0, 3)

  /*
    Linked is "the session resolves a school", not "assignments exist".

    A teacher invited this morning has a school and no classes yet, and telling them
    attendance needs a school would be wrong — they need a class, which their school
    gives them.
  */
  /*
    `linked` must mean "we asked and the answer was no", not "we have no answer".

    Previously a FAILED request left `data` null, so `linked` was false and the card
    read "No school linked" — telling a teacher something false about their own
    account because the network was down. The error state below takes precedence, and
    this stays false only when the request actually succeeded.
  */
  const linked = Boolean(data?.school)

  const classCount = useMemo(
    () => new Set((data?.assignments ?? []).map((a) => a.classId).filter(Boolean)).size,
    [data],
  )

  /*
    Counted here rather than in the JSX so the two conditions that decide whether the
    section renders at all are the same values the tiles display. Computing them twice
    is how a heading appears above nothing.
  */
  const unmarkedCount = useMemo(
    () => (data?.classes ?? []).filter((k) => !k.registerMarkedToday).length,
    [data],
  )
  const unpublishedCount = data?.unpublishedSheets?.length ?? 0

  const today = useMemo(
    () => new Date().toLocaleDateString('en-ZM', { weekday: 'long', day: 'numeric', month: 'long' }),
    [],
  )

  /*
    Today's lessons, from the week the timetable endpoint already returns.

    `out_day_of_week` is 1–7 with Monday as 1, so `getDay()` — which starts at Sunday
    — is remapped rather than used directly. Getting that wrong shows Monday's lessons
    on Sunday, which is the kind of error that looks like the timetable being broken.
  */
  const todaysLessons = useMemo<ScheduleEntry[]>(() => {
    const jsDay = new Date().getDay()
    const isoDay = jsDay === 0 ? 7 : jsDay

    return (timetable.data?.slots ?? [])
      .filter((slot) => slot.out_day_of_week === isoDay)
      .map((slot) => {
        const teaching = slot.out_slot_type === 'lesson'
        const entry: ScheduleEntry = {
          startTime: slot.out_start_time,
          endTime: slot.out_end_time,
          title: slot.out_subject_name ?? slot.out_period_name,
          subtitle: teaching ? slot.out_class_id : null,
          nonTeaching: !teaching,
        }
        /*
          The action is "take the register", and only for a class whose register is
          still unmarked. Offering it for one already marked would invite a teacher to
          re-open a finished register between lessons, which is how a correct register
          gets overwritten.
        */
        if (teaching && (data?.classes ?? []).some((k) => k.classId === slot.out_class_id && !k.registerMarkedToday)) {
          entry.actionLabel = 'Register'
          entry.onPress = () =>
            router.push(`/(teacher)/(tabs)/register/${encodeURIComponent(slot.out_class_id)}` as never)
        }
        return entry
      })
  }, [timetable.data, data?.classes, router])

  return (
    <Screen>
      {/*
        Outside the ScrollView, so the mark, the school, the bell and the avatar stay
        put while the day scrolls under them. The reference designs pin it, and a
        notification count that scrolls away is a notification count nobody sees.
      */}
      <AppHeader
        left={<Mark size={32} />}
        schoolName={data?.school?.name ?? null}
        unread={notices.data?.unread ?? 0}
        onPressBell={() => router.push('/(teacher)/(tabs)/notices' as never)}
        onPressAvatar={() => router.push('/(teacher)/(tabs)/account' as never)}
        avatar={<Avatar name={firstName ?? 'You'} size="sm" />}
      />

      <ScrollView
        contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.cards, paddingBottom: SPACE.xxl }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
        }
      >
        <Greeting
          name={firstName ? firstName : 'Your teaching'}
          subtitle={`Here is your day — ${today}.`}
        />

        {/*
          Stated, and above everything that depends on the answer. Without this a
          failed request fell through to "No school linked", which is a claim about
          the teacher's account rather than about the connection.
        */}
        {error && <ErrorNote message={error} onRetry={reload} />}

        {/* The school, or the absence of one, said plainly. A standalone teacher is not
            in a broken state and the card does not imply they are.

            Hidden entirely while the answer is unknown — a failed or in-flight request
            must not render a claim either way. */}
        {!error && (data || !loading) && (
        <Card>
          <Row gap={SPACE.md}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: RADIUS.md,
                backgroundColor: linked ? c.primaryTint : c.surfaceSunken,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <School size={20} color={linked ? c.primaryMark : c.textSubtle} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[TYPE.heading, { color: c.text }]} numberOfLines={1}>
                {data?.school?.name ?? 'No school linked'}
              </Text>
              <Caption>
                {linked
                  ? classCount > 0
                    ? `${classCount} ${classCount === 1 ? 'class' : 'classes'} assigned to you`
                    : 'No classes assigned yet — your school sets these'
                  : 'Your plans and quizzes are yours either way'}
              </Caption>
            </View>
          </Row>
        </Card>
        )}

        {/*
          What is outstanding today, before the grid of everything.

          Built from data this screen already fetched — `classes[].registerMarkedToday`
          and `unpublishedSheets` — and never shown as zeros. A teacher opening the app
          between lessons wants to know whether anything is waiting, and two tiles
          reading "0" on a quiet day is furniture that pushes the grid down.

          The web screen got the same strip, from the same fields, for the same reason.
        */}
        {linked && (unmarkedCount > 0 || unpublishedCount > 0) && (
          <>
            <SectionHeader title="Waiting for you" />

            {unmarkedCount > 0 && (
              <StatTile
                label="Registers still to mark"
                value={String(unmarkedCount)}
                icon={CalendarCheck}
                tone="warning"
                hint={
                  unmarkedCount === 1
                    ? 'One class has no register for today.'
                    : `${unmarkedCount} classes have no register for today.`
                }
              />
            )}

            {unpublishedCount > 0 && (
              <StatTile
                label="Mark sheets not published"
                value={String(unpublishedCount)}
                icon={ClipboardList}
                tone="primary"
                hint="Entered but not yet released by the head."
              />
            )}
          </>
        )}

        {/*
          Today, before the grid of everything.

          The reference designs lead with this and the reasoning holds: a teacher
          between lessons wants the next forty minutes, not a catalogue. The grid is
          what they scroll to when they are looking for something specific.
        */}
        {linked && (
          <>
            <SectionHeader
              title="Today"
              actionLabel="Full timetable"
              onPressAction={() => router.push('/(teacher)/(tabs)/timetable' as never)}
            />
            {timetable.error ? (
              <ErrorNote message={timetable.error} onRetry={timetable.reload} />
            ) : (
              <TodaySchedule
                entries={todaysLessons}
                emptyLabel={
                  timetable.loading ? 'Loading your day…' : 'No lessons on your timetable today.'
                }
              />
            )}
          </>
        )}

        <SectionHeader title="Everything else" />

        <FeatureGrid
          features={FEATURES.map((f) => ({
            key: f.key,
            label: f.label,
            icon: f.icon,
            href: f.href,
            state: featureState(f, linked),
            tone: f.tone,
          }))}
          onPress={(href) => router.push(href as never)}
          lockedLabel="Needs school"
        />

        {/*
          Recent notices, last — the mockup puts them at the foot of the home screen
          and that is the right rank: a notice is something to read when there is a
          moment, not the reason the app was opened. The bell carries the count for
          anybody who needs it sooner.
        */}
        {linked && (noticeList.length > 0) && (
          <>
            <SectionHeader
              title="Recent notices"
              actionLabel="View all"
              onPressAction={() => router.push('/(teacher)/(tabs)/notices' as never)}
            />
            <Card style={{ paddingVertical: SPACE.xs }}>
              {noticeList.map((notice, i) => (
                <View key={notice.id}>
                  {i > 0 && <RowDivider />}
                  <ListRow
                    icon={Megaphone}
                    tone={notice.importance === 'urgent' ? 'danger' : 'primary'}
                    title={notice.title}
                    subtitle={notice.sentAt ? new Date(notice.sentAt).toLocaleDateString('en-ZM', { day: 'numeric', month: 'long' }) : null}
                    unread={!notice.read}
                    onPress={() => router.push('/(teacher)/(tabs)/notices' as never)}
                  />
                </View>
              ))}
            </Card>
          </>
        )}
      </ScrollView>
    </Screen>
  )
}

// ---------------------------------------------------------------------------
