'use client'

/**
 * The colour theme, shared.
 *
 * Lifted out of `ThemeToggle` when the theme control moved into the account menu.
 * Two components reading `localStorage` and writing `data-theme` independently is two
 * copies of one decision, and it is how one of them ends up applying a theme the
 * other does not know about.
 */

import { useCallback, useEffect, useState } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'

/** What `system` currently means on this device. */
function systemIsDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

export function useTheme(): {
  choice: ThemeChoice
  setChoice: (next: ThemeChoice) => void
} {
  /*
    `system` until proven otherwise, and read AFTER mount.

    Reading `localStorage` during render would mismatch the markup the server sent —
    and the inline script in the document head has already applied the stored theme,
    so the page is never briefly wrong while this catches up.
  */
  const [choice, setStored] = useState<ThemeChoice>('system')

  useEffect(() => {
    try {
      const stored = localStorage.getItem('zsms-theme')
      if (stored === 'light' || stored === 'dark') setStored(stored)
    } catch {
      /* private mode, blocked storage: `system` is the right fallback */
    }
  }, [])

  const setChoice = useCallback((next: ThemeChoice) => {
    setStored(next)
    try {
      if (next === 'system') localStorage.removeItem('zsms-theme')
      else localStorage.setItem('zsms-theme', next)
      document.documentElement.setAttribute(
        'data-theme',
        next === 'system' ? (systemIsDark() ? 'dark' : 'light') : next,
      )
    } catch {
      /* non-fatal: the attribute is what matters and it is already set */
    }
  }, [])

  // Follow the OS while on `system` — a phone switching at sunset should take the
  // portal with it without a reload.
  useEffect(() => {
    if (choice !== 'system') return undefined
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [choice])

  return { choice, setChoice }
}
