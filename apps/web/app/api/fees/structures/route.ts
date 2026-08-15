/**
 * /api/fees/structures — what a grade/term costs.
 *
 * Spec: `Official Documentation/01 Foundation Layer/RLS.md` — fee_structures
 *       `Official Documentation/09 Fees and Payments/`
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
import { createFeeStructureSchema } from '../../../../lib/validation'
import { resolveSchoolContext } from '../../../../lib/school-context'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const params = request.nextUrl.searchParams
    let query = client
      .from('fee_structures')
      .select(
        'id, school_id, academic_year, term_number, grade_id, student_type, fee_label, amount, currency_code, is_mandatory, is_active, created_at',
      )
      .eq('is_active', true)
      .order('term_number', { ascending: true })

    const year = params.get('academicYear')
    const term = params.get('termNumber')
    if (year) query = query.eq('academic_year', year)
    if (term) query = query.eq('term_number', Number(term))

    const { data, error } = await query
    if (error) return fromPostgrestError(error)
    return ok(data ?? [])
  })
}

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

    const parsed = createFeeStructureSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This session is not associated with a school.')

    const i = parsed.data
    const row: Record<string, unknown> = {
      school_id: school.uuid,
      academic_year: i.academicYear,
      term_number: i.termNumber,
      grade_id: i.gradeId,
      fee_label: i.feeLabel,
      amount: i.amount,
    }
    if (i.studentType !== undefined) row['student_type'] = i.studentType
    if (i.currencyCode !== undefined) row['currency_code'] = i.currencyCode
    if (i.isMandatory !== undefined) row['is_mandatory'] = i.isMandatory

    const { data, error } = await client
      .from('fee_structures')
      .insert(row)
      .select('id, academic_year, term_number, grade_id, student_type, fee_label, amount, currency_code')
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!data) return fail('FORBIDDEN', 'Only the owner or accountant may define fee structures.')

    return created(data)
  })
}
