/**
 * /api/fees/structures — what a grade/term costs.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/FEE_STRUCTURES.md`
 *       `Official Documentation/01 Foundation Layer/RLS.md` — fee_structures
 *
 * ## Three operations the builder needs that this route did not have
 *
 * The table and the single-line POST have existed since `0070`; no screen ever let a school
 * define a fee, so the module looked unbuilt while the backend was complete. Building the
 * editor surfaced three gaps against the specification:
 *
 *   * **a fee line applies to SEVERAL terms.** `FEE_STRUCTURES.md` shows term checkboxes —
 *     an exam fee in Term 3 only, tuition in all three. The table stores one row per term,
 *     so the route takes `termNumbers` and writes the set. All or nothing: a school told
 *     "saved" having got two terms out of three would discover it a term later, when fee
 *     records generate wrong.
 *   * **copying a year forward with an increase.** Every school does this annually, and the
 *     alternative is retyping forty lines — which is where transcription errors in money
 *     come from.
 *   * **retiring a line.** `is_active` exists for exactly this. A fee that no longer applies
 *     must stop generating records WITHOUT disappearing from history, because records
 *     already generated from it reference what the school charged.
 *
 * Business rule 3 governs all of it: changing a structure never alters fee records already
 * generated. `fee_records.amount_due` is copied at generation time and preserved — so this
 * route only ever describes what FUTURE generation will charge.
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
import { createFeeStructureSchema, updateFeeStructureSchema } from '../../../../lib/validation'
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

    /*
      One row per term. `termNumbers` is the term checkboxes from the specification; the
      single `termNumber` stays accepted so existing callers are unaffected.

      Inserted as ONE array, so PostgREST sends a single statement: either every term is
      written or none is. A partial save on a fee schedule is the kind of error nobody finds
      until invoices generate for the wrong terms.
    */
    const terms = i.termNumbers && i.termNumbers.length > 0 ? i.termNumbers : [i.termNumber]
    const rows = terms.map((term) => ({ ...row, term_number: term }))

    const { data, error } = await client
      .from('fee_structures')
      .insert(rows)
      .select('id, academic_year, term_number, grade_id, student_type, fee_label, amount, currency_code')

    if (error) return fromPostgrestError(error)
    if (!data || data.length === 0) {
      return fail('FORBIDDEN', 'Only the owner or accountant may define fee structures.')
    }

    return created({ lines: data, count: data.length })
  })
}

/**
 * Retire a fee line, or bring it back.
 *
 * `is_active = false` rather than DELETE. Fee records already generated from this line
 * reference what the school charged, and a school asked in March why a pupil owes a fee that
 * no longer exists needs the line to still be there. It simply stops generating new records.
 */
export async function PATCH(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = updateFeeStructureSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    // No school filter: the policies scope `fee_structures` to the caller's own school, and
    // a second rule here saying the same thing is one that can drift from the first.
    const { data, error } = await client
      .from('fee_structures')
      .update({ is_active: parsed.data.isActive, updated_at: new Date().toISOString() })
      .eq('id', parsed.data.id)
      .select('id, is_active')
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!data) {
      // Not found and not permitted are one answer: distinguishing them would confirm that
      // another school's fee line id exists.
      return fail('NOT_FOUND', 'That fee line is not available to change.')
    }

    return ok(data)
  })
}
