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

    return ok(data ?? [], { page, perPage, total: count ?? 0 })
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

    const { data, error } = await client
      .from('students')
      .insert(row)
      .select('id, student_id, school_id, first_name, last_name, grade_id, class_id, status, created_at')
      .maybeSingle()

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
