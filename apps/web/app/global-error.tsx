'use client'

/**
 * The last thing between a crash and a blank page.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/SENTRY.md`
 *       `Official Documentation/01 Foundation Layer/DESIGN_SYSTEM.md`
 *
 * ## What this catches that nothing else does
 *
 * An error thrown in the root layout, or in rendering the root itself, happens before any `error.tsx`
 * boundary exists. Without this file the browser shows Next's default unstyled error page in
 * production, or nothing at all — and the exception is never reported, because there was no component
 * alive to report it.
 *
 * It is also the only error boundary that must supply its own `<html>` and `<body>`: the root layout is
 * the thing that failed, so nothing is wrapping this.
 *
 * ## The copy is written for a school clerk mid-task
 *
 * Whoever sees this was doing something — recording a payment, marking a register — and their first
 * question is whether they lost it. So the page answers that before anything else, and gives them the
 * two actions that resolve almost every instance: reload, or go back to their dashboard.
 *
 * `digest` is shown deliberately. Next hashes the server-side message into it, and it is the one string
 * that lets AfriTech find this exact crash in Sentry from a phone call — far better than asking somebody
 * to describe what they saw.
 *
 * Inline styles rather than Tailwind classes, because the stylesheet is part of what may have failed to
 * load. A styled apology that renders as unstyled HTML reads as a second fault.
 */

import type { JSX } from 'react'
import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): JSX.Element {
  useEffect(() => {
    // A no-op when no DSN was configured, so this is safe in every environment.
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          // System stack: a webfont is another thing that may not have loaded.
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          background: '#ffffff',
          color: '#1e2a3f',
        }}
      >
        <main style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 600, margin: '0 0 0.75rem' }}>
            Something went wrong
          </h1>

          {/* First, the question they are actually asking. */}
          <p style={{ margin: '0 0 0.75rem', lineHeight: 1.55 }}>
            Your school&rsquo;s records are safe — nothing was lost. This page failed to load, and
            AfriTech has been told about it automatically.
          </p>
          <p style={{ margin: '0 0 1.5rem', lineHeight: 1.55 }}>
            If you were part-way through entering something, check whether it saved before entering it
            again.
          </p>

          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={() => reset()}
              style={{
                // 44px, the tap target this product uses everywhere. A thumb has to reach it on a
                // page that has already gone wrong once.
                minHeight: '44px',
                padding: '0 1.25rem',
                border: 'none',
                borderRadius: '0.5rem',
                background: '#1e2a3f',
                color: '#ffffff',
                fontSize: '1rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                minHeight: '44px',
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0 1.25rem',
                borderRadius: '0.5rem',
                border: '1px solid #d4d7dd',
                color: '#1e2a3f',
                textDecoration: 'none',
                fontSize: '1rem',
                fontWeight: 500,
              }}
            >
              Back to start
            </a>
          </div>

          {error.digest && (
            <p style={{ marginTop: '1.5rem', fontSize: '0.8125rem', color: '#6b7280' }}>
              If you call AfriTech, quote this code:{' '}
              <span style={{ fontFamily: 'ui-monospace, monospace' }}>{error.digest}</span>
            </p>
          )}
        </main>
      </body>
    </html>
  )
}
