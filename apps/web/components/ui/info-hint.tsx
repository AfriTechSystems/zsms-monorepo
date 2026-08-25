'use client'

/**
 * A small "what is this?" explainer attached to a heading, a field, or an action.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md` → Explainers
 *
 * ## It does not float on a phone, and that is the whole design
 *
 * The obvious implementation is a tooltip: absolutely positioned, appears on
 * hover. It fails twice on the device this portal is most used on. A phone has
 * no hover at all, so the explainer is simply unreachable; and an absolutely
 * positioned bubble near the right-hand edge of a 390px screen is clipped by the
 * viewport — the exact "popups cut off" problem this component exists to avoid
 * rather than reproduce.
 *
 * So it behaves differently by width, on purpose:
 *
 *   - **Below `sm`** the explainer opens **inline**, pushing content down. It
 *     cannot be clipped because it is in normal flow, and it is opened by a tap
 *     because that is the only input available.
 *   - **From `sm` up** it is a positioned panel that also appears on hover and
 *     focus, where there is room for one and a pointer to summon it.
 *
 * Both are the same element with the same text and the same `aria-describedby`,
 * so a screen reader gets one consistent thing.
 *
 * ## Why a button and not a `title` attribute
 *
 * `title` is invisible to touch, unstyleable, appears after an arbitrary delay,
 * and is skipped by several screen readers. It looks like the cheap answer and
 * is really no answer. A real `<button>` is focusable, announces its state, and
 * works with a thumb.
 */

import type { JSX, ReactNode } from 'react'
import { useId, useState } from 'react'
import { ChevronDown, Info } from 'lucide-react'

import { cn } from '../../lib/utils'

export function InfoHint({
  label,
  children,
  className,
}: {
  /** What the explainer is about, for the button's accessible name. */
  label: string
  /** The explanation. Plain sentences — this is read while someone is stuck. */
  children: ReactNode
  className?: string
}): JSX.Element {
  const id = useId()
  const [open, setOpen] = useState(false)

  return (
    <span className={cn('relative inline-flex align-middle', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        // Hover and focus only take effect where the panel is positioned, i.e.
        // `sm` and up. Below that the panel is inline and toggled by the tap
        // above, so opening it on focus would make it flicker during keyboard
        // navigation on a small screen.
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-full',
          'text-muted-foreground transition-colors hover:bg-sunken hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <Info aria-hidden="true" className="size-4" />
        <span className="sr-only">About {label}</span>
      </button>

      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            // Inline on a phone: normal flow, full width, cannot be clipped.
            'absolute left-0 top-full z-40 mt-1 block w-[min(18rem,calc(100vw-2rem))]',
            'rounded-lg border border-border bg-popover p-3 text-sm font-normal',
            'text-popover-foreground shadow-md',
            // Anchored left by default; near the right edge that would overflow,
            // so on wider screens it is allowed to hang either way.
            'sm:w-72',
          )}
        >
          {children}
        </span>
      )}
    </span>
  )
}

/**
 * A page-level explainer: what this screen is for, and what changes here affect.
 *
 * ## Collapsed by default, and that is a correction
 *
 * The first version rendered the note as a permanently visible block under the
 * heading. On a laptop that is fine. On a 390px screen a three-line paragraph
 * costs roughly a fifth of the viewport on **every** screen, forever — and it is
 * read once. Something worth reading once should not be charged for on every
 * visit.
 *
 * So it is a disclosure: one compact line that costs a single row, expanding on
 * demand. `<details>`/`<summary>` rather than React state, because the browser
 * gives the open/closed semantics, keyboard handling and screen-reader
 * announcement for free, and it still works before hydration.
 *
 * It starts closed at every width rather than opening itself on a laptop. The
 * argument for collapsing applies to a returning user on any screen, and one
 * behaviour is easier to learn than two.
 */
export function PageNote({
  children,
  label = 'About this page',
  className,
}: {
  children: ReactNode
  /** The summary line. Name the screen when a page has more than one note. */
  label?: string
  className?: string
}): JSX.Element {
  return (
    <details
      className={cn(
        'group mb-cards rounded-lg border border-border bg-sunken text-sm text-muted-foreground',
        className,
      )}
    >
      <summary
        className={cn(
          'flex min-h-tap cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium',
          'transition-colors hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          // Safari renders a disclosure triangle on `summary` regardless of
          // `list-none`; this removes it so the chevron below is the only marker.
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <Info aria-hidden="true" className="size-4 shrink-0" />
        <span className="flex-1">{label}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <p className="px-3 pb-3 pl-9">{children}</p>
    </details>
  )
}
