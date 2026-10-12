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
  /**
   * A period-on-period movement, as a signed percentage.
   *
   * Spec: reference images W1 and W2, where every card carries "+12% vs last month".
   *
   * `null` is meaningful and is NOT zero: it means no prior period exists to compare
   * against. A school in its first month has no trend, and rendering 0% would state
   * that nothing changed — a claim the data does not support.
   */
  trend?: number | null
  /** What the trend is measured against. Required whenever `trend` is a number. */
  trendLabel?: string
  /**
   * Whether a rise is good.
   *
   * Defaults to true. Set false for a figure where up is bad — open incidents,
   * arrears, the onboarding backlog — so the arrow and the colour agree with the
   * meaning rather than with the sign.
   */
  trendUp?: 'good' | 'bad'
  /**
   * A 0-100 completion bar under the figure, for a card that reports progress
   * rather than a quantity (storage used, marks entered, staff seats).
   */
  progress?: number
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
  trend,
  trendLabel,
  trendUp = 'good',
  progress,
  className,
}: StatCardProps): JSX.Element {
  const t = TONE[tone]

  /*
    The arrow follows the SIGN; the colour follows the MEANING.

    A rise in open incidents gets an up arrow and a danger colour, because the number
    did go up and that is bad. Tying the colour to the sign would paint a growing
    backlog green.
  */
  const hasTrend = typeof trend === 'number'
  const rising = hasTrend && trend > 0
  const flat = hasTrend && trend === 0
  const favourable = flat || (trendUp === 'good' ? rising : !rising)

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

      {/*
        Tabular figures so a row of stat cards aligns rather than jitters, and the
        size STEPS DOWN as the figure gets longer.

        A fixed `text-3xl` was wrapping "K 1,284,350.00" onto a second line and
        clipping it — observed on the school dashboard's Outstanding fees card. The
        amounts only grow: a secondary school deals in millions, and a platform-wide
        total for AfriTech reaches billions. A card whose layout depends on the number
        being small is a card that breaks exactly when the school is doing well.

        So the figure is measured and sized to fit rather than assumed to be short.
        The steps are deliberately coarse — three buckets, not a continuous scale —
        because a row of cards whose figures are all slightly different sizes reads as
        sloppy, while a row where one long figure is visibly a step smaller reads as
        considered.
      */}
      <p
        data-numeric
        className={cn(
          'mt-1.5 font-semibold tracking-tight sm:mt-2',
          // Breakpoints chosen against the real worst cases: "K 1,284,350.00" is 14,
          // "248" is 3. Below 9 keeps the generous size the design wants.
          value.length <= 8
            ? 'text-2xl sm:text-3xl'
            : value.length <= 12
              ? 'text-xl sm:text-2xl'
              : 'text-lg sm:text-xl',
          // The last line of defence. If a figure still overruns — an unexpected
          // currency, a longer locale separator — it shrinks rather than clipping,
          // and `break-words` lets it wrap as a last resort instead of overflowing
          // the card and pushing the row sideways.
          'break-words [overflow-wrap:anywhere]',
          t.label,
        )}
        title={value}
      >
        {value}
      </p>

      {/*
        The trend line. Arrow + sign + what it is measured against — three pieces,
        because "+12%" alone does not say since when.
      */}
      {hasTrend && (
        <p className={cn('mt-1 flex flex-wrap items-center gap-1 text-xs sm:text-sm', t.label)}>
          <span
            aria-hidden
            className={cn(
              'inline-flex items-center font-medium',
              favourable ? 'text-success-text' : 'text-danger-text',
            )}
          >
            {flat ? '\u2192' : rising ? '\u2197' : '\u2198'}
          </span>
          <span
            data-numeric
            className={cn('font-medium', favourable ? 'text-success-text' : 'text-danger-text')}
          >
            {trend > 0 ? '+' : ''}
            {trend}%
          </span>
          {trendLabel && <span className="opacity-80">{trendLabel}</span>}
        </p>
      )}

      {/*
        Explicitly absent rather than silently missing. "No comparison yet" is a fact
        a reader can act on; a blank space reads as an oversight.
      */}
      {trend === null && (
        <p className={cn('mt-1 text-xs opacity-70 sm:text-sm', t.label)}>
          No earlier period to compare
        </p>
      )}

      {typeof progress === 'number' && (
        <div className="mt-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-current/15">
            <div
              className="h-full rounded-full bg-current transition-[width]"
              style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
            />
          </div>
        </div>
      )}

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
