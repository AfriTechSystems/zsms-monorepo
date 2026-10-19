'use client'

/**
 * Comfortable or compact rows.
 *
 * For the people who work in one list all day — a school office checking forty fee
 * records — where the scroll between the top of the list and the bottom is the cost.
 *
 * Per browser, not per account: it is a preference about this screen at this desk,
 * and the same person on a phone wants the comfortable one. Stored in `localStorage`
 * and applied as an attribute on `<html>`, so the rule can live in CSS and apply to
 * every table at once rather than being threaded through `DataTable`.
 *
 * **Row padding only.** Font size is untouched — a register read across a desk needs
 * its text, and shrinking it to fit more rows trades the thing the list is for
 * against the number of them.
 */

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Rows2, Rows3 } from 'lucide-react'

import { cn } from '../../lib/utils'

type Density = 'comfortable' | 'compact'

export function DensityToggle({ className }: { className?: string }): JSX.Element {
  const [density, setDensity] = useState<Density>('comfortable')

  // After mount, never during render: `localStorage` does not exist on the server.
  useEffect(() => {
    try {
      if (localStorage.getItem('zsms-density') === 'compact') {
        setDensity('compact')
        document.documentElement.setAttribute('data-density', 'compact')
      }
    } catch {
      /* blocked storage: comfortable is the right fallback */
    }
  }, [])

  const apply = (next: Density): void => {
    setDensity(next)
    try {
      if (next === 'compact') {
        localStorage.setItem('zsms-density', 'compact')
        document.documentElement.setAttribute('data-density', 'compact')
      } else {
        localStorage.removeItem('zsms-density')
        document.documentElement.removeAttribute('data-density')
      }
    } catch {
      /* the attribute is what matters and it is already set */
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Row height"
      className={cn('inline-flex rounded-md border border-border p-0.5', className)}
    >
      {([
        { value: 'comfortable' as const, label: 'Comfortable', Icon: Rows2 },
        { value: 'compact' as const, label: 'Compact', Icon: Rows3 },
      ]).map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={density === value}
          aria-label={label}
          title={label}
          onClick={() => apply(value)}
          className={cn(
            'inline-flex size-7 items-center justify-center rounded transition-colors',
            density === value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-sunken hover:text-foreground',
          )}
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      ))}
    </div>
  )
}
