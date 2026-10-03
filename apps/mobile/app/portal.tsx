/**
 * Which portal — the mobile counterpart of `/welcome`.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *
 * One address is often a parent, a teacher AND a school owner at once, which in a small
 * Zambian private school is ordinary. The web routed on the first match until it was
 * corrected; the phone must not repeat that, so the same `/api/session/portals`
 * enumeration drives both.
 *
 * ## What the phone can open, and what it cannot
 *
 * This build serves teachers. A portal the app has no screens for is listed and says so
 * rather than being hidden — somebody who is also a parent should learn their parent
 * portal exists and where to find it, not conclude ZSMS has lost their children.
 */

import type { JSX } from 'react'
import { useRouter } from 'expo-router'
import { Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { ArrowRight, Building2, GraduationCap, Network, ShieldCheck, Users } from 'lucide-react-native'

import { useApi } from '../lib/use-api'
import { BASE_URL } from '../lib/api'
import { Badge, Body, Caption, Loading, Row, Screen, Title, usePalette } from '../components/ui'
import { RADIUS, SPACE, TAP, TYPE } from '../theme'

interface Portal {
  key: string
  kind: 'admin' | 'school' | 'parent' | 'teacher' | 'network'
  label: string
  description: string
  href: string
}

const ICON = {
  admin: ShieldCheck,
  school: Building2,
  parent: Users,
  teacher: GraduationCap,
  network: Network,
} as const

/** Only the teacher portal has screens in this build. */
const NATIVE = new Set(['teacher', 'school'])

export default function PortalPicker(): JSX.Element {
  const c = usePalette()
  const router = useRouter()
  const { data, loading } = useApi<{ portals: Portal[] }>('/api/session/portals')

  const portals = data?.portals ?? []

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.cards }}>
        <View style={{ gap: 4 }}>
          <Title>Where would you like to go?</Title>
          <Body muted>This account reaches more than one part of ZSMS.</Body>
        </View>

        {loading && portals.length === 0 && <Loading />}

        {portals.map((portal) => {
          const Icon = ICON[portal.kind]
          const native = NATIVE.has(portal.kind)

          return (
            <Pressable
              key={portal.key}
              accessibilityRole="button"
              onPress={() => {
                if (native) {
                  router.replace('/(teacher)')
                  return
                }
                // Not built natively yet. Opening the web portal is honest and useful —
                // far better than a dead card, and the parent portal is phone-first on
                // the web anyway.
                void Linking.openURL(`${BASE_URL}${portal.href}`)
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: SPACE.md,
                minHeight: TAP,
                padding: SPACE.card,
                borderRadius: RADIUS.lg,
                backgroundColor: c.surface,
                borderWidth: 1,
                borderColor: c.border,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: RADIUS.md,
                  backgroundColor: c.primaryTint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon size={20} color={c.primaryMark} strokeWidth={2} />
              </View>

              <View style={{ flex: 1, gap: 2 }}>
                <Row gap={SPACE.sm}>
                  <Text style={[TYPE.heading, { color: c.text }]} numberOfLines={1}>
                    {portal.label}
                  </Text>
                  {!native && <Badge label="Opens in browser" tone="neutral" />}
                </Row>
                <Caption>{portal.description}</Caption>
              </View>

              <ArrowRight size={18} color={c.textSubtle} />
            </Pressable>
          )
        })}
      </ScrollView>
    </Screen>
  )
}
