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
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { CreditCard } from 'lucide-react-native'

import { useApi } from '../../../lib/use-api'
import { useSession } from '../../../lib/auth'
import {
  Body,
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
  const c = usePalette()
  const { fullName, email } = useSession()
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

        {/* Stated rather than discovered at the point of refusal. */}
        <Caption>
          Buying more credits is on the ZSMS website for now — mobile payment is not wired
          up yet.
        </Caption>
      </ScrollView>
    </Screen>
  )
}
