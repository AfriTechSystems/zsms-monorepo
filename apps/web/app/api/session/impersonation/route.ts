/**
 * GET/DELETE /api/session/impersonation — am I acting as somebody else?
 *
 * Spec: `02 Authentication and Identity/IMPERSONATION.md`
 *
 * ## Why this is under `session/` and not `admin/`
 *
 * During impersonation the caller IS the customer as far as every check is concerned —
 * `get_user_id()` returns the target and only `get_actor_id()` holds the operator. A
 * route under `/admin` would be gated to AfriTech and the banner would never load, which
 * is precisely the page where it matters most.
 *
 * So it is a session question, answerable by anybody: an ordinary user gets
 * `isImpersonating: false` and the banner renders nothing.
 */

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    // Not an error — a signed-out visitor is not being impersonated.
    if (!client) return ok({ isImpersonating: false })

    const { data, error } = await client.rpc('my_impersonation_context').maybeSingle()

    if (error) return fromPostgrestError(error)

    const row = data as {
      out_is_impersonating: boolean
      out_actor_user_id: string | null
      out_target_user_id: string | null
      out_reason: string | null
      out_started_at: string | null
      out_expires_at: string | null
    } | null

    return ok({
      isImpersonating: row?.out_is_impersonating ?? false,
      /*
        The ACTOR is deliberately not returned.

        The banner is rendered inside the customer's session, and the operator already
        knows who they are. Putting an AfriTech staff id into a page the customer could
        also be looking at discloses a real person for no benefit.
      */
      targetUserId: row?.out_target_user_id ?? null,
      reason: row?.out_reason ?? null,
      startedAt: row?.out_started_at ?? null,
      expiresAt: row?.out_expires_at ?? null,
    })
  })
}

export async function DELETE(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      This closes the ZSMS record. The Clerk session is ended by the browser leaving it
      — the banner navigates away, and the actor token lapses at `expires_at` regardless,
      which is why `0238` caps it at two hours.
    */
    const { data, error } = await client.rpc('end_impersonation_session', {
      p_reason: 'ended_by_actor',
    })

    if (error) return fromPostgrestError(error)

    return ok({
      ended: Boolean(data),
      message: data
        ? 'Impersonation ended.'
        : 'There was no open session to end.',
    })
  })
}
