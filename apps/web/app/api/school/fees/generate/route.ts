/**
 * POST /api/school/fees/generate — turn fee structures into per-pupil bills.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/FEE_STRUCTURES.md`
 *
 * ## Structures are a price list; records are what a pupil owes
 *
 * A `fee_structure` says "Grade 8, term 1, tuition, K2,500". It bills nobody. A
 * `fee_record` is that amount attached to a named pupil, and it is what appears
 * on a statement, accrues arrears and receives a payment. Generation is the step
 * between them, and it is deliberately explicit rather than automatic on enrol:
 * a school sets its whole price list over several days, and a structure saved
 * halfway through that should not start billing.
 *
 * ## It is safe to run twice, and the response says what it did
 *
 * `generate_fee_records()` skips any pupil who already has a record for that
 * year/term/label rather than raising or duplicating, and returns both counts.
 * That matters because the honest answer to "I clicked it twice" is "the second
 * one created nothing", and a screen can only say so if the function reports
 * skips separately from creations.
 *
 * Running it again after enrolling a new pupil mid-term is therefore the
 * intended way to bill them — not an edge case to warn about.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { can } from '../../../../../lib/roles'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../../lib/api-response'
import { resolveFeeCaller } from '../../../../../lib/fee-context'

export const dynamic = 'force-dynamic'

const generateSchema = z.object({
  // `YYYY` or `YYYY/YYYY` — Zambian academic years are written both ways and
  // the column is text precisely so a school can use its own convention.
  academicYear: z.string().trim().regex(/^\d{4}(\/\d{4})?$/, 'Use 2026 or 2026/2027'),
  termNumber: z.number().int().min(1).max(3),
  dueDate: z.string().datetime().optional(),
})

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveFeeCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'fees:write')) {
      return fail('FORBIDDEN', 'Only the school owner and the accountant can issue fees.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = generateSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const { academicYear, termNumber, dueDate } = parsed.data

    const { data, error } = await client.rpc('generate_fee_records', {
      p_academic_year: academicYear,
      p_term_number: termNumber,
      p_due_date: dueDate ?? null,
    })

    if (error) return fromPostgrestError(error)

    const row = (data as Array<{ created_count: number; skipped_count: number }> | null)?.[0]

    return ok({
      created: row?.created_count ?? 0,
      // Reported separately, never folded into a single "processed" figure —
      // "0 created, 240 skipped" is the answer to "did I just double-bill
      // everyone", and it is only reassuring if it is visible.
      skipped: row?.skipped_count ?? 0,
      academicYear,
      termNumber,
    })
  })
}
