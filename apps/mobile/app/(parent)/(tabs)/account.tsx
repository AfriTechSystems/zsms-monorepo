/**
 * A parent's account: who they are, notifications, and their data.
 *
 * Spec: `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *       Zambia Data Protection Act 2021
 *
 * ## Notifications are asked for here
 *
 * Not at launch. A phone that asks before showing anything gets "Don't allow", and on
 * iOS that answer is close to final. By the time a parent opens their account they have
 * seen what the app is for.
 *
 * ## Data rights point at the web, deliberately
 *
 * Downloading a file and asking to be erased are both better done on a screen with
 * room to explain what is kept and for how long. A six-year financial retention rule
 * compressed onto a phone card is the kind of thing somebody agrees to without reading.
 * The app says the rights exist and where to exercise them.
 */

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Linking, ScrollView, Text, View } from 'react-native'
import { Bell, BellOff, ShieldCheck } from 'lucide-react-native'

import {
  Body,
  Button,
  Caption,
  Card,
  Row,
  Screen,
  Title,
  usePalette,
} from '../../../components/ui'
import { ThemeChoiceRow } from '../../../components/theme-choice'
import { useSession } from '../../../lib/auth'
import { IconTile } from '../../../components/shell'
import {
  enablePush,
  pushState,
  pushUnavailableReason,
  type PushState,
} from '../../../lib/push'
import { BASE_URL } from '../../../lib/api'
import { SPACE, TYPE } from '../../../theme'

export default function ParentAccount(): JSX.Element {
  const c = usePalette()
  const { fullName, email, getToken } = useSession()

  const [push, setPush] = useState<PushState | null>(null)
  const [pushWhy, setPushWhy] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void pushState().then((state) => {
      setPush(state)
      /*
        Fetch the reason only when there is one.

        "Not available on this device" sends somebody looking for a fault in the app,
        when the real answer is usually that Expo Go dropped push in SDK 53 — which is
        actionable, and only by whoever is testing.
      */
      if (state === 'unavailable') void pushUnavailableReason().then(setPushWhy)
    })
  }, [])

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.md, paddingBottom: SPACE.xxl }}
      >
        <View style={{ gap: 2 }}>
          <Title>{fullName ?? 'Your account'}</Title>
          <Caption>{email ?? ''}</Caption>
        </View>

        {/* ---- Notifications ---- */}
        <Card>
          <Row gap={SPACE.md}>
            {/* The same tile, the same tones, the same meaning as the teacher's
                account screen. Green when notices will actually arrive. */}
            <IconTile
              icon={push === 'on' ? Bell : BellOff}
              tone={push === 'on' ? 'success' : 'neutral'}
            />
            <View style={{ flex: 1 }}>
              <Body>Notifications</Body>
              <Caption>
                {push === 'on'
                  ? 'This phone will be told when your school sends a notice.'
                  : push === 'declined'
                    ? 'Turned off. Switch notifications on for ZSMS in your phone settings.'
                    : push === 'unavailable'
                      ? (pushWhy ?? 'Not available on this device.')
                      : 'Get told when your school sends a notice.'}
              </Caption>
            </View>
          </Row>

          {push === 'unasked' && (
            <Button
              label={busy ? 'Asking…' : 'Turn on notifications'}
              onPress={() => {
                setBusy(true)
                void enablePush(getToken)
                  .then(setPush)
                  .finally(() => setBusy(false))
              }}
              busy={busy}
              full
            />
          )}
        </Card>

        {/* ---- Data rights ---- */}
        {/*
          Light / System / Dark, here rather than in a settings screen the app does
          not have. The web portals put it in the account menu for the same reason:
          it is a setting about the person, and this is the person's screen.
        */}
        <Card>
          <ThemeChoiceRow />
        </Card>
        <Card>
          <Row gap={SPACE.md}>
            <IconTile icon={ShieldCheck} tone="accent" />
            <View style={{ flex: 1 }}>
              <Body>Your data</Body>
              <Caption>
                You can download everything ZSMS holds about you and your children, or
                ask us to erase it.
              </Caption>
            </View>
          </Row>

          <Text style={[TYPE.caption, { color: c.textSubtle }]}>
            Erasing keeps payment records for six years with your name removed, because
            schools are required to keep business records. The full explanation is on the
            website, where there is room for it.
          </Text>

          <Button
            label="Open my account on the web"
            tone="outline"
            onPress={() => void Linking.openURL(`${BASE_URL}/account`)}
            full
          />
        </Card>
      </ScrollView>
    </Screen>
  )
}
