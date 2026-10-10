'use client'

/**
 * A thin progress bar across the top while a page is loading.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## Why this is not a centred splash
 *
 * Decided 2026-09-30, weighing it against a full-screen ZSMS mark on every navigation. A splash reads
 * as a wait even when it is 200ms — the eye registers content being taken away — and on a phone it
 * replaces the thing the person was reading. A 2px bar tells them the tap registered and never blocks
 * anything.
 *
 * The mark is still always present: `PublicHeader` renders it server-side, so it is in the first paint
 * of every page rather than appearing during a transition.
 *
 * ## The App Router has no navigation events, so this listens to clicks
 *
 * There is no `router.events` in the App Router — the Pages Router API that made this trivial is gone,
 * and `usePathname` only changes **after** a navigation completes, which is too late to start a
 * progress bar. So: a capture-phase click listener starts the bar, and a pathname change stops it.
 *
 * That ordering is the whole design. Getting it backwards produces a bar that appears once the page is
 * already there.
 *
 * ## It never reaches 100% on its own
 *
 * The bar eases toward 90% and waits. Real progress is unknowable — the browser does not report how
 * much of a server component has streamed — and a bar that completes early then sits there is worse
 * than one that is honestly still going. It jumps to 100% and fades only when the pathname actually
 * changes.
 */

import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

export function RouteProgress(): JSX.Element | null {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [progress, setProgress] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  // Start on a click that will navigate.
  useEffect(() => {
    function onClick(event: MouseEvent): void {
      /**
       * Every reason this click will NOT cause a navigation we can show progress for. Missing any of
       * them leaves a bar running forever — the failure mode that makes people distrust the indicator
       * and then ignore it.
       */
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

      const anchor = (event.target as HTMLElement | null)?.closest('a')
      if (!anchor) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return

      const href = anchor.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return

      // External links hand off to the browser, which draws its own indicator.
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      // Same page — nothing will load.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return

      setProgress(8)
    }

    document.addEventListener('click', onClick, { capture: true })
    return () => document.removeEventListener('click', onClick, { capture: true })
  }, [])

  // Ease toward 90% while pending.
  useEffect(() => {
    if (progress === null || progress >= 90) return

    timer.current = setInterval(() => {
      setProgress((current) => {
        if (current === null) return null
        // Decelerating: fast at the start where most navigations finish, slow near the ceiling so it
        // never looks stuck at a number it is about to leave.
        const next = current + Math.max(0.6, (90 - current) / 12)
        return Math.min(next, 90)
      })
    }, 120)

    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [progress])

  /**
   * Finish when the route actually changes.
   *
   * `searchParams` is a dependency as well as `pathname`, because the directory's filters navigate by
   * query string alone — without it, every filter change would start a bar that never ends.
   */
  useEffect(() => {
    setProgress((current) => (current === null ? null : 100))
    const hide = setTimeout(() => setProgress(null), 260)
    return () => clearTimeout(hide)
  }, [pathname, searchParams])

  if (progress === null) return null

  return (
    <div
      // Not `role="progressbar"`: the value is invented, and announcing a fabricated percentage to a
      // screen reader is worse than announcing nothing. `aria-hidden` and let the page announce itself.
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5"
    >
      <div
        className="h-full bg-primary transition-[width,opacity] duration-200 ease-out"
        style={{ width: `${progress}%`, opacity: progress === 100 ? 0 : 1 }}
      />
    </div>
  )
}
