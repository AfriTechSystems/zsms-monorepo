/**
 * Account — the plan, and what is left of it.
 *
 * Spec: `Official Documentation/18 AI Module/AI_OVERVIEW.md`
 *       `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * Credits are the one number a teacher needs BEFORE starting work rather than after
 * being refused, which is why this is one tap from the Home grid rather than buried in
 * a settings tree.
 */

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { Bell, BellOff, CreditCard } from 'lucide-react-native'

import { useApi } from '../../../lib/use-api'
import { useSession } from '../../../lib/auth'
import {
  enablePush,
  pushState,
  pushUnavailableReason,
  type PushState,
} from '../../../lib/push'
import {
  Body,
  Button,
  Caption,
  Card,
  ErrorNote,
  Loading,
  Row,
  Screen,
  Title,
  usePalette,
} from '../../../components/ui'
import { NUMERIC, RADIUS, SPACE, TYPE } from '../../../theme'

interface Hub {
  account?: {
    full_name?: string
    plan_code?: string
    subscription_status?: string
  } | null
  credits?: { remaining?: number; included?: number } | null
}

export default function Account(): JSX.Element {
  /*
    Notifications are asked for HERE, not at launch.

    A phone that asks before showing anything gets "Don't allow", and on iOS that answer
    is close to final — the app can never ask again, only send somebody to Settings. By
    the time a teacher opens their account they have seen what the app is for.
  */
  const [push, setPush] = useState<PushState | null>(null)
  const [pushWhy, setPushWhy] = useState<string | null>(null)
  const [pushBusy, setPushBusy] = useState(false)

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
  const c = usePalette()
  const { fullName, email, getToken } = useSession()
  const { data, loading, error, reload } = useApi<Hub>('/api/teacher/hub')

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: SPACE.gutter, gap: SPACE.cards }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
        }
      >
        <View style={{ gap: 2 }}>
          <Title>{data?.account?.full_name ?? fullName ?? 'Your account'}</Title>
          <Caption>{email ?? ''}</Caption>
        </View>

        {error && <ErrorNote message={error} onRetry={reload} />}
        {loading && !data && <Loading />}

        {data && (
          <Card>
            <Row gap={SPACE.md}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: RADIUS.md,
                  backgroundColor: c.primaryTint,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CreditCard size={21} color={c.primaryMark} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[NUMERIC, { color: c.text, fontSize: 22 }]}>
                  {data.credits?.remaining ?? 0}
                </Text>
                <Caption>
                  AI credits left
                  {typeof data.credits?.included === 'number'
                    ? ` of ${data.credits.included} this month`
                    : ''}
                </Caption>
              </View>
            </Row>
          </Card>
        )}

        {data?.account?.plan_code && (
          <Card>
            <Body>Plan: {data.account.plan_code}</Body>
            <Caption>{data.account.subscription_status ?? ''}</Caption>
          </Card>
        )}

        {/* ---- Notifications ---- */}
        <Card>
          <Row gap={SPACE.sm}>
            {push === 'on' ? (
              <Bell size={21} color={c.primaryMark} strokeWidth={2} />
            ) : (
              <BellOff size={21} color={c.textSubtle} strokeWidth={2} />
            )}
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
              label={pushBusy ? 'Asking…' : 'Turn on notifications'}
              onPress={() => {
                setPushBusy(true)
                void enablePush(getToken)
                  .then(setPush)
                  .finally(() => setPushBusy(false))
              }}
              busy={pushBusy}
              full
            />
          )}
        </Card>

        {/* Stated rather than discovered at the point of refusal. */}
        <Caption>
          Buying more credits is on the ZSMS website for now — mobile payment is not wired
          up yet.
        </Caption>
      </ScrollView>
    </Screen>
  )
}
