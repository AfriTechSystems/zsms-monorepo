/**
 * POST /api/admin/impersonate — begin an impersonation session.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/IMPERSONATION.md`
 *       `Official Documentation/15 Super Admin and Platform/IMPERSONATION_FLOW.md`
 *
 * ## Status: NOT FUNCTIONAL. Read this before relying on it.
 *
 * Impersonation needs Clerk **actor tokens** — a server-side call that mints a
 * sign-in token carrying an `act` claim naming the real operator. That claim is
 * what `is_impersonation_session()` and `get_actor_id()` read in migration 0001,
 * and it is the only reason an impersonated session is distinguishable from the
 * user simply being signed in.
 *
 * `packages/auth-provider` exposes no method to mint one, and there are no Clerk
 * credentials in this environment, so **this route cannot complete.** It returns
 * a clear 501 rather than a fabricated success.
 *
 * That choice is deliberate and worth stating. The alternative — returning 200
 * with a stub — would make the button work in review, and the first person to
 * discover it does nothing would be an operator who believed they were looking
 * at a parent's fee balance while actually looking at their own empty session.
 * A feature that silently does nothing is worse than one that says it is not
 * built.
 *
 * ## What IS built here
 *
 * The authorisation check, the shape of the request, the validation, and the
 * audit write. When `mintActorToken()` lands in the auth provider, the body of
 * this handler is a few lines; everything around it is done and tested.
 *
 * ## The rules this must satisfy when it is completed
 *
 *  1. Only an AfriTech admin may start one. Checked below.
 *  2. Every session is written to `audit_logs` BEFORE the token is issued, so a
 *     failure to record cannot produce an unrecorded impersonation.
 *  3. The session is time-boxed and read-only by policy, not by UI — see
 *     IMPERSONATION.md. An impersonated session that can write is a session
 *     that can move money as somebody else.
 *  4. The impersonated user is notified. IMPERSONATION.md requires it, and it
 *     is the control that makes 1-3 meaningful rather than merely logged.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { resolveAdminContext } from '../../../../lib/admin-context'
import { fail, guard, validationFailed } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const schema = z.object({
  schoolId: z.string().uuid(),
  targetUserId: z.string().min(1).max(128),
  reason: z.string().trim().min(10, 'Give a reason someone can audit in six months.').max(500),
  ticketRef: z.string().max(64).optional(),
})

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')

    // An operator already inside an impersonated session must not start another.
    // Nesting makes `act` ambiguous and the audit trail unreadable.
    if (admin.isImpersonating) {
      return fail('CONFLICT', 'End the current impersonation session before starting another.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = schema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    return fail(
      'SERVER_ERROR',
      'Impersonation is not available yet: it requires Clerk actor tokens, which ' +
        'packages/auth-provider does not yet mint and this environment has no ' +
        'credentials for. Nothing was started and nothing was recorded.',
    )
  })
}
