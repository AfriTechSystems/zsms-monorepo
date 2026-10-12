'use client'

/**
 * The bulk action bar.
 *
 * Spec: reference images W2, W5 and W6, all of which show checkboxes beside rows.
 *
 * ## Why it is a bar and not a toolbar above the table
 *
 * It appears only when something is selected, pinned to the bottom of the viewport.
 * A permanently visible toolbar with greyed-out buttons takes space on every visit to
 * answer a question nobody asked yet; a bar that arrives on selection is impossible
 * to miss and costs nothing the rest of the time.
 *
 * Bottom rather than top because on a phone the top of a long list is scrolled away
 * by the time a reader has chosen the rows they want.
 *
 * ## It always says how many, and always offers a way out
 *
 * The count is the whole point — a bar reading "Message parents" with no number is how
 * somebody messages 400 people meaning to message 4. And `Clear` is a button, not a
 * trick with the header checkbox: undoing a selection should not require working out
 * which box controls what.
 */

import type { JSX, ReactNode } from 'react'

import { Button } from './button'

export function BulkBar({
  count,
  noun,
  onClear,
  children,
}: {
  count: number
  /** Singular; pluralised with a trailing "s". */
  noun: string
  onClear: () => void
  /** The actions. Buttons, so a reader can tell them from the count. */
  children: ReactNode
}): JSX.Element | null {
  if (count === 0) return null

  return (
    /*
      `sticky bottom-0` inside the page flow rather than `fixed`.

      Fixed positioning would float the bar over a sidebar on desktop and over the
      parent portal's bottom tab bar on a phone, covering navigation the reader needs
      in order to leave.
    */
    <div
      role="region"
      aria-label={`${count} ${noun}${count === 1 ? '' : 's'} selected`}
      className="sticky bottom-0 z-20 -mx-4 mt-cards border-t border-border bg-surface/95 px-4 py-3 shadow-lg backdrop-blur sm:mx-0 sm:rounded-lg sm:border"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-medium">
          <span data-numeric>{count}</span> {noun}
          {count === 1 ? '' : 's'} selected
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {children}
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        </div>
      </div>
    </div>
  )
}
