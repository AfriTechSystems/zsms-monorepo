/**
 * /api/fees/records — the per-student ledger.
 *
 * GET  lists what the caller may see. A parent sees only their own children's
 *      records; RLS decides, not a filter here.
 * POST generates records for a term from the active fee structures.
 *
 * Spec: `Official Documentation/01 Foundation Layer/RLS.md` — fee_records
 */

import type { NextRequest } from 'next/server'
import { createUserClient } from '../../../../lib/supabase'
import {
  created,
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'
import { generateFeeRecordsSchema, listFeeRecordsQuerySchema } from '../../../../lib/validation'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = listFeeRecordsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    )
    if (!parsed.success) return validationFailed(parsed.error)

    const { page, perPage, studentId, academicYear, termNumber, status } = parsed.data
    const from = (page - 1) * perPage

    let query = client
      .from('fee_records')
      .select(
        'id, school_id, student_id, academic_year, term_number, fee_label, amount_due, amount_paid, discount_amount, currency_code, status, due_date, created_at',
        { count: 'exact' },
      )
      .eq('is_deleted', false)
      .order('due_date', { ascending: true, nullsFirst: false })
      .range(from, from + perPage - 1)

    if (studentId) query = query.eq('student_id', studentId)
    if (academicYear) query = query.eq('academic_year', academicYear)
    if (termNumber) query = query.eq('term_number', termNumber)
    if (status) query = query.eq('status', status)

    const { data, error, count } = await query
    if (error) return fromPostgrestError(error)

    return ok(data ?? [], { page, perPage, total: count ?? 0 })
  })
}

/**
 * Generates the term's fee records.
 *
 * Delegates to generate_fee_records(), which is idempotent and does the whole
 * job in one statement. Doing this in the route — read structures, read
 * students, insert one by one — would be both slow and racy, and a partial run
 * would leave a term half-billed.
 */
export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = generateFeeRecordsSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const { academicYear, termNumber, dueDate } = parsed.data

    const { data, error } = await client.rpc('generate_fee_records', {
      p_academic_year: academicYear,
      p_term_number: termNumber,
      p_due_date: dueDate ?? null,
    })

    if (error) {
      // The function raises 42501 itself when the caller lacks the finance role,
      // so the mapping in fromPostgrestError already yields FORBIDDEN.
      return fromPostgrestError(error)
    }

    const result = Array.isArray(data) ? data[0] : data
    return created({
      createdCount: result?.created_count ?? 0,
      skippedCount: result?.skipped_count ?? 0,
      academicYear,
      termNumber,
    })
  })
}
