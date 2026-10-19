/**
 * The colour theme preference, for mobile.
 *
 * The app followed the operating system and nothing else, so a teacher whose phone
 * is in dark mode had no way to read a mark sheet in light — which is a real request
 * in a school: a phone held up beside printed paper is easier to read light-on-white.
 *
 * `system` stays the default, and is what most people should keep.
 *
 * ## Why SecureStore rather than AsyncStorage
 *
 * Only because it is already a dependency — the Clerk token cache uses it. A theme is
 * not a secret, but adding a second storage library for one string is not worth it,
 * and a failure to read one is handled the same way either way: fall back to the
 * system.
 */

import type { JSX, ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useColorScheme } from 'react-native'
import * as SecureStore from 'expo-secure-store'

import { DARK, LIGHT, type Palette } from './index'

export type ThemeChoice = 'light' | 'dark' | 'system'

const KEY = 'zsms-theme'

interface ThemeContextValue {
  /** What the person chose. */
  choice: ThemeChoice
  /** What that resolves to right now, which is what the UI should paint with. */
  scheme: 'light' | 'dark'
  palette: Palette
  setChoice: (next: ThemeChoice) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const system = useColorScheme()
  const [choice, setStored] = useState<ThemeChoice>('system')

  /*
    Read once, after mount.

    Until it arrives the app paints with the SYSTEM scheme, which is what it did
    before this existed — so the worst case is the old behaviour for one frame rather
    than a flash of the wrong theme.
  */
  useEffect(() => {
    let alive = true
    void SecureStore.getItemAsync(KEY)
      .then((stored) => {
        if (!alive) return
        if (stored === 'light' || stored === 'dark') setStored(stored)
      })
      .catch(() => {
        /* unreadable store: `system` is the right fallback */
      })
    return () => {
      alive = false
    }
  }, [])

  const setChoice = useCallback((next: ThemeChoice) => {
    // Applied immediately, persisted in the background. A theme that waited for a
    // disk write before changing would feel broken on a slow phone.
    setStored(next)
    void (next === 'system'
      ? SecureStore.deleteItemAsync(KEY)
      : SecureStore.setItemAsync(KEY, next)
    ).catch(() => {
      /* non-fatal: the choice holds for this session */
    })
  }, [])

  const scheme: 'light' | 'dark' =
    choice === 'system' ? (system === 'dark' ? 'dark' : 'light') : choice

  return (
    <ThemeContext.Provider
      value={{ choice, scheme, palette: scheme === 'dark' ? DARK : LIGHT, setChoice }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

/**
 * The theme in force.
 *
 * Falls back to the system scheme when no provider is above it, so a screen rendered
 * outside the app shell — a test, a storybook-style preview — still paints correctly
 * instead of throwing.
 */
export function useThemePreference(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  const system = useColorScheme()

  if (ctx) return ctx

  const scheme: 'light' | 'dark' = system === 'dark' ? 'dark' : 'light'
  return {
    choice: 'system',
    scheme,
    palette: scheme === 'dark' ? DARK : LIGHT,
    setChoice: () => undefined,
  }
}
