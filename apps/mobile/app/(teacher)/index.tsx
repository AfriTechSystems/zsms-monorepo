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
import { ChevronRight, School } from 'lucide-react-native'

import { FEATURES, featureState, type Feature } from '../../lib/features'
import { useApi } from '../../lib/use-api'
import { useSession } from '../../lib/auth'
import { Badge, Body, Caption, Card, Row, Screen, Title, usePalette } from '../../components/ui'
import { RADIUS, SPACE, TAP, TYPE } from '../../theme'

interface Overview {
  school: { name?: string } | null
  assignments: Array<{ classId: string | null }>
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

        <FeatureGrid linked={linked} onOpen={(href) => router.push(href as never)} />
      </ScrollView>
    </Screen>
  )
}

// ---------------------------------------------------------------------------

function FeatureGrid({
  linked,
  onOpen,
}: {
  linked: boolean
  onOpen: (href: string) => void
}): JSX.Element {
  const c = usePalette()

  /*
    School features first WHEN LINKED, personal tools first otherwise.

    The order changes; the contents do not. A linked teacher's day starts with a
    register, and a standalone teacher has no register to start with.
  */
  const ordered = useMemo(() => {
    const weight = (f: Feature): number => {
      const state = featureState(f, linked)
      // Anything unavailable sinks, whatever its group — a grid whose first row is
      // greyed out reads as a broken app.
      if (state !== 'ready') return 10
      if (linked) return f.schoolOnly ? 0 : 1
      return f.schoolOnly ? 2 : 0
    }
    return [...FEATURES].sort((a, b) => weight(a) - weight(b))
  }, [linked])

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
      {ordered.map((feature) => {
        const state = featureState(feature, linked)
        const available = state === 'ready'
        const Icon = feature.icon

        return (
          <Pressable
            key={feature.key}
            disabled={!available}
            accessibilityRole="button"
            accessibilityState={{ disabled: !available }}
            accessibilityLabel={
              available
                ? feature.label
                : `${feature.label}, ${state === 'coming' ? 'coming soon' : 'needs a school'}`
            }
            onPress={() => feature.href && onOpen(feature.href)}
            style={({ pressed }) => ({
              // Three across on a phone, with the gutter and two gaps removed.
              width: '31.5%',
              minHeight: TAP + 34,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: SPACE.md,
              borderRadius: RADIUS.lg,
              backgroundColor: c.surface,
              borderWidth: 1,
              borderColor: c.border,
              opacity: available ? (pressed ? 0.7 : 1) : 0.45,
            })}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: RADIUS.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: available ? c.primaryTint : c.surfaceSunken,
              }}
            >
              <Icon
                size={19}
                color={available ? c.primaryMark : c.textSubtle}
                strokeWidth={2}
              />
            </View>

            <Text
              numberOfLines={2}
              style={[
                TYPE.caption,
                {
                  color: available ? c.text : c.textSubtle,
                  textAlign: 'center',
                  fontWeight: '600',
                  paddingHorizontal: 4,
                },
              ]}
            >
              {feature.label}
            </Text>

            {/* Which kind of unavailable. A teacher can act on "needs a school" and
                cannot act on "soon", so they must not look the same. */}
            {!available && (
              <Text style={[TYPE.caption, { fontSize: 10, color: c.textSubtle }]}>
                {state === 'coming' ? 'Soon' : 'Needs school'}
              </Text>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

export { FeatureGrid }
