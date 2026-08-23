/**
 * Branded loading screen.
 *
 * Shown on initial application load and when entering a dashboard heavy enough
 * that a skeleton would be a lie about how long the wait is. Quick in-app
 * navigation uses `Skeleton` instead — a full-screen takeover for a 120ms
 * transition makes a fast app feel slower, because a splash reads as "starting
 * over" rather than "still here".
 *
 * ## No percentage, and that is not laziness
 *
 * A counted percentage requires knowing the size of the work. Here the work is a
 * server render plus an unknown number of queries over an unknown connection —
 * there is no denominator. Every "87%" in that situation is invented, and users
 * learn quickly that a progress number which stalls at 87% is a number that was
 * never measuring anything. An indeterminate indicator makes exactly one honest
 * claim: something is still happening. It cannot be wrong.
 *
 * ## It fades in rather than appearing
 *
 * A splash that flashes for 80ms is worse than no splash. The fade is delayed by
 * 180ms in CSS, so a load that resolves quickly unmounts this component before
 * it was ever visible — no JavaScript timer, no state, and it works during a
 * server-side suspense boundary where there is no client to run a timer on.
 *
 * ## Theming
 *
 * Colours come from CSS variables, so a school's palette applies automatically
 * wherever this is rendered inside that school's layout. The logo is passed in:
 * the school's own where set, the ZSMS lockup otherwise.
 */

import type { JSX } from 'react'

import { cn } from '../../lib/utils'

export interface BrandSplashProps {
  /** School logo URL. Falls back to the ZSMS lockup. */
  logoUrl?: string | null
  /** Accessible name for the mark — the school's name, or "ZSMS". */
  name?: string
  /** What is being prepared. Announced, and shown under the indicator. */
  message?: string
  /** Fills its container rather than the viewport. For in-page panels. */
  inline?: boolean
  className?: string
}

export function BrandSplash({
  logoUrl,
  name = 'ZSMS',
  message = 'Loading',
  inline = false,
  className,
}: BrandSplashProps): JSX.Element {
  return (
    <div
      // `status` rather than `alert`: this is a progress advisory, not something
      // demanding attention. `aria-busy` is what a screen reader uses to say the
      // region is still working.
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn(
        'zsms-splash flex flex-col items-center justify-center gap-6 bg-background px-gutter',
        inline ? 'min-h-[320px] w-full' : 'fixed inset-0 z-50 min-h-screen',
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl || '/brand/zsms-lockup.png'}
        alt={name}
        // Intrinsic size given so the layout does not jump when the image
        // arrives — on the connection this screen exists for, it will not be
        // instant.
        width={260}
        height={213}
        className="h-auto w-[180px] max-w-[60vw] object-contain sm:w-[240px]"
      />

      <div className="w-full max-w-[260px] space-y-3">
        {/*
          The indicator. A track with a segment that sweeps across it —
          indeterminate by construction, with no number that could be wrong.
          `aria-hidden` because the accessible status is carried by the text
          below and by aria-busy on the container; announcing a decorative bar
          would add noise without information.
        */}
        <div
          className="zsms-splash-track h-1.5 w-full overflow-hidden rounded-full bg-sunken"
          aria-hidden="true"
        >
          <div className="zsms-splash-bar h-full w-2/5 rounded-full bg-primary" />
        </div>

        <p className="text-center text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  )
}
