/**
 * GET  /api/school/fees/verify — payments recorded but not yet confirmed.
 * POST /api/school/fees/verify — confirm or reject one.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *
 * ## A recorded payment is a claim; a verified payment is money
 *
 * `pending_verification` rows do not move a balance — `recalculate_fee_record_balance()`
 * counts verified payments only. That separation is the entire control: a parent
 * or a clerk can say "I paid", and somebody with the authority to check the bank
 * confirms it. A dashboard that added the two together would report money the
 * school does not have.
 *
 * Verification is a named function rather than an UPDATE, and `authenticated`
 * holds no UPDATE privilege on `payments` at all. So the decision, the actor and
 * the timestamp are written together or not at all, and there is no path that
 * flips a status without recording who did it.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { can } from '../../../../../lib/roles'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../../lib/api-response'
import { resolveFeeCaller } from '../../../../../lib/fee-context'

export const dynamic = 'force-dynamic'

const decisionSchema = z
  .object({
    paymentId: z.string().uuid(),
    decision: z.enum(['verified', 'rejected']),
    reason: z.string().trim().max(300).optional(),
  })
  // A rejection with no reason leaves the person who recorded the payment with
  // nothing to act on, and the parent with nothing to be told.
  .refine((v) => v.decision !== 'rejected' || Boolean(v.reason), {
    message: 'Say why the payment was rejected — the person who recorded it needs to know.',
  })

export async function GET(): Promise<Response> {
  return guard(async () => {
    const caller = await resolveFeeCaller()
    if (!caller.ok) return caller.response
    if (!can(caller.role, 'fees:read')) return fail('FORBIDDEN', 'Your role does not include fees.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .from('payments')
      .select(
        'id, student_id, fee_record_id, amount, payment_method, status, receipt_number, ' +
          'recorded_by_user_id, notes, proof_of_payment_url, created_at, ' +
          'students(student_id, first_name, last_name)',
      )
      .eq('status', 'pending_verification')
      .order('created_at', { ascending: true })
      .limit(200)

    if (error) return fromPostgrestError(error)

    return ok({
      pending: data ?? [],
      // Verification is a `fees:write` act. A read-only finance viewer sees the
      // queue and cannot clear it, which is the correct shape for a review step.
      canVerify: can(caller.role, 'fees:write'),
    })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveFeeCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'fees:write')) {
      return fail('FORBIDDEN', 'Only the school owner and the accountant can verify payments.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = decisionSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const { paymentId, decision, reason } = parsed.data

    const { error } = await client.rpc('verify_payment', {
      p_payment_id: paymentId,
      p_decision: decision,
      p_reason: reason ?? null,
    })

    if (error) {
      // Two distinct refusals, and the difference is not cosmetic — found by
      // the pgTAP suite, which expected one code and caught the other.
      //
      //   P0002 — no such payment, or it belongs to another school.
      //   23514 — the payment exists and has ALREADY been decided. The
      //           function's own words: correct it with a reversal instead.
      //
      // Both mean the same thing to the person looking at the queue: the row
      // they clicked is not actionable any more, almost always because a second
      // person cleared it first. That is a stale screen, not a fault, so it
      // reads as one and the queue reloads.
      //
      // 23514 matters especially: without it, the commonest real collision —
      // two people confirming the same payment — fell through to a generic
      // SERVER_ERROR and looked like a bug in the product.
      if (error.code === 'P0002' || error.code === '23514') {
        return fail(
          'NOT_FOUND',
          'That payment is no longer awaiting verification — someone may have just handled it. Reload the queue.',
        )
      }
      return fromPostgrestError(error)
    }

    return ok({ paymentId, decision })
  })
}
