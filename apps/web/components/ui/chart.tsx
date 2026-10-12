'use client'

/**
 * The chart set: a trend line, a donut, and a bar.
 *
 * Spec: `19 Design System/ZSMS_UI_REDESIGN_MASTER_PROMPT.md` §7
 *       Reference images W1 (admin dashboard), W3 (student profile), W5 (results)
 *
 * ## Inline SVG, not a charting library
 *
 * Three reasons, in order of weight. The master prompt says avoid unnecessary
 * dependencies. The palette has to come from `@zsms/design-tokens` — a library would
 * want its own theme object, which is the duplicate token system the prompt forbids.
 * And every chart in the twelve references is simple enough that the library would be
 * more code than the chart.
 *
 * ## The palette order is not decoration
 *
 * `CHART_SERIES` is validated: brand amber failed the lightness band and reached only
 * 1.97:1 against the surface, so chart amber is a darker step; and green beside any
 * warm hue failed protanopia separation, so the order interleaves cool hues. Assign in
 * order, never cycle. See the comment on `CHART_SERIES`.
 *
 * ## Every chart here needs a legend or a direct label
 *
 * Identity is never carried by colour alone. The donut legend names each slice; the
 * line chart renders a legend above the plot whenever there is more than one series.
 * A single series needs neither — the title names it.
 */

import type { JSX, ReactNode } from 'react'
import { useId, useState } from 'react'
import { CHART_SERIES } from '@zsms/design-tokens'

/** Assign in order; a seventh series folds into "Other" rather than inventing a hue. */
export function seriesColour(index: number): string {
  return CHART_SERIES[index] ?? CHART_SERIES[CHART_SERIES.length - 1]!
}

// ---------------------------------------------------------------------------

