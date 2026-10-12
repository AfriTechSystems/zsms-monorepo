'use client'

/**
 * Admin overview.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/PLATFORM_METRICS.md`
 *       `Official Documentation/15 Super Admin and Platform/SCHOOL_HEALTH_SCORES.md`
 *
 * The screen answers one question first — *which school needs a call today* —
 * and only then shows the totals. That ordering is the whole point of the health
 * score: `SCHOOL_HEALTH_SCORES.md` frames it as churn prevention, and a
 * dashboard that leads with revenue buries the schools about to stop paying it.
 */

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Building2,
  CalendarClock,
  HeartPulse,
  Hourglass,
  ReceiptText,
  TrendingUp,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-react'

import { useApi } from '../../lib/use-api'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/empty-state'
import { ErrorState, PageHeader, StatSkeleton, TableSkeleton } from '../../components/ui/data-states'
import { StatCard, type StatTone } from '../../components/ui/stat-card'
import { BarChart, ChartFrame, DonutChart, TrendChart } from '../../components/ui/chart'
import { ActivityFeed } from '../../components/ui/activity-feed'
import { RailPanel } from '../../components/ui/context-rail'
import { SectionLink } from '../../components/ui/section-link'
import { Select } from '../../components/ui/field'
import { HealthBadge, formatKwacha, type HealthRow } from './health-shared'

interface Metrics {
  schools_total: number
  schools_active: number
  schools_trial: number
  schools_suspended: number
  students_total: number
  staff_total: number
  collected_this_month: string
  outstanding_total: string
  arrears_total: string
  payments_pending: number
}

/**
 * AfriTech's own business metrics (`0261`, PLATFORM_METRICS.md).
 *
 * `null` when the caller lacks the `billing:read` capability — a support agent has a
 * legitimate overview and simply does not see revenue, rather than being refused the
 * whole page.
 */
interface Business {
  mrr_zmw: string
  arr_zmw: string
  paying_schools: number
  collected_this_month: string
  invoiced_unpaid: string
  trials_active: number
  trials_converted: number
  trials_expired: number
  /** NULL when no trial has finished. "None ended" is not "none converted". */
  trial_conversion_pct: string | null
  loan_commission_earned: string
  loan_commission_unpaid: string
  /** FALSE until twelve months of subscription history exist. */
  nrr_available: boolean
}

interface TierRevenue {
  tier_name: string
  display_name: string
  schools: number
  students: number
  mrr_zmw: string
  mrr_share_pct: string | null
}

/**
 * The health bands, in the order a reader expects to meet them.
 *
 * Status colours rather than series colours: a band means the same thing on every
 * screen, so it must not take whichever hue its position in the array happens to give
 * it. These match `HealthBadge`'s own variants in `health-shared`.
 */
const BAND_ORDER = ['excellent', 'good', 'at_risk', 'critical'] as const

const BAND_LABEL: Record<(typeof BAND_ORDER)[number], string> = {
  excellent: 'Excellent',
  good: 'Good',
  at_risk: 'At risk',
  critical: 'Critical',
}

const BAND_COLOUR: Record<(typeof BAND_ORDER)[number], string> = {
  excellent: '#4A9B4F',
  good: '#3A8DDE',
  at_risk: '#C87F0F',
  critical: '#E15A44',
}

interface HistoryPoint {
  out_captured_on: string
  out_schools_total: number
  out_schools_active: number
  out_students_total: number
  out_mrr_zmw: string
}

interface Overview {
  /** Daily snapshots (`0267`). Empty until the worker has run at least twice. */
  history: HistoryPoint[]
  metrics: Metrics | null
  business: Business | null
  revenueByTier: TierRevenue[]
  health: HealthRow[]
  atRisk: number
}

