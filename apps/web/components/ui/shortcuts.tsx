'use client'

/**
 * The keyboard shortcuts panel, opened with `?`.
 *
 * Spec: reference images, which show a shortcut hint in the search field.
 *
 * ## Why a panel rather than a help page
 *
 * Shortcuts are remembered by being seen while working, not by being read once. `?`
 * is the convention every tool that has one uses, and it costs nothing when unused.
 *
 * ## It lists only what actually works
 *
 * Every row here is a shortcut this application really binds. A panel that advertises
 * keys nobody wired is worse than no panel — the reader presses one, nothing happens,
 * and they stop trusting the rest of the list. When a new shortcut is bound, it is
 * added here; when one is removed, it goes.
 */

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

/** `true` on a Mac, where the modifier is ⌘ rather than Ctrl. */
function useIsMac(): boolean {
  const [mac, setMac] = useState(false)
  // After mount, never during render: `navigator` does not exist on the server, and
  // reading it during render would mismatch the markup React hydrated.
  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent))
  }, [])
  return mac
}

export function Shortcuts(): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const isMac = useIsMac()
  const mod = isMac ? '⌘' : 'Ctrl'

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }

      if (e.key !== '?') return

      /*
        Not while typing. `?` is a character, so binding it unconditionally means a
        teacher writing "Did you see Mwansa?" in a comment opens a help panel
        mid-sentence. The check is the element, not a flag — contenteditable included,
        since the assistant's composer may become one.
      */
      const el = document.activeElement
      const tag = el?.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (el instanceof HTMLElement && el.isContentEditable) return

      e.preventDefault()
      setOpen((v) => !v)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!open) return null

  const groups: Array<{ heading: string; rows: Array<[string, string]> }> = [
    {
      heading: 'Anywhere',
      rows: [
        [`${mod} K`, 'Search pupils, staff and schools'],
        ['?', 'Show this list'],
        ['Esc', 'Close a panel, menu or dialog'],
      ],
    },
    {
      heading: 'In search',
      rows: [
        ['↑ ↓', 'Move through results'],
        ['Enter', 'Open the highlighted result'],
      ],
    },
    {
      heading: 'On a list',
      rows: [
        ['Tab', 'Move to the next control'],
        ['Space', 'Tick the focused checkbox'],
      ],
    },
  ]

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-black/40"
      />

      <div className="relative max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-surface p-card shadow-2xl">
        <div className="mb-stack flex items-center justify-between gap-2">
          <h2 className="font-semibold">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        {groups.map((g) => (
          <section key={g.heading} className="mb-stack last:mb-0">
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {g.heading}
            </h3>
            <dl className="space-y-1.5">
              {g.rows.map(([keys, what]) => (
                <div key={keys} className="flex items-center justify-between gap-3">
                  <dt className="text-sm">{what}</dt>
                  <dd className="shrink-0">
                    <kbd className="rounded border border-border bg-sunken px-1.5 py-0.5 font-mono text-xs">
                      {keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}

        {/*
          Said plainly rather than left to be discovered. A phone has no keyboard, and
          a reader who opened this on one should be told why it is not useful to them
          instead of wondering which key they are missing.
        */}
        <p className="mt-stack border-t border-border pt-stack text-xs text-muted-foreground">
          Shortcuts need a physical keyboard. On a phone or tablet, every one of these
          has a button on screen.
        </p>
      </div>
    </div>
  )
}
