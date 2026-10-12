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
import { CalendarCheck, ChevronRight, ClipboardList, School } from 'lucide-react-native'

import { FEATURES, featureState } from '../../../lib/features'
import { FeatureGrid } from '../../../components/feature-grid'
import { SectionTitle, StatTile } from '../../../components/stats'
import { useApi } from '../../../lib/use-api'
import { useSession } from '../../../lib/auth'
import { Badge, Body, Caption, Card, Row, Screen, Title, usePalette } from '../../../components/ui'
import { RADIUS, SPACE, TAP, TYPE } from '../../../theme'

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
  const { data, loading, reload } = useApi<Overview>('/api/teacher/overview')

  /*
    Linked is "the session resolves a school", not "assignments exist".

    A teacher invited this morning has a school and no classes yet, and telling them
    attendance needs a school would be wrong — they need a class, which their school
    gives them.
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

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.cards, paddingBottom: SPACE.xxl }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
        }
      >
        <View style={{ gap: 2 }}>
          <Caption>{today}</Caption>
          <Title>{firstName ? `Hello, ${firstName}` : 'Your teaching'}</Title>
        </View>

        {/* The school, or the absence of one, said plainly. A standalone teacher is not
            in a broken state and the card does not imply they are. */}
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
            <SectionTitle>Waiting for you</SectionTitle>

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

        <SectionTitle>Everything else</SectionTitle>

        <FeatureGrid
          features={FEATURES.map((f) => ({
            key: f.key,
            label: f.label,
            icon: f.icon,
            href: f.href,
            state: featureState(f, linked),
          }))}
          onPress={(href) => router.push(href as never)}
          lockedLabel="Needs school"
        />
      </ScrollView>
    </Screen>
  )
}

// ---------------------------------------------------------------------------
