'use client'

/**
 * School dashboard.
 *
 * Spec: `Official Documentation/06 School and Tenant Module/SCHOOL.md`
 *       `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *
 * ## What a dashboard is for here
 *
 * Not a summary of everything — a short answer to "is anything wrong today".
 * Four figures at most, each one either reassuring or actionable, and each
 * linking to the screen where something can be done about it.
 *
 * ## Arrears are shown, never enforced
 *
 * The outstanding-fees card is a figure and a link. It does not gate anything,
 * and nothing downstream of it may: withholding a result or a certificate over a
 * balance is a school-configurable policy that is off by default, never
 * behaviour this product assumes. A dashboard that quietly became an
 * enforcement point is exactly how that assumption gets made.
 *
 * ## Sections a role cannot see are absent, not empty
 *
 * `/api/school/overview` returns `null` for a section the caller has no policy
 * for, rather than an empty object. The difference matters: an empty fees card
 * reading "K 0.00 outstanding" would tell a teacher their school has no arrears,
 * which is a claim the teacher was never entitled to and which may be false.
 */

import type { JSX } from 'react'
import { SetupProgress } from './setup-progress'
import { use } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarCheck, TriangleAlert, UserPlus, Users, Wallet } from 'lucide-react'

import { useApi } from '../../../lib/use-api'
import { can } from '../../../lib/roles'
import type { Role } from '@zsms/auth-provider'
import { Alert } from '../../../components/ui/alert'
import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, PageHeader, StatSkeleton } from '../../../components/ui/data-states'
import { StatCard } from '../../../components/ui/stat-card'
import { ActivityFeed } from '../../../components/ui/activity-feed'
import { RailPanel } from '../../../components/ui/context-rail'
import { SectionLink } from '../../../components/ui/section-link'
import { formatCount, formatDate, formatKwacha } from './school-shared'
import { ChartFrame, TrendChart } from '../../../components/ui/chart'

interface Capacity {
  studentLimit: number | null
  isUnlimited: boolean
  source: string
  currentCount: number
  remaining: number | null
  atCapacity: boolean
}

/**
 * Attendance over the last fortnight, as a rate.
 *
 * ## Why a rate and not four counts
 *
 * The question a head teacher asks of a fortnight is "is attendance holding up",
 * which is one number per day. Four stacked series would answer "what was the
 * composition of each day", which nobody asked, and would need a legend, four hues
 * and a stacking order to argue about. One series, so no legend — the title names
 * it, and the tooltip carries the day's actual counts.
 *
 * ## What counts as attending
 *
 * `present + late`. A late pupil came to school; counting them absent would make
 * punctuality and attendance the same measure, and the register already separates
 * them. `excused` sits in the denominator but not the numerator — an authorised
 * absence is still an absence from the room, and a school that wants it counted
 * differently needs a policy setting rather than a different chart.
 */
function AttendanceTrend({
  trend,
}: {
  trend: Array<{ date: string; present: number; late: number; absent: number; excused: number }>
}): JSX.Element {
  const rates = trend.map((d) => {
    const assessed = d.present + d.late + d.absent + d.excused
    return assessed === 0 ? 0 : Math.round(((d.present + d.late) / assessed) * 100)
  })

  // Day and month only. A fortnight of `2026-10-14` labels collides at any width,
  // and the year is the same on every point.
  const labels = trend.map((d) => {
    const [, month, day] = d.date.split('-')
    return `${day}/${month}`
  })

  return (
    <ChartFrame
      title="Attendance, last fortnight"
      description="Present or late, as a share of the pupils whose register was marked that day. Days the school was closed are not shown."
    >
      <TrendChart
        series={[{ label: 'Attending', points: rates }]}
        labels={labels}
        format={(n) => `${n}%`}
        emptyMessage="No registers marked in the last fortnight."
      />
    </ChartFrame>
  )
}

interface Overview {
  school: {
    id: string
    code: string
    name: string
    status: string
    tier: string
    financeModuleEnabled: boolean
    whatsappEnabled: boolean
  }
  role: string
  capacity: Capacity | null
  roll: { total: number; enrolled: number; byStatus: Record<string, number> }
  fees: {
    visible: boolean
    totalDue: number
    totalPaid: number
    outstanding: number
    overdueCount: number
    studentsInArrears: number
  } | null
  attendance: {
    visible: boolean
    date: string
    present: number
    absent: number
    late: number
    total: number
    /**
     * The last fortnight, days the school was closed already removed by the route.
     * A `holiday` day is not a day of total absence, and plotted as one it draws a
     * cliff to 0% that reads as a register nobody marked.
     */
    trend: Array<{
      date: string
      present: number
      late: number
      absent: number
      excused: number
    }>
  } | null
  announcements: Array<{
    id: string
    title: string
    importance: string
    sent_at: string | null
    status: string
  }>
}

