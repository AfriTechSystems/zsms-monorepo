/**
 * Fetching, for a screen.
 *
 * The mobile counterpart of the web's `useApi`, deliberately sharing its shape —
 * `{ data, loading, error, reload }` — so a developer moving between the two apps is
 * reading the same thing.
 *
 * ## Why it is written out rather than pulled from a library
 *
 * React Query would bring caching, retries and background refetch, and this app needs none
 * of them yet: a teacher opens a register, marks it, and leaves. Adding a cache before
 * there is a cache-shaped problem means every future offline decision has to be argued
 * with the library's model of staleness rather than with PowerSync's — and PowerSync is
 * what ADR-004 commits to.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { api, type ApiResult } from './api'
import { useSession } from './auth'

export interface ApiState<T> {
  data: T | null
  loading: boolean
  error: string | null
  code: string | null
  reload: () => void
}

export function useApi<T>(path: string | null): ApiState<T> {
  const { getToken, isLoaded, isSignedIn } = useSession()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  /*
    A screen a teacher navigates away from mid-request must not write its result into an
    unmounted component — React Native warns, and worse, a stale response can overwrite a
    newer one when two fetches race.
  */
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!path || !isLoaded || !isSignedIn) return

    setLoading(true)
    setError(null)

    void api.get<T>(path, getToken).then((result: ApiResult<T>) => {
      if (!alive.current) return
      setData(result.data)
      setError(result.error)
      setCode(result.code)
      setLoading(false)
    })
  }, [path, getToken, isLoaded, isSignedIn, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])

  return { data, loading, error, code, reload }
}
