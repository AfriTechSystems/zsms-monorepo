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
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

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
  /**
   * Where the figure can be examined.
   *
   * Every overview in the product summarised something and then stopped: six cards on the
   * admin dashboard reported totals with no way through to the records behind them, so the
   * only route to "which schools are at risk" was to know the menu. A summary that cannot be
   * opened makes the reader navigate from the top again.
   *
   * Optional, because some figures genuinely have nowhere to go — a count of something with
   * no screen of its own gets no arrow rather than a link to a page that does not answer it.
   */
  href?: string
  /** Overrides the default "View <label>" screen-reader label on the link. */
  hrefLabel?: string
  className?: string
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
  href,
  hrefLabel,
  className,
}: StatCardProps): JSX.Element {
  const t = TONE[tone]

  const body = (
    // `p-card` rather than a fixed `p-4`: the token already tightens below
    // 480px, and a hardcoded padding is exactly how a row of stat cards ends up
    // taller than the content it summarises on a phone.
    <div className={cn('rounded-xl p-card', t.panel, href ? 'h-full' : className)}>
      <div className="flex items-start justify-between gap-2">
        <p className={cn('text-sm font-medium leading-snug', t.label)}>{label}</p>
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

      {/* Tabular figures so a row of stat cards aligns rather than jitters.
          `text-2xl` on a phone and `text-3xl` from `sm` up: at two cards per row
          on a 390px screen a 3xl figure is what pushes a long one — "K 588,000"
          — onto a second line and makes the card grow. */}
      <p data-numeric className={cn('mt-1.5 text-2xl font-semibold tracking-tight sm:mt-2 sm:text-3xl', t.label)}>
        {value}
      </p>

      {hint && <p className={cn('mt-1 text-xs leading-snug opacity-80 sm:text-sm', t.label)}>{hint}</p>}

      {href && (
        // Not a nested anchor — the whole card is the link when `href` is given, and this is
        // the affordance that says so. `aria-hidden` because the link already has an
        // accessible name; announcing "arrow right" after it adds nothing.
        <span
          aria-hidden="true"
          className={cn('mt-2 flex items-center gap-1 text-xs font-medium sm:text-sm', t.label)}
        >
          {hrefLabel ?? 'View'}
          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      )}
    </div>
  )

  if (!href) return body

  return (
    <Link
      href={href}
      aria-label={hrefLabel ?? `View ${label}`}
      className="group block rounded-xl transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </Link>
  )
}
