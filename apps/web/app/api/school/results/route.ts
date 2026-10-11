/**
 * GET  /api/school/results — a class's marks for one subject and term.
 * POST /api/school/results — save marks for that sheet.
 *
 * Spec: `Official Documentation/11 Examinations and Results/`
 *       `Official Documentation/01 Foundation Layer/DECISIONS.md` — ADR-041
 *
 * ## The sheet is the roll, not the marks
 *
 * Same shape as the attendance register, for the same reason. A naive endpoint
 * returns `exam_results` for a class and renders empty on the day marking
 * starts, because before anyone enters anything there are no rows. Pupils come
 * from `students`; marks are joined onto them, and a pupil with no mark comes
 * back as `null`.
 *
 * That null is load-bearing. A missing mark is **not** a zero — a zero is a
 * child who sat the paper and scored nothing, and an absent mark is a child who
 * was not examined. Defaulting one to the other is how a sick pupil ends up with
 * a fail on a report card.
 *
 * ## The grade and the scale that explains it are written together
 *
 * ADR-041. Every mark saved here resolves the subject's **current scale
 * version** and writes `grade_letter`, `grade_points` and
 * `grading_scale_version_id` in the same row. The letter is computed by
 * `grade_from_scale_version()` in the database, never in TypeScript: a second
 * implementation of a grade boundary is a second answer to "is 79.5 a
 * distinction".
 *
 * A subject with no grading scale can still take raw marks — the grade columns
 * stay NULL rather than the save being refused. Blocking mark entry because
 * nobody has configured a scale yet would lose a teacher's afternoon of work
 * over a settings screen they cannot reach.
 *
 * ## Published marks are not editable here
 *
 * `teacher_update_unpublished_results` stops a teacher editing a published mark,
 * and this route does not try to route around it. A correction after publication
 * is a deliberate, attributed act — not a silent overwrite.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { can } from '../../../../lib/roles'
import { resolveFeeCaller as resolveSchoolCaller } from '../../../../lib/fee-context'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const sheetQuery = z.object({
  classId: z.string().trim().min(1).max(40),
  subjectCode: z.string().trim().min(1).max(20),
  academicYear: z.string().trim().regex(/^\d{4}(\/\d{4})?$/),
  termNumber: z.coerce.number().int().min(1).max(4),
})

const marksSchema = z.object({
  classId: z.string().trim().min(1).max(40),
  subjectCode: z.string().trim().min(1).max(20),
  subjectName: z.string().trim().min(1).max(120),
  academicYear: z.string().trim().regex(/^\d{4}(\/\d{4})?$/),
  termNumber: z.number().int().min(1).max(4),
  marksTotal: z.number().positive().max(9999),
  marks: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        // `null` clears a mark. Distinct from 0, which is a real score — see
        // the header. Zod has to accept both for that distinction to survive
        // the wire.
        marksObtained: z.number().min(0).max(9999).nullable(),
        comments: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    .max(300),
})

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveSchoolCaller()
    if (!caller.ok) return caller.response
    if (!can(caller.role, 'results:read')) {
      return fail('FORBIDDEN', 'Your role does not include results.')
    }

    const parsed = sheetQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if (!parsed.success) return validationFailed(parsed.error)
    const q = parsed.data

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const [pupils, marks, scaleVersion] = await Promise.all([
      // The roll. RLS scopes it to the caller's school; a teacher additionally
      // only reaches classes they teach.
      client
        .from('students')
        .select('id, student_id, first_name, last_name')
        .eq('class_id', q.classId)
        .in('status', ['active', 'on_leave'])
        .order('last_name', { ascending: true }),
      client
        .from('exam_results')
        .select(
          'id, student_id, marks_obtained, marks_total, grade_letter, grade_points, ' +
            'comments, results_published, published_at, grading_scale_version_id, ' +
            'grade_override, grade_override_reason, unlocked_at',
        )
        .eq('class_id', q.classId)
        .eq('subject_code', q.subjectCode)
        .eq('academic_year', q.academicYear)
        .eq('term_number', q.termNumber),
      // The one-argument form (0108) resolves the school from the session, so
      // the route never passes a school id it could get wrong.
      client.rpc('current_subject_scale_version', { p_subject_code: q.subjectCode }),
    ])

    if (pupils.error) return fromPostgrestError(pupils.error)
    if (marks.error) return fromPostgrestError(marks.error)

    // PostgREST's inferred row type for this select is a union including its
    // error shape; the runtime error is handled above, so the rows are narrowed
    // once here rather than every field access being guarded.
    type MarkRow = {
      id: string
      student_id: string
      marks_obtained: number | null
      marks_total: number | null
      grade_letter: string | null
      grade_points: number | null
      comments: string | null
      results_published: boolean
      grading_scale_version_id: string | null
      grade_override: string | null
      grade_override_reason: string | null
      unlocked_at: string | null
    }
    const markRows = (marks.data ?? []) as unknown as MarkRow[]
    const byStudent = new Map(markRows.map((m) => [m.student_id, m] as const))

    const rows = (pupils.data ?? []).map((p) => {
      const existing = byStudent.get(p.id)
      return {
        studentId: p.id,
        // The RESULT row's id, which correcting a published mark needs: the unlock in
        // `0172` is granular to one result, never a pupil or a class, so the pupil id
        // cannot identify what to unlock.
        resultId: existing?.id ?? null,
        studentCode: p.student_id,
        firstName: p.first_name,
        lastName: p.last_name,
        // null, never 0. A pupil nobody has marked is unmarked.
        marksObtained: existing?.marks_obtained ?? null,
        marksTotal: existing?.marks_total ?? null,
        /*
          The COMPUTED grade, always. `grade_override` travels separately rather
          than replacing it, because a report card has to be able to show that a
          grade was awarded rather than calculated — GRADING.md asks for a
          footnote, and you cannot footnote a value you have overwritten.
        */
        gradeLetter: existing?.grade_letter ?? null,
        gradeOverride: existing?.grade_override ?? null,
        gradeOverrideReason: existing?.grade_override_reason ?? null,
        // Whether an override can be set right now: a published result needs
        // unlocking first, which records the reason (0124).
        canOverride: Boolean(existing?.id) &&
          (!existing?.results_published || Boolean(existing?.unlocked_at)),
        gradePoints: existing?.grade_points ?? null,
        comments: existing?.comments ?? null,
        published: existing?.results_published ?? false,
        // Surfaced so the screen can say a grade is unexplainable rather than
        // showing a letter with no provenance (ADR-041).
        hasScaleVersion: Boolean(existing?.grading_scale_version_id),
      }
    })

    return ok({
      rows,
      // A sheet with any published mark is locked. Reported once for the sheet
      // rather than inferred per row by the screen.
      published: rows.some((r) => r.published),
      scaleVersionId: (scaleVersion.data as string | null) ?? null,
      canWrite: can(caller.role, 'results:write'),
      canPublish: can(caller.role, 'results:publish'),
    })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveSchoolCaller()
    if (!caller.ok) return caller.response
    if (!can(caller.role, 'results:write')) {
      return fail('FORBIDDEN', 'Only teachers, the principal and the owner enter marks.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = marksSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)
    const v = parsed.data

    // Checked here so the message names the arithmetic. The table's
    // `exam_results_marks_within_total` CHECK is the guarantee.
    const over = v.marks.filter(
      (m) => m.marksObtained !== null && m.marksObtained > v.marksTotal,
    )
    if (over.length > 0) {
      return fail(
        'VALIDATION_ERROR',
        `${over.length} mark${over.length === 1 ? '' : 's'} above the paper total of ${v.marksTotal}. A mark above the maximum is a typing error, not a distinction.`,
      )
    }

    const { data, error } = await client.rpc('save_exam_marks', {
      p_class_id: v.classId,
      p_subject_code: v.subjectCode,
      p_subject_name: v.subjectName,
      p_academic_year: v.academicYear,
      p_term_number: v.termNumber,
      p_marks_total: v.marksTotal,
      p_marks: v.marks.map((m) => ({
        student_id: m.studentId,
        marks_obtained: m.marksObtained,
        comments: m.comments ?? null,
      })),
    })

    if (error) {
      // 42501 from the function: the sheet is published, or this teacher does
      // not teach this class and subject. Both are "not yours to change now",
      // and the function's own sentence is better than a generic 403.
      if (error.code === '42501') {
        return fail('FORBIDDEN', error.message)
      }
      return fromPostgrestError(error)
    }

    const row = (data as Array<{ saved_count: number; graded_count: number }> | null)?.[0]

    return ok({
      saved: row?.saved_count ?? 0,
      // Reported separately: a sheet can save 30 marks and grade none, which is
      // what happens when the subject has no grading scale. Silence there would
      // look like success and read as a missing feature later.
      graded: row?.graded_count ?? 0,
    })
  })
}

