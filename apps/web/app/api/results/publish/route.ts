/**
 * /api/results/publish — the principal's publication action.
 *
 * Publication is the lock: once a result is published a teacher can no longer
 * edit the mark, and parents and students can see it. Both halves are enforced
 * in policy, not here.
 *
 * Delegates to publish_results(), which checks the role itself and skips rows
 * with no mark entered — publishing NULLs would lock empty rows and print blank
 * grades on a report card.
 *
 * Spec: `Official Documentation/01 Foundation Layer/RLS.md` — exam_results
 */

import type { NextRequest } from 'next/server'
import { createUserClient } from '../../../../lib/supabase'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'
import { publishResultsSchema } from '../../../../lib/validation'

export const dynamic = 'force-dynamic'

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

    const parsed = publishResultsSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const { academicYear, termNumber, classId } = parsed.data

    const { data, error } = await client.rpc('publish_results', {
      p_academic_year: academicYear,
      p_term_number: termNumber,
      p_class_id: classId ?? null,
    })

    if (error) return fromPostgrestError(error)

    return ok({
      published: typeof data === 'number' ? data : 0,
      academicYear,
      termNumber,
      classId: classId ?? null,
      // Publication is irreversible through this API. Unpublishing would let a
      // mark change after parents have seen it; if it is ever needed it should
      // be a separate, audited action.
    })
  })
}
