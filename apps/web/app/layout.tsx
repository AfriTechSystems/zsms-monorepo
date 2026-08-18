/**
 * Root layout.
 *
 * The theme is emitted server-side into `<head>` as CSS custom properties, so a
 * school's colours are present in the first paint. `suppressHydrationWarning`
 * on `<html>` is required because the pre-hydration script may set
 * `data-theme` before React attaches.
 */
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'

// Self-hosted so the build needs no network and no third-party request is made
// from a parent's browser — a Google Fonts call from a Zambian school portal
// is both a latency cost and a data-protection question we do not need to have.
import '@fontsource-variable/inter'
import './globals.css'

import { SessionProvider } from '@zsms/auth-provider/react'

import { platformTheme, ThemeStyle } from '../lib/theme'

export const metadata: Metadata = {
  title: 'ZSMS',
  description: 'School management for Zambian schools — AfriTech Systems Limited',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Not `maximum-scale: 1` — blocking pinch-zoom is a WCAG 1.4.4 failure and
  // this product is read on phones by parents who may need to enlarge it.
  // The browser chrome colour. These are the *page ground* tokens, not white and
  // near-black — a mismatched address bar above a lavender page is the one place
  // a themed app still looks unfinished on a phone.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F1F3FA' },
    { media: '(prefers-color-scheme: dark)', color: '#14181F' },
  ],
}

/**
 * Resolves the theme before first paint.
 *
 * Always writes an explicit `data-theme`, including for users on "system" —
 * resolving the system preference here rather than in a media query is what
 * keeps the CSS variables and Tailwind's `dark:` utilities on the same switch.
 *
 * Without this, a user who chose dark mode sees a white flash on every
 * navigation. It is deliberately tiny and dependency-free, and it fails silently
 * — a blocked script leaves the media-query fallback in `globals`, which is a
 * fine outcome rather than a broken page.
 */
const THEME_INIT = `
try {
  var t = localStorage.getItem('zsms-theme');
  if (t !== 'dark' && t !== 'light') {
    t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`

export default function RootLayout({ children }: { children: ReactNode }) {
  // The root layout is not school-scoped: a school theme is applied by the
  // school/parent/teacher layouts once a school is resolved from the route.
  const theme = platformTheme()

  return (
    // `SessionProvider` is the auth-provider's neutral name for the Clerk
    // context (ADR-032). It wraps `<html>` rather than sitting inside `<body>`
    // because Clerk's own guidance is that the provider owns the document — and
    // because sign-in redirects need to be decidable before anything renders.
    <SessionProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          <ThemeStyle theme={theme} />
          <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        </head>
        <body>
          <a href="#main" className="skip-link">
            Skip to main content
          </a>
          {children}
        </body>
      </html>
    </SessionProvider>
  )
}