/**
 * PATCH — award a grade rather than calculate it.
 *
 * Spec: `11 Examinations and Results/GRADING.md` → *Grade Override*
 *
 * Used where a final grade is not a percentage: coursework subjects, practicals, and
 * exceptional circumstances the principal has approved.
 *
 * `set_grade_override()` (`0256`) does the enforcing — it requires a reason, validates
 * the grade against the school's own scale version, refuses a published result, and
 * takes the school from the session rather than from this request. None of that is
 * re-checked here, because a second copy of a rule is the copy a direct PostgREST call
 * bypasses.
 */
const overrideSchema = z.object({
  resultId: z.string().uuid(),
  /*
    Optional, and an empty string is meaningful: it clears the override. Not
    validated against a grade list here — the school's scale is the authority and
    `0256` checks against the version that produced this very result.
  */
  grade: z.string().trim().max(10).optional(),
  reason: z.string().trim().max(500).optional(),
})

export async function PATCH(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const parsed = overrideSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .rpc('set_grade_override', {
        p_result_id: parsed.data.resultId,
        // An empty grade CLEARS the override and restores the computed grade.
        p_grade: parsed.data.grade ?? null,
        p_reason: parsed.data.reason ?? null,
      })
      .maybeSingle()

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    const row = data as {
      out_grade: string | null
      out_computed: string | null
      out_is_override: boolean
    } | null

    return ok({
      grade: row?.out_grade ?? null,
      computed: row?.out_computed ?? null,
      isOverride: row?.out_is_override ?? false,
      message: row?.out_is_override
        ? 'Grade awarded. It appears on the report card with your reason as a footnote.'
        : 'Override removed. The calculated grade applies again.',
    })
  })
}
