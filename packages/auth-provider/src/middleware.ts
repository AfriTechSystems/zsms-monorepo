/**
 * Next.js middleware — the piece that makes `auth()` work at all.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/SESSIONS.md`
 * Decision: ADR-003 (Clerk), ADR-032 (single Clerk importer)
 *
 * ## Why this file has to exist
 *
 * `auth()` does not read a cookie by itself. Clerk's middleware verifies the
 * session token and puts the result on the request; `auth()` then reads what the
 * middleware left. With no middleware, `auth()` does not return "signed out" —
 * it **throws**, which surfaces as a 500 from every route that asks who the
 * caller is. That is exactly what `/api/admin/*` did before this file existed:
 * the routes, the RLS policies, and the Clerk configuration were all correct,
 * and nothing worked, because the one line that connects them was missing.
 *
 * ## Why it does not protect anything
 *
 * `clerkMiddleware()` is called with no route matcher, so it authenticates and
 * then gets out of the way. Every route decides its own authorisation, and the
 * real boundary is the RLS policy the caller's token is evaluated against —
 * see `lib/supabase.ts`. Adding `protect()` here would put a second, weaker
 * copy of that decision in a place no policy test covers, and the two would
 * drift. Middleware establishes *identity*; the database enforces *access*.
 *
 * Kept in this package because ARCHITECTURE.md and ADR-032 permit `@clerk/*`
 * imports here and nowhere else. `apps/web/middleware.ts` is a re-export, so
 * swapping Clerk for Keycloak stays a change to this package alone.
 */

import { clerkMiddleware } from '@clerk/nextjs/server'

/**
 * Next.js middleware entry point. Re-exported as the default from
 * `apps/web/middleware.ts`.
 *
 * The route matcher deliberately does **not** live here. Next resolves
 * `config.matcher` by static analysis of the middleware file at build time, so
 * an imported identifier fails the build — the array has to be a literal in
 * `apps/web/middleware.ts`. Exporting one from this package would give two
 * places that look authoritative and one that actually is.
 */
export const authMiddleware = clerkMiddleware()
