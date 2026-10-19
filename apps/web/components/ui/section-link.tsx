/**
 * The way one section points at another.
 *
 * Spec: `19 Design System/ZSMS_UI_REDESIGN_MASTER_PROMPT.md` §4D, and the agreed
 *       principle below.
 *
 * ## The principle this exists to enforce
 *
 * **Navigation that is an ACTION is a button with an arrow. A link inside prose stays
 * a link.**
 *
 * A "View all" beside a panel heading, a "Pricing" that leaves the dashboard, a "See the
 * full checklist" — these are things the reader *does*, offered alongside other things
 * they can do. Rendered as underlined text they read as a footnote, they are smaller
 * than the 44px touch target, and they sit inconsistently beside the real buttons next
 * to them.
 *
 * What stays an ordinary link, deliberately:
 *
 * - **A name in a table cell** that opens its record. The row is the subject; a button
 *   in every row would be a wall of chrome.
 * - **A word inside a sentence** — a consent line pointing at the privacy policy, "set
 *   on the school profile". Promoting these breaks the sentence.
 * - **A card title** that opens the card's subject.
 * - **`tel:` and `mailto:`**, which are not navigation at all.
 *
 * ## Why a component rather than a convention
 *
 * A convention written in a document is re-decided on every screen. This renders the
 * agreed shape — `Button` with `variant="ghost"` or `"outline"`, a trailing
 * `ArrowRight`, the 44px target inherited — so the decision is made once.
 */

import type { JSX } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { Button } from './button'

export interface SectionLinkProps {
  href: string
  children: React.ReactNode
  /**
   * `ghost` for a link beside a panel heading, which should not compete with the
   * panel's content. `outline` when it is the only action in its area and needs an
   * edge to be found.
   */
  variant?: 'ghost' | 'outline'
  /** Overrides the accessible name when the visible text is terse, like "View all". */
  ariaLabel?: string
  className?: string
}

export function SectionLink({
  href,
  children,
  variant = 'ghost',
  ariaLabel,
  className,
}: SectionLinkProps): JSX.Element {
  return (
    <Button asChild size="sm" variant={variant} className={className}>
      <Link href={href} aria-label={ariaLabel}>
        {children}
        {/*
          The arrow is `aria-hidden`: the link already has an accessible name, and
          announcing "arrow right" after it adds nothing. It nudges on hover for the
          same reason the stat card's does — the affordance should feel like it leads
          somewhere.
        */}
        <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </Button>
  )
}
