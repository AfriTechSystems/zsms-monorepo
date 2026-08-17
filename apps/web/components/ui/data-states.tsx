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
import { RefreshCw, ShieldAlert, TriangleAlert } from 'lucide-react'

import { Alert } from './alert'
import { Button } from './button'
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
          {forbidden ? (
            <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          ) : (
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
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
              <RefreshCw aria-hidden="true" />
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
      className="grid gap-cards sm:grid-cols-2 lg:grid-cols-4"
    >
      <span className="sr-only">Loading figures</span>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[104px] rounded-xl" />
      ))}
    </div>
  )
}

/** Page title block. Keeps the h1 and its description consistent across screens. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}): JSX.Element {
  return (
    <div className="mb-cards flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  )
}
