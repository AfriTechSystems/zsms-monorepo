/**
 * Loading placeholder.
 *
 * Shaped like the content it replaces, so the layout does not jump when data
 * arrives. `aria-hidden` with a live-region label on the container: a screen
 * reader should hear "loading students", not eleven grey rectangles.
 */
import { cn } from '../../lib/utils'
import type { JSX } from 'react'

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={cn('relative overflow-hidden rounded-md bg-sunken', className)}
      {...props}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-black/[0.04] to-transparent dark:via-white/[0.06]" />
    </div>
  )
}

export function LoadingRegion({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}
