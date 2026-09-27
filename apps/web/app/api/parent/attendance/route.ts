/**
 * GET /api/parent/attendance — a child's marked days.
 *
 * Spec: `Official Documentation/10 Attendance/ATTENDANCE.md`
 *
 * ## Only days that were actually marked
 *
 * `parent_read_own_child_attendance` scopes the rows; no day is invented to fill
 * a gap. A day with no record means no teacher marked the register, and
 * manufacturing an "absent" row for it would accuse a child of missing school
 * because a teacher was busy. The count of marked days is returned so the screen
 * can show the denominator rather than a bare percentage.
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
    if (children.length === 0) return ok({ children: [], selected: null })

    const child = pickChild(children, request.nextUrl.searchParams.get('childId'))
    if (!child) return fail('NOT_FOUND', 'That pupil is not one of your children.')

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const { data, error } = await client
      .from('attendance_records')
      .select('attendance_date, status, excuse_reason')
      .eq('student_id', child.id)
      .gte('attendance_date', since)
      .order('attendance_date', { ascending: false })

    if (error) return fromPostgrestError(error)

    const rows = (data ?? []) as Array<{ status: string }>
    // Holidays out of the denominator; late counts as present. Same arithmetic as
    // `/api/parent/overview`, and it has to stay the same — two screens reporting
    // different attendance for one child is worse than either being slightly off.
    const schoolDays = rows.filter((r) => r.status !== 'holiday')
    const present = schoolDays.filter((r) => r.status === 'present' || r.status === 'late').length

    return ok({
      children: children.map((c) => ({
        id: c.id,
        firstName: c.first_name,
        lastName: c.last_name,
      })),
      selected: { id: child.id, firstName: child.first_name, lastName: child.last_name },
      attendance: {
        days: schoolDays.length,
        present,
        late: schoolDays.filter((r) => r.status === 'late').length,
        absent: schoolDays.filter((r) => r.status === 'absent').length,
        excused: schoolDays.filter((r) => r.status === 'excused').length,
        rate: schoolDays.length > 0 ? Math.round((present / schoolDays.length) * 100) : null,
      },
      records: data ?? [],
    })
  })
}
