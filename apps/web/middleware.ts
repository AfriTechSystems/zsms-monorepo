/**
 * Next.js middleware.
 *
 * The implementation, and the only `@clerk/*` import behind it, live in
 * `@zsms/auth-provider/middleware` — see ADR-032. Putting `clerkMiddleware()`
 * directly here would work today and make the Keycloak swap for self-hosted
 * deployments a refactor instead of a configuration change.
 *
 * This file must sit beside `app/`, not inside it. Next only looks for
 * middleware at the project root.
 *
 * ## Why the matcher is a literal here rather than imported
 *
 * Next reads `config.matcher` by **static analysis at build time**, not by
 * executing this module, so it cannot follow an imported identifier — the build
 * fails with `Unknown identifier "…" at "config.matcher"`. Note that
 * `next dev` accepts the imported version quite happily; only `next build`
 * rejects it. The array therefore has to be written out in place.
 */

import type { NextFetchEvent, NextRequest } from 'next/server'

import { authMiddleware } from '@zsms/auth-provider/middleware'
import { rateLimitResponse } from './lib/rate-limit'

/**
 * Rate limiting runs BEFORE authentication.
 *
 * Two reasons. The abuse this protects against is unauthenticated by definition —
 * somebody hammering registration has no account — so there is no user id to limit on
 * and the IP is the only unit available. And verifying a session token for a request
 * that is about to be refused is work worth not doing.
 *
 * `authMiddleware` is still the default behaviour for everything that passes. Composing
 * here rather than inside `@zsms/auth-provider` keeps ADR-032 intact: `apps/web` imports
 * no Clerk symbol, and rate limiting is not an authentication concern that belongs in
 * the auth abstraction.
 *
 * The limiter fails OPEN. A Redis outage must not take a school's attendance register
 * down on a Monday morning — see `lib/rate-limit.ts` for the full trade.
 */
export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  const limited = await rateLimitResponse(request)
  if (limited) return limited

  return authMiddleware(request, event)
}

export const config = {
  // Skips `_next` internals and static assets — they carry no session, and
  // verifying one on every image is pure latency. API routes are matched
  // explicitly rather than left to the negative lookahead above them, because a
  // path like `/api/students/export.csv` would otherwise look asset-shaped and
  // silently bypass authentication.
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
