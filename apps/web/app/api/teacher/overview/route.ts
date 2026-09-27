/**
 * GET /api/teacher/overview — what this teacher teaches, and what is outstanding.
 *
 * Spec: `Official Documentation/08 Staff Management/ASSIGNMENTS.md`
 *       `Official Documentation/01 Foundation Layer/DECISIONS.md` — ADR-037
 *
 * ## The question a teacher opens the app to answer
 *
 * Not "show me the school" — they have no interest in the roll, the fee ledger or
 * the staff list. It is: which classes are mine, is today's register marked, and
 * which mark sheets still need entering. Everything here serves one of those three.
 *
 * ## Unmarked is the signal, so it is computed rather than implied
 *
 * `attendance_records` has no row for a register nobody opened. So "today's register
 * is not marked" cannot be read from the table directly — it is the absence of rows
 * for a class the teacher is assigned to. That absence is the whole point of the
 * screen, and computing it here means the teacher does not have to open five
 * registers to find the one they forgot.
 *
 * ## Only their own assignments
 *
 * `teacher_read_own_teacher_assignments` scopes on `teacher_user_id = get_user_id()`,
 * so this route passes no user id. A teacher sees their own scope and nobody else's,
 * decided by the policy rather than by a filter this file could get wrong.
 */

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

interface AssignmentRow {
  id: string
  scope: string
  class_id: string
  subject_id: string | null
  academic_year: string
  term_number: number | null
  school_subjects: Array<{ subject_code: string; subject_name: string }> | null
}

export async function GET(): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    // Not restricted to `org:teacher`: a head who also teaches a class has
    // assignments too, and refusing them a teaching view because of their title
    // would be the product telling them what their job is.
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const today = new Date().toISOString().slice(0, 10)

    const [assignments, todayMarks, unpublished, school] = await Promise.all([
      client
        .from('teacher_assignments')
        .select(
          'id, scope, class_id, subject_id, academic_year, term_number, ' +
            'school_subjects(subject_code, subject_name)',
        )
        .eq('is_active', true),
      // Today's register rows, for the classes this teacher can see. A class with
      // no row here has not been marked.
      client
        .from('attendance_records')
        .select('class_id')
        .eq('attendance_date', today),
      // Mark sheets with something entered but not yet published. What a teacher
      // still owes the head, effectively.
      client
        .from('exam_results')
        .select('class_id, subject_code, subject_name, academic_year, term_number')
        .eq('results_published', false),
      client.from('schools').select('school_id, name').maybeSingle(),
    ])

    if (assignments.error) return fromPostgrestError(assignments.error)

    const rows = (assignments.data ?? []) as unknown as AssignmentRow[]

    const markedToday = new Set(
      ((todayMarks.data ?? []) as Array<{ class_id: string }>).map((r) => r.class_id),
    )

    // Distinct class list, because a subject teacher holding three subjects in one
    // class marks its register once, not three times.
    const classes = [...new Set(rows.map((a) => a.class_id))].sort()

    // Unpublished sheets, deduplicated to one entry per class+subject+term.
    const pendingKey = new Set<string>()
    const pending: Array<Record<string, unknown>> = []
    for (const r of (unpublished.data ?? []) as Array<Record<string, unknown>>) {
      const key = `${r['class_id']}|${r['subject_code']}|${r['academic_year']}|${r['term_number']}`
      if (pendingKey.has(key)) continue
      pendingKey.add(key)
      pending.push(r)
    }

    return ok({
      school: school.data ?? null,
      role: session.role,
      today,
      assignments: rows.map((a) => ({
        id: a.id,
        scope: a.scope,
        classId: a.class_id,
        academicYear: a.academic_year,
        termNumber: a.term_number,
        subjectCode: a.school_subjects?.[0]?.subject_code ?? null,
        subjectName: a.school_subjects?.[0]?.subject_name ?? null,
      })),
      classes: classes.map((c) => ({
        classId: c,
        // The signal. Absence of a row, turned into a fact.
        registerMarkedToday: markedToday.has(c),
        subjects: rows
          .filter((a) => a.class_id === c)
          .map((a) => ({
            code: a.school_subjects?.[0]?.subject_code ?? null,
            name: a.school_subjects?.[0]?.subject_name ?? null,
            // A class-scope assignment covers every subject in the class, which is
            // why it has no subject of its own (ADR-037).
            wholeClass: a.scope === 'class',
          })),
      })),
      unpublishedSheets: pending,
    })
  })
}
