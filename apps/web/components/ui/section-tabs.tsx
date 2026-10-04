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
 */
export function useSectionTabs<K extends string>(initial: K): [K, (k: K) => void] {
  const [active, setActive] = useState<K>(initial)
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
