/**
 * Light/dark toggle.
 *
 * Three states, not two: light, dark, and system. "System" is the default and
 * matters more than it looks — a phone that switches to dark at sunset should
 * take the portal with it unless the user has said otherwise.
 */
'use client'

import * as React from 'react'
import type { JSX } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

import { cn } from '../../lib/utils'

type Choice = 'light' | 'dark' | 'system'

const OPTIONS: Array<{ value: Choice; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'dark', label: 'Dark', Icon: Moon },
]

export function ThemeToggle({ className }: { className?: string }): JSX.Element {
  const [choice, setChoice] = React.useState<Choice>('system')

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('zsms-theme')
      if (stored === 'light' || stored === 'dark') setChoice(stored)
    } catch {
      /* storage unavailable — system default stands */
    }
  }, [])

  // "System" still writes an explicit attribute — see the note in
  // `themeToStyleSheet`. Removing it would leave Tailwind's `dark:` utilities
  // on light while the CSS variables went dark.
  const resolve = (next: Choice): 'light' | 'dark' =>
    next !== 'system'
      ? next
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'

  const apply = (next: Choice): void => {
    setChoice(next)
    try {
      if (next === 'system') localStorage.removeItem('zsms-theme')
      else localStorage.setItem('zsms-theme', next)
      document.documentElement.setAttribute('data-theme', resolve(next))
    } catch {
      /* non-fatal */
    }
  }

  // Follow the OS while on "system" — a phone switching at sunset should take
  // the portal with it without a reload.
  React.useEffect(() => {
    if (choice !== 'system') return undefined
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [choice])

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn('inline-flex shrink-0 rounded-md border border-border bg-background p-0.5', className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={choice === value}
          onClick={() => apply(value)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm transition-colors',
            choice === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-sunken',
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          {/*
            Icon-only on a narrow screen. Measured, not guessed: the three
            labelled buttons need 237px, and on a 375px header that leaves the
            product name about 90px — truncated to nothing. The label stays in
            the accessible name either way, so the control is unchanged for a
            screen reader.
          */}
          <span className="hidden sm:inline">{label}</span>
          <span className="sr-only sm:hidden">{label}</span>
        </button>
      ))}
    </div>
  )
}
