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
import { BarChart, ChartFrame, DonutChart } from '../../components/ui/chart'
import { SectionLink } from '../../components/ui/section-link'
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

interface Overview {
  metrics: Metrics | null
  business: Business | null
  revenueByTier: TierRevenue[]
  health: HealthRow[]
  atRisk: number
}

export default function AdminOverviewPage(): JSX.Element {
  const { data, loading, error, code, reload } = useApi<Overview>('/api/admin/overview')

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
