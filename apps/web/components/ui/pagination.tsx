'use client'

/**
 * Pagination controls for a list screen.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## Why this exists as a component
 *
 * Two screens had pagination — the pupil roll and the admin school list — and both carried their own
 * copy of the same twenty lines. Twenty-eight other list screens had none at all, including the fee
 * register, which grows by one row per pupil per term and is the fastest-growing table in the product.
 * Copying the block a third time would have set the pattern; this is the third time.
 *
 * ## `Showing 26–50 of 431`, not just page numbers
 *
 * A bursar reconciling payments needs to know where they are in a list, not merely which page they are
 * on. The range answers "have I done these yet" in a way that "page 2" does not.
 *
 * ## Page numbers are a window, not the whole set
 *
 * A school with 4,000 pupils has 160 pages. Rendering 160 links is unusable on a laptop and impossible
 * on a phone, so this shows first, last, and a short run around the current page, with gaps marked. The
 * window is deliberately narrow on small screens — Previous/Next and the range carry the weight there,
 * because a thumb cannot hit a 24px number reliably.
 */

import type { JSX } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { cn } from '../../lib/utils'
import { Button } from './button'

/** `en-ZM` grouping, matching `formatCount` in the school portal. Inlined rather than imported: a
 *  shared primitive reaching into a portal's module would invert the dependency. */
const count = (value: number): string => value.toLocaleString('en-ZM')

/**
 * The page numbers to render, with `null` standing for a gap.
 *
 * Exported for its own test: off-by-one errors here are invisible until a list is long enough to need
 * a gap, which is exactly when nobody is looking.
 */
export function pageWindow(page: number, lastPage: number, span = 1): (number | null)[] {
  if (lastPage <= 1) return [1]

  const pages = new Set<number>([1, lastPage])
  for (let p = page - span; p <= page + span; p += 1) {
    if (p >= 1 && p <= lastPage) pages.add(p)
  }

  const sorted = [...pages].sort((a, b) => a - b)
  const withGaps: (number | null)[] = []

  // Bound locally rather than indexed twice: `noUncheckedIndexedAccess` is on, so `sorted[i]` is
  // `number | undefined` at every use site.
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i]
    const previous = i > 0 ? sorted[i - 1] : undefined
    if (current === undefined) continue

    if (previous !== undefined) {
      // A gap of exactly one page is silly — render the page instead of an ellipsis that hides it.
      if (current - previous === 2) withGaps.push(current - 1)
      else if (current - previous > 2) withGaps.push(null)
    }
    withGaps.push(current)
  }

  return withGaps
}

export function Pagination({
  page,
  total,
  perPage,
  onPageChange,
  /** What is being counted, for the screen-reader label: "pupils", "invoices". */
  noun = 'records',
  className,
}: {
  page: number
  total: number
  perPage: number
  onPageChange: (page: number) => void
  noun?: string
  className?: string
}): JSX.Element | null {
  const lastPage = Math.max(1, Math.ceil(total / perPage))

  // Nothing to page through. Rendering disabled controls over a six-row list is noise.
  if (total <= perPage) return null

  const first = (page - 1) * perPage + 1
  const last = Math.min(page * perPage, total)

  return (
    <nav
      aria-label={`${noun} pagination`}
      className={cn('mt-cards flex flex-wrap items-center justify-between gap-3', className)}
    >
      <p className="text-sm text-muted-foreground">
        Showing <span data-numeric>{first}</span>–<span data-numeric>{last}</span> of{' '}
        <span data-numeric>{count(total)}</span> {noun}
      </p>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft aria-hidden="true" />
          <span className="hidden sm:inline">Previous</span>
        </Button>

        {/* Hidden below `sm`: see the header comment on tap targets. */}
        <ol className="hidden items-center gap-1 sm:flex">
          {pageWindow(page, lastPage).map((p, i) =>
            p === null ? (
              <li
                key={`gap-${i}`}
                aria-hidden="true"
                className="px-1 text-sm text-muted-foreground"
              >
                &hellip;
              </li>
            ) : (
              <li key={p}>
                <button
                  type="button"
                  onClick={() => onPageChange(p)}
                  aria-current={p === page ? 'page' : undefined}
                  aria-label={`Page ${p}`}
                  className={cn(
                    'inline-flex size-9 items-center justify-center rounded-md text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    p === page
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span data-numeric>{p}</span>
                </button>
              </li>
            ),
          )}
        </ol>

        {/* The page indicator the numbers would have given, for the widths that do not show them. */}
        <span className="px-2 text-sm text-muted-foreground sm:hidden">
          <span data-numeric>{page}</span> / <span data-numeric>{lastPage}</span>
        </span>

        <Button
          variant="outline"
          size="sm"
          disabled={page >= lastPage}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  )
}
