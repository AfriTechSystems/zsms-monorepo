/**
 * GET /api/parent/overview — everything a parent's home screen needs.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/PARENTS.md`
 *
 * ## One request, because a parent is on a phone on mobile data
 *
 * The children, the balance, the attendance summary, the latest results and the
 * unread notices in a single round trip. Five requests would be five chances to
 * fail on a Zambian mobile connection, and the screen has nothing useful to show
 * until it has most of them anyway.
 *
 * ## Only what has been published, only for their own children
 *
 * Every filter here is a policy, not a `where` clause. `parent_read_own_children`,
 * `parent_read_own_fee_records`, `parent_read_published_results` and
 * `parent_read_own_child_attendance` already scope each table, so this route
 * passes no parent id and no school id. An unpublished mark is invisible to the
 * database, not merely hidden by this code — which is the only version of that
 * guarantee worth having.
 *
 * ## A balance a parent sees is money the school has actually confirmed
 *
 * `student_fee_balance` nets verified payments only. A parent who has just
 * submitted a deposit slip sees it in the payment list as awaiting confirmation
 * and NOT deducted from the balance — the same distinction the school side draws,
 * and the honest one: the school has not agreed it received the money yet.
 */

import type { NextRequest } from 'next/server'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'
import { listParentChildren, pickChild, resolveParentCaller } from '../../../../lib/parent-context'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveParentCaller()
    if (!caller.ok) return caller.response

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const children = await listParentChildren(client)

    if (children.length === 0) {
      // Not an error. A parent whose link has been removed, or whose account was
      // created before being linked, has a working session and no children — and
      // the screen says so rather than rendering a broken dashboard.
      return ok({ children: [], selected: null })
    }

    const requested = request.nextUrl.searchParams.get('childId')
    const child = pickChild(children, requested)
    if (!child) return fail('NOT_FOUND', 'That pupil is not one of your children.')

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const [balance, attendance, results, announcements, payments, school] = await Promise.all([
      client.from('student_fee_balance').select('*').eq('student_id', child.id).maybeSingle(),
      client
        .from('attendance_records')
        .select('status, attendance_date')
        .eq('student_id', child.id)
        .gte('attendance_date', since),
      client
        .from('exam_results')
        .select(
          'id, subject_name, subject_code, academic_year, term_number, marks_obtained, ' +
            'marks_total, grade_letter, class_position, class_size, comments, published_at',
        )
        .eq('student_id', child.id)
        .order('published_at', { ascending: false })
        .limit(20),
      client
        .from('announcements')
        .select('id, title, body, importance, sent_at')
        .order('sent_at', { ascending: false })
        .limit(10),
      client
        .from('payments')
        .select('id, amount, payment_method, status, receipt_number, created_at, verified_at')
        .eq('student_id', child.id)
        .order('created_at', { ascending: false })
        .limit(10),
      client.from('schools').select('school_id, name').eq('id', child.school_id).maybeSingle(),
    ])

    if (balance.error) return fromPostgrestError(balance.error)

    const marks = (attendance.data ?? []) as Array<{ status: string }>

    // A holiday is not a school day and must not sit in the denominator. Counting
    // it would report a child as having missed school on a day the school was
    // shut — which understates every rate by however many holidays fall in the
    // window, and is exactly the sort of figure a parent brings to a meeting.
    const schoolDays = marks.filter((m) => m.status !== 'holiday')

    // Late counts as present: a child who arrived at 08:20 was at school.
    // Lateness and excused absence are reported separately rather than folded in,
    // because an authorised absence and an unexplained one are different
    // conversations and a single percentage hides which one happened.
    const present = schoolDays.filter((m) => m.status === 'present' || m.status === 'late').length

    return ok({
      children: children.map((c) => ({
        id: c.id,
        studentId: c.student_id,
        firstName: c.first_name,
        lastName: c.last_name,
      })),
      selected: {
        id: child.id,
        studentId: child.student_id,
        firstName: child.first_name,
        lastName: child.last_name,
        gradeId: child.grade_id,
        classId: child.class_id,
        status: child.status,
      },
      school: school.data ?? null,
      balance: balance.data ?? null,
      attendance: {
        // Over the last 30 days, and the window is stated on the screen. A
        // percentage with no period attached is the kind of number a parent
        // argues with a school about.
        days: schoolDays.length,
        present,
        late: schoolDays.filter((m) => m.status === 'late').length,
        absent: schoolDays.filter((m) => m.status === 'absent').length,
        excused: schoolDays.filter((m) => m.status === 'excused').length,
        // null, not 0, when there is nothing to divide by. A newly enrolled pupil
        // showing "0% attendance" would be a false accusation.
        rate: schoolDays.length > 0 ? Math.round((present / schoolDays.length) * 100) : null,
      },
      results: results.data ?? [],
      announcements: announcements.data ?? [],
      payments: payments.data ?? [],
    })
  })
}
