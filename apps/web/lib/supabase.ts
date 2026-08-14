/**
 * Supabase clients for API routes.
 *
 * Spec: `Official Documentation/01 Foundation Layer/RLS.md`
 *       `Official Documentation/03 Infrastructure Services/SUPABASE.md`
 *
 * THE CENTRAL RULE OF THIS FILE
 * ----------------------------
 * Every request-scoped query goes through `createUserClient()`, which forwards
 * the caller's Clerk JWT to PostgREST. That token is what `get_school_id()`,
 * `get_user_role()`, and `get_user_id()` read inside every RLS policy
 * (migration 0001). Tenant isolation is a property of the token, not of the
 * query — so a query issued without one, or with the service role key, is
 * outside the boundary entirely.
 *
 * `createServiceClient()` therefore does not exist here. The service role key
 * is never used outside an Edge Function (CONVENTIONS.md prohibition 1); a
 * Next.js API route is not an Edge Function.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getAuthProvider } from '@zsms/auth-provider'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. API routes cannot reach Supabase without it — see ENV.md.`,
    )
  }
  return value
}

/**
 * A Supabase client bound to the calling user's Clerk session.
 *
 * Returns null when there is no session. Callers must treat that as 401 rather
 * than falling back to an unauthenticated client — an anonymous client is not a
 * degraded version of an authenticated one, it is a different security context.
 */
export async function createUserClient(): Promise<SupabaseClient | null> {
  const token = await getAuthProvider().getSupabaseToken()
  if (!token) return null

  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: {
        // API routes are stateless. Persisting or refreshing a session here
        // would let one request's identity leak into the next.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  )
}
