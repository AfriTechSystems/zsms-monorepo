/**
 * Term dates.
 *
 *   POST /api/school/settings/terms — add or correct a term
 *
 * Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_CONFIG.md`
 *
 * ## Why there is no DELETE
 *
 * The repository grants DELETE nowhere in `public` — the invariant `0129` had to restore twice —
 * and here it also happens to be right on the merits. `fee_records`, `exam_results` and
 * `attendance_records` all carry `term_number`, so removing a term orphans rows that reference it
 * by number rather than by key. Correcting the dates is what a school actually needs; deleting a
 * term is an AfriTech support action.
 *
 * ## Overlap is the database's rule
 *
 * `0141`'s trigger rejects a term overlapping another and **names the one it collides with**. That
 * message is passed through rather than replaced: "those dates overlap 2026 term 1 (12 Jan to
 * 10 Apr)" turns a rejection into a correction, and nothing this file could compose would be
 * better informed.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const termSchema = z
  .object({
    id: z.string().uuid().optional(),
    academicYear: z.string().trim().min(4).max(9),
    // Not capped at three. Zambia runs three terms, but that is a fact about Zambia rather than a
    // constraint — ADR-040 already tracks five hardcoded CHECKs that each need a migration to
    // admit a second country, and this would have been a sixth.
    termNumber: z.number().int().min(1).max(6),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
  })
  .refine((t) => t.endsOn > t.startsOn, {
    message: 'The term must end after it starts.',
    path: ['endsOn'],
  })

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = termSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)
    const t = parsed.data

    const school = await client.from('schools').select('id').maybeSingle()
    if (school.error) return fromPostgrestError(school.error)
    if (!school.data) return fail('NOT_FOUND', 'No school in this session.')

    const row = {
      school_id: school.data.id,
      academic_year: t.academicYear,
      term_number: t.termNumber,
      starts_on: t.startsOn,
      ends_on: t.endsOn,
    }

    const { data, error } = t.id
      ? await client.from('school_term_dates').update(row).eq('id', t.id).select('id').maybeSingle()
      : await client.from('school_term_dates').insert(row).select('id').maybeSingle()

    if (error) {
      // The overlap trigger, and the end-before-start CHECK. Both name the problem precisely.
      if (error.code === '23514') return fail('CONFLICT', error.message)
      // The (school, year, term) uniqueness — saving term 2 twice for one year.
      if (error.code === '23505') {
        return fail(
          'CONFLICT',
          `Term ${t.termNumber} of ${t.academicYear} already exists. Edit it rather than adding it again.`,
        )
      }
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      return fromPostgrestError(error)
    }

    if (!data) {
      // Policy refused: `management_write_term_dates` is owner, principal and administrator only.
      // Term dates move fee issuing, mark entry and attendance at once, so this is a school
      // calendar decision rather than a departmental one.
      return fail(
        'FORBIDDEN',
        'Only the owner, principal or administrator can set term dates.',
      )
    }

    return ok({ id: data.id })
  })
}
