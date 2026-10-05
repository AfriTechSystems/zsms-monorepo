/**
 * GET /api/parent/timetable — one child's week.
 *
 * Spec: `Official Documentation/07 Students and Parents/PARENT_PORTAL.md`
 *       `Official Documentation/08 Staff Management/TIMETABLE.md`
 *
 * `child_timetable()` checks `is_linked_parent_of()` before reading anything — a parent
 * has no organisation, so the link row is the whole of the authorisation, exactly as it
 * is for attendance and results. Only a PUBLISHED timetable is returned: a draft is the
 * school rearranging next term, and a parent acting on one would be acting on a guess.
 */

import type { NextRequest } from 'next/server'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    // Every parent endpoint takes the children list and a selected child, so the
    // switcher keeps working on a screen that would otherwise need its own query.
    const { data: children, error: childrenError } = await client
      .from('student_parent_links')
      .select('student_id, students!inner(id, first_name, last_name, school_id, class_id)')
      .eq('is_active', true)

    if (childrenError) return fromPostgrestError(childrenError)

    type Row = {
      students: {
        id: string
        first_name: string
        last_name: string
        school_id: string
        class_id: string
      }
    }

    const kids = ((children ?? []) as unknown as Row[]).map((r) => ({
      id: r.students.id,
      firstName: r.students.first_name,
      lastName: r.students.last_name,
      schoolId: r.students.school_id,
      schoolName: null as string | null,
    }))

    if (kids.length === 0) return ok({ children: [], selected: null, slots: [] })

    const requested = request.nextUrl.searchParams.get('childId')
    const child = kids.find((k) => k.id === requested) ?? kids[0]
    if (!child) return ok({ children: kids, selected: null, slots: [] })

    const { data, error } = await client.rpc('child_timetable', { p_student_id: child.id })
    if (error) {
      // The function's own refusal when a child is not this parent's. Not distinguished
      // from "no such pupil": telling them apart confirms another family's record exists.
      if (error.code === '42501') return fail('NOT_FOUND', 'That is not one of your children.')
      return fromPostgrestError(error)
    }

    return ok({ children: kids, selected: child, slots: data ?? [] })
  })
}