function ChartEmpty({ message }: { message: string }): JSX.Element {
  /*
    A chart with no data says so. Rendering an empty axis is worse than rendering
    nothing: it looks like a chart reporting zero, which is a different claim.
  */
  return (
    <div className="flex min-h-[140px] items-center justify-center rounded-md border border-dashed border-border px-4 py-8">
      <p className="text-center text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

export interface ChartFrameProps {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}

/** The shared card around a chart, so every one sits the same way on a dashboard. */
export function ChartFrame({ title, description, action, children }: ChartFrameProps): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-surface p-card">
      <div className="mb-stack flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Trend line
// ---------------------------------------------------------------------------

export interface TrendSeries {
  label: string
  points: number[]
}

export interface TrendChartProps {
  series: TrendSeries[]
  /** One label per point. Thinned automatically when they would collide. */
  labels: string[]
  emptyMessage?: string
  /** Formats the value in the tooltip and on the y-axis. */
  format?: (n: number) => string
}

/**
 * A line chart with an optional soft area fill, a crosshair and a tooltip.
 *
 * Interactive by default: an SVG chart that cannot be interrogated point by point
 * makes the reader estimate from pixels.
 */
export function TrendChart({
  series,
  labels,
  emptyMessage = 'No data for this period yet.',
  format = (n) => String(n),
}: TrendChartProps): JSX.Element {
  const gradientId = useId()
  const [hover, setHover] = useState<number | null>(null)

  const hasData = series.length > 0 && series.some((s) => s.points.length > 0)
  if (!hasData) return <ChartEmpty message={emptyMessage} />

  const W = 640
  const H = 200
  const PAD = { top: 12, right: 12, bottom: 28, left: 40 }
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom

  const count = Math.max(...series.map((s) => s.points.length))
  const all = series.flatMap((s) => s.points)
  const rawMax = Math.max(...all, 0)
  /*
    A tenth of headroom, and never a zero range: a flat series at 0 would divide by
    zero and put every point on the axis.
  */
  const max = rawMax === 0 ? 1 : rawMax * 1.1

  const x = (i: number): number => PAD.left + (count <= 1 ? plotW / 2 : (i / (count - 1)) * plotW)
  const y = (v: number): number => PAD.top + plotH - (v / max) * plotH

  // Four gridlines is enough to read against and few enough to recede.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t))

  // Thin the x labels so they never collide at narrow widths.
  const step = Math.ceil(count / 8)

  return (
    <div>
      {series.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-4">
          {series.map((s, i) => (
            <li key={s.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: seriesColour(i) }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 'auto' }}
        role="img"
        aria-label={`Trend chart: ${series.map((s) => s.label).join(', ')}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={seriesColour(0)} stopOpacity="0.18" />
            <stop offset="100%" stopColor={seriesColour(0)} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive grid — present to measure against, never competing with the data. */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
              stroke="currentColor"
              className="text-border"
              strokeWidth="1"
            />
            <text
              x={PAD.left - 6}
              y={y(t) + 3}
              textAnchor="end"
              className="fill-current text-[9px] text-muted-foreground"
            >
              {format(t)}
            </text>
          </g>
        ))}

        {series.map((s, si) => {
          const colour = seriesColour(si)
          const path = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p)}`).join(' ')
          const area =
            si === 0 && series.length === 1
              ? `${path} L ${x(s.points.length - 1)} ${y(0)} L ${x(0)} ${y(0)} Z`
              : null

          return (
            <g key={s.label}>
              {area ? <path d={area} fill={`url(#${gradientId})`} /> : null}
              <path d={path} fill="none" stroke={colour} strokeWidth="2" strokeLinecap="round" />
              {s.points.map((p, i) => (
                <circle
                  key={i}
                  cx={x(i)}
                  cy={y(p)}
                  r={hover === i ? 4.5 : 3}
                  fill={colour}
                  /* A 2px surface ring, so a marker over the line still reads as a point. */
                  stroke="currentColor"
                  className="text-surface"
                  strokeWidth="2"
                />
              ))}
            </g>
          )
        })}

        {/*
          Hit targets wider than the marks. A 3px dot is not something a mouse finds,
          so each point owns a full-height column.
        */}
        {Array.from({ length: count }).map((_, i) => (
          <rect
            key={i}
            x={x(i) - plotW / Math.max(count - 1, 1) / 2}
            y={PAD.top}
            width={plotW / Math.max(count - 1, 1)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={PAD.top}
            y2={PAD.top + plotH}
            stroke="currentColor"
            className="text-muted-foreground"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}

        {labels.map((l, i) =>
          i % step === 0 ? (
            <text
              key={l + i}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              className="fill-current text-[9px] text-muted-foreground"
            >
              {l}
            </text>
          ) : null,
        )}
      </svg>

      {hover !== null && (
        <div className="mt-2 rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm">
          <span className="font-medium">{labels[hover] ?? ''}</span>
          <span className="ml-3 inline-flex flex-wrap gap-3">
            {series.map((s, i) => (
              <span key={s.label} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: seriesColour(i) }}
                />
                <span className="text-muted-foreground">{s.label}</span>
                <span data-numeric className="font-medium">
                  {format(s.points[hover] ?? 0)}
                </span>
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Donut
// ---------------------------------------------------------------------------

export interface DonutSlice {
  label: string
  value: number
  /** Overrides the series colour — for a status breakdown, which has fixed meanings. */
  colour?: string
}

export interface DonutChartProps {
  slices: DonutSlice[]
  /** Shown in the hole. Usually the total and what it counts. */
  centreValue?: string
  centreLabel?: string
  emptyMessage?: string
}

/**
 * A donut with a legend carrying each slice's value and share.
 *
 * The legend is not optional: a wedge without a label is identity by colour alone,
 * which fails for a reader with CVD and in print.
 */
export function DonutChart({
  slices,
  centreValue,
  centreLabel,
  emptyMessage = 'Nothing to break down yet.',
}: DonutChartProps): JSX.Element {
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  if (slices.length === 0 || total === 0) return <ChartEmpty message={emptyMessage} />

  const SIZE = 180
  const R = 70
  const STROKE = 26
  const C = 2 * Math.PI * R

  let offset = 0

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-[180px] w-[180px] shrink-0"
        role="img"
        aria-label={`Breakdown: ${slices.map((s) => `${s.label} ${s.value}`).join(', ')}`}
      >
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          {slices.map((s, i) => {
            const share = s.value / total
            /*
              A 2px gap between segments, expressed as a shortened dash. Without it
              two adjacent slices of similar lightness read as one.
            */
            const len = Math.max(share * C - 2, 0)
            const el = (
              <circle
                key={s.label}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                stroke={s.colour ?? seriesColour(i)}
                strokeWidth={STROKE}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
              />
            )
            offset += share * C
            return el
          })}
        </g>
        {centreValue ? (
          <>
            <text
              x={SIZE / 2}
              y={SIZE / 2 - 2}
              textAnchor="middle"
              className="fill-current text-[22px] font-semibold"
            >
              {centreValue}
            </text>
            <text
              x={SIZE / 2}
              y={SIZE / 2 + 16}
              textAnchor="middle"
              className="fill-current text-[11px] text-muted-foreground"
            >
              {centreLabel ?? ''}
            </text>
          </>
        ) : null}
      </svg>

      <ul className="min-w-[180px] flex-1 space-y-2">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: s.colour ?? seriesColour(i) }}
            />
            <span className="flex-1">{s.label}</span>
            <span data-numeric className="font-medium">
              {s.value}
            </span>
            <span data-numeric className="w-10 text-right text-muted-foreground">
              {Math.round((s.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bar
// ---------------------------------------------------------------------------

export interface BarDatum {
  label: string
  value: number
  colour?: string
}

export interface BarChartProps {
  data: BarDatum[]
  emptyMessage?: string
  /** Appended to each direct label — '%' for a percentage chart. */
  suffix?: string
}

/**
 * A vertical bar chart with a direct label on every bar.
 *
 * Direct labels rather than a y-axis: with eight or fewer bars the number above the
 * bar is both more precise and less furniture than an axis the reader has to trace.
 */
export function BarChart({ data, emptyMessage = 'No data yet.', suffix = '' }: BarChartProps): JSX.Element {
  if (data.length === 0) return <ChartEmpty message={emptyMessage} />

  const max = Math.max(...data.map((d) => d.value), 1)

  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-1" role="img" aria-label="Bar chart">
      {data.map((d, i) => (
        <div key={d.label} className="flex min-w-[48px] flex-1 flex-col items-center gap-1">
          <span data-numeric className="text-xs font-medium">
            {d.value}
            {suffix}
          </span>
          <div className="flex h-[120px] w-full items-end">
            <div
              /* 4px rounded top, anchored to the baseline — never a floating pill. */
              className="w-full rounded-t"
              style={{
                height: `${Math.max((d.value / max) * 100, 2)}%`,
                backgroundColor: d.colour ?? seriesColour(i),
              }}
            />
          </div>
          <span className="w-full truncate text-center text-[11px] text-muted-foreground" title={d.label}>
            {d.label}
          </span>
        </div>
      ))}
    </div>
  )
}
