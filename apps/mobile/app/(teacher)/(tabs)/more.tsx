/**
 * More — the sidebar, as a screen.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## Why not a drawer
 *
 * A drawer needs a nested navigator, a gesture handler, and an edge swipe that competes
 * with the register's own horizontal controls. A full-screen categorised menu carries the
 * same content with none of that, and on a phone it is what most apps actually ship.
 *
 * ## It lists everything, including what is not built
 *
 * Same catalogue as the Home grid, grouped. A teacher scanning for "timetable" should
 * find it and learn it is coming, rather than conclude the app cannot do it — and the
 * list stops reshuffling every time something ships.
 *
 * ## The portal switcher and sign-out live here
 *
 * Both are session-level, both are rare, and neither belongs in a tab. `/portal` is the
 * same chooser the web shows after sign-in.
 */

import type { JSX } from 'react'
import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { ChevronRight, LayoutGrid, LogOut } from 'lucide-react-native'

import { FEATURES, featureState, type Feature } from '../../../lib/features'
import { useApi } from '../../../lib/use-api'
import { useSession } from '../../../lib/auth'
import { Badge, Caption, Row, Screen, usePalette } from '../../../components/ui'
import { IconTile } from '../../../components/shell'
import { RADIUS, SPACE, TAP, TYPE } from '../../../theme'

const GROUPS: Array<Feature['group']> = ['Teaching', 'My tools', 'School', 'Account']

export default function More(): JSX.Element {
  const c = usePalette()
  const router = useRouter()
  const { fullName, email, signOut } = useSession()

  const { data } = useApi<{ school: { name?: string } | null }>('/api/teacher/overview')
  const { data: portals } = useApi<{ count: number }>('/api/session/portals')

  const linked = Boolean(data?.school)
  const grouped = useMemo(
    () => GROUPS.map((g) => ({ group: g, items: FEATURES.filter((f) => f.group === g) })),
    [],
  )

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.cards, paddingBottom: SPACE.xxl }}
      >
        {/* Who is signed in. The commonest confusion on an app somebody uses in two
            roles is being signed in as the wrong account. */}
        <View style={{ gap: 2 }}>
          <Text style={[TYPE.heading, { color: c.text }]}>{fullName ?? 'Your account'}</Text>
          <Caption>{email ?? ''}</Caption>
          {data?.school?.name && <Caption>{data.school.name}</Caption>}
        </View>

        {grouped.map(({ group, items }) => (
          <View key={group} style={{ gap: SPACE.xs }}>
            <Text style={[TYPE.label, { color: c.textMuted, textTransform: 'uppercase' }]}>
              {group}
            </Text>

            <View
              style={{
                borderRadius: RADIUS.lg,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.border,
                backgroundColor: c.surface,
                overflow: 'hidden',
              }}
            >
              {items.map((feature, i) => {
                const state = featureState(feature, linked)
                const available = state === 'ready'
                const Icon = feature.icon

                return (
                  <Pressable
                    key={feature.key}
                    disabled={!available}
                    accessibilityRole="button"
                    onPress={() => feature.href && router.push(feature.href as never)}
                    style={({ pressed }) => ({
                      minHeight: TAP,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: SPACE.md,
                      paddingHorizontal: SPACE.md,
                      paddingVertical: SPACE.sm,
                      borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderTopColor: c.border,
                      opacity: available ? (pressed ? 0.6 : 1) : 0.45,
                    })}
                  >
                    {/* The same tinted tile the grid and every list row uses, in the
                        feature's own hue. A bare glyph here made this screen the one
                        place in the app where a feature had no colour. */}
                    <IconTile
                      icon={Icon}
                      tone={feature.tone ?? 'primary'}
                      size={34}
                      muted={!available}
                    />

                    <View style={{ flex: 1 }}>
                      <Text style={[TYPE.body, { color: available ? c.text : c.textSubtle }]}>
                        {feature.label}
                      </Text>
                      {feature.hint && <Caption>{feature.hint}</Caption>}
                    </View>

                    {/* Two different kinds of unavailable, and a teacher can act on
                        exactly one of them. */}
                    {state === 'coming' && <Badge label="Soon" tone="neutral" />}
                    {state === 'needs-school' && <Badge label="Needs school" tone="warning" />}
                    {available && <ChevronRight size={18} color={c.textSubtle} />}
                  </Pressable>
                )
              })}
            </View>
          </View>
        ))}

        {/* Session-level, and rare. Neither belongs in a tab. */}
        <View style={{ gap: SPACE.sm, marginTop: SPACE.md }}>
          {(portals?.count ?? 0) > 1 && (
            <Pressable
              onPress={() => router.push('/portal')}
              accessibilityRole="button"
              style={{
                minHeight: TAP,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: SPACE.sm,
                borderRadius: RADIUS.md,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.border,
              }}
            >
              <LayoutGrid size={16} color={c.primaryText} />
              <Text style={[TYPE.label, { color: c.primaryText }]}>Switch portal</Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => void signOut()}
            accessibilityRole="button"
            style={{
              minHeight: TAP,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: SPACE.sm,
              borderRadius: RADIUS.md,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: c.border,
            }}
          >
            <LogOut size={16} color={c.textMuted} />
            <Text style={[TYPE.label, { color: c.textMuted }]}>Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  )
}
