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
  const { data, error } = await client
    .from('schools')
    .select('id, school_id')
    .maybeSingle()

  if (error || !data) return null
  return { uuid: data.id as string, code: data.school_id as string }
}

/**
 * Builds the next student identifier: STU-<school code>-<5-digit sequence>,
 * e.g. STU-ZM-LSK-0001-00042 (CONVENTIONS.md).
 *
 * KNOWN LIMITATION — this reads the current count and adds one, so two
 * concurrent enrolments at the same school can compute the same sequence. The
 * UNIQUE constraint on students.student_id turns that into a 409 rather than a
 * duplicate, so it is safe but not graceful. STUDENT_ID.md assigns generation to
 * an Edge Function; moving it there with a per-school sequence removes the race
 * entirely. Tracked in JOURNAL.md.
 */
export async function nextStudentId(
  client: SupabaseClient,
  school: SchoolContext,
): Promise<string> {
  const { count, error } = await client
    .from('students')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', school.uuid)

  if (error) throw new Error(`Could not determine next student sequence: ${error.message}`)

  const sequence = String((count ?? 0) + 1).padStart(5, '0')
  return `STU-${school.code}-${sequence}`
}
