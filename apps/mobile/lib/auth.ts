/**
 * The one place a feature screen touches authentication.
 *
 * Spec: ADR-032 — the auth provider is wrapped, never imported directly by features
 *
 * `@clerk/clerk-expo` is imported here, in `app/_layout.tsx`, and in the sign-in screen.
 * Nowhere else. A screen asks this module who the user is and how to get a token, so
 * replacing Clerk with Keycloak for a self-hosted deployment means rewriting three files
 * rather than thirty — the same promise ADR-032 makes on the web.
 */

import { useAuth as useClerkAuth, useUser } from '@clerk/clerk-expo'
import { useCallback } from 'react'

import type { TokenGetter } from './api'

export interface Session {
  isLoaded: boolean
  isSignedIn: boolean
  userId: string | null
  email: string | null
  fullName: string | null
  /** Passed to `api.*`; never cached, so a sign-out takes effect on the next call. */
  getToken: TokenGetter
  signOut: () => Promise<void>
}

export function useSession(): Session {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useClerkAuth()
  const { user } = useUser()

  /*
    Stable across renders so it can sit in a `useEffect` dependency list without
    re-firing every fetch on every render — the commonest way a mobile screen ends up
    hammering an API.
  */
  const token = useCallback(async () => {
    try {
      return await getToken()
    } catch {
      return null
    }
  }, [getToken])

  return {
    isLoaded,
    isSignedIn: Boolean(isSignedIn),
    userId: userId ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    fullName: user?.fullName ?? null,
    getToken: token,
    signOut: async () => {
      await signOut()
    },
  }
}
