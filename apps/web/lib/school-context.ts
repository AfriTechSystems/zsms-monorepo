/**
 * Resolves the caller's school from their session.
 *
 * INSERT policies require `school_id = current_school_uuid()`, so a write needs
 * the school's UUID in the payload. It is resolved from the JWT here — never
 * accepted from the request body. A client that can nominate its own school_id
 * can write into another tenant, and the WITH CHECK would be the only thing
 * standing in the way. Deriving it removes the question.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface SchoolContext {
  /** schools.id — the UUID other tables key on. */
  uuid: string
  /** schools.school_id — the human-readable ZM-LSK-0001 form. */
  code: string
}

export async function resolveSchoolContext(
  client: SupabaseClient,
): Promise<SchoolContext | null> {
  // RLS restricts this to the caller's own school row, so no filter is needed:
  // the policy IS the filter. maybeSingle() keeps "no school" as null rather
  // than an exception, which is the correct state for a platform-level account.
  //
  // ONE CALLER IS NOT SO RESTRICTED. `afritech_admin_all_schools` matches every
  // row, so an AfriTech operator's query returns many and `maybeSingle()`
  // errors. That is handled here as "no school", which is the truthful answer —
  // a platform operator does not have one — rather than propagating a driver
  // error the caller cannot act on. Routes that must refuse an operator outright
  // check the org slug before reaching this (see `/api/school/overview`).
  const { data, error } = await client
    .from('schools')
    .select('id, school_id')
    .limit(2)

  const row = data?.[0]
  if (error || !row || data.length !== 1) return null
  return { uuid: row.id as string, code: row.school_id as string }
}

/**
 * Builds the next student identifier: STU-<school code>-<5-digit sequence>,
 * e.g. STU-ZM-LSK-0001-00042 (CONVENTIONS.md).
 *
 * ## Why MAX of the existing suffix, not a row count
 *
 * This used to read `count(*)` and add one. Two problems with that, and the
 * second is the one that bites:
 *
 *   - Two concurrent enrolments compute the same sequence. The UNIQUE constraint
 *     on `student_id` refuses the second, so no duplicate is created — see the
 *     retry at the call site, which turns that into a successful enrolment
 *     rather than a confusing conflict.
 *   - **A count collides permanently once numbering has a gap.** If the highest
 *     existing sequence is ever greater than the row count — a hard delete, a
 *     manual insert, a migration that seeded ids directly — then count+1 names a
 *     row that already exists, the UNIQUE constraint refuses it, and *every*
 *     subsequent enrolment computes the same taken number and fails the same
 *     way. Enrolment stays broken until the roll grows past the gap.
 *
 * MAX+1 cannot collide with an existing row, so it has neither failure mode.
 * `next_student_sequence()` (migration 0112) is the same arithmetic in SQL, and
 * `import_students()` already uses it — this function delegating to it is also
 * what stops the two paths numbering pupils differently.
 *
 * NOTE ON A CORRECTION: an earlier version of this comment, and a tracked item
 * in CLAUDE.md, claimed a soft delete lowered the count and caused identifier
 * REUSE. That was wrong. The count query carries no `is_deleted` filter and the
 * read policy does not add one, so soft-deleted pupils are counted and a
 * withdrawal changes nothing. The gap problem above is the real one.
 */
export async function nextStudentId(
  client: SupabaseClient,
  school: SchoolContext,
): Promise<string> {
  // SECURITY DEFINER inside, so the maximum is taken over every pupil at the
  // school including soft-deleted ones — an identifier must be unique against
  // the whole table, not against the rows this caller can see.
  const { data, error } = await client.rpc('next_student_sequence', {
    p_school_id: school.uuid,
  })

  if (error) throw new Error(`Could not determine next student sequence: ${error.message}`)

  const sequence = String((data as number | null) ?? 1).padStart(5, '0')
  return `STU-${school.code}-${sequence}`
}
