/**
 * GET  /api/school/fees/[studentId] — the statement, the balance, and how a
 *      payment of a given amount would be allocated.
 * POST /api/school/fees/[studentId] — record a payment against that pupil.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *       `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *
 * ## The statement carries a brought-forward line, and that is the point
 *
 * `fee_statement()` opens a windowed statement with a computed
 * `brought_forward` entry — the balance owed *before* the window starts. Without
 * it a term statement shows a term's charges and a term's payments and a closing
 * figure that matches neither, because last year's unpaid balance is invisible
 * and still owed. Zambian school fees carry across terms and across years, so a
 * statement that starts at zero every term is a statement that lies.
 *
 * ## The allocation is a suggestion, and the operator can overrule it
 *
 * `suggest_payment_allocation()` fills the oldest unpaid record first, which is
 * right almost always and wrong exactly when it matters — a parent paying this
 * term's fees while last term's amount is under dispute. So the API returns the
 * suggestion, and `allocate_payment()` accepts an explicit allocation that
 * overrides it. The database still refuses an allocation totalling more than the
 * payment, and one that targets another pupil's record.
 *
 * A recorded payment is `pending_verification` and does not move the balance.
 * That is the whole design: money is claimed here and confirmed elsewhere.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { can } from '../../../../../lib/roles'
import {
  created,
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../../lib/api-response'
import { resolveFeeCaller } from '../../../../../lib/fee-context'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const money = z
  .number()
  .positive()
  .max(9_999_999_999.99)
  .refine((v) => Math.round(v * 100) === v * 100, { message: 'At most two decimal places' })

const paySchema = z.object({
  amount: money,
  paymentMethod: z.enum([
    'cash',
    'bank_deposit',
    'cheque',
    'online_gateway',
    'loan_disbursement',
    'waiver',
  ]),
  notes: z.string().trim().max(500).optional(),
  /**
   * An explicit allocation, overriding oldest-first.
   *
   * Absent means "use the suggestion", which is the common case. Present means
   * somebody deliberately chose where the money goes — see the header.
   */
  allocations: z
    .array(z.object({ feeRecordId: z.string().uuid(), amount: money }))
    .min(1)
    .optional(),
})

type RouteContext = { params: Promise<{ studentId: string }> }

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return guard(async () => {
    const caller = await resolveFeeCaller()
    if (!caller.ok) return caller.response
    if (!can(caller.role, 'fees:read')) return fail('FORBIDDEN', 'Your role does not include fees.')

    const { studentId } = await context.params
    if (!UUID_RE.test(studentId)) return fail('VALIDATION_ERROR', 'Student id must be a UUID.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    // The amount being allocated, if the screen is previewing one. Absent on
    // first load, when there is nothing to allocate yet.
    const previewRaw = request.nextUrl.searchParams.get('amount')
    const preview = previewRaw ? Number(previewRaw) : 0

    const [pupil, balance, statement, records, payments, suggestion] = await Promise.all([
      client
        .from('students')
        .select('id, student_id, first_name, last_name, grade_id, class_id, status')
        .eq('id', studentId)
        .maybeSingle(),
      client.from('student_fee_balance').select('*').eq('student_id', studentId).maybeSingle(),
      client.rpc('fee_statement', { p_student_id: studentId }),
      client
        .from('fee_record_status')
        .select('*')
        .eq('student_id', studentId)
        .order('due_date', { ascending: true }),
      client
        .from('payments')
        .select('id, amount, payment_method, status, receipt_number, paid_at, created_at, verified_at, notes')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(50),
      preview > 0
        ? client.rpc('suggest_payment_allocation', { p_student_id: studentId, p_amount: preview })
        : Promise.resolve({ data: [], error: null }),
    ])

    // A pupil this caller cannot see is not-found, never forbidden — answering
    // 403 would confirm the id belongs to somebody at another school.
    if (!pupil.data) return fail('NOT_FOUND', 'Pupil not found.')
    if (statement.error) return fromPostgrestError(statement.error)

    return ok({
      pupil: pupil.data,
      balance: balance.data ?? null,
      statement: statement.data ?? [],
      records: records.data ?? [],
      payments: payments.data ?? [],
      suggestion: suggestion.data ?? [],
      canRecord: can(caller.role, 'fees:write'),
    })
  })
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return guard(async () => {
    const caller = await resolveFeeCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'fees:write')) {
      return fail('FORBIDDEN', 'Only the school owner and the accountant can record payments.')
    }

    const { studentId } = await context.params
    if (!UUID_RE.test(studentId)) return fail('VALIDATION_ERROR', 'Student id must be a UUID.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = paySchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const v = parsed.data

    // Checked here so the message names the arithmetic. `allocate_payment` also
    // refuses it with 22023 — the database is the guarantee, this is the better
    // sentence.
    if (v.allocations) {
      const total = v.allocations.reduce((t, a) => t + a.amount, 0)
      if (Math.round(total * 100) > Math.round(v.amount * 100)) {
        return fail(
          'VALIDATION_ERROR',
          `The allocation totals more than the payment — ${total.toFixed(2)} allocated of ${v.amount.toFixed(2)} received.`,
        )
      }
    }

    const { data, error } = await client.rpc('allocate_payment', {
      p_student_id: studentId,
      p_amount: v.amount,
      p_payment_method: v.paymentMethod,
      p_allocations: v.allocations
        ? v.allocations.map((a) => ({ fee_record_id: a.feeRecordId, amount: a.amount }))
        : null,
      p_notes: v.notes ?? null,
      p_proof_url: null,
      /*
        NULL, deliberately.

        `confirmation_checkbox_at` records that a PERSON ticked a declaration —
        "I confirm that this payment has been made". An accountant recording cash
        over the counter ticked nothing, and until `0213` this function wrote
        `NOW()` on every row regardless, so the column said yes for payments
        nobody had ever confirmed. Absent is the honest answer.
      */
      p_confirmation_at: null,
      // The accountant path has its own fields for a bank or cheque reference;
      // this column is what a PAYER typed, which here is nobody.
      p_transaction_reference: null,
    })

    if (error) {
      if (error.code === '22023') {
        return fail('VALIDATION_ERROR', 'That allocation does not add up to the payment received.')
      }
      return fromPostgrestError(error)
    }

    const rows = (data ?? []) as Array<{ out_receipt_number: string }>
    return created({
      allocations: data ?? [],
      // Every row is one payment against one fee record, so a lump sum spanning
      // two terms produces two — each with its own receipt number.
      receiptNumbers: rows.map((r) => r.out_receipt_number),
    })
  })
}
