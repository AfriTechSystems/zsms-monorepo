'use client'

/**
 * "You have an unsaved draft" — offered, never applied silently.
 *
 * ## Why restoring is a choice rather than automatic
 *
 * Silently refilling a form is worse than it sounds. Somebody who abandoned a draft deliberately
 * comes back, starts typing, and submits something half-old without noticing — and on an
 * announcement that reaches every parent in a school, that is a real mistake rather than an
 * inconvenience. So the draft is offered with its age, and both buttons are explicit.
 *
 * `role="status"` rather than `role="alert"`: it is information, not a problem, and an alert
 * interrupts a screen reader mid-sentence for something that can wait.
 */

import type { JSX } from 'react'
import { RotateCcw, X } from 'lucide-react'

import { Button } from './button'

export function DraftNotice({
  savedAgo,
  onRestore,
  onDiscard,
}: {
  /** Already formatted — "20 minutes ago". */
  savedAgo: string
  onRestore: () => void
  onDiscard: () => void
}): JSX.Element {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-accent bg-accent-tint px-4 py-3"
    >
      <RotateCcw className="size-4 shrink-0 text-accent-text" aria-hidden />
      <p className="flex-1 text-sm text-accent-text">
        You left this unfinished {savedAgo}. Pick up where you stopped?
      </p>
      <div className="flex shrink-0 gap-2">
        <Button size="sm" variant="outline" onClick={onRestore}>
          Restore
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onDiscard}
          aria-label="Discard the saved draft and start fresh"
        >
          <X className="size-4" aria-hidden />
          Start fresh
        </Button>
      </div>
    </div>
  )
}
