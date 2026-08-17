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
  ReceiptText,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-react'

import { useApi } from '../../lib/use-api'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { EmptyState } from '../../components/ui/empty-state'
import { ErrorState, PageHeader, StatSkeleton, TableSkeleton } from '../../components/ui/data-states'
import { StatCard, type StatTone } from '../../components/ui/stat-card'
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

interface Overview {
  metrics: Metrics | null
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

      {loading && !error && (
        <div className="space-y-cards">
          <StatSkeleton count={6} />
          <TableSkeleton rows={5} columns={4} />
        </div>
      )}

      {!loading && !error && data && (
        <div className="space-y-section">
          <section aria-labelledby="figures">
            <h2 id="figures" className="sr-only">
              Platform figures
            </h2>

            <div className="grid gap-cards sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Schools"
                value={String(data.metrics?.schools_total ?? 0)}
                hint={`${data.metrics?.schools_active ?? 0} active · ${data.metrics?.schools_trial ?? 0} on trial`}
                tone="neutral"
                icon={<Building2 />}
              />
              <StatCard
                label="Needs attention"
                value={String(data.atRisk)}
                hint="at risk or critical"
                // The one figure allowed to be alarming, and only when it is
                // non-zero — a permanently red card stops being read.
                tone={data.atRisk > 0 ? 'danger' : 'success'}
                icon={<HeartPulse />}
              />
              <StatCard
                label="Students enrolled"
                value={(data.metrics?.students_total ?? 0).toLocaleString('en-ZM')}
                hint={`${data.metrics?.staff_total ?? 0} staff`}
                tone="info"
                icon={<Users />}
              />
              <StatCard
                label="Collected this month"
                value={formatKwacha(data.metrics?.collected_this_month)}
                hint="verified payments only"
                tone="success"
                icon={<Wallet />}
              />
              <StatCard
                label="In arrears"
                value={formatKwacha(data.metrics?.arrears_total)}
                hint={`of ${formatKwacha(data.metrics?.outstanding_total)} outstanding`}
                tone="warning"
                icon={<CalendarClock />}
              />
              <StatCard
                label="Awaiting verification"
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

          <section aria-labelledby="attention">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="attention" className="text-xl font-semibold tracking-tight">
                Schools needing attention
              </h2>
              <Link href="/admin/health" className="text-sm text-primary-text hover:underline">
                Full health breakdown
              </Link>
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
