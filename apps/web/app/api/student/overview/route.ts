/**
 * GET /api/student/overview — everything the student portal shows.
 *
 * Spec: `02 Authentication and Identity/AUTH.md` → Student and Alumni login flows,
 *       `02 Authentication and Identity/ROLES.md` → `org:student`, `platform:alumni`
 *
 * ## One route for a pupil and an alumnus
 *
 * `0239` keys every policy on `students.clerk_user_id` and says nothing about the
 * organisation claim, so a graduated pupil with no org still reaches their own records.
 * The only difference here is `isAlumnus`, which changes what the screen *says* rather
 * than what it may read.
 *
 * ## Why one route rather than four
 *
 * The portal is a single screen. Four endpoints would mean four round-trips on a phone
 * over a Zambian mobile connection to render one page, and the pupil's own record has to
 * be resolved first in any case to know who the rest is about.
 *
 * ## No fees
 *
 * ROLES.md gives a student results, timetable and announcements; AUTH.md adds an
 * attendance summary. Money is between the school and whoever pays, and a child's portal
 * is not where a family learns it is in arrears.
 */

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const me = await client.rpc('my_student_record').maybeSingle()
    if (me.error) return fromPostgrestError(me.error)

    const record = me.data as {
      out_student_id: string
      out_display_id: string
      out_first_name: string
      out_last_name: string
      out_school_name: string
      out_grade_id: string
      out_class_id: string
      out_status: string
      out_is_alumnus: boolean
    } | null

    if (!record) {
      /*
        A signed-in person with no pupil row. Common and not an error — a parent or a
        teacher who opened this URL, or a pupil whose school has not yet linked their
        account. Say which, rather than returning an empty page that reads as broken.
      */
      return ok({
        linked: false,
        message:
          'No pupil record is linked to this account. If you are a pupil here, ask the school office to add your email to your record.',
      })
    }

    const studentId = record.out_student_id

    /*
      Fetched together. Each is scoped by `0239`'s policies, so a failure here is a
      policy problem rather than something to guard against in the route.
    */
    const [results, attendance, slots] = await Promise.all([
      client
        .from('exam_results')
        .select(
          'id, academic_year, term_number, subject_code, subject_name, marks_obtained, marks_total, grade_letter, class_position, class_size, published_at',
        )
        .eq('student_id', studentId)
        .order('academic_year', { ascending: false })
        .order('term_number', { ascending: false }),
      client
        .from('attendance_records')
        .select('id, attendance_date, status')
        .eq('student_id', studentId)
        .order('attendance_date', { ascending: false })
        .limit(90),
      /*
        The subject NAME comes through the embed, not from the slot.

        `timetable_slots` holds `subject_id`, not a code or a name — checked with
        `db:cols`. The FK to `school_subjects` lets PostgREST resolve it in the same
        request, and the select stays one literal because concatenating it kills
        row-type inference.
      */
      client
        .from('timetable_slots')
        .select(
          'id, day_of_week, period_id, room, slot_type, staff_user_id, school_subjects(subject_code, subject_name)',
        )
        .eq('class_id', record.out_class_id),
    ])

    const attendanceRows = attendance.error ? [] : (attendance.data ?? [])
    const present = attendanceRows.filter((a) => a.status === 'present').length

    return ok({
      linked: true,
      student: {
        id: studentId,
        displayId: record.out_display_id,
        firstName: record.out_first_name,
        lastName: record.out_last_name,
        schoolName: record.out_school_name,
        gradeId: record.out_grade_id,
        classId: record.out_class_id,
        status: record.out_status,
        /*
          Drives the framing, not the permissions. An alumnus sees the same records
          presented as a historical record rather than as this term's work.
        */
        isAlumnus: record.out_is_alumnus,
      },
      results: results.error ? [] : (results.data ?? []),
      resultsLoaded: !results.error,
      attendance: {
        // A summary, which is what AUTH.md specifies — not a day-by-day register.
        recorded: attendanceRows.length,
        present,
        percentage:
          attendanceRows.length === 0
            ? null
            : Math.round((present / attendanceRows.length) * 100),
        recent: attendanceRows.slice(0, 14),
      },
      attendanceLoaded: !attendance.error,
      timetable: slots.error ? [] : (slots.data ?? []),
      /*
        A secondary read that fails should not fail the page. An alumnus has no live
        timetable at all, and that is not an error either.
      */
      timetableLoaded: !slots.error,
    })
  })
}
