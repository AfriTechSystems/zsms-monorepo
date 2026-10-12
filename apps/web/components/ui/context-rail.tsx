/**
 * The right-hand column that carries context rather than content.
 *
 * Spec: reference images W2 (students list), W3 (student record), W5 (results),
 *       W6 (attendance) — all four put a narrow column of supporting panels beside
 *       the main one.
 *
 * ## What belongs in it, and what must never
 *
 * The rail holds things that help you read the main column: a summary of what is on
 * screen, a distribution, recent activity, shortcuts to places you were going anyway.
 *
 * **It must never hold the only route to something.** It is the first thing that
 * disappears below `xl`, so an action available only here is an action a phone cannot
 * reach. Every shortcut in a rail points somewhere the main navigation also reaches.
 *
 * ## Why a component rather than a `grid-cols-3` per screen
 *
 * Four screens want the same geometry, the same stacking behaviour and the same
 * breakpoint. Written per screen, those three would drift — and the one that drifts is
 * usually the breakpoint, which is invisible until somebody opens a laptop at 1280.
 */

import type { JSX, ReactNode } from 'react'

import { cn } from '../../lib/utils'

export interface WithRailProps {
  children: ReactNode
  rail: ReactNode
  /**
   * `lg` for a sparse rail that can afford the room early; `xl` for a dense main
   * column — a mark sheet or a register — that needs the width longer.
   */
  from?: 'lg' | 'xl'
  className?: string
}

/**
 * Main column plus rail.
 *
 * Below the breakpoint the rail does not vanish — it **stacks underneath**. Hiding it
 * on a phone would make a summary that exists on a laptop simply absent on a phone,
 * and a head teacher checking attendance on the way to assembly would be the one who
 * lost it.
 */
export function WithRail({ children, rail, from = 'xl', className }: WithRailProps): JSX.Element {
  return (
    <div
      className={cn(
        'grid gap-cards',
        from === 'lg' ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : 'xl:grid-cols-[minmax(0,1fr)_340px]',
        className,
      )}
    >
      {/* `min-w-0` or a wide table inside will push the rail off the screen rather
          than scrolling within its own column. */}
      <div className="min-w-0">{children}</div>

      <aside
        aria-label="Related information"
        className={cn(
          'min-w-0 space-y-cards',
          // Sticky only where there is room for it to be useful. A sticky rail on a
          // short viewport covers the content it is meant to support.
          from === 'lg' ? 'lg:sticky lg:top-20 lg:self-start' : 'xl:sticky xl:top-20 xl:self-start',
        )}
      >
        {rail}
      </aside>
    </div>
  )
}

export interface RailPanelProps {
  title: string
  /** A `SectionLink` or similar. Optional: most panels are read-only. */
  action?: ReactNode
  children: ReactNode
}

/** One panel inside the rail, so they all sit the same way. */
export function RailPanel({ title, action, children }: RailPanelProps): JSX.Element {
  return (
    <section className="rounded-lg border border-border bg-surface p-card">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export interface RailStat {
  label: string
  value: string
  /** A token class — `bg-primary-fill`, `bg-success-fill`. Omit for no marker. */
  colour?: string
  /** 0–100. Draws a proportion bar under the row, as the references do. */
  percent?: number
}

/**
 * A labelled list of figures — the class distribution and grade breakdown shapes the
 * references use in the rail.
 *
 * Deliberately not a chart. At six rows a bar chart is harder to read than six
 * right-aligned numbers, and it cannot show the label, the count and the share at once.
 */
export function RailStats({ stats }: { stats: RailStat[] }): JSX.Element {
  if (stats.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing to show yet.</p>
  }

  return (
    <ul className="space-y-2">
      {stats.map((s) => (
        <li key={s.label} className="text-sm">
          <div className="flex items-center gap-2">
            {s.colour ? (
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full', s.colour)} />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{s.label}</span>
            <span data-numeric className="font-medium">
              {s.value}
            </span>
          </div>
          {typeof s.percent === 'number' && (
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-sunken">
              <div
                className={cn('h-full rounded-full', s.colour ?? 'bg-primary-fill')}
                style={{ width: `${Math.min(Math.max(s.percent, 0), 100)}%` }}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
