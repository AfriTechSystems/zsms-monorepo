/**
 * The right to erasure, self-service.
 *
 * Spec: `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *       Zambia Data Protection Act 2021
 *
 * `0187` built erasure as something AfriTech performs for somebody. That meets the
 * obligation only if the person can reach AfriTech — and the Act gives the right to the
 * data subject, so the request has to start with them.
 *
 * GET reports where they stand, including what cannot be erased and why. POST asks.
 * DELETE withdraws, which is what the grace period is for.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('my_erasure_status').maybeSingle()
    if (error) return fromPostgrestError(error)

    const row = (data ?? {}) as {
      out_pending?: boolean
      out_requested_at?: string | null
      out_action_after?: string | null
      out_can_request?: boolean
      out_blocked_why?: string | null
      out_retain_years?: number
    }

    return ok({
      pending: row.out_pending ?? false,
      requestedAt: row.out_requested_at ?? null,
      actionAfter: row.out_action_after ?? null,
      canRequest: row.out_can_request ?? false,
      // Why not, in the person's terms, shown before they fill anything in.
      blockedWhy: row.out_blocked_why ?? null,
      retainYears: row.out_retain_years ?? 6,
    })
  })
}

const askSchema = z.object({ reason: z.string().trim().max(1000).optional() })

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = askSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .rpc('request_my_erasure', { p_reason: parsed.data.reason ?? null })
      .maybeSingle()

    if (error) {
      if (error.code === '42501') return fail('UNAUTHORIZED', error.message)
      return fromPostgrestError(error)
    }

    const row = (data ?? {}) as {
      out_done?: boolean
      out_message?: string
      out_action_after?: string | null
    }

    // A refusal here is a real answer, not an error: a school owner is told the remedy.
    if (!row.out_done) return fail('CONFLICT', row.out_message ?? 'That could not be done.')

    return ok({ requested: true, message: row.out_message, actionAfter: row.out_action_after })
  })
}

export async function DELETE(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('withdraw_my_erasure').maybeSingle()
    if (error) return fromPostgrestError(error)

    const row = (data ?? {}) as { out_done?: boolean; out_message?: string }
    if (!row.out_done) return fail('NOT_FOUND', row.out_message ?? 'Nothing to withdraw.')

    return ok({ withdrawn: true, message: row.out_message })
  })
}
