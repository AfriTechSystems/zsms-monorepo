/**
 * /api/results — marks entry and reading.
 *
 * As with attendance, the teaching-scope check lives in the policy
 * (`teacher_teaches_subject()`), not here. A teacher entering marks for a
 * subject or class they do not teach is refused by the database.
 *
 * Reading is asymmetric by design: staff see drafts, parents and students see
 * only what has been published.
 *
 * Spec: `Official Documentation/01 Foundation Layer/RLS.md` — exam_results
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
import { enterMarksSchema, listResultsQuerySchema } from '../../../lib/validation'
import { resolveSchoolContext } from '../../../lib/school-context'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = listResultsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    )
    if (!parsed.success) return validationFailed(parsed.error)

    const { page, perPage, classId, studentId, academicYear, termNumber, subjectCode } = parsed.data
    const from = (page - 1) * perPage

    let query = client
      .from('exam_results')
      .select(
        'id, school_id, student_id, class_id, academic_year, term_number, subject_code, subject_name, marks_obtained, marks_total, grade_letter, grade_points, class_position, class_size, results_published, published_at, comments, entered_by_user_id, created_at',
        { count: 'exact' },
      )
      .order('subject_code', { ascending: true })
      .range(from, from + perPage - 1)

    if (classId) query = query.eq('class_id', classId)
    if (studentId) query = query.eq('student_id', studentId)
    if (academicYear) query = query.eq('academic_year', academicYear)
    if (termNumber) query = query.eq('term_number', termNumber)
    if (subjectCode) query = query.eq('subject_code', subjectCode)

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

    const parsed = enterMarksSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This session is not associated with a school.')

    const i = parsed.data
    const marksTotal = i.marksTotal ?? 100

    const overMax = i.marks.filter(
      (m) => m.marksObtained !== null && m.marksObtained > marksTotal,
    )
    if (overMax.length > 0) {
      // The database CHECK would reject this too; catching it here names the
      // offending students instead of failing the whole batch anonymously.
      return fail(
        'VALIDATION_ERROR',
        `Marks exceed the maximum of ${marksTotal}.`,
        overMax.map((m) => ({ studentId: m.studentId, marksObtained: m.marksObtained })),
      )
    }

    const rows = i.marks.map((m) => ({
      school_id: school.uuid,
      student_id: m.studentId,
      class_id: i.classId,
      academic_year: i.academicYear,
      term_number: i.termNumber,
      subject_code: i.subjectCode,
      subject_name: i.subjectName,
      entered_by_user_id: session.userId,
      marks_obtained: m.marksObtained,
      marks_total: marksTotal,
      comments: m.comments ?? null,
      sync_source: i.syncSource ?? 'web',
    }))

    const { data, error } = await client
      .from('exam_results')
      .upsert(rows, {
        onConflict: 'school_id,student_id,academic_year,term_number,subject_code',
      })
      .select('id, student_id, subject_code, marks_obtained, marks_total, results_published')

    if (error) return fromPostgrestError(error)
    if (!data || data.length === 0) {
      return fail(
        'FORBIDDEN',
        'You may not enter marks for this subject and class, or the results are already published.',
      )
    }

    return created({ entered: data.length, results: data })
  })
}
