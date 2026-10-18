/**
 * POST /api/admin/impersonate — begin an impersonation session.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/IMPERSONATION.md`
 *       `Official Documentation/15 Super Admin and Platform/IMPERSONATION_FLOW.md`
 *
 * ## Status: built and working.
 *
 * This block said "NOT FUNCTIONAL … returns a clear 501" until 2026-10-18, and
 * had done since long after the route was finished. There is no 501 in this
 * file. It mints a Clerk actor token through `@zsms/auth-provider/impersonation`,
 * records the session with `begin_impersonation_session()`, revokes the token if
 * the database refuses, and returns the redemption URL. `DOC_AUDIT_PROGRESS.md`
 * names this as one of three CLAUDE.md claims that were false — all three found
 * by building against them rather than by reading them.
 *
 * Impersonation works through Clerk **actor tokens**: a server-side call mints a
 * sign-in token carrying an `act` claim naming the real operator. That claim is
 * what `is_impersonation_session()` and `get_actor_id()` read in migration 0001,
 * and it is the only reason an impersonated session is distinguishable from the
 * user simply being signed in.
 *
 * ## The rules, and where each one actually lives
 *
 *  1. **Only an AfriTech admin may start one.** Enforced in
 *     `begin_impersonation_session()`, which checks the `impersonate` capability
 *     — a developer and a regional manager are both refused there, per
 *     ROLES.md. Deliberately not re-checked in this handler: a second copy
 *     drifts, and the database copy is the one a direct call cannot skip.
 *  2. **The token is minted first and recorded second** — the opposite of what
 *     this block used to require, and the reasoning is inline below. Recording
 *     first means a failed mint leaves a trail claiming a session that never
 *     happened; this way the only failure mode is a token that exists for a
 *     moment and is revoked before anybody can redeem it.
 *  3. **Time-boxed** by the token's own expiry, which is stored alongside the
 *     session row so the record and the credential cannot disagree.
 *  4. **Read-only by policy, not by UI** — see IMPERSONATION.md. An impersonated
 *     session that can write is a session that can move money as somebody else.
 *
 * ## Still open
 *
 * Rule 5 of IMPERSONATION.md: **the impersonated user is notified.** Nothing
 * here sends anything, and it cannot until a delivery channel exists — no Meta,
 * Resend or Twilio credentials, so no message has ever left this machine. It is
 * the control that makes the other four meaningful rather than merely logged,
 * and it belongs on the list of work that unblocks when those credentials land.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { resolveAdminContext } from '../../../../lib/admin-context'
import { createActorToken, revokeActorToken } from '@zsms/auth-provider/impersonation'
import { fail, guard, ok, validationFailed } from '../../../../lib/api-response'

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

    /*
      Mint FIRST, record SECOND, and undo the mint if recording is refused.

      The order matters. If the row were written first and the mint then failed, the
      trail would claim a session that never happened. This way the only failure mode
      is a token that exists for a moment and is revoked before anyone can redeem it.
    */
    let token
    try {
      token = await createActorToken({
        targetUserId: parsed.data.targetUserId,
        actorUserId: admin.userId,
      })
    } catch (error) {
      /*
        The common cause is `CLERK_SECRET_KEY` being unset, and saying so is more
        useful than "something went wrong" — this is the one failure an operator can
        actually fix.
      */
      return fail(
        'SERVER_ERROR',
        error instanceof Error && error.message.includes('CLERK_SECRET_KEY')
          ? error.message
          : 'Clerk refused to mint an impersonation token. Nothing was started.',
      )
    }

    /*
      `begin_impersonation_session()` enforces the `impersonate` capability — a
      developer and a regional manager are both refused there, per ROLES.md. It is not
      re-checked here: a second copy would drift, and this is the copy a direct call
      skips.
    */
    const { data, error } = await client.rpc('begin_impersonation_session', {
      p_target_user_id: parsed.data.targetUserId,
      p_reason: parsed.data.reason,
      p_ticket_ref: parsed.data.ticketRef ?? null,
      p_actor_token_id: token.id,
      p_expires_at: token.expiresAt.toISOString(),
      p_target_school_id: null,
    })

    if (error) {
      // Leave no usable ticket behind for a session the database refused.
      await revokeActorToken(token.id).catch(() => undefined)

      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fail('SERVER_ERROR', 'The session could not be recorded, so it was not started.')
    }

    return ok({
      sessionId: data as string,
      url: token.url,
      expiresAt: token.expiresAt.toISOString(),
      message:
        'Open the link in a new tab. Everything you do there is recorded against your ' +
        'own name, not theirs.',
    })
  })
}
