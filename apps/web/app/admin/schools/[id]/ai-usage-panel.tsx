'use client'

/**
 * One school's AI usage, for AfriTech.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/PLATFORM_METRICS.md`
 *       `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *
 * ## No teacher is named here, by design
 *
 * The panel shows totals, what is being generated, and how usage is spread across the
 * staff — never who. That was a deliberate narrowing of the original request (2026-09-30):
 * named per-teacher profiles across every customer school need a documented purpose under
 * the Data Protection Act, and nothing in pricing, packaging or roadmap is answered by a
 * name that the distribution does not answer better.
 *
 * The school sees its own staff by name on its own screen. AfriTech is a processor here,
 * not the employer.
 *
 * ## Why the distribution is the most useful block on this panel
 *
 * A school where one teacher generates everything and a school where thirty share it evenly
 * have identical totals and completely different futures. The first loses its AI usage the
 * day that teacher leaves; the second has adopted the product. The bands say which you are
 * looking at, and no individual is identifiable in a count.
 */

import type { JSX } from 'react'
import { Bot, TrendingUp } from 'lucide-react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../../components/ui/card'
import { useApi } from '../../../../lib/use-api'

interface Summary {
  out_credits_purchased: number
  out_credits_spent: number
  out_credits_remaining: number
  out_teachers_assigned: number
  out_teachers_active: number
  out_actions: number
  out_cost_usd: number
  out_from_reserve: number
  out_last_used_at: string | null
}

interface BreakdownRow {
  out_label: string
  out_credits_spent: number
  out_actions: number
  out_cost_usd: number
}

interface BandRow {
  out_band: string
  out_teachers: number
  out_credits: number
}

interface Payload {
  summary: Summary | null
  byFeature: BreakdownRow[]
  bySubject: BreakdownRow[]
  byGrade: BreakdownRow[]
  distribution: BandRow[]
}

export function AiUsagePanel({ schoolId }: { schoolId: string }): JSX.Element | null {
  const { data } = useApi<Payload>(`/api/admin/schools/${schoolId}/ai-usage`)

  const summary = data?.summary
  // A school that has never used AI gets no panel rather than a wall of zeroes.
  if (!summary || summary.out_actions === 0) return null

  const maxBand = Math.max(1, ...(data?.distribution ?? []).map((b) => b.out_teachers))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot aria-hidden="true" className="size-5 text-primary" />
          AI usage
        </CardTitle>
        <CardDescription>
          {/* Said plainly, so nobody goes looking for the names. */}
          Totals and patterns. Individual teachers are not identified here — the school sees
          its own staff on its own screen.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Credits bought" value={summary.out_credits_purchased} />
          <Stat label="Credits used" value={summary.out_credits_spent} />
          <Stat label="Teachers using it" value={summary.out_teachers_active} />
          <Stat
            label="Of teachers given credits"
            value={summary.out_teachers_assigned}
          />
        </dl>

        {/* The cost side. What makes margin measurable rather than hoped for. */}
        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-md bg-muted/40 p-card text-sm">
          <span>
            <span className="text-muted-foreground">Model cost: </span>
            <span data-numeric className="font-semibold">
              ${Number(summary.out_cost_usd ?? 0).toFixed(4)}
            </span>
          </span>
          <span>
            <span className="text-muted-foreground">Items generated: </span>
            <span data-numeric className="font-semibold">{summary.out_actions}</span>
          </span>
          {summary.out_from_reserve > 0 && (
            <span>
              <span className="text-muted-foreground">Drawn from reserve: </span>
              <span data-numeric className="font-semibold">{summary.out_from_reserve}</span>
            </span>
          )}
        </div>

        <Breakdown title="What they generate" rows={data?.byFeature ?? []} />
        <Breakdown title="Subjects" rows={data?.bySubject ?? []} />
        <Breakdown title="Grades" rows={data?.byGrade ?? []} />

        {(data?.distribution ?? []).length > 0 && (
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <TrendingUp aria-hidden="true" className="size-4 text-muted-foreground" />
              How usage is spread
            </h3>
            <p className="mb-3 text-xs text-muted-foreground">
              Teachers grouped by how many credits they have used. One teacher doing
              everything and thirty sharing it evenly look identical in the totals above.
            </p>
            <ul className="flex flex-col gap-1.5">
              {(data?.distribution ?? []).map((band) => (
                <li key={band.out_band} className="flex items-center gap-3 text-sm">
                  <span className="w-16 shrink-0 text-muted-foreground">{band.out_band}</span>
                  <span className="h-4 flex-1 overflow-hidden rounded bg-muted">
                    <span
                      className="block h-full rounded bg-primary"
                      style={{ width: `${(band.out_teachers / maxBand) * 100}%` }}
                    />
                  </span>
                  <span data-numeric className="w-20 shrink-0 text-right">
                    {band.out_teachers} {band.out_teachers === 1 ? 'teacher' : 'teachers'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  )
}

function Breakdown({ title, rows }: { title: string; rows: BreakdownRow[] }): JSX.Element | null {
  if (rows.length === 0) return null
  const max = Math.max(1, ...rows.map((r) => r.out_credits_spent))

  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {rows.slice(0, 8).map((row) => (
          <li key={row.out_label} className="flex items-center gap-3 text-sm">
            <span className="w-32 shrink-0 truncate text-muted-foreground">
              {row.out_label}
            </span>
            <span className="h-4 flex-1 overflow-hidden rounded bg-muted">
              <span
                className="block h-full rounded bg-primary/70"
                style={{ width: `${(row.out_credits_spent / max) * 100}%` }}
              />
            </span>
            <span data-numeric className="w-16 shrink-0 text-right">
              {row.out_credits_spent}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd data-numeric className="text-xl font-semibold">
        {Number(value ?? 0).toLocaleString('en-ZM')}
      </dd>
    </div>
  )
}
