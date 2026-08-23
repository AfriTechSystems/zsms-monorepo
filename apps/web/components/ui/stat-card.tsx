/**
 * Stat card — the soft-tint "chip".
 *
 * A pale tinted panel carrying one number, its label, and an icon. It is the
 * unit a dashboard is built from, and the reason the whole palette is expressed
 * as tint / fill / text triples rather than as flat brand colours.
 *
 * **Why a tint rather than a saturated block.** A row of six saturated cards
 * competes with the data underneath it: every card shouts equally, so none of
 * them signals anything. A row of pale tints reads as a set — calm at a glance,
 * distinguishable when looked at — and leaves saturation available for the one
 * thing on the page that genuinely needs attention. It is also the difference
 * between an interface that looks designed and one that looks like a palette
 * applied to boxes.
 *
 * **The tone is a meaning, not a colour.** `success` is paid, `warning` is due
 * soon, `danger` is overdue — the same mapping as everywhere else in the
 * product. `neutral` is the lavender-grey chip, for counts that carry no
 * judgement (students enrolled, staff on roll); `primary` and `info` are for
 * figures that are notable without being good or bad.
 *
 * Every tone's text and icon are contrast-audited against its own tint in
 * `auditTheme()`, which is what lets a tint be this pale safely.
 */

import type { JSX, ReactNode } from 'react'

import { cn } from '../../lib/utils'

export type StatTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'

const TONE: Record<StatTone, { panel: string; label: string; mark: string }> = {
  neutral: { panel: 'bg-neutral-tint', label: 'text-neutral-text', mark: 'text-neutral-fill' },
  primary: { panel: 'bg-primary-tint', label: 'text-primary-text', mark: 'text-primary-fill' },
  success: { panel: 'bg-success-tint', label: 'text-success-text', mark: 'text-success-fill' },
  warning: { panel: 'bg-warning-tint', label: 'text-warning-text', mark: 'text-warning-fill' },
  danger: { panel: 'bg-danger-tint', label: 'text-danger-text', mark: 'text-danger-fill' },
  info: { panel: 'bg-accent-tint', label: 'text-accent-text', mark: 'text-accent-fill' },
}

export interface StatCardProps {
  label: string
  value: string
  /** Context under the figure — a period, a comparison, a count. */
  hint?: string
  tone?: StatTone
  /** A Lucide icon. Decorative: the label already carries the meaning. */
  icon?: ReactNode
  className?: string
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  className,
}: StatCardProps): JSX.Element {
  const t = TONE[tone]

  return (
    <div className={cn('rounded-xl p-4', t.panel, className)}>
      <div className="flex items-start justify-between gap-3">
        <p className={cn('text-sm font-medium', t.label)}>{label}</p>
        {icon && (
          // Drawn directly in the derived `fill` step, which is guaranteed 3:1
          // against this exact tint. Two things this deliberately avoids: the
          // raw brand hue, which puts an amber icon on pale amber at 1.80:1;
          // and a saturated filled square behind a white glyph, which fails in
          // dark mode where the marks are lightened rather than darkened.
          <span className={cn('shrink-0 [&_svg]:size-5', t.mark)} aria-hidden="true">
            {icon}
          </span>
        )}
      </div>

      {/* Tabular figures so a row of stat cards aligns rather than jitters. */}
      <p data-numeric className={cn('mt-2 text-3xl font-semibold tracking-tight', t.label)}>
        {value}
      </p>

      {hint && <p className={cn('mt-1 text-sm opacity-80', t.label)}>{hint}</p>}
    </div>
  )
}
