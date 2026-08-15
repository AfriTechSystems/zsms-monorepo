/**
 * /api/payments — submission and listing.
 *
 * A submitted payment always lands as `pending_verification` and moves no
 * balance. The client cannot name its own status: the field is not in the
 * schema, and the parent INSERT policy pins it besides.
 *
 * Spec: `Official Documentation/01 Foundation Layer/RLS.md` — payments
 */

import type { NextRequest } from 'next/server'
import { getAuthProvider } from '@zsms/auth-provider'
import { createUserClient } from '../../../lib/supabase'
import {
  created,
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../lib/api-response'
import { submitPaymentSchema } from '../../../lib/validation'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const params = request.nextUrl.searchParams
    const page = Math.max(1, Number(params.get('page') ?? 1))
    const perPage = Math.min(100, Math.max(1, Number(params.get('perPage') ?? 25)))
    const from = (page - 1) * perPage

    let query = client
      .from('payments')
      .select(
        'id, school_id, fee_record_id, student_id, amount, currency_code, payment_method, receipt_number, status, paid_at, verified_at, verified_by, rejection_reason, is_voided, created_at',
        { count: 'exact' },
      )
      .order('paid_at', { ascending: false })
      .range(from, from + perPage - 1)

    const status = params.get('status')
    const feeRecordId = params.get('feeRecordId')
    if (status) query = query.eq('status', status)
    if (feeRecordId) query = query.eq('fee_record_id', feeRecordId)

    const { data, error, count } = await query
    if (error) return fromPostgrestError(error)

    return ok(data ?? [], { page, perPage, total: count ?? 0 })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = submitPaymentSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)
    const i = parsed.data

    // school_id and student_id come from the fee record, not the request. A
    // client naming its own tenant or student is the whole attack.
    const { data: feeRecord, error: frError } = await client
      .from('fee_records')
      .select('id, school_id, student_id, currency_code')
      .eq('id', i.feeRecordId)
      .maybeSingle()

    if (frError) return fromPostgrestError(frError)
    if (!feeRecord) return fail('NOT_FOUND', 'Fee record not found.')

    const row: Record<string, unknown> = {
      school_id: feeRecord.school_id,
      fee_record_id: feeRecord.id,
      student_id: feeRecord.student_id,
      recorded_by_user_id: session.userId,
      amount: i.amount,
      currency_code: feeRecord.currency_code,
      payment_method: i.paymentMethod,
      status: 'pending_verification',
      confirmation_checkbox_at: new Date().toISOString(),
    }
    if (i.bankName !== undefined) row['bank_name'] = i.bankName
    if (i.chequeNumber !== undefined) row['cheque_number'] = i.chequeNumber
    if (i.gatewayName !== undefined) row['gateway_name'] = i.gatewayName
    if (i.gatewayReference !== undefined) row['gateway_reference'] = i.gatewayReference
    if (i.proofOfPaymentUrl !== undefined) row['proof_of_payment_url'] = i.proofOfPaymentUrl
    if (i.notes !== undefined) row['notes'] = i.notes
    if (i.paidAt !== undefined) row['paid_at'] = i.paidAt

    // receipt_number is omitted deliberately — the 0075 trigger assigns it
    // under a row lock, which is the only race-free way to number receipts.
    const { data, error } = await client
      .from('payments')
      .insert(row)
      .select('id, receipt_number, amount, currency_code, payment_method, status, paid_at')
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!data) return fail('FORBIDDEN', 'You may not submit a payment against this fee record.')

    return created(data)
  })
}
