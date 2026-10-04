/**
 * What the drawer shows.
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## Built from the catalogue, not from the routes
 *
 * `DrawerContentScrollView`'s default renders one item per child route, which here would
 * be a single entry called "(tabs)". The drawer needs the FEATURE list — grouped, gated,
 * including what is not built — and that lives in `lib/features.ts` alongside the Home
 * grid so the two cannot disagree.
 *
 * ## Who is signed in, at the top
 *
 * The commonest confusion on an app somebody uses in two roles is being signed in as the
 * wrong account, and the drawer is where a user looks when something seems wrong.
 */

import type { JSX } from 'react'
import { useMemo } from 'react'
import { useRouter } from 'expo-router'
import {
  DrawerContentScrollView,
  type DrawerContentComponentProps,
} from 'expo-router/drawer'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { LayoutGrid, LogOut } from 'lucide-react-native'

import { FEATURES, featureState, type Feature } from '../lib/features'
import { useApi } from '../lib/use-api'
import { useSession } from '../lib/auth'
import { Badge, Caption, usePalette } from './ui'
import { RADIUS, SPACE, TAP, TYPE } from '../theme'

const GROUPS: Array<Feature['group']> = ['Teaching', 'My tools', 'School', 'Account']

/*
  Everything drawer-related comes from `expo-router/drawer`, the PUBLIC entry.

  Two wrong turns got here, and both are worth recording:

    * `@react-navigation/drawer` is a hard bundling error as of SDK 56 — "expo-router is
      no longer compatible with react-navigation".
    * `expo-router/build/react-navigation/drawer`, the internal module, RESOLVES — so the
      bundle succeeded and type-check passed — and then fails to initialise on device
      with "undefined is not a function", which Hermes reports against the module's first
      import line rather than the offending one. A green bundle is not a running app.

  `expo-router/drawer` re-exports `Drawer`, the views and the types together.
*/
export function DrawerContents(props: DrawerContentComponentProps): JSX.Element {
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

  const go = (href: string): void => {
    props.navigation.closeDrawer()
    router.push(href as never)
  }

  return (
    <DrawerContentScrollView
      {...props}
      contentContainerStyle={{ paddingTop: SPACE.lg, paddingBottom: SPACE.xxl }}
    >
      <View style={{ paddingHorizontal: SPACE.gutter, gap: 2, marginBottom: SPACE.lg }}>
        <Text style={[TYPE.heading, { color: c.text }]} numberOfLines={1}>
          {fullName ?? 'Your account'}
        </Text>
        <Caption>{email ?? ''}</Caption>
        {data?.school?.name && (
          <Text style={[TYPE.caption, { color: c.primaryText }]} numberOfLines={1}>
            {data.school.name}
          </Text>
        )}
      </View>

      {grouped.map(({ group, items }) => (
        <View key={group} style={{ marginBottom: SPACE.md }}>
          <Text
            style={[
              TYPE.caption,
              {
                color: c.textSubtle,
                textTransform: 'uppercase',
                fontWeight: '700',
                paddingHorizontal: SPACE.gutter,
                marginBottom: 4,
              },
            ]}
          >
            {group}
          </Text>

          {items.map((feature) => {
            const state = featureState(feature, linked)
            const available = state === 'ready'
            const Icon = feature.icon

            return (
              <Pressable
                key={feature.key}
                disabled={!available}
                accessibilityRole="button"
                accessibilityState={{ disabled: !available }}
                onPress={() => feature.href && go(feature.href)}
                style={({ pressed }) => ({
                  minHeight: TAP,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: SPACE.md,
                  paddingHorizontal: SPACE.gutter,
                  backgroundColor: pressed ? c.surfaceSunken : 'transparent',
                  opacity: available ? 1 : 0.45,
                })}
              >
                <Icon
                  size={19}
                  color={available ? c.primaryMark : c.textSubtle}
                  strokeWidth={2}
                />
                <Text
                  style={[TYPE.body, { flex: 1, color: available ? c.text : c.textSubtle }]}
                  numberOfLines={1}
                >
                  {feature.label}
                </Text>

                {/* Two kinds of unavailable, and a teacher can act on exactly one. */}
                {state === 'coming' && <Badge label="Soon" tone="neutral" />}
                {state === 'needs-school' && <Badge label="School" tone="warning" />}
              </Pressable>
            )
          })}
        </View>
      ))}

      <View
        style={{
          paddingHorizontal: SPACE.gutter,
          paddingTop: SPACE.md,
          gap: SPACE.sm,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: c.border,
        }}
      >
        {(portals?.count ?? 0) > 1 && (
          <Pressable
            onPress={() => go('/portal')}
            accessibilityRole="button"
            style={{
              minHeight: TAP,
              flexDirection: 'row',
              alignItems: 'center',
              gap: SPACE.md,
            }}
          >
            <LayoutGrid size={18} color={c.primaryText} />
            <Text style={[TYPE.body, { color: c.primaryText }]}>Switch portal</Text>
          </Pressable>
        )}

        <Pressable
          onPress={() => void signOut()}
          accessibilityRole="button"
          style={{ minHeight: TAP, flexDirection: 'row', alignItems: 'center', gap: SPACE.md }}
        >
          <LogOut size={18} color={c.textMuted} />
          <Text style={[TYPE.body, { color: c.textMuted }]}>Sign out</Text>
        </Pressable>
      </View>
    </DrawerContentScrollView>
  )
}
