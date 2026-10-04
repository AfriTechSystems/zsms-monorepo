'use client'

/**
 * Jump between the sub-sections of one screen.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## The problem it solves
 *
 * Reported from use: School Settings holds School profile, Academic structure and Term
 * dates, and the only way to reach the third is to scroll past the first two. The
 * sidebar lists *screens*, so it cannot help — a sub-section is not a destination it
 * knows about. Somebody setting term dates on their first afternoon has no way to tell
 * that the screen even has them.
 *
 * ## Why scrolling and not routes
 *
 * Splitting each section into its own route would also work, and would be a much larger
 * change: every one of these screens is a single form posting to a single endpoint, so
 * routing would mean either three endpoints or three forms sharing hidden state. It
 * would also throw away unsaved edits on every tab change, which is the exact moment
 * somebody is most likely to switch.
 *
 * This keeps one screen and one form, and makes its parts reachable.
 *
 * ## It follows the scroll
 *
 * The active tab tracks the section actually in view, so the bar is a position indicator
 * as well as a control. Without that it would highlight whatever was last clicked and
 * quietly lie as soon as somebody scrolled by hand.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface Section {
  /** Matches the `id` on the section's wrapper. */
  id: string
  label: string
}

export function SectionNav({
  sections,
  className = '',
}: {
  sections: Section[]
  className?: string
}): JSX.Element | null {
  const [active, setActive] = useState<string>(sections[0]?.id ?? '')
  const barRef = useRef<HTMLDivElement>(null)

  /*
    Which section counts as "where you are".

    The last one whose top has passed the band under the sticky bar — which is how a
    reader perceives it — with one exception that matters: **at the bottom of the page
    the last section wins**, however short it is.

    Without that exception the final tab can never light up. A short last section cannot
    be scrolled to the top of the viewport, so a reader who clicks it arrives looking at
    it while the bar still highlights the one above. Observed on /admin/billing, where
    clicking "Invoices" selected "Record a payment".

    An IntersectionObserver was the first attempt and had exactly this fault: it reports
    crossings, and the bottom section never crosses. Measuring positions is both simpler
    and correct at the edges.
  */
  const sync = useCallback(() => {
    const nodes = sections
      .map((s) => ({ id: s.id, node: document.getElementById(s.id) }))
      .filter((e): e is { id: string; node: HTMLElement } => e.node !== null)

    if (nodes.length === 0) return

    const last = nodes[nodes.length - 1]
    const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 2
    if (atBottom && last) {
      setActive(last.id)
      return
    }

    // 96px clears the sticky bar; anything above that line is already read.
    const line = 96
    let current = nodes[0]!.id
    for (const entry of nodes) {
      if (entry.node.getBoundingClientRect().top <= line) current = entry.id
    }
    setActive(current)
  }, [sections])

  useEffect(() => {
    sync()
    // Throttled to one measurement per frame: a scroll handler that reads layout on
    // every event forces a reflow per event and makes the page feel heavy.
    let queued = false
    const onScroll = (): void => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => {
        queued = false
        sync()
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [sync])

  const jump = useCallback((id: string) => {
    const node = document.getElementById(id)
    if (!node) return
    node.scrollIntoView({ behavior: 'smooth', block: 'start' })
    /*
      Move focus as well as the viewport.

      A keyboard or screen-reader user who activates a tab and is only scrolled has not
      gone anywhere — their next Tab continues from the bar. `scroll-mt` on the section
      keeps the heading clear of the sticky bar.
    */
    node.setAttribute('tabindex', '-1')
    node.focus({ preventScroll: true })
    setActive(id)
  }, [])

  if (sections.length < 2) return null

  return (
    <div
      ref={barRef}
      // Sticky so it stays reachable from the bottom of a long form, which is where
      // somebody realises they need a different section.
      className={`sticky top-0 z-20 -mx-1 mb-cards flex gap-1 overflow-x-auto border-b border-border bg-background/95 px-1 backdrop-blur ${className}`}
      role="tablist"
      aria-label="Sections on this page"
    >
      {sections.map((s) => {
        const isActive = s.id === active
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            data-section={s.id}
            aria-selected={isActive}
            aria-controls={s.id}
            onClick={() => jump(s.id)}
            className={`min-h-tap whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors ${
              isActive
                ? 'border-primary text-primary-text'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            {s.label}
          </button>
        )
      })}
    </div>
  )
}
