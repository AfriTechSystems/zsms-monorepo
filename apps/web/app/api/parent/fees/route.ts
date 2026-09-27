/**
 * GET  /api/parent/fees — a child's statement and payment history.
 * POST /api/parent/fees — tell the school about a payment you have made.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *
 * ## A parent submits a claim, not a payment
 *
 * `parent_submit_payment` exists in RLS, and what it permits is narrow and
 * correct: a parent records that they have paid, as `pending_verification`. It
 * moves no balance. The school confirms it against the bank.
 *
 * That is not a limitation to work around — it is the control. A parent-declared
 * payment that reduced a balance immediately would let anybody clear their fees by
 * typing a number. So this route refuses to set a status, and the response says
 * "told the school" rather than "paid".
 *
 * ## No gateway here
 *
 * `payment_method` admits `online_gateway`, and a real card or mobile-money
 * integration would confirm its own payments through a webhook — a different and
 * trusted path (`webhook_verified` on `payments`). This endpoint is for a parent
 * reporting a bank deposit or a cash payment at the office, so the gateway method
 * is not offered. Offering it would let a parent assert a gateway payment nobody
 * charged.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok, created, validationFailed } from '../../../../lib/api-response'
import { listParentChildren, pickChild, resolveParentCaller } from '../../../../lib/parent-context'

export const dynamic = 'force-dynamic'

const submitSchema = z.object({
  childId: z.string().uuid(),
  amount: z
    .number()
    .positive()
    .max(9_999_999.99)
    .refine((v) => Math.round(v * 100) === v * 100, { message: 'At most two decimal places' }),
  // Deliberately no `online_gateway` — see the header.
  paymentMethod: z.enum(['cash', 'bank_deposit', 'cheque']),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
})

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveParentCaller()
    if (!caller.ok) return caller.response

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const children = await listParentChildren(client)
    if (children.length === 0) return ok({ children: [], selected: null })

    const child = pickChild(children, request.nextUrl.searchParams.get('childId'))
    if (!child) return fail('NOT_FOUND', 'That pupil is not one of your children.')

    const [balance, statement, records, payments] = await Promise.all([
      client.from('student_fee_balance').select('*').eq('student_id', child.id).maybeSingle(),
      // The same brought-forward statement the school sees. A parent disputing a
      // figure and a bursar defending it should be reading one document.
      client.rpc('fee_statement', { p_student_id: child.id }),
      client
        .from('fee_record_status')
        .select('*')
        .eq('student_id', child.id)
        .order('due_date', { ascending: true }),
      client
        .from('payments')
        .select(
          'id, amount, payment_method, status, receipt_number, notes, ' +
            'created_at, verified_at, rejection_reason',
        )
        .eq('student_id', child.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    if (statement.error) return fromPostgrestError(statement.error)

    return ok({
      children: children.map((c) => ({
        id: c.id,
        studentId: c.student_id,
        firstName: c.first_name,
        lastName: c.last_name,
      })),
      selected: {
        id: child.id,
        studentId: child.student_id,
        firstName: child.first_name,
        lastName: child.last_name,
      },
      balance: balance.data ?? null,
      statement: statement.data ?? [],
      records: records.data ?? [],
      payments: payments.data ?? [],
    })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveParentCaller()
    if (!caller.ok) return caller.response

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = submitSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)
    const v = parsed.data

    // The child must be theirs. Established from the policy-scoped list rather
    // than trusted from the body — and a child that is not theirs is not-found,
    // never forbidden, so the answer does not confirm the id exists.
    const children = await listParentChildren(client)
    const child = children.find((c) => c.id === v.childId)
    if (!child) return fail('NOT_FOUND', 'That pupil is not one of your children.')

    // The oldest unpaid record, so the payment attaches to something. A parent
    // does not choose an allocation — the school does, and may overrule
    // oldest-first when it verifies.
    const { data: target, error: targetError } = await client
      .from('fee_record_status')
      .select('id, outstanding')
      .eq('student_id', child.id)
      .gt('outstanding', 0)
      .order('due_date', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (targetError) return fromPostgrestError(targetError)
    if (!target) {
      return fail(
        'CONFLICT',
        'There is nothing outstanding on this pupil, so there is nothing to record a payment against. If you think that is wrong, contact the school office.',
      )
    }

    const { data, error } = await client
      .from('payments')
      .insert({
        school_id: child.school_id,
        student_id: child.id,
        fee_record_id: (target as { id: string }).id,
        amount: v.amount,
        payment_method: v.paymentMethod,
        recorded_by_user_id: caller.caller.userId,
        // Not set by this route at all where it can be avoided — but `status` has
        // no default that means "claimed", so it is stated explicitly and the RLS
        // WITH CHECK on `parent_submit_payment` is what guarantees a parent cannot
        // write anything else.
        status: 'pending_verification',
        notes: [v.reference ? `Reference: ${v.reference}` : null, v.notes]
          .filter(Boolean)
          .join(' — ') || null,
      })
      .select('id, amount, status, created_at')
      .maybeSingle()

    if (error) {
      if (error.code === '42501') {
        return fail(
          'FORBIDDEN',
          'That payment could not be recorded against this pupil. Contact the school office.',
        )
      }
      return fromPostgrestError(error)
    }

    if (!data) return fail('FORBIDDEN', 'That payment could not be recorded.')

    return created({
      payment: data,
      // Never "paid". The school has been told; it has not agreed.
      message:
        'The school has been told about your payment. It will appear against your balance once they have confirmed it.',
    })
  })
}
