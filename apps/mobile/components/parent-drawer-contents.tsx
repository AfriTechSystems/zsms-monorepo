/**
 * The parent drawer: every feature, grouped, with the reason anything is unavailable.
 *
 * Spec: `Official Documentation/07 Students and Parents/PARENT_PORTAL.md`
 *
 * The generated route list would be a single entry called "(tabs)". What a parent needs
 * is the CATALOGUE — grouped, gated, and honest about what is not built — which has no
 * relationship to the file tree.
 *
 * Gating asks one question: is this account linked to a child? A parent has no Clerk
 * organisation, so there is no role to branch on. Somebody who has just signed up and
 * has no link yet sees the whole list with the school half explained, rather than a
 * different, emptier app.
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

import {
  PARENT_FEATURES,
  parentFeatureState,
  type ParentFeature,
} from '../lib/parent-features'
import { useApi } from '../lib/use-api'
import { useSession } from '../lib/auth'
import { Badge, Caption, usePalette } from './ui'
import { SPACE, TAP, TYPE } from '../theme'

const GROUPS: Array<ParentFeature['group']> = ['My children', 'Money', 'School', 'Account']

export function ParentDrawerContents(props: DrawerContentComponentProps): JSX.Element {
  const c = usePalette()
  const router = useRouter()
  const { fullName, email, signOut } = useSession()

  const { data } = useApi<{ children: Array<{ id: string }> }>('/api/parent/overview')
  const { data: portals } = useApi<{ count: number }>('/api/session/portals')

  const hasChild = (data?.children?.length ?? 0) > 0
  const grouped = useMemo(
    () =>
      GROUPS.map((g) => ({
        group: g,
        items: PARENT_FEATURES.filter((f) => f.group === g),
      })),
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
        {hasChild && (
          <Text style={[TYPE.caption, { color: c.primaryText }]} numberOfLines={1}>
            {data?.children.length === 1
              ? '1 child'
              : `${data?.children.length ?? 0} children`}
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
            const state = parentFeatureState(feature, hasChild)
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

                {/* Two kinds of unavailable, and a parent can act on exactly one. */}
                {state === 'coming' && <Badge label="Soon" tone="neutral" />}
                {state === 'needs-child' && <Badge label="No child" tone="warning" />}
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
