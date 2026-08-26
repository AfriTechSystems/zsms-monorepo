/**
 * Who is asking about fees, and are they allowed to be.
 *
 * ## Why this is not in `app/api/school/fees/route.ts`
 *
 * It was, and Next.js rejected it. A `route.ts` module may export **only** the
 * HTTP handlers and a fixed set of config names (`dynamic`, `revalidate`, …);
 * anything else fails the generated route-type check with "not assignable to
 * type never". The four fee routes still need one shared answer to "who is this
 * caller", so the shared thing lives in `lib/` and the routes import it.
 *
 * Worth knowing generally: `next build` succeeds while this is wrong. The error
 * only appears from `tsc` against the generated `.next/types`, which do not
 * exist until a build has run — so type-checking a clean tree will not find it.
 */

import type { NextResponse } from 'next/server'

import { getAuthProvider, type Role } from '@zsms/auth-provider'

import { AFRITECH_ORG_SLUG } from './admin-context'
import { fail } from './api-response'

export type FeeCaller =
  | { ok: true; role: Role | 'none'; userId: string }
  | { ok: false; response: NextResponse }

/**
 * Resolves the caller, refusing anyone who is not inside a school.
 *
 * The AfriTech org is turned away explicitly: a platform admin has no school
 * context, so `get_school_id()` would resolve to nothing and every query would
 * quietly return zero rows. An empty fees page is a far worse answer than a
 * refusal, because it looks like a school with no debtors.
 */
export async function resolveFeeCaller(): Promise<FeeCaller> {
  const session = await getAuthProvider().getSessionUser()
  if (!session) return { ok: false, response: fail('UNAUTHORIZED', 'Authentication required.') }
  if (session.organisationSlug === AFRITECH_ORG_SLUG || !session.organisationId) {
    return { ok: false, response: fail('FORBIDDEN', 'This is a school endpoint.') }
  }
  return { ok: true, role: session.role, userId: session.userId }
}
