/**
 * /api/payments/[id]/verify — the verification decision.
 *
 * Calls verify_payment(), which is the only path that can move a payment out of
 * pending_verification. It checks the caller's role and tenant itself and
 * records who decided and when — end users hold no UPDATE privilege on the
 * table at all (migration 0076).
 *
 * Spec: `Official Documentation/01 Foundation Layer/RLS.md` — payments
 */

import type { NextRequest } from 'next/server'
import { createUserClient } from '../../../../../lib/supabase'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../../lib/api-response'
import { verifyPaymentSchema } from '../../../../../lib/validation'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return guard(async () => {
    const { id } = await context.params
    if (!UUID_RE.test(id)) return fail('VALIDATION_ERROR', 'Payment id must be a UUID.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = verifyPaymentSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const { decision, reason } = parsed.data
    if (decision === 'rejected' && !reason) {
      return fail('VALIDATION_ERROR', 'A rejection requires a reason.')
    }

    const { data, error } = await client.rpc('verify_payment', {
      p_payment_id: id,
      p_decision: decision,
      p_reason: reason ?? null,
    })

    if (error) {
      // The function distinguishes its own failure modes: 42501 for the wrong
      // role or another school's payment, P0002 for a payment that is not
      // visible, 23514 for a re-verification or a missing reason.
      if (error.code === 'P0002') return fail('NOT_FOUND', 'Payment not found.')
      if (error.code === '23514') return fail('CONFLICT', error.message)
      return fromPostgrestError(error)
    }

    const row = Array.isArray(data) ? data[0] : data
    return ok({
      id: row?.id,
      status: row?.status,
      verifiedBy: row?.verified_by ?? null,
      verifiedAt: row?.verified_at ?? null,
      rejectionReason: row?.rejection_reason ?? null,
    })
  })
}
