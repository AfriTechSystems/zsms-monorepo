'use client'

/**
 * The three states every data screen must render.
 *
 * Extracted because they are the parts that get skipped. A screen that only
 * handles the happy path renders a blank panel when a request fails, which is
 * indistinguishable from "there is nothing here" — and for an operator deciding
 * whether a school has no arrears or whether the arrears query broke, those two
 * answers are not interchangeable.
 */

import type { JSX, ReactNode } from 'react'
import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'

// The error and refresh glyphs come from the canonical registry; ShieldAlert stays
// local because "permission denied" is this component's own concept and appears
// nowhere else — the registry owns what is reused, not every glyph in the app.
import { ICONS } from './icon'

import { Alert } from './alert'
import { Button } from './button'
import { PageNote } from './info-hint'
import { Skeleton } from './skeleton'
import { cn } from '../../lib/utils'

/**
 * A failed request.
 *
 * `FORBIDDEN` is separated from everything else because it is not a failure the
 * user can retry their way out of — offering "Try again" for a permissions
 * problem invites someone to click it ten times and conclude the app is broken.
 */
export function ErrorState({
  message,
  code,
  onRetry,
}: {
  message: string
  code?: string | null
  onRetry?: () => void
}): JSX.Element {
  const forbidden = code === 'FORBIDDEN' || code === 'UNAUTHORIZED'

  return (
    <Alert
      variant={forbidden ? 'warning' : 'danger'}
      title={forbidden ? 'You do not have access to this' : 'Could not load this section'}
    >
      <div className="space-y-3">
        <p className="flex items-start gap-2">
          {/*
            `ICONS.error` is a circled X, and it used to be a warning triangle here.

            That was a real inconsistency rather than a style choice: this branch is the
            `danger` variant, so the Alert's own header already drew a circled X while
            the body beside it drew an amber-shaped warning glyph for the same message.
            Reference sheet 01 section F is explicit — a circled X is Error, a triangle
            is Warning — and the forbidden branch keeps ShieldAlert because "you do not
            have access" is neither.
          */}
          {forbidden ? (
            <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          ) : (
            <ICONS.error aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          )}
          <span>{message}</span>
        </p>

        {forbidden ? (
          <p className="text-sm">
            The admin dashboard requires membership of the{' '}
            <code className="font-mono text-xs">afritech-systems-admin</code> organisation in Clerk.
          </p>
        ) : (
          onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <ICONS.refresh aria-hidden="true" />
              Try again
            </Button>
          )
        )}
      </div>
    </Alert>
  )
}

/** Skeleton rows shaped like the table they replace, so the layout does not jump. */
export function TableSkeleton({ rows = 6, columns = 4 }: { rows?: number; columns?: number }): JSX.Element {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-2">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn('h-10', c === 0 ? 'flex-[2]' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function StatSkeleton({ count = 4 }: { count?: number }): JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="grid grid-cols-2 gap-cards lg:grid-cols-4"
    >
      <span className="sr-only">Loading figures</span>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[92px] rounded-xl sm:h-[104px]" />
      ))}
    </div>
  )
}

/**
 * Page title block. Keeps the h1, its description and the way back consistent.
 *
 * `backTo` renders a labelled link ABOVE the heading rather than a bare arrow
 * beside it. Two reasons. A browser back button is not always the right
 * destination — arriving at a pupil from a search result, from the dashboard, or
 * from a bookmark should all lead back to the roll. And an arrow with no words
 * makes the reader guess where it goes; "All pupils" does not.
 *
 * `note` is the one-paragraph explainer for the screen: what it is for, and what
 * changes here affect. Optional, and worth writing on any screen that changes
 * something a school would notice.
 */
export function PageHeader({
  title,
  description,
  actions,
  backTo,
  backLabel,
  note,
  leading,
}: {
  title: string
  description?: string
  actions?: ReactNode
  /**
   * Something that sits to the LEFT of the heading — a pupil's photo, a school crest.
   *
   * A slot rather than a `photoUrl` prop: the header should not know what an avatar
   * is, who may change one, or how an upload works. The caller already knows all
   * three.
   */
  leading?: ReactNode
  /** Where "back" goes. Always a real destination, never `history.back()`. */
  backTo?: string
  /** What that destination is called. Required whenever `backTo` is given. */
  backLabel?: string
  note?: ReactNode
}): JSX.Element {
  return (
    <>
      {backTo && (
        <Link
          href={backTo}
          className={cn(
            'mb-3 inline-flex min-h-tap items-center gap-1.5 rounded-md text-sm font-medium',
            'text-muted-foreground transition-colors hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <ICONS.back aria-hidden="true" className="size-4 shrink-0" />
          {backLabel ?? 'Back'}
        </Link>
      )}
      {note && <PageNote>{note}</PageNote>}
      {renderHeader()}
    </>
  )

  function renderHeader(): JSX.Element {
    return (
    // Stacked on a phone, side by side from `sm`. `flex-wrap` alone was not
    // enough: an action group wrapping under a heading still sat right-aligned
    // against the gutter, and a long title pushed a button off the edge before
    // the wrap took effect.
    <div className="mb-cards flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-start gap-4">
        {leading && <div className="shrink-0">{leading}</div>}
        <div className="min-w-0">
          {/* `break-words` because a school name is user data and can be one long
              token; without it the h1 sets the page's minimum width. */}
          <h1 className="break-words text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground sm:text-base">
              {description}
            </p>
          )}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2 sm:shrink-0">{actions}</div>}
    </div>
    )
  }
}
