'use client'

/**
 * The search box in the top bar.
 *
 * Spec: `19 Design System/ZSMS_UI_REDESIGN_MASTER_PROMPT.md` §4C; every web reference
 *       image puts a wide search field across the header.
 *
 * ## Mounted per portal, not in the shell
 *
 * The shell takes `headerActions`, and each portal's layout decides whether to pass
 * this. AfriTech, School and Teacher do; **Parent and Student do not** — a parent has
 * one or two children, so a box that searches them is furniture that makes the header
 * busier without making anything findable.
 *
 * That is a UI decision rather than a security one. `search_everything()` is safe for a
 * parent; it is simply useless to them.
 *
 * ## What it does not do
 *
 * It does not filter, rank or decide what the caller may see. The function is SECURITY
 * INVOKER and RLS scopes it, so a teacher typing a surname gets the pupils in their own
 * classes and nothing else — without this component knowing that rule exists.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { GraduationCap, Loader2, School, Search, UserRound, X } from 'lucide-react'

import { cn } from '../../lib/utils'

interface Result {
  kind: string
  id: string
  title: string
  subtitle: string | null
  href: string
}

const ICON: Record<string, typeof Search> = {
  student: GraduationCap,
  staff: UserRound,
  school: School,
}

const KIND_LABEL: Record<string, string> = {
  student: 'Pupil',
  staff: 'Staff',
  school: 'School',
}

export function GlobalSearch({ placeholder }: { placeholder?: string }): JSX.Element {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)

  const [term, setTerm] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(0)

  /*
    Debounced, because this fires per keystroke.

    200ms is short enough to feel immediate and long enough that typing a surname is
    one request rather than seven. The abort controller matters more than the delay:
    without it a slow early response can land after a fast later one and replace the
    right results with stale ones.
  */
  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([])
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setBusy(true)
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        })
        if (!response.ok) {
          setResults([])
          return
        }
        const body = await response.json()
        setResults(body.data?.results ?? [])
        setActive(0)
      } catch {
        /* Aborted or offline. The box keeps its last result rather than flashing empty. */
      } finally {
        setBusy(false)
      }
    }, 200)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [term])

  // Ctrl/Cmd+K, the shortcut anybody who has used another admin tool will try first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Clicking away closes it. Without this the panel survives navigation on a tab click.
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const go = useCallback(
    (r: Result) => {
      setOpen(false)
      setTerm('')
      setResults([])
      router.push(r.href)
    },
    [router],
  )

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      setOpen(false)
      input.current?.blur()
      return
    }
    if (results.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = results[active]
      if (chosen) go(chosen)
    }
  }

  const showPanel = open && term.trim().length >= 2

  return (
    <div ref={box} className="relative w-full max-w-md">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          ref={input}
          type="search"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? 'Search…'}
          aria-label="Search"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="global-search-results"
          aria-autocomplete="list"
          className={cn(
            'min-h-tap w-full rounded-lg border border-border bg-sunken py-2 pl-9 pr-16 text-sm',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        />

        <span className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {busy && <Loader2 aria-hidden className="size-3.5 animate-spin text-muted-foreground" />}
          {term ? (
            <button
              type="button"
              onClick={() => {
                setTerm('')
                input.current?.focus()
              }}
              aria-label="Clear search"
              className="rounded text-muted-foreground hover:text-foreground"
            >
              <X aria-hidden className="size-4" />
            </button>
          ) : (
            // Hidden on small screens: the shortcut needs a keyboard, and the hint
            // would otherwise crowd a field that is already tight on a tablet.
            <kbd className="hidden rounded border border-border px-1.5 text-[10px] text-muted-foreground sm:inline">
              Ctrl K
            </kbd>
          )}
        </span>
      </div>

      {showPanel && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          {results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              {busy ? 'Searching…' : `Nothing matching “${term}”.`}
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((r, i) => {
                const Icon = ICON[r.kind] ?? Search
                return (
                  <li key={`${r.kind}-${r.id}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(r)}
                      className={cn(
                        'flex min-h-tap w-full items-center gap-2.5 px-3 py-2 text-left text-sm',
                        i === active ? 'bg-neutral-tint' : 'bg-transparent',
                      )}
                    >
                      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{r.title}</span>
                        {r.subtitle ? (
                          <span className="block truncate text-xs text-muted-foreground">
                            {r.subtitle}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {KIND_LABEL[r.kind] ?? r.kind}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
