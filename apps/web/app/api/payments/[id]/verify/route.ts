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

    // A verified payment triggers the receipt and the parent notification.
    // Enqueued, not awaited: rendering a PDF and calling Meta must not sit
    // inside the request an accountant is waiting on, and a provider outage
    // must not fail a verification that has already been recorded.
    //
    // The payload carries the payment ID and nothing else — the worker fetches
    // the amount, the phone number, and the guardian by ID at processing time.
    if (row?.status === 'verified') {
      try {
        const { getQueue } = await import('@zsms/queue')
        await getQueue().enqueue(
          'generate-receipt',
          { paymentId: id },
          {
            priority: 1, // HIGH — a parent is waiting on confirmation.
            attempts: 5,
            backoff: { type: 'exponential', delay: 2000 },
            // Same payment verified twice must not produce two receipts.
            deduplicationId: `receipt:${id}`,
          },
        )
      } catch (err) {
        // The verification stands regardless. Losing the receipt job is
        // recoverable — a reconciliation sweep can re-enqueue it — whereas
        // failing the response would leave the accountant unsure whether the
        // money was recorded at all.
        console.error('[api] failed to enqueue receipt for payment', id, err)
      }
    }

    return ok({
      id: row?.id,
      status: row?.status,
      verifiedBy: row?.verified_by ?? null,
      verifiedAt: row?.verified_at ?? null,
      rejectionReason: row?.rejection_reason ?? null,
    })
  })
}
