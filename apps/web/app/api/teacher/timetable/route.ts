/**
 * GET /api/teacher/timetable — this teacher's own week.
 *
 * Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
 *
 * `my_timetable()` resolves the caller from their token and returns only slots they
 * teach, from the ACTIVE timetable. A draft is invisible because the slot policy
 * already hides it — there is no `published` filter here, deliberately, since a second
 * copy of that rule is the one that would drift.
 */

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

interface Slot {
  out_day_of_week: number
  out_period_name: string
  out_start_time: string
  out_end_time: string
  out_period_order: number
  out_class_id: string
  out_subject_name: string | null
  out_room: string | null
  out_slot_type: string
}

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('my_timetable')
    if (error) {
      if (error.code === '42501') return fail('UNAUTHORIZED', error.message)
      return fromPostgrestError(error)
    }

    const slots = (data ?? []) as unknown as Slot[]

    return ok({
      slots,
      // Counted here so a heading and the grid cannot disagree.
      lessons: slots.filter((s) => s.out_slot_type === 'lesson').length,
      /*
        Whether anything exists at all, which the screen needs to tell two very
        different situations apart: a school with no timetable yet, and a teacher who
        has simply not been assigned to any lesson in one that exists.
      */
      hasAny: slots.length > 0,
    })
  })
}
