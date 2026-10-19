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
import { CalendarCheck, CircleAlert, GraduationCap, Wallet } from 'lucide-react-native'

import { Avatar } from '../../../components/avatar'
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
import { Ring, SectionTitle, StatTile } from '../../../components/stats'
import { AppHeader, Greeting } from '../../../components/shell'
import { Mark } from '../../../components/wordmark'
import { useSession } from '../../../lib/auth'
import { childQuery, useChild, type Child } from '../../../lib/child'
import { PARENT_FEATURES, parentFeatureState } from '../../../lib/parent-features'
import { useApi } from '../../../lib/use-api'
import { NUMERIC, SPACE, TYPE } from '../../../theme'

interface Overview {
  children: Child[]
  selected: {
    id: string
    firstName: string
    lastName: string
    /** Set by the school. A parent sees it and cannot change it (`0265`). */
    photoUrl?: string | null
  } | null
  school: { name?: string } | null
  balance: { outstanding?: number | null; total_due?: number | null; total_paid?: number | null } | null
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

  const { firstName } = useSession()
  /* Only the count is read here — the bell is a number, and the list lives on the
     notices tab. A home screen that fetches every notice to render one badge is a
     request a parent pays for on a metered connection. */
  const notices = useApi<{ unread: number }>('/api/parent/notices')
  const { data, loading, error, reload } = useApi<Overview>(
    `/api/parent/overview${childQuery(childId)}`,
  )

  const kids = data?.children ?? []
  const hasChild = kids.length > 0
  const outstanding = data?.balance?.outstanding ?? 0

  /*
    How much of the term has been paid, as a percentage.

    `undefined` when there is no total to be a proportion of — a school that has not
    billed anything yet would otherwise show a full bar, which reads as "paid up"
    when nothing has been charged at all.

    Verified payments only, because that is what `student_fee_balance` nets. A parent
    who uploaded proof this morning sees it as a claim on the Fees screen and not in
    this bar, which is the same distinction the school side draws.
  */
  const totalDue = data?.balance?.total_due ?? 0
  const paidPercent =
    totalDue > 0 ? ((data?.balance?.total_paid ?? 0) / totalDue) * 100 : undefined

  return (
    <Screen>
      {/*
        The same header the teacher portal carries, for the same reason and in the same
        place. Two portals of one product that put the school name, the bell and the
        account in different corners read as two products — and a parent who is also a
        teacher switches between them.
      */}
      <AppHeader
        left={<Mark size={32} />}
        schoolName={data?.school?.name ?? null}
        unread={notices.data?.unread ?? 0}
        onPressBell={() => router.push('/(parent)/(tabs)/notices' as never)}
        onPressAvatar={() => router.push('/(parent)/(tabs)/account' as never)}
        avatar={<Avatar name={firstName ?? 'You'} size="sm" />}
      />

      <Greeting
        name={firstName ? firstName : 'Your children'}
        subtitle="Here is what is happening today."
      />

      <View style={{ height: SPACE.md }} />

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
            {/*
              Who this is about, with a face.

              The name alone sat at the top of a stack of numbers; a parent of three
              switching between children had nothing but a line of text to confirm
              which one they were looking at. The photograph is the school's, read-only
              here — a parent sees what the school recorded.
            */}
            <Row gap={SPACE.md}>
              <Avatar
                name={`${data.selected.firstName} ${data.selected.lastName}`}
                src={data.selected.photoUrl ?? null}
                size="lg"
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Title>
                  {data.selected.firstName} {data.selected.lastName}
                </Title>
                {data.school?.name && <Caption>{data.school.name}</Caption>}
              </View>
            </Row>

            {/*
              Money first. It is the question that changes what somebody does today.

              The bar is new and it is the point: an outstanding figure on its own says
              nothing about whether a parent is nearly finished paying or has barely
              started, and that is what they actually want to know. It only appears
              when a total exists to be a proportion OF.
            */}
            <StatTile
              label="Fees outstanding"
              value={kwacha(outstanding)}
              icon={Wallet}
              tone={outstanding > 0 ? 'danger' : 'success'}
              progress={paidPercent}
              hint={
                outstanding > 0
                  ? paidPercent === undefined
                    ? 'Tap Fees below for the breakdown.'
                    : `${Math.round(paidPercent)}% of this term's fees paid.`
                  : 'Nothing owed. Thank you.'
              }
            />

            <SectionTitle>How your child is doing</SectionTitle>

            {/*
              The ring carries attendance, because a percentage is exactly the shape a
              ring reads well — and `null` draws an empty track with an em dash rather
              than a red ring at zero, which for a newly enrolled pupil would be a
              false accusation.
            */}
            <Card>
              <Row gap={SPACE.lg}>
                <Ring
                  value={data.attendance.rate}
                  tone={
                    data.attendance.rate === null
                      ? 'neutral'
                      : data.attendance.rate >= 90
                        ? 'success'
                        : data.attendance.rate >= 80
                          ? 'warning'
                          : 'danger'
                  }
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Row gap={SPACE.sm}>
                    <CalendarCheck size={16} color={c.textMuted} strokeWidth={2} />
                    <Text style={[TYPE.heading, { color: c.text }]}>Attendance</Text>
                  </Row>
                  <Caption>
                    {data.attendance.days > 0
                      ? `Present ${data.attendance.present} of ${data.attendance.days} days marked`
                      : 'Nothing marked yet this term'}
                  </Caption>
                </View>
              </Row>
            </Card>

            <StatTile
              label="Published results"
              value={String(data.results.length)}
              icon={GraduationCap}
              tone={data.results.length > 0 ? 'primary' : 'neutral'}
              hint={
                data.results.length === 0
                  ? 'None published yet this term.'
                  : 'Tap Results below to read them.'
              }
            />

            <SectionTitle>Everything else</SectionTitle>
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
