'use client'

/**
 * Client-side fetching for the admin dashboard.
 *
 * Deliberately ~80 lines and not React Query. The admin surface has no
 * cross-screen cache to share, no optimistic updates, and no infinite lists;
 * adding a data library would settle a repo-wide architectural question (see
 * THIRTEEN_LAYER_COMPLIANCE.md, Layer 1 — state management is still open) as a
 * side effect of building one dashboard. That question deserves the school
 * portal's requirements before it is answered, not this one's.
 *
 * What this does guarantee is the three states every screen must render, which
 * is the part that actually gets skipped: `loading`, `error`, and data. The
 * envelope is the one every route returns — `{ data, meta? }` or
 * `{ error, code }` — so a screen never has to guess at the shape.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ApiState<T> {
  data: T | null
  meta: { page?: number; perPage?: number; total?: number } | null
  loading: boolean
  /** Human-readable. Already safe to render — routes never leak driver text. */
  error: string | null
  /** The machine code, for branching on FORBIDDEN vs a transient failure. */
  code: string | null
  reload: () => void
}

interface Envelope<T> {
  data?: T
  meta?: { page?: number; perPage?: number; total?: number }
  error?: string
  code?: string
}

export function useApi<T>(url: string | null): ApiState<T> {
  const [data, setData] = useState<T | null>(null)
  const [meta, setMeta] = useState<ApiState<T>['meta']>(null)
  const [loading, setLoading] = useState(Boolean(url))
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  // Guards against a slow first response overwriting a fast second one when the
  // URL changes mid-flight — the classic filter-typing race, where the list
  // settles on results for a query the user has already moved past.
  const latest = useRef(0)

  useEffect(() => {
    if (!url) {
      setLoading(false)
      return
    }

    const request = ++latest.current
    const controller = new AbortController()

    setLoading(true)
    setError(null)
    setCode(null)
    ;(async () => {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        })

        let body: Envelope<T>
        try {
          body = (await response.json()) as Envelope<T>
        } catch {
          // A non-JSON body means something upstream of the route answered —
          // a proxy, or Next's own error page. Saying so beats "undefined".
          throw new Error(`The server returned an unreadable response (HTTP ${response.status}).`)
        }

        if (request !== latest.current) return

        if (!response.ok || body.error) {
          setCode(body.code ?? 'SERVER_ERROR')
          setError(body.error ?? `Request failed (HTTP ${response.status}).`)
          setData(null)
        } else {
          setData((body.data ?? null) as T | null)
          setMeta(body.meta ?? null)
        }
      } catch (err) {
        if (controller.signal.aborted || request !== latest.current) return
        setCode('SERVER_ERROR')
        setError(err instanceof Error ? err.message : 'Could not reach the server.')
        setData(null)
      } finally {
        if (request === latest.current) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [url, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  return { data, meta, loading, error, code, reload }
}

/**
 * A mutation with its own pending and error state.
 *
 * Returns the parsed error rather than throwing, because every caller here
 * needs to render it next to the control that failed — and a form that clears
 * itself on failure is the specific behaviour DESIGN_SYSTEM.md forbids.
 */
export async function apiSend<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
): Promise<{ data: T | null; error: string | null; code: string | null }> {
  try {
    const response = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })

    const parsed = (await response.json().catch(() => ({}))) as Envelope<T>

    if (!response.ok || parsed.error) {
      return {
        data: null,
        error: parsed.error ?? `Request failed (HTTP ${response.status}).`,
        code: parsed.code ?? 'SERVER_ERROR',
      }
    }

    return { data: (parsed.data ?? null) as T | null, error: null, code: null }
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Could not reach the server.',
      code: 'SERVER_ERROR',
    }
  }
}