/**
 * How full the school is, in words.
 *
 * The ceiling is never printed as a bare number without saying where it came
 * from. "200" alone invites the reading that it is a property of the school; it
 * is a property of the plan, and knowing that is the difference between calling
 * AfriTech and giving up on enrolling a pupil.
 */
function capacitySentence(capacity: Capacity): string {
  if (capacity.isUnlimited) {
    return capacity.source === 'school_override'
      ? 'No limit, by arrangement with AfriTech'
      : 'No limit on this plan'
  }

  const of = `of ${formatCount(capacity.studentLimit ?? 0)}`
  switch (capacity.source) {
    case 'school_override':
      return `${of} — a limit set for this school`
    case 'tier_override':
      return `${of} on the plan currently applied`
    case 'tier_missing':
      return of
    default:
      return `${of} on this plan`
  }
}

export default function SchoolDashboardPage({
  params,
}: {
  params: Promise<{ schoolCode: string }>
}): JSX.Element {
  const { schoolCode } = use(params)
  const base = `/school/${schoolCode}`

  const { data, loading, error, code, reload } = useApi<Overview>('/api/school/overview')

  const capacity = data?.capacity ?? null
  // Only warn near the edge. A school at 40 of 200 does not need to be told
  // about a ceiling; a school at 195 does, before the registrar hits it with a
  // parent standing in front of them.
  const nearCapacity =
    capacity !== null &&
    !capacity.isUnlimited &&
    capacity.remaining !== null &&
    capacity.remaining <= 10

  return (
    <>
      <PageHeader
        title={data?.school.name ?? 'Dashboard'}
        description="Today at a glance."
        actions={
          // Gated on the capability, not merely on having loaded. Offering
          // "Enrol pupil" to a role the INSERT policy refuses produces a
          // filled-in form and a flat "you do not have permission" — which
          // reads as a broken product rather than as a role boundary.
          data && can(data.role as Role, 'students:write') && (
            <Button asChild>
              <Link href={`${base}/students/new`}>
                <UserPlus aria-hidden="true" />
                Enrol pupil
              </Link>
            </Button>
          )
        }
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}
      {loading && !data && !error && <StatSkeleton count={4} />}

      {!error && data && (
        <div className="space-y-cards">
          {/* Above the figures while anything is outstanding: a dashboard of numbers is
              useless to a school that cannot yet mark a register. Renders nothing once
              everything derivable is done. */}
          <SetupProgress base={base} />

          {/* A school that is not `active` has staff who need to know why their
              screens are about to behave oddly, stated once at the top rather
              than discovered one refusal at a time. */}
          {data.school.status !== 'active' && (
            <Alert
              variant={data.school.status === 'suspended' ? 'danger' : 'warning'}
              title={data.school.status === 'trial' ? 'Trial' : `School is ${data.school.status.replace(/_/g, ' ')}`}
            >
              {data.school.status === 'trial'
                ? 'This school is on a trial. Everything works; the subscription has not started.'
                : 'Some actions will be refused while the school is in this state. Contact AfriTech.'}
            </Alert>
          )}

          {nearCapacity && capacity && (
            <Alert
              variant={capacity.atCapacity ? 'danger' : 'warning'}
              title={capacity.atCapacity ? 'The roll is full' : 'Nearly at the pupil limit'}
            >
              <p>
                {capacity.atCapacity
                  ? `This school has ${formatCount(capacity.currentCount)} pupils on the roll and its plan allows ${formatCount(capacity.studentLimit ?? 0)}. No further pupils can be enrolled until a place is freed or the limit is raised.`
                  : `${formatCount(capacity.remaining ?? 0)} place${capacity.remaining === 1 ? '' : 's'} left of ${formatCount(capacity.studentLimit ?? 0)}.`}{' '}
                Upgrading the subscription raises the limit, or AfriTech can set a limit for this
                school alone.
              </p>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-cards lg:grid-cols-4">
            <StatCard
              label="Pupils on the roll"
              value={formatCount(data.roll.enrolled)}
              hint={capacity ? capacitySentence(capacity) : undefined}
              tone={capacity?.atCapacity ? 'warning' : 'primary'}
              icon={<Users />}
            />

            {data.fees ? (
              <StatCard
                label="Outstanding fees"
                value={formatKwacha(data.fees.outstanding)}
                hint={
                  data.fees.overdueCount > 0
                    ? `${formatCount(data.fees.overdueCount)} past its due date`
                    : 'Nothing past due'
                }
                tone={data.fees.overdueCount > 0 ? 'danger' : 'success'}
                icon={<Wallet />}
              />
            ) : (
              // Deliberately a different card, not a zero. See the header note.
              <StatCard
                label="Fees"
                value="—"
                hint="Not part of your role"
                tone="neutral"
                icon={<Wallet />}
              />
            )}

            {data.attendance ? (
              <StatCard
                label="Absent today"
                value={formatCount(data.attendance.absent)}
                hint={
                  data.attendance.total === 0
                    ? 'No register marked yet today'
                    : `${formatCount(data.attendance.present)} present, ${formatCount(data.attendance.late)} late`
                }
                tone={data.attendance.total === 0 ? 'neutral' : data.attendance.absent > 0 ? 'warning' : 'success'}
                icon={<CalendarCheck />}
              />
            ) : (
              <StatCard
                label="Attendance"
                value="—"
                hint="Not part of your role"
                tone="neutral"
                icon={<CalendarCheck />}
              />
            )}

            <StatCard
              label="Not on the roll"
              value={formatCount(data.roll.total - data.roll.enrolled)}
              hint="Transferred, graduated, or withdrawn"
              tone="neutral"
              icon={<Users />}
            />
          </div>

          {/*
            Stat row, then the chart, then the lists — the dashboard archetype in
            zsms-ui, in that order.

            Rendered only with two or more days behind it. One point is not a trend,
            and a line chart with a single dot on it is furniture pretending to be
            information; the stat card above already says what today looks like.
          */}
          {data.attendance && data.attendance.trend.length >= 2 && (
            <AttendanceTrend trend={data.attendance.trend} />
          )}

          <div className="grid gap-cards lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>The roll</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Active and on-leave pupils occupy a place; the rest do not.
                </p>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2">
                  {Object.entries(data.roll.byStatus).length === 0 ? (
                    <EmptyState
                      illustration="pupils"
                      title="No pupils yet"
                      description="Enrol the first pupil to start the roll."
                      action={
                        can(data.role as Role, 'students:write') ? (
                          <Button asChild size="sm">
                            <Link href={`${base}/students/new`}>
                              <UserPlus aria-hidden="true" />
                              Enrol pupil
                            </Link>
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    Object.entries(data.roll.byStatus)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, count]) => (
                        <div
                          key={status}
                          className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0"
                        >
                          <dt className="text-sm capitalize text-muted-foreground">
                            {status.replace(/_/g, ' ')}
                          </dt>
                          <dd data-numeric className="text-sm font-medium">
                            {formatCount(count)}
                          </dd>
                        </div>
                      ))
                  )}
                </dl>

                {data.roll.total > 0 && (
                  <Button variant="outline" size="sm" asChild className="mt-stack">
                    <Link href={`${base}/students`}>
                      See all pupils
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent announcements</CardTitle>
                <p className="text-sm text-muted-foreground">The last five sent to this school.</p>
              </CardHeader>
              <CardContent>
                {data.announcements.length === 0 ? (
                  <EmptyState
                    illustration="notices"
                    title="Nothing sent yet"
                    description="Announcements sent to this school will appear here."
                  />
                ) : (
                  <ul className="space-y-3">
                    {data.announcements.map((a) => (
                      <li key={a.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {a.importance === 'urgent' && (
                            <Badge variant="danger">
                              <TriangleAlert aria-hidden="true" />
                              Urgent
                            </Badge>
                          )}
                          <span className="min-w-0 truncate text-sm font-medium">{a.title}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDate(a.sent_at)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/*
              What other people have been doing (reference W1; `0268`).

              Beside the roll rather than below everything: on a school dashboard the
              question "has anything changed since I last looked" is asked at the same
              moment as "how many pupils do we have", not after scrolling past it.

              `recent_activity()` excludes the reader's OWN actions, so a head teacher
              who has just marked a register does not see themselves reported back.
            */}
            <RailPanel
              title="Recent activity"
              action={<SectionLink href={`${base}/settings/audit`}>Audit trail</SectionLink>}
            >
              <ActivityFeed limit={6} />
            </RailPanel>
          </div>
        </div>
      )}
    </>
  )
}
