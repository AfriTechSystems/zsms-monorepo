/**
 * Year-end operations on the roll.
 *
 *   POST /api/school/students/year-end  { action: 'promote', dryRun }
 *   POST /api/school/students/year-end  { action: 'transfer', studentId, reason, … }
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
 *         → *Student Grade Promotion*
 *       `Official Documentation/07 Student and Parent Modules/TRANSFER.md`
 *
 * ## One route, two actions, because they are the same decision point
 *
 * Both are things a school does to the roll rather than to a pupil's details, and both are
 * reserved to the people who run the school. Splitting them would put two near-identical
 * permission checks in two files.
 *
 * ## `dryRun` defaults to TRUE and the route does not change that
 *
 * Promotion rewrites every pupil's grade in one statement and there is no undo short of a
 * restore. The function defaults to a preview; the caller has to ask for the real thing,
 * and the screen asks the human first.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('promote'),
    // Explicit rather than inferred: "I meant to actually do it" should be a thing the
    // caller says, not a default anybody inherits.
    dryRun: z.boolean().default(true),
  }),
  z.object({
    action: z.literal('transfer'),
    studentId: z.string().uuid(),
    reason: z.string().trim().min(4, 'Say briefly why the pupil is leaving.').max(500),
    destination: z.string().trim().max(200).optional(),
    // `graduated` is deliberately absent — graduating a cohort is decided against
    // examination results, not recorded as a pupil leaving.
    kind: z.enum(['transferred', 'withdrawn']).default('transferred'),
    /*
      TRANSFER.md marks this "(recommended)" and so does the form. Defaulted TRUE:
      the letter is what the receiving school asks for, and a school that forgets to
      tick it discovers the omission when a family is already standing at the next
      school's counter.
    */
    generateLetter: z.boolean().default(true),
  }),
])

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const input = parsed.data

    if (input.action === 'promote') {
      const { data, error } = await client.rpc('promote_students', { p_dry_run: input.dryRun })

      if (error) {
        // The function reserves this to the owner and principal, inside itself, because
        // `authenticated` covers every member of staff.
        if (error.code === '42501') return fail('FORBIDDEN', error.message)
        return fromPostgrestError(error)
      }

      const rows = (data ?? []) as Array<{
        out_from_grade: string
        out_to_grade: string
        out_pupils: number
        out_is_final: boolean
      }>

      return ok({
        dryRun: input.dryRun,
        grades: rows,
        // Counted here so the screen and the confirmation cannot disagree about how many
        // pupils an irreversible action is about to touch.
        moving: rows.filter((r) => !r.out_is_final).reduce((t, r) => t + r.out_pupils, 0),
        graduating: rows.filter((r) => r.out_is_final).reduce((t, r) => t + r.out_pupils, 0),
      })
    }

    const { data, error } = await client
      .rpc('transfer_student', {
        p_student_id: input.studentId,
        p_reason: input.reason,
        p_destination: input.destination ?? null,
        p_kind: input.kind,
      })
      .maybeSingle()

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    const row = (data ?? {}) as {
      out_done?: boolean
      out_access_until?: string
      out_message?: string
    }
    if (!row.out_done) return fail('NOT_FOUND', row.out_message ?? 'That pupil is not here.')

    /*
      The letter, queued after the transfer has committed.

      Order matters: the pupil's status is the thing that must not fail, and a letter
      is retryable. Queuing first would risk a letter for a transfer that did not
      happen.
    */
    let letterReference: string | null = null

    if (input.generateLetter) {
      try {
        const school = await client.rpc('current_school_uuid')
        const schoolId = (school.data as string | null) ?? null

        if (schoolId) {
          const ref = await client.rpc('next_transfer_reference', {
            p_school_id: schoolId,
          })
          letterReference = (ref.data as string | null) ?? null

          if (letterReference) {
            const { getQueue } = await import('@zsms/queue')
            await getQueue().enqueue(
              'generate-transfer-letter',
              { studentId: input.studentId, schoolId, transferReference: letterReference },
              {
                // Above a report-card batch: somebody may be waiting at the office
                // counter for a letter they need to take with them today.
                priority: 2,
                attempts: 3,
                backoff: { type: 'exponential', delay: 5000 },
                // One letter per reference, so a double-submit does not render twice.
                deduplicationId: `transfer-letter:${letterReference}`,
              },
            )
          }
        }
      } catch {
        /*
          Swallowed, deliberately — and reported honestly below.

          The transfer has already committed and must not be undone because a queue
          was unreachable. `letterReference` stays null, the response says the letter
          was not started, and the school can ask again rather than being told it
          exists when it does not.
        */
        letterReference = null
      }
    }

    return ok({
      done: true,
      // Surfaced so the screen can say so: a family keeps access for 30 days, and a school
      // expecting the record to vanish would otherwise think it had failed.
      accessUntil: row.out_access_until ?? null,
      letterReference,
      letterRequested: input.generateLetter,
      message: row.out_message,
    })
  })
}
