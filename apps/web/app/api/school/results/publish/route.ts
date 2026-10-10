/**
 * POST /api/school/results/publish — make a term's marks visible to parents.
 *
 * Spec: `Official Documentation/11 Examinations and Results/`
 *
 * ## Publication is one-way, and the count is the confirmation
 *
 * `publish_results()` flips `results_published` and stamps `published_at` for
 * every complete mark in the scope, and returns how many rows moved. There is no
 * unpublish: a grade a parent has already seen cannot be taken back, only
 * corrected. So the screen's confirmation is that number, and the warning before
 * it is that the action does not reverse.
 *
 * ## A mark that was never entered is not published
 *
 * The function skips `marks_obtained IS NULL`. Publishing empty rows would lock
 * them — a teacher could no longer enter the mark — and would put a blank grade
 * on a report card. So an incomplete sheet publishes what exists and leaves the
 * gaps editable, which is what a school part-way through marking actually wants.
 * The response reports the count so "18 of 30" is visible rather than implied.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { can } from '../../../../../lib/roles'
import { resolveFeeCaller as resolveSchoolCaller } from '../../../../../lib/fee-context'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const publishSchema = z.object({
  academicYear: z.string().trim().regex(/^\d{4}(\/\d{4})?$/, 'Use 2026 or 2026/2027'),
  termNumber: z.number().int().min(1).max(4),
  // Absent publishes the whole term, which is the end-of-term action. Present
  // publishes one class, which is how a school releases results as each class
  // finishes marking.
  classId: z.string().trim().min(1).max(40).optional(),
})

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveSchoolCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'results:publish')) {
      return fail('FORBIDDEN', 'Only the school owner and the principal publish results.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = publishSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)
    const v = parsed.data

    const { data, error } = await client.rpc('publish_results', {
      p_academic_year: v.academicYear,
      p_term_number: v.termNumber,
      p_class_id: v.classId ?? null,
    })

    if (error) {
      // The function raises 42501 for anyone but owner/principal. The capability
      // check above already refused them, so reaching this means the session's
      // role and the database disagree — which is worth the database's sentence
      // rather than a generic 500.
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      return fromPostgrestError(error)
    }

    return ok({
      published: (data as number | null) ?? 0,
      academicYear: v.academicYear,
      termNumber: v.termNumber,
      classId: v.classId ?? null,
    })
  })
}
