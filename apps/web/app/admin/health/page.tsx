'use client'

/**
 * School health breakdown.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SCHOOL_HEALTH_SCORES.md`
 *
 * The overview shows *which* schools are struggling. This screen exists to show
 * *why*, because the composite score alone is not actionable: 52 from weak
 * engagement is a training call, and 52 from weak collections is a finance
 * conversation. Showing the three components beside the composite is the whole
 * point of the page — a single number would just be the overview again.
 *
 * Reads `/api/admin/overview`, which already returns every health row. A
 * dedicated endpoint would issue the same `school_health_scores()` call for the
 * same six rows.
 */

import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { HeartPulse, Info } from 'lucide-react'

import { useApi } from '../../../lib/use-api'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { EmptyState } from '../../../components/ui/empty-state'
import { ErrorState, PageHeader, TableSkeleton } from '../../../components/ui/data-states'
import { Field, Select } from '../../../components/ui/field'
import { HealthBadge, StatusBadge, TIER_LABEL, type HealthBand, type HealthRow } from '../health-shared'

interface Overview {
  health: HealthRow[]
}

/**
 * The documented weights. Rendered rather than described, so an operator
 * questioning a score can see what produced it without opening the spec.
 */
const WEIGHTS = [
  { key: 'operational', label: 'Operational', weight: 40, explain: 'Attendance and results actually being recorded' },
  { key: 'financial', label: 'Financial', weight: 30, explain: 'Collection rate against what was invoiced' },
  { key: 'engagement', label: 'Engagement', weight: 30, explain: 'Messages and announcements reaching parents' },
] as const

/**
 * A score as a bar plus its number.
 *
 * The bar is `aria-hidden` and the number carries the value, so a screen reader
 * announces "62" once rather than describing a decorative rectangle. Width is
 * the only thing hue is allowed to duplicate here.
 */
function ScoreBar({ value }: { value: number }): JSX.Element {
  const tone = value >= 80 ? 'bg-success-fill' : value >= 65 ? 'bg-primary' : value >= 45 ? 'bg-warning-fill' : 'bg-danger-fill'

  return (
    <div className="flex items-center justify-end gap-2">
      <div aria-hidden="true" className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-sunken sm:block">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span data-numeric className="w-7 text-right tabular-nums">
        {value}
      </span>
    </div>
  )
}

export default function AdminHealthPage(): JSX.Element {
  const { data, loading, error, code, reload } = useApi<Overview>('/api/admin/overview')
  const [band, setBand] = useState<HealthBand | 'all'>('all')

  const rows = useMemo(() => {
    const all = data?.health ?? []
    // Already ordered lowest-first by the function; filtering preserves that,
    // which is the order an operator works down.
    return band === 'all' ? all : all.filter((r) => r.band === band)
  }, [data, band])

  const provisional = (data?.health ?? []).some((h) => h.inputs_available < h.inputs_total)

  return (
    <>
      <PageHeader
        title="School health"
        description="Why each school scores what it scores. The composite is a weighted blend of three measures, each computed from what the school has actually recorded."
      />

      {error && <ErrorState message={error} code={code} onRetry={reload} />}

      {loading && !error && <TableSkeleton rows={6} columns={6} />}

      {!loading && !error && data && (
        <div className="space-y-cards">
          <Card>
            <CardHeader>
              <CardTitle>How the composite is built</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-stack sm:grid-cols-3">
                {WEIGHTS.map((w) => (
                  <div key={w.key}>
                    <dt className="flex items-baseline gap-2 font-medium">
                      {w.label}
                      <span data-numeric className="text-sm text-muted-foreground">
                        {w.weight}%
                      </span>
                    </dt>
                    <dd className="mt-0.5 text-sm text-muted-foreground">{w.explain}</dd>
                  </div>
                ))}
              </dl>

              {provisional && (
                <p className="mt-stack flex items-start gap-2 rounded-md bg-warning-tint p-3 text-sm text-warning-text">
                  <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Scores are provisional. {data.health[0]?.inputs_available} of{' '}
                    {data.health[0]?.inputs_total} documented inputs are computable today — teacher
                    login frequency and parent app usage need telemetry this schema does not
                    collect. The available inputs are rescaled to 100 rather than the missing ones
                    counting as zero, which would mark every school critical.
                  </span>
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-card">
              <Field
                id="health-band"
                label="Show"
                className="max-w-xs"
                hint="Ordered lowest score first, whichever band is selected"
              >
                {(props) => (
                  <Select
                    {...props}
                    value={band}
                    onChange={(e) => setBand(e.target.value as HealthBand | 'all')}
                  >
                    <option value="all">Every school</option>
                    <option value="critical">Critical only</option>
                    <option value="at_risk">At risk only</option>
                    <option value="good">Good</option>
                    <option value="excellent">Excellent</option>
                  </Select>
                )}
              </Field>
            </CardContent>
          </Card>

          {rows.length === 0 ? (
            <EmptyState
              icon={HeartPulse}
              title="No school is in this band"
              description="Nothing scores in the selected range. Widen the filter to see the full ranking."
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      School health scores, {rows.length} schools, ordered lowest composite first
                    </caption>
                    <thead className="border-b border-border bg-sunken text-left">
                      <tr>
                        <th scope="col" className="px-4 py-2.5 font-medium">School</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-medium">Operational</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-medium">Financial</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-medium">Engagement</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-medium">Composite</th>
                        <th scope="col" className="px-4 py-2.5 font-medium">Standing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.school_id} className="border-b border-border last:border-0">
                          <th scope="row" className="px-4 py-3 text-left font-normal">
                            <Link
                              href={`/admin/schools/${row.school_id}`}
                              className="font-medium text-foreground hover:underline"
                            >
                              {row.school_name}
                            </Link>
                            <span className="mt-0.5 flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs text-subtle">{row.school_code}</span>
                              <StatusBadge status={row.status} />
                              <span className="text-xs text-muted-foreground">
                                {TIER_LABEL[row.subscription_tier] ?? row.subscription_tier} ·{' '}
                                <span data-numeric>{row.students}</span> pupils
                              </span>
                            </span>
                          </th>
                          <td className="px-4 py-3 text-right">
                            <ScoreBar value={row.operational_score} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <ScoreBar value={row.financial_score} />
                          </td>
                          <td className="px-4 py-3 text-right">
                            <ScoreBar value={row.engagement_score} />
                          </td>
                          <td data-numeric className="px-4 py-3 text-right text-base font-semibold">
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
        </div>
      )}
    </>
  )
}
