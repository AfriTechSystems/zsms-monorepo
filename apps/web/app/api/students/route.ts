/**
 * /api/students — collection.
 *
 * Spec: `Official Documentation/05 Core Database and API Reference/ENDPOINTS.md`
 *       `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
 *       `Official Documentation/01 Foundation Layer/RLS.md` — students table
 *
 * No query here filters by school. That is intentional: five SELECT policies on
 * students already decide what each role may see — management sees the school,
 * teachers see their classes, parents see their children, students see
 * themselves. Re-applying a school filter in the route would duplicate the
 * boundary in a second place that can drift from the first.
 */

import type { NextRequest } from 'next/server'
import { createUserClient } from '../../../lib/supabase'
import {
  created,
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
  type Meta,
} from '../../../lib/api-response'
import { createStudentSchema, listStudentsQuerySchema } from '../../../lib/validation'
import { nextStudentId, resolveSchoolContext } from '../../../lib/school-context'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = listStudentsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    )
    if (!parsed.success) return validationFailed(parsed.error)

    const { page, perPage, status, gradeId, classId, search } = parsed.data
    const from = (page - 1) * perPage

    let query = client
      .from('students')
      .select(
        'id, student_id, school_id, first_name, last_name, grade_id, class_id, is_boarding, status, enrolment_date, date_of_birth, gender, photo_url, created_at, updated_at',
        { count: 'exact' },
      )
      // Soft-deleted students stay in the table for audit and historical
      // records; they are simply not part of any normal listing.
      .eq('is_deleted', false)
      .order('last_name', { ascending: true })
      .range(from, from + perPage - 1)

    if (status) query = query.eq('status', status)
    if (gradeId) query = query.eq('grade_id', gradeId)
    if (classId) query = query.eq('class_id', classId)
    if (search) {
      const escaped = search.replace(/[%_,()]/g, ' ').trim()
      if (escaped) query = query.or(`first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%`)
    }

    const { data, error, count } = await query
    if (error) return fromPostgrestError(error)

    // The ceiling travels with the list. The students screen needs it to decide
    // whether "Enrol pupil" can be offered at all, and taking it from a second
    // request would let the roll and the limit be read at two different
    // instants — visible precisely when a school is at the boundary.
    //
    // `school_student_capacity()` is SECURITY DEFINER and takes the school id,
    // so it is resolved from the session rather than from a query parameter.
    // A caller cannot ask about another school's capacity through this route.
    const school = await resolveSchoolContext(client)
    let capacity: Meta['capacity'] = null
    if (school) {
      const { data: row } = await client.rpc('school_student_capacity', {
        p_school_id: school.uuid,
      })
      capacity = (Array.isArray(row) ? row[0] : row) ?? null
    }

    /*
      Two aggregates for the context rail, computed over the WHOLE roll rather than the
      page in hand.

      This matters more than it looks. The rail shows a year-group distribution beside a
      paginated table, and deriving it from `data` would describe the ten rows on screen
      — so "Year 7: 4" would mean four on this page, not four in the school. A reader
      has no way to tell those apart, which makes the panel worse than absent.

      Both are read-only and respect the same RLS as the listing above. They deliberately
      ignore the caller's filters: the distribution answers "how is the school made up",
      which does not change because somebody searched for a surname.
    */
    const [spread, newest] = await Promise.all([
      client
        .from('students')
        .select('grade_id')
        .eq('is_deleted', false)
        .in('status', ['active', 'on_leave']),
      client
        .from('students')
        .select('id, student_id, first_name, last_name, grade_id, photo_url, created_at')
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .limit(5),
    ])

    const byGrade: Record<string, number> = {}
    if (!spread.error) {
      for (const row of (spread.data ?? []) as Array<{ grade_id: string | null }>) {
        const key = row.grade_id ?? 'Unassigned'
        byGrade[key] = (byGrade[key] ?? 0) + 1
      }
    }

    return ok(data ?? [], {
      page,
      perPage,
      total: count ?? 0,
      capacity,
      /*
        `null` when the aggregate itself failed, so the rail can say the breakdown is
        unavailable rather than render an empty one — an empty distribution reads as a
        school with no pupils.
      */
      distribution: spread.error ? null : byGrade,
      recent: newest.error ? [] : (newest.data ?? []),
    })
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

    const parsed = createStudentSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const school = await resolveSchoolContext(client)
    if (!school) {
      return fail('FORBIDDEN', 'This session is not associated with a school.')
    }

    const input = parsed.data
    const studentId = await nextStudentId(client, school)

    const row: Record<string, unknown> = {
      student_id: studentId,
      // From the JWT, never from the body — see school-context.ts.
      school_id: school.uuid,
      first_name: input.firstName,
      last_name: input.lastName,
      grade_id: input.gradeId,
      class_id: input.classId,
    }
    if (input.dateOfBirth !== undefined) row['date_of_birth'] = input.dateOfBirth
    if (input.gender !== undefined) row['gender'] = input.gender
    if (input.isBoarding !== undefined) row['is_boarding'] = input.isBoarding
    if (input.enrolmentDate !== undefined) row['enrolment_date'] = input.enrolmentDate
    if (input.photoUrl !== undefined) row['photo_url'] = input.photoUrl

    /**
     * Insert, retrying once per attempt on an identifier collision.
     *
     * `nextStudentId()` reads the highest sequence and adds one, which two
     * simultaneous enrolments can do at the same moment. The UNIQUE constraint on
     * `student_id` refuses the loser — correctly, no duplicate is created — but
     * without this loop the registrar sees a conflict for an enrolment that would
     * succeed if simply tried again a moment later.
     *
     * Three attempts, not unbounded: a collision that survives three fresh reads
     * of MAX is not contention, it is something structurally wrong, and looping on
     * it would hide the real fault behind a hung request. STUDENT_ID.md's per-school
     * sequence in an Edge Function removes the race outright; this makes the
     * present implementation behave well in the meantime.
     */
    let data: Record<string, unknown> | null = null
    let error: { code?: string; message: string } | null = null

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        // Re-read the sequence. Retrying with the same taken number would fail
        // identically three times.
        row['student_id'] = await nextStudentId(client, school)
      }

      const res = await client
        .from('students')
        .insert(row)
        .select('id, student_id, school_id, first_name, last_name, grade_id, class_id, status, created_at')
        .maybeSingle()

      data = (res.data as Record<string, unknown> | null) ?? null
      error = res.error

      // 23505 — unique_violation on student_id. The only error worth retrying:
      // a full roll (ZS001) or a permission failure will not change on a retry.
      if (!error || error.code !== '23505') break
    }

    if (error) return fromPostgrestError(error)
    if (!data) {
      // INSERT blocked by management_write_students. PostgREST can report a
      // WITH CHECK failure as either 42501 or an empty result depending on the
      // path, so both are handled.
      return fail('FORBIDDEN', 'You do not have permission to enrol students at this school.')
    }

    return created(data)
  })
}
