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

  /*
    Proof of payment, as a stored path from `POST /api/parent/fees/proof`.

    `PAYMENTS.md` has the submit button "disabled until checkbox is checked and proof
    uploaded", and the server-side schema marks `proof_of_payment_url` as "Required —
    cannot be empty". Optional HERE and not there, for one reason: a parent who paid
    cash at the school office has no confirmation to photograph, and refusing their
    claim would push them back to the telephone. The school sees plainly that a claim
    arrived without proof.
  */
  proofPath: z.string().trim().max(500).optional(),

  /*
    Set when the parent has seen the duplicate warning and means it anyway.

    `PAYMENTS.md`: "the submit button still works after the parent acknowledges." A
    parent who genuinely paid twice with one mistyped reference must not be blocked from
    recording the second payment.
  */
  acknowledgeDuplicate: z.boolean().optional(),

  /*
    When the parent ticked the confirmation box, from their own clock.

    Required. This is the declaration — "I confirm that this payment has been made...
    false submissions may result in account suspension" — and until `0213` the database
    manufactured it with NOW(), which recorded the declaration as made whether or not
    anybody made it. The freshness window is enforced in `allocate_payment()`.
  */
  confirmedAt: z.string().datetime(),

  /*
    Which terms the parent says this payment is for.

    Omitted means oldest-first, which is arrears-first, and is the default a parent who
    just wants to pay what they owe should get. Supplied when they choose — a parent
    paying this term while leaving an older balance alone is a real and legitimate
    thing to do, and silently applying it to the arrears instead would be ZSMS deciding
    something it was not asked to decide.

    The amounts are checked against the payment total, and each record against the
    pupil, inside `allocate_payment()`.
  */
  allocations: z
    .array(
      z.object({
        feeRecordId: z.string().uuid(),
        amount: z.number().positive().max(9_999_999.99),
      }),
    )
    .min(1)
    .max(20)
    .optional(),
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

    const [balance, statement, records, payments, accounts] = await Promise.all([
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
      /*
        Where to actually pay.

        `0212` exists because this was missing: a parent could record a claim while ZSMS
        could not tell them the account number to pay into, so they rang the school —
        the thing this product exists to stop. Read through the parent branch of
        `school_members_read_payment_details`, which resolves through the link row since
        a parent's `current_school_uuid()` does not scope their data.
      */
      client
        .from('school_payment_details')
        .select(
          'id, method_kind, label, bank_name, account_name, account_number, branch, provider, phone_number, instructions',
        )
        .eq('school_id', child.school_id)
        .eq('is_active', true)
        .order('display_order', { ascending: true }),
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
      /*
        A failure here does not fail the page.

        A parent must still be able to read their balance and their payment history if
        the account list cannot be loaded — and an empty list is also the honest state
        for a school that has not entered its details yet.
      */
      accounts: accounts.error ? [] : (accounts.data ?? []),
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

    /*
      Has this reference been recorded before?

      `PAYMENTS.md` specifies a duplicate WARNING the parent may acknowledge and proceed
      past, so this reports rather than refuses. `0213` built
      `payment_reference_already_used()` and nothing called it — found by `npm run gaps`,
      which is exactly the failure that script exists to catch: a function that is
      correct and unreachable.

      A failed check does NOT block the claim. The warning is advice, and losing the
      advice must not lose the payment.
    */
    let duplicateOf: Array<{ amount: number; status: string; submittedAt: string }> = []

    if (v.reference && !v.acknowledgeDuplicate) {
      const dup = await client.rpc('payment_reference_already_used', {
        p_student_id: child.id,
        p_reference: v.reference,
      })

      const rows = (dup.data ?? []) as Array<{
        out_amount: number
        out_status: string
        out_submitted: string
      }>

      if (!dup.error && rows.length > 0) {
        duplicateOf = rows.map((r) => ({
          amount: Number(r.out_amount),
          status: r.out_status,
          submittedAt: r.out_submitted,
        }))

        /*
          CONFLICT, not VALIDATION_ERROR: the request is well formed and the parent may
          legitimately mean it. The screen shows what it found and offers to go ahead,
          which resends with `acknowledgeDuplicate`.
        */
        return fail(
          'CONFLICT',
          `You have already recorded a payment with the reference ${v.reference}. Check below, then confirm if this is a different payment.`,
          { duplicateOf },
        )
      }
    }

    /*
      A claim is recorded through `allocate_payment()`, not a direct insert.

      The function splits one lump sum across fee records — oldest first by default,
      which is arrears first — and `payments` holds ONE `fee_record_id` per row, so a
      payment spanning two terms is genuinely two rows. The direct insert this replaced
      attached the whole amount to the oldest outstanding record and could not express
      that at all.

      It is SECURITY INVOKER, so `parent_submit_payment` still decides whether this
      caller may write. Nothing is trusted from the body: the allocation targets are
      checked against the pupil inside the function.
    */
    const { data, error } = await client.rpc('allocate_payment', {
      p_student_id: child.id,
      p_amount: v.amount,
      p_payment_method: v.paymentMethod,
      p_allocations: v.allocations
        ? v.allocations.map((a) => ({ fee_record_id: a.feeRecordId, amount: a.amount }))
        : null,
      p_notes: v.notes ?? null,
      p_proof_url: v.proofPath ?? null,
      // The parent's own tick, passed through and never replaced. See the schema.
      p_confirmation_at: v.confirmedAt,
      p_transaction_reference: v.reference ?? null,
    })

    if (error) {
      if (error.code === '42501') {
        return fail(
          'FORBIDDEN',
          'That payment could not be recorded against this pupil. Contact the school office.',
        )
      }
      /*
        `22023` covers every refusal the function raises — a stale confirmation, an
        allocation that does not add up, nothing outstanding. Its messages are written
        for a parent to read, so they are passed through rather than replaced with a
        generic line.
      */
      if (error.code === '22023') {
        return fail('VALIDATION_ERROR', error.message)
      }
      return fromPostgrestError(error)
    }

    const rows = (data ?? []) as Array<{
      out_payment_id: string
      out_fee_record_id: string
      out_amount: number
    }>

    if (rows.length === 0) return fail('FORBIDDEN', 'That payment could not be recorded.')

    return created({
      /*
        Every row the claim produced, because one claim across two terms is two rows and
        a parent who sees only the first will think half their money vanished.
      */
      payments: rows.map((r) => ({
        id: r.out_payment_id,
        feeRecordId: r.out_fee_record_id,
        amount: r.out_amount,
      })),
      // Never "paid". The school has been told; it has not agreed.
      message: v.proofPath
        ? 'The school has been told about your payment, with your proof attached. It will appear against your balance once they have confirmed it.'
        : 'The school has been told about your payment. It will appear against your balance once they have confirmed it.',
    })
  })
}
