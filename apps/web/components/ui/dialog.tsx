'use client'

/**
 * A modal dialog.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## Why `<dialog>` and not a div
 *
 * The native element gives focus trapping, Escape to close, inert background content
 * and the top layer for free — four things a hand-rolled modal gets wrong, usually by
 * leaving a screen-reader user tabbing through the page behind it. The browser's
 * implementation is better than ours would be and does not drift.
 *
 * ## Why a dialog at all, here
 *
 * Asked for on 2026-10-05: the timetable's slot editor appeared BELOW the grid, so
 * choosing a subject meant losing sight of the cell being edited and scrolling back to
 * check. A modal keeps the question and its context on one screen.
 *
 * ## Closing
 *
 * Escape and the backdrop both close, and both route through `onClose` so the caller
 * can clear its own state. A dialog that closes without telling its owner leaves the
 * owner thinking it is still open.
 */

import type { JSX, ReactNode } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { X } from 'lucide-react'

export function Dialog({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  /** Actions. Kept out of the scroll area so they stay reachable on a short screen. */
  footer?: ReactNode
}): JSX.Element | null {
  const ref = useRef<HTMLDialogElement>(null)

  /*
    `showModal()` rather than the `open` attribute.

    Only `showModal()` puts the element in the top layer and makes the rest of the page
    inert; setting `open` renders a dialog that looks modal and is not, which is the
    usual way focus escapes one.
  */
  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  }, [open])

  // The browser closes on Escape by itself; this tells the caller it happened.
  const onCancel = useCallback(
    (e: React.SyntheticEvent<HTMLDialogElement>) => {
      e.preventDefault()
      onClose()
    },
    [onClose],
  )

  if (!open) return null

  return (
    <dialog
      ref={ref}
      onCancel={onCancel}
      onClick={(e) => {
        // The backdrop is the dialog element itself; a click on a child does not
        // reach here with the dialog as its target.
        if (e.target === ref.current) onClose()
      }}
      aria-labelledby="dialog-title"
      className="m-auto w-full max-w-lg rounded-lg border border-border bg-card p-0 text-card-foreground shadow-lg backdrop:bg-black/40"
    >
      <div className="flex items-start justify-between gap-stack border-b border-border p-card">
        <div>
          <h2 id="dialog-title" className="text-lg font-semibold leading-tight">
            {title}
          </h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-m-1 inline-flex min-h-tap min-w-tap items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      {/* Capped so a long form scrolls inside the dialog rather than pushing the
          actions off a laptop screen. */}
      <div className="max-h-[60vh] overflow-y-auto p-card">{children}</div>

      {footer && (
        <div className="flex flex-wrap gap-2 border-t border-border p-card">{footer}</div>
      )}
    </dialog>
  )
}
