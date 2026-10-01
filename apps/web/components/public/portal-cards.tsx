/**
 * The card grid every "choose where you're going" screen uses.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## Fitting on one screen is the whole brief
 *
 * Asked for on 2026-10-01: a visitor must see every option the moment they land, without
 * scrolling, on a phone as much as a laptop. That constraint drives every decision here, and
 * most of them are subtractions.
 *
 * **Four across on a laptop, two-by-two on a phone.** Not `sm:grid-cols-2`, which stacks four
 * cards into two tall rows and pushes the last one below the fold on a 768px laptop. The
 * breakpoints are `grid-cols-2` from the smallest width — two columns even at 360px — then
 * four across at `lg`.
 *
 * **The body copy is hidden below `sm`.** This is the uncomfortable one, and it is deliberate:
 * at 360px, four cards with three lines of explanation each is roughly 900px of content for a
 * 640px viewport. The eyebrow, the title and the button carry the meaning — "Parents / Find a
 * school for my child / Browse" is not improved by a sentence nobody reads while deciding
 * where to tap. The copy is still in the DOM for screen readers and returns at `sm`.
 *
 * ## A button, not an arrow
 *
 * The previous version ended each card with text and a chevron. That reads as decoration
 * rather than a control — people tap the card and hope. Every card now ends in something
 * button-shaped that fills on hover and slides its arrow, and the whole card is still the
 * link, so the obvious gesture works and the affordance is honest about it.
 *
 * `role="presentation"` on the inner span, because the real link is the card: a nested
 * interactive element inside an anchor is invalid, and a `<button>` here would be.
 */

import type { JSX } from 'react'
import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { cn } from '../../lib/utils'

export interface PortalCard {
  href: string
  icon: LucideIcon
  /** Who this is for. Two words at most — it sits above the title in small caps. */
  eyebrow: string
  title: string
  /** Hidden below `sm`. See the header. */
  body: string
  cta: string
  /** Tinted and primary-bordered. Use for the routes most visitors actually want. */
  emphasis?: boolean
}

export function PortalCards({
  cards,
  label,
  /**
   * `four` packs onto one row at `lg`; `two` is for screens with a genuine pair of choices and
   * keeps them side by side from `sm` rather than stacking.
   */
  columns = 'four',
  compact = false,
  className,
}: {
  cards: readonly PortalCard[]
  label: string
  columns?: 'two' | 'four'
  /**
   * Drops the body copy at every width.
   *
   * For cards whose title is already a complete thought — "Register my school", "Open the
   * Teacher Hub" — the sentence underneath is read by nobody choosing between two doors, and
   * on `/welcome` it was ~60px of the overflow that stopped the page fitting at once.
   */
  compact?: boolean
  className?: string
}): JSX.Element {
  return (
    <nav aria-label={label} className={className}>
      <h2 className="sr-only">{label}</h2>
      <ul
        className={cn(
          'grid gap-3 sm:gap-cards',
          // Two columns even at 360px — see the header on why this is not `grid-cols-1`.
          columns === 'four' ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2',
        )}
      >
        {cards.map((card) => (
          <li key={card.href}>
            <Link
              href={card.href}
              className={cn(
                'group flex h-full flex-col gap-1.5 rounded-xl border p-3 transition-all sm:gap-2 sm:p-card',
                'hover:-translate-y-0.5 hover:shadow-lg',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                card.emphasis
                  ? 'border-primary/40 bg-primary/5 hover:border-primary'
                  : 'border-border bg-card hover:border-foreground/30',
              )}
            >
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors sm:size-10',
                  card.emphasis
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary',
                )}
              >
                <card.icon aria-hidden="true" className="size-4 sm:size-5" />
              </span>

              <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                {card.eyebrow}
              </span>

              <span className="text-sm font-semibold leading-snug sm:text-base">{card.title}</span>

              {/* In the DOM for screen readers at every width; visible from `sm` unless the
                  caller asked for compact. */}
              <span className={cn('text-sm text-muted-foreground', compact ? 'sr-only' : 'hidden sm:block')}>
                {card.body}
              </span>

              <span className="mt-auto pt-2">
                <span
                  role="presentation"
                  className={cn(
                    'inline-flex min-h-tap w-full items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors',
                    card.emphasis
                      ? 'bg-primary text-primary-foreground group-hover:bg-primary/90'
                      : 'border border-border bg-background group-hover:border-primary group-hover:bg-primary group-hover:text-primary-foreground',
                  )}
                >
                  {card.cta}
                  <ArrowRight
                    aria-hidden="true"
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