export default function AdminOverviewPage(): JSX.Element {
  /*
    How far back the growth chart looks. Not persisted: a dashboard range is a
    glance, not a preference, and remembering it means somebody returns to a window
    they no longer remember choosing.
  */
  const [range, setRange] = useState(365)

  const { data, loading, error, code, reload } = useApi<Overview>('/api/admin/overview')

  /*
    The growth series, thinned to one point per month.

    The API returns up to a year of DAILY rows. Drawing 365 points across 640px gives
    a line nobody can read a value off, and the question the chart answers — "are we
    growing" — is a monthly one. So each month contributes its LAST captured reading,
    which is the month's end state rather than an average that belongs to no real day.
  */
  const growth = useMemo(() => {
    const rows = (data?.history ?? []).filter((h) => {
      const age = (Date.now() - new Date(h.out_captured_on).getTime()) / 86_400_000
      return age <= range
    })

    if (rows.length === 0) return { labels: [], points: [], span: '' }

    const lastPerMonth = new Map<string, (typeof rows)[number]>()
    for (const r of rows) {
      lastPerMonth.set(r.out_captured_on.slice(0, 7), r)
    }

    const months = [...lastPerMonth.entries()].sort(([a], [b]) => a.localeCompare(b))

    // A single point is not a trend, and TrendChart's empty state says so better
    // than a chart with one dot in it.
    if (months.length < 2) return { labels: [], points: [], span: '' }

    const label = (iso: string): string =>
      new Date(iso).toLocaleDateString('en-GB', { month: 'short' })

    return {
      labels: months.map(([, r]) => label(r.out_captured_on)),
      points: [
        { label: 'Total schools', points: months.map(([, r]) => r.out_schools_total) },
        { label: 'Active schools', points: months.map(([, r]) => r.out_schools_active) },
      ],
      span: `${label(months[0]![1].out_captured_on)} to ${label(months[months.length - 1]![1].out_captured_on)}`,
    }
  }, [data?.history, range])


  return (
    <>
      <PageHeader
        title="Overview"
        description="Every school on the platform, ranked by the ones most likely to leave."
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/schools">
              All schools
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}

      {loading && !data && !error && (
        <div className="space-y-cards">
          <StatSkeleton count={6} />
          <TableSkeleton rows={5} columns={4} />
        </div>
      )}

      {!error && data && (
        <div className="space-y-section">
          {/*
            Revenue first, because this is AfriTech's own dashboard and "is the
            business working" outranks "how many pupils are enrolled".

            Rendered only when the caller holds `billing:read` (`0237`). A support
            agent sees the operational figures below and nothing here.
          */}
          {data.business && (
            <section aria-labelledby="revenue" className="mb-cards">
              <h2 id="revenue" className="mb-stack font-medium">
                Business
              </h2>

              <div className="grid grid-cols-2 gap-cards lg:grid-cols-3">
                <StatCard
                  label="Monthly recurring revenue"
                  value={formatKwacha(data.business.mrr_zmw)}
                  hint={`${data.business.paying_schools} paying school${
                    data.business.paying_schools === 1 ? '' : 's'
                  } · ${formatKwacha(data.business.arr_zmw)} a year`}
                  tone="neutral"
                  icon={<TrendingUp />}
                />
                <StatCard
                  label="Collected this month"
                  href="/admin/billing"
                  hrefLabel="Billing"
                  value={formatKwacha(data.business.collected_this_month)}
                  hint={`${formatKwacha(data.business.invoiced_unpaid)} invoiced and unpaid`}
                  tone={
                    Number(data.business.invoiced_unpaid) > Number(data.business.mrr_zmw)
                      ? 'warning'
                      : 'neutral'
                  }
                  icon={<ReceiptText />}
                />
                <StatCard
                  label="Trial conversion"
                  /*
                    An em dash, not 0%. `trial_conversion_pct` is NULL when no trial
                    has finished yet, and "no trials have ended" is a different fact
                    from "no trial ever converted" — which is what 0% would state.
                  */
                  value={
                    data.business.trial_conversion_pct === null
                      ? '—'
                      : `${Number(data.business.trial_conversion_pct).toFixed(0)}%`
                  }
                  hint={
                    data.business.trial_conversion_pct === null
                      ? 'No trial has finished yet'
                      : `${data.business.trials_converted} converted · ${data.business.trials_expired} lapsed · ${data.business.trials_active} running`
                  }
                  tone="neutral"
                  icon={<Hourglass />}
                />
              </div>

              {/*
                Revenue by tier. PLATFORM_METRICS.md asks for the SHARE and says
                why: if most revenue comes from few schools, that shapes sales
                strategy — and a school count cannot show it.
              */}
              {data.revenueByTier.length > 0 && (
                <ul className="mt-stack space-y-1">
                  {data.revenueByTier.map((t) => (
                    <li
                      key={t.tier_name}
                      className="flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <span>
                        {t.display_name}{' '}
                        <span className="text-xs text-muted-foreground">
                          <span data-numeric>{t.schools}</span> school
                          {t.schools === 1 ? '' : 's'} ·{' '}
                          <span data-numeric>{t.students}</span> pupils
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-medium" data-numeric>
                          {formatKwacha(t.mrr_zmw)}
                        </span>
                        {t.mrr_share_pct !== null && (
                          <span className="text-xs text-muted-foreground" data-numeric>
                            {Number(t.mrr_share_pct).toFixed(0)}%
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {/*
                Said rather than omitted. An absent NRR figure looks like an
                oversight; naming the reason makes it a known limit.
              */}
              {!data.business.nrr_available && (
                <p className="mt-stack text-xs text-muted-foreground">
                  Net revenue retention needs twelve months of subscription history to
                  compare against. It will appear once there is a year to look back on.
                </p>
              )}
            </section>
          )}

          {/*
            Two charts, and deliberately not three.

            Reference W1 shows a school-growth LINE chart beside the health donut. There
            is no time series behind it: `platform_metrics()` returns current counts, not
            a month-by-month history. Drawing that line would mean inventing ten months of
            data, which §7 of the brief forbids and which would be read as fact.

            So the growth chart is omitted until a history exists, and the two charts here
            are both fed from data the API already returns: the health bands from
            `school_health_scores()`, and the tier split from `admin_revenue_by_tier()`.
          */}

          <section aria-labelledby="figures">
            <h2 id="figures" className="sr-only">
              Platform figures
            </h2>

            <div className="grid grid-cols-2 gap-cards lg:grid-cols-3">
              <StatCard
                label="Schools"
                href="/admin/schools"
                hrefLabel="All schools"
                value={String(data.metrics?.schools_total ?? 0)}
                hint={`${data.metrics?.schools_active ?? 0} active · ${data.metrics?.schools_trial ?? 0} on trial`}
                tone="neutral"
                icon={<Building2 />}
              />
              <StatCard
                label="Needs attention"
                href="/admin/health"
                hrefLabel="School health"
                value={String(data.atRisk)}
                hint="at risk or critical"
                // The one figure allowed to be alarming, and only when it is
                // non-zero — a permanently red card stops being read.
                tone={data.atRisk > 0 ? 'danger' : 'success'}
                icon={<HeartPulse />}
              />
              <StatCard
                label="Students enrolled"
                href="/admin/schools"
                hrefLabel="By school"
                value={(data.metrics?.students_total ?? 0).toLocaleString('en-ZM')}
                hint={`${data.metrics?.staff_total ?? 0} staff`}
                tone="info"
                icon={<Users />}
              />
              <StatCard
                label="Collected this month"
                href="/admin/billing"
                hrefLabel="Billing"
                value={formatKwacha(data.metrics?.collected_this_month)}
                hint="verified payments only"
                tone="success"
                icon={<Wallet />}
              />
              <StatCard
                label="In arrears"
                href="/admin/health"
                hrefLabel="Who is behind"
                value={formatKwacha(data.metrics?.arrears_total)}
                hint={`of ${formatKwacha(data.metrics?.outstanding_total)} outstanding`}
                tone="warning"
                icon={<CalendarClock />}
              />
              <StatCard
                label="Awaiting verification"
                href="/admin/schools"
                hrefLabel="By school"
                value={String(data.metrics?.payments_pending ?? 0)}
                hint="payments recorded, not yet confirmed"
                tone={((data.metrics?.payments_pending ?? 0) > 0 ? 'primary' : 'neutral') as StatTone}
                icon={<ReceiptText />}
              />
            </div>

            <p className="mt-3 text-sm text-muted-foreground">
              &ldquo;Collected&rdquo; counts verified payments only. A payment that has been recorded
              but not confirmed is a claim, not money.
            </p>
          </section>

          {/*
            School growth (reference W1).

            This is the chart I would not draw before: `platform_metrics()` returns
            current counts, so a line through them would have been invented. `0267`
            records a daily snapshot, and this shows only days that were actually
            captured — no gap filling, because a line through interpolated points looks
            exactly like a line through measured ones.
          */}
          <section aria-labelledby="growth" className="mb-cards">
            <h2 id="growth" className="sr-only">
              Platform growth
            </h2>

            <ChartFrame
              title="School growth"
              description={
                growth.points.length > 0
                  ? `Total and active schools, ${growth.span}`
                  : 'Total and active schools over time'
              }
              action={
                /*
                  A range control, not a date picker.

                  The image shows "1 Oct - 31 Oct 2026". Arbitrary ranges would imply
                  the data supports any window; it supports whatever has been captured,
                  which today is days rather than years. Three coarse choices say that
                  honestly and cannot produce an empty chart by accident.
                */
                <Select
                  value={String(range)}
                  onChange={(e) => setRange(Number(e.target.value))}
                  aria-label="Period shown"
                  className="w-auto"
                >
                  <option value="90">Last 3 months</option>
                  <option value="180">Last 6 months</option>
                  <option value="365">Last 12 months</option>
                </Select>
              }
            >
              <TrendChart
                labels={growth.labels}
                series={growth.points}
                emptyMessage={
                  /*
                    Two different absences, said differently. Nothing recorded at all is
                    a worker that has not run; one point is a worker that has run once,
                    and a single point is not a trend.
                  */
                  (data.history?.length ?? 0) === 0
                    ? 'No history has been recorded yet. The daily snapshot runs at 01:30 and the line appears once there are two days to join.'
                    : 'Only one day has been recorded so far. A second will make a line.'
                }
              />
            </ChartFrame>
          </section>

          <section aria-labelledby="breakdown" className="mb-cards">
            <h2 id="breakdown" className="sr-only">
              Platform breakdown
            </h2>

            <div className="grid gap-cards lg:grid-cols-2">
              <ChartFrame
                title="Schools by health score"
                description="Operational, financial and engagement, combined"
                action={
                  <SectionLink href="/admin/health" ariaLabel="View all school health scores">
                    View all
                  </SectionLink>
                }
              >
                <DonutChart
                  centreValue={String(data.health.length)}
                  centreLabel={data.health.length === 1 ? 'School' : 'Schools'}
                  emptyMessage="No school has enough data to score yet."
                  slices={BAND_ORDER.map((band) => ({
                    label: BAND_LABEL[band],
                    value: data.health.filter((r) => r.band === band).length,
                    /*
                      Fixed colours, not the series palette: these are STATUS bands with
                      settled meanings, and excellent must be green on every screen that
                      shows it rather than green only when it happens to sort first.
                    */
                    colour: BAND_COLOUR[band],
                  })).filter((sl) => sl.value > 0)}
                />
              </ChartFrame>

              <ChartFrame
                title="Monthly revenue by tier"
                description="Where recurring revenue actually comes from"
                action={
                  <SectionLink href="/admin/pricing" ariaLabel="Open pricing and tiers">
                    Pricing
                  </SectionLink>
                }
              >
                <BarChart
                  emptyMessage="No school is on a paid tier yet."
                  data={(data.revenueByTier ?? [])
                    .filter((t) => Number(t.mrr_zmw) > 0)
                    .map((t) => ({
                      label: t.display_name,
                      value: Math.round(Number(t.mrr_zmw)),
                    }))}
                />
              </ChartFrame>
            </div>
          </section>

          {/*
            Recent activity (reference W1).

            `audit_logs` has held this all along; what was missing was a sentence.
            `recent_activity()` (`0268`) maps a row to one, and excludes the reader's
            own actions — a feed telling you what you just did is a receipt, not news.
          */}
          <section aria-labelledby="activity" className="mb-cards">
            <h2 id="activity" className="sr-only">
              Recent activity
            </h2>
            <RailPanel
              title="Recent activity"
              action={<SectionLink href="/admin/audit">Full audit trail</SectionLink>}
            >
              <ActivityFeed limit={6} />
            </RailPanel>
          </section>

          <section aria-labelledby="attention">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="attention" className="text-xl font-semibold tracking-tight">
                Schools needing attention
              </h2>
              <SectionLink href="/admin/health">Full health breakdown</SectionLink>
            </div>

            {data.health.filter((h) => h.band === 'at_risk' || h.band === 'critical').length === 0 ? (
              <EmptyState
                icon={HeartPulse}
                title="No school is currently at risk"
                description="Every school scores 65 or above. This list fills as engagement drops, not as schools are added."
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Ranked by composite score, lowest first</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <caption className="sr-only">
                        Schools scoring below 65, ordered by composite health score
                      </caption>
                      <thead className="border-y border-border bg-sunken text-left">
                        <tr>
                          <th scope="col" className="px-4 py-2.5 font-medium">School</th>
                          <th scope="col" className="px-4 py-2.5 text-right font-medium">Pupils</th>
                          <th scope="col" className="px-4 py-2.5 text-right font-medium">Score</th>
                          <th scope="col" className="px-4 py-2.5 font-medium">Standing</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.health
                          .filter((h) => h.band === 'at_risk' || h.band === 'critical')
                          .slice(0, 8)
                          .map((row) => (
                            <tr key={row.school_id} className="border-b border-border last:border-0">
                              <th scope="row" className="px-4 py-3 text-left font-normal">
                                <Link
                                  href={`/admin/schools/${row.school_id}`}
                                  className="font-medium text-foreground hover:underline"
                                >
                                  {row.school_name}
                                </Link>
                                <span className="block font-mono text-xs text-subtle">
                                  {row.school_code}
                                </span>
                              </th>
                              <td data-numeric className="px-4 py-3 text-right">
                                {row.students}
                              </td>
                              <td data-numeric className="px-4 py-3 text-right font-medium">
                                {row.composite_score}
                              </td>
                              <td className="px-4 py-3">
                                <HealthBadge band={row.band} />
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {data.health.some((h) => h.inputs_available < h.inputs_total) && (
              <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-fill" />
                <span>
                  Scores are provisional: {data.health[0]?.inputs_available} of{' '}
                  {data.health[0]?.inputs_total} documented inputs are computable. Teacher login
                  activity and parent app usage need telemetry this schema does not yet collect.
                </span>
              </p>
            )}
          </section>
        </div>
      )}
    </>
  )
}
