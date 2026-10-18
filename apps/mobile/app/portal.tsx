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
import { IconTile } from '../components/shell'
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
/**
 * Where each portal goes inside the app.
 *
 * A kind that is absent opens the web portal instead, which is honest and useful — far
 * better than a dead card.
 *
 * `school` lands in the teacher app on purpose: a school owner on a phone is almost
 * always there to mark a register or read a notice, and the administrative half of the
 * school portal is a desk job.
 */
const NATIVE: Record<string, string> = {
  teacher: '/(teacher)/(tabs)',
  school: '/(teacher)/(tabs)',
  parent: '/(parent)/(tabs)',
}

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
          const nativeHref = NATIVE[portal.kind]

          return (
            <Pressable
              key={portal.key}
              accessibilityRole="button"
              onPress={() => {
                if (nativeHref) {
                  // By KIND, not "is it native at all". Sending every native portal to
                  // the teacher app was correct while that was the only one built; a
                  // parent tapping their own card would now land in a register.
                  router.replace(nativeHref as never)
                  return
                }
                // No screens for this one. Opening the web portal is honest and
                // useful — far better than a dead card.
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
              <IconTile icon={Icon} tone="primary" size={42} />

              <View style={{ flex: 1, gap: 2 }}>
                <Row gap={SPACE.sm}>
                  <Text style={[TYPE.heading, { color: c.text }]} numberOfLines={1}>
                    {portal.label}
                  </Text>
                  {!nativeHref && <Badge label="Opens in browser" tone="neutral" />}
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
