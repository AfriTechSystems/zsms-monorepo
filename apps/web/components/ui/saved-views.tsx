'use client'

/**
 * Saved filter views, as chips above a list.
 *
 * Spec: reference image W2; migration `0269`.
 *
 * ## A view is a name for FILTERS, never for rows
 *
 * Opening one applies its filters and the list resolves fresh. So a pupil who leaves
 * the roll leaves the view, and "Year 7 boarders" keeps meaning what it says. Saving
 * a list of ids instead would quietly turn into a record of who matched on the day
 * somebody pressed the button.
 *
 * ## Shared within the school, by decision
 *
 * "Fees overdue" is the same question whoever asks it. Per-user views mean four
 * people in one office build the same filter and none of them agrees on what it
 * means. The creator is recorded for attribution and for who may delete, not to
 * restrict who can see.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { Bookmark, BookmarkPlus, X } from 'lucide-react'

import { Button } from './button'
import { useToast } from './toast'

interface View {
  id: string
  name: string
  filters: Record<string, string>
  created_by: string
}

export function SavedViews({
  surface,
  current,
  onApply,
  canSave,
}: {
  /** Which screen's views these are. */
  surface: 'students' | 'staff' | 'fees' | 'results'
  /** The filters in hand, as the screen spells them in its query string. */
  current: Record<string, string>
  onApply: (filters: Record<string, string>) => void
  canSave: boolean
}): JSX.Element | null {
  const [views, setViews] = useState<View[] | null>(null)
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/school/saved-views?surface=${surface}`)
      if (!response.ok) {
        // Null keeps the row absent entirely. A broken views strip above a working
        // list should not make the list look broken.
        setViews(null)
        return
      }
      const body = await response.json()
      setViews(body.data?.views ?? [])
    } catch {
      setViews(null)
    }
  }, [surface])

  useEffect(() => {
    void load()
  }, [load])

  // Anything worth saving? An empty filter set is the unfiltered list, which already
  // has a name: the screen's own.
  const hasFilters = Object.values(current).some((v) => v && v.trim().length > 0)

  const save = async (): Promise<void> => {
    if (!name.trim()) return
    setBusy(true)
    try {
      const response = await fetch('/api/school/saved-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ surface, name: name.trim(), filters: current }),
      })
      const body = await response.json()
      if (!response.ok) {
        toast(body.error ?? 'That view could not be saved.', 'danger')
        return
      }
      toast(`"${name.trim()}" saved.`, 'success')
      setName('')
      setNaming(false)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (v: View): Promise<void> => {
    const response = await fetch(`/api/school/saved-views?id=${v.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      toast(body?.error ?? 'That view could not be removed.', 'danger')
      return
    }
    toast(`"${v.name}" removed.`, 'success')
    await load()
  }

  // Nothing saved and nothing to save: no strip at all, rather than an empty row
  // with a heading explaining a feature nobody has used yet.
  if ((views === null || views.length === 0) && !hasFilters) return null

  return (
    <div className="mb-stack flex flex-wrap items-center gap-2">
      {(views ?? []).map((v) => (
        <span
          key={v.id}
          className="inline-flex items-center overflow-hidden rounded-full border border-border bg-surface"
        >
          <button
            type="button"
            onClick={() => onApply(v.filters)}
            className="inline-flex min-h-tap items-center gap-1.5 py-1 pl-3 pr-2 text-sm transition-colors hover:bg-primary-tint"
          >
            <Bookmark aria-hidden="true" className="size-3.5 text-muted-foreground" />
            {v.name}
          </button>
          {/*
            Removing is offered to everybody and refused by the policy where it should
            be — only the creator or the owner. A hidden control would need this
            screen to know the rule too, which is a second copy that drifts; the
            refusal says so plainly instead.
          */}
          <button
            type="button"
            onClick={() => void remove(v)}
            aria-label={`Remove the view ${v.name}`}
            className="inline-flex min-h-tap items-center pr-2.5 text-muted-foreground transition-colors hover:text-danger-text"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      ))}

      {canSave && hasFilters && !naming && (
        <Button variant="ghost" size="sm" onClick={() => setNaming(true)}>
          <BookmarkPlus aria-hidden="true" className="size-4" />
          Save these filters
        </Button>
      )}

      {naming && (
        <span className="inline-flex items-center gap-1.5">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
              if (e.key === 'Escape') setNaming(false)
            }}
            maxLength={60}
            placeholder="Name this view"
            aria-label="Name this view"
            className="h-9 rounded-md border border-border bg-surface px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button size="sm" onClick={() => void save()} disabled={busy || !name.trim()}>
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setNaming(false)}>
            Cancel
          </Button>
        </span>
      )}
    </div>
  )
}
