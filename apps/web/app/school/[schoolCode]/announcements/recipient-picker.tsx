'use client'

/**
 * Choosing named people to address.
 *
 * Spec: `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
 *
 * ## Search, not a scroll
 *
 * A 2,000-pupil school has several thousand addressable people. A list is useless
 * at that size, so this is a search box: type a name, pick, repeat. The endpoint
 * caps at 200 and says when it truncated, which the component surfaces rather
 * than silently showing a partial answer that looks complete.
 *
 * ## Chosen people stay visible
 *
 * Selections are rendered as removable chips above the search, because the whole
 * failure mode of a search-based picker is losing track of who you have already
 * added and sending a private message to four people instead of one.
 *
 * ## The kind of person is shown, and it matters
 *
 * A parent, a pupil and a member of staff can share a name. The label carries
 * which family a parent belongs to and which class a pupil is in — without that,
 * addressing "Mary Mwale" at a school with four of them is a guess.
 */

import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'

import { useApi } from '../../../../lib/use-api'
import { Badge } from '../../../../components/ui/badge'
import { Field, Input } from '../../../../components/ui/field'

interface Recipient {
  userId: string
  name: string
  kind: 'staff' | 'parent' | 'student'
  detail: string
}

const KIND_LABEL: Record<Recipient['kind'], string> = {
  staff: 'Staff',
  parent: 'Parent',
  student: 'Pupil',
}

export function RecipientPicker({
  selected,
  onChange,
}: {
  selected: string[]
  onChange: (ids: string[]) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  // Debounced: this endpoint reads three tables, and a request per keystroke on a
  // school connection is how a picker becomes slower than a paper list.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  const url = debounced
    ? `/api/school/recipients?q=${encodeURIComponent(debounced)}`
    : '/api/school/recipients'
  const { data, loading } = useApi<{
    recipients: Recipient[]
    total: number
    truncated: boolean
  }>(url)

  // Chosen people must stay nameable after the search that found them is gone, so
  // every recipient ever seen is remembered for labelling.
  const [known, setKnown] = useState<Map<string, Recipient>>(new Map())
  useEffect(() => {
    if (!data?.recipients) return
    setKnown((prev) => {
      const next = new Map(prev)
      for (const r of data.recipients) next.set(r.userId, r)
      return next
    })
  }, [data?.recipients])

  const toggle = useCallback(
    (id: string) => {
      onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id])
    },
    [selected, onChange],
  )

  const results = useMemo(
    () => (data?.recipients ?? []).filter((r) => !selected.includes(r.userId)),
    [data?.recipients, selected],
  )

  return (
    <div className="space-y-stack">
      {selected.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-medium text-foreground">
            Sending to {selected.length} {selected.length === 1 ? 'person' : 'people'}
          </p>
          <ul className="flex flex-wrap gap-2">
            {selected.map((id) => {
              const r = known.get(id)
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    className="flex min-h-tap items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-sm transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>{r?.name ?? id}</span>
                    {r && <span className="text-xs text-muted-foreground">{KIND_LABEL[r.kind]}</span>}
                    <X aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">Remove {r?.name ?? id}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <Field
        id="recipient-search"
        label="Find a person"
        hint="Search by name. Parents are shown with their children's names."
      >
        {(props) => (
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              {...props}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              maxLength={80}
            />
          </div>
        )}
      </Field>

      {loading && <p className="text-sm text-muted-foreground">Searching…</p>}

      {!loading && data && (
        <>
          {data.truncated && (
            <p className="text-sm text-warning-text">
              Showing the first 200 of {data.total}. Type a name to narrow it.
            </p>
          )}

          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {debounced ? `Nobody matching “${debounced}”.` : 'No addressable people found.'}
            </p>
          ) : (
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {results.map((r) => (
                <li key={r.userId}>
                  <button
                    type="button"
                    onClick={() => toggle(r.userId)}
                    className="flex min-h-tap w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {r.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.detail}
                      </span>
                    </span>
                    <Badge variant="neutral">{KIND_LABEL[r.kind]}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
