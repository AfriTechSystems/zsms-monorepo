/**
 * /api/attendance — marking and reading the register.
 *
 * Marking is a bulk operation: a teacher marks a whole class at once. The
 * teaching-scope check is NOT performed here — the `attendance_insert` policy
 * calls `teacher_reaches_class()`, so a teacher marking a class they do not
 * reach is refused by the database. Duplicating that test in the route would
 * create a second place for it to drift.
 *
 * Spec: `Official Documentation/01 Foundation Layer/RLS.md` — attendance_records
 *       `Official Documentation/01 Foundation Layer/DECISIONS.md` — ADR-037
 */

import type { NextRequest } from 'next/server'
import { getAuthProvider } from '@zsms/auth-provider'
import { createUserClient } from '../../../lib/supabase'
import {
  created,
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../lib/api-response'
import { listAttendanceQuerySchema, markAttendanceSchema } from '../../../lib/validation'
import { resolveSchoolContext } from '../../../lib/school-context'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = listAttendanceQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    )
    if (!parsed.success) return validationFailed(parsed.error)

    const { page, perPage, classId, studentId, attendanceDate, status } = parsed.data
    const from = (page - 1) * perPage

    let query = client
      .from('attendance_records')
      .select(
        'id, school_id, student_id, class_id, attendance_date, academic_year, term_number, status, arrival_time, excuse_reason, recorded_by_user_id, parent_notified, sync_source, created_at',
        { count: 'exact' },
      )
      .order('attendance_date', { ascending: false })
      .range(from, from + perPage - 1)

    if (classId) query = query.eq('class_id', classId)
    if (studentId) query = query.eq('student_id', studentId)
    if (attendanceDate) query = query.eq('attendance_date', attendanceDate)
    if (status) query = query.eq('status', status)

    const { data, error, count } = await query
    if (error) return fromPostgrestError(error)

    return ok(data ?? [], { page, perPage, total: count ?? 0 })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = markAttendanceSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This session is not associated with a school.')

    const i = parsed.data
    const rows = i.records.map((r) => ({
      school_id: school.uuid,
      student_id: r.studentId,
      class_id: r.classId,
      recorded_by_user_id: session.userId,
      attendance_date: i.attendanceDate,
      academic_year: i.academicYear,
      term_number: i.termNumber,
      status: r.status,
      arrival_time: r.arrivalTime ?? null,
      excuse_reason: r.excuseReason ?? null,
      sync_source: i.syncSource ?? 'web',
      local_created_at: i.localCreatedAt ?? null,
    }))

    // Re-marking the same day is a correction, not a duplicate — the unique
    // constraint on (school, student, date) makes upsert the right verb.
    const { data, error } = await client
      .from('attendance_records')
      .upsert(rows, { onConflict: 'school_id,student_id,attendance_date' })
      .select('id, student_id, class_id, attendance_date, status')

    if (error) return fromPostgrestError(error)
    if (!data || data.length === 0) {
      return fail('FORBIDDEN', 'You may not mark attendance for this class.')
    }

    return created({ marked: data.length, records: data })
  })
}
