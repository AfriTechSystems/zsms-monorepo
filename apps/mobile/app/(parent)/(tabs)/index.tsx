/**
 * A parent's home: how each child is doing, and everything else one tap away.
 *
 * Spec: `Official Documentation/07 Students and Parents/PARENT_PORTAL.md`
 *
 * ## What a parent opens the app for
 *
 * Three things, in this order: is anything owed, has my child been in school, and has
 * anything been published. Those are above the grid because scrolling past a grid of
 * icons to learn you owe K450 is the wrong way round.
 *
 * ## The grid is every feature, including the unbuilt ones
 *
 * Decided on the teacher app and kept here: a greyed "Pay fees — soon" tells a parent
 * what is coming and stops the grid reshuffling at each release.
 */

import type { JSX } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { CircleAlert } from 'lucide-react-native'

import { ChildSwitcher } from '../../../components/child-switcher'
import { FeatureGrid } from '../../../components/feature-grid'
import {
  Body,
  Caption,
  Card,
  Empty,
  ErrorNote,
  Loading,
  Row,
  Screen,
  Title,
  usePalette,
} from '../../../components/ui'
import { childQuery, useChild, type Child } from '../../../lib/child'
import { PARENT_FEATURES, parentFeatureState } from '../../../lib/parent-features'
import { useApi } from '../../../lib/use-api'
import { NUMERIC, SPACE, TYPE } from '../../../theme'

interface Overview {
  children: Child[]
  selected: { id: string; firstName: string; lastName: string } | null
  school: { name?: string } | null
  balance: { outstanding?: number | null } | null
  attendance: { days: number; present: number; absent: number; rate: number | null }
  results: unknown[]
  announcements: unknown[]
}

const kwacha = (n: number): string =>
  `K${n.toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function ParentHome(): JSX.Element {
  const c = usePalette()
  const router = useRouter()
  const { childId, setChildId } = useChild()

  const { data, loading, error, reload } = useApi<Overview>(
    `/api/parent/overview${childQuery(childId)}`,
  )

  const kids = data?.children ?? []
  const hasChild = kids.length > 0
  const outstanding = data?.balance?.outstanding ?? 0

  return (
    <Screen>
      <ChildSwitcher children={kids} selectedId={childId} onSelect={setChildId} />

      <ScrollView
        contentContainerStyle={{
          padding: SPACE.gutter,
          gap: SPACE.md,
          paddingBottom: SPACE.xxl,
        }}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={reload} tintColor={c.primary} />
        }
      >
        {error && <ErrorNote message={error} onRetry={reload} />}
        {loading && !data && <Loading label="Loading your children" />}

        {/*
          No link yet, which is a state with a real remedy.

          A parent who signs up before their school has recorded their email sees this
          rather than an empty app. `claim_parent_links()` matches on the verified
          address the school entered at enrolment, so the fix is at the school office.
        */}
        {!loading && data && !hasChild && (
          <Empty
            icon={CircleAlert}
            title="No children linked yet"
            body="Your school links your account using the email address they have on file. If this is a new account, ask the school office to check the address against the one you signed up with."
          />
        )}

        {hasChild && data?.selected && (
          <>
            <View style={{ gap: 2 }}>
              <Title>
                {data.selected.firstName} {data.selected.lastName}
              </Title>
              {data.school?.name && <Caption>{data.school.name}</Caption>}
            </View>

            {/* Money first. It is the question that changes what somebody does today. */}
            <Card>
              <Caption>Fees outstanding</Caption>
              <Text
                style={[
                  TYPE.display,
                  NUMERIC,
                  { color: outstanding > 0 ? c.danger : c.success },
                ]}
              >
                {kwacha(outstanding)}
              </Text>
              <Body muted>
                {outstanding > 0
                  ? 'Tap Fees below for the breakdown and what has been paid.'
                  : 'Nothing owed. Thank you.'}
              </Body>
            </Card>

            <Row gap={SPACE.md}>
              <Card style={{ flex: 1 }}>
                <Caption>Attendance</Caption>
                <Text style={[TYPE.heading, NUMERIC, { color: c.text }]}>
                  {/* null, not 0, when there is nothing to divide by — a newly
                      enrolled pupil showing 0% would be a false accusation. */}
                  {data.attendance.rate === null ? '—' : `${data.attendance.rate}%`}
                </Text>
                <Caption>
                  {data.attendance.days > 0
                    ? `${data.attendance.present} of ${data.attendance.days} days`
                    : 'Nothing marked yet'}
                </Caption>
              </Card>

              <Card style={{ flex: 1 }}>
                <Caption>Published results</Caption>
                <Text style={[TYPE.heading, NUMERIC, { color: c.text }]}>
                  {data.results.length}
                </Text>
                <Caption>
                  {data.results.length === 0 ? 'None yet this term' : 'Tap Results to read'}
                </Caption>
              </Card>
            </Row>
          </>
        )}

        {/* Everything the portal has, built or not. */}
        <FeatureGrid
          features={PARENT_FEATURES.map((f) => ({
            key: f.key,
            label: f.label,
            icon: f.icon,
            href: f.href,
            state: parentFeatureState(f, hasChild),
          }))}
          onPress={(href) => router.push(href as never)}
          lockedLabel="Needs a child linked"
        />
      </ScrollView>
    </Screen>
  )
}
