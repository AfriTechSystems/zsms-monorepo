'use client'

/**
 * Switch between the sub-sections of one screen.
 *
 * Spec: `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## What this replaces
 *
 * School Settings holds School profile, Academic structure and Term dates, and reaching
 * the third meant scrolling past the first two. The sidebar lists *screens*, so it
 * cannot help — a sub-section is not a destination it knows about.
 *
 * ## Why a switch and not scrolling, and not routes either
 *
 * Scrolling to an anchor was the first attempt and was rejected: the reader still passes
 * everything in between, and a section carrying a lot of data — every invoice, every
 * payment — is rendered whether or not anybody is looking at it.
 *
 * Separate routes were the second, and were also wrong. These sub-sections belong to one
 * screen: they share a payload, a reload and often a form. Splitting them into routes
 * means fetching the same endpoint several times and holding the same state in several
 * places, to express something that is really one page with a view switch.
 *
 * So: one page, one fetch, and only the chosen section rendered. `useSectionTabs` holds
 * the choice.
 */

import type { JSX } from 'react'
import { useState } from 'react'
import { useSearchParams } from 'next/navigation'

export interface SectionTab<K extends string = string> {
  key: K
  label: string
  /** Shown beside the label — an invoice total, a staff headcount. */
  count?: number
}

/**
 * The selected section.
 *
 * A hook rather than internal state, because the screen needs to read the choice to
 * decide what to render, and a tab bar that owns a secret cannot tell it.
 *
 * ## `?section=` opens a tab from elsewhere
 *
 * The setup checklist links to "Term dates", which is the third tab of School settings.
 * Without this the link lands on the first tab and the person has to find it anyway,
 * which defeats the point of the prompt.
 *
 * It is read ONCE, as the initial value, and never again. Keeping the tab in the URL
 * would mean every click pushed a history entry, so Back would walk tabs instead of
 * leaving the screen — which is the behaviour the user rejected when they asked for a
 * switch rather than routes.
 */
export function useSectionTabs<K extends string>(
  initial: K,
  /** Every valid key. The hint is checked against it; anything else is ignored. */
  valid: readonly K[],
): [K, (k: K) => void] {
  const params = useSearchParams()
  const hinted = params.get('section')

  const [active, setActive] = useState<K>(
    // Checked, not trusted. This arrives from a URL anybody can type, and an
    // unrecognised value would leave the page rendering no section at all.
    hinted !== null && (valid as readonly string[]).includes(hinted)
      ? (hinted as K)
      : initial,
  )
  return [active, setActive]
}

export function SectionTabs<K extends string>({
  tabs,
  active,
  onChange,
  className = '',
}: {
  tabs: SectionTab<K>[]
  active: K
  onChange: (key: K) => void
  className?: string
}): JSX.Element | null {
  if (tabs.length < 2) return null

  return (
    <div
      role="tablist"
      aria-label="Sections on this page"
      className={`-mx-1 mb-cards flex gap-1 overflow-x-auto border-b border-border px-1 ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            data-section={tab.key}
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`inline-flex min-h-tap shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors ${
              isActive
                ? 'border-primary text-primary-text'
                : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
            }`}
          >
            {tab.label}
            {typeof tab.count === 'number' && (
              <span
                data-numeric
                className={`rounded-full px-1.5 text-sm ${
                  isActive ? 'bg-primary/10 text-primary-text' : 'bg-sunken text-muted-foreground'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
