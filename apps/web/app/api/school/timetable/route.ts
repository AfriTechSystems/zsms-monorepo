/**
 * The school's timetable: read the grid, place a lesson, publish.
 *
 * Spec: `Official Documentation/08 Staff Management/TIMETABLE.md`
 *
 * ## Clashes are the database's answer, not this route's
 *
 * Partial unique indexes make a double-booking impossible, and
 * `set_timetable_slot()` turns the resulting violation into a sentence naming where the
 * teacher already is. This route maps `23505` to `CONFLICT` and passes that sentence
 * through. It does not check for clashes itself: a pre-flight SELECT would race two
 * deputies dragging at the same moment, and a second rule here is the one that drifts.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider, type Role } from '@zsms/auth-provider'
import { can } from '../../../../lib/roles'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const url = new URL(request.url)
    const timetableId = url.searchParams.get('timetableId')

    /*
      `classId` decides what the subject and teacher dropdowns may offer.

      The spec scopes subjects to the class's grade level and teachers to a matching
      `teacher_assignments` row — "cannot assign an unrelated teacher". Both come from
      `timetable_slot_options()`, which knows the mapping between two level-type
      vocabularies that do not share a value set.
    */
    const classId = url.searchParams.get('classId')

    const [grid, timetables, classes, options] = await Promise.all([
      client.rpc('school_timetable', { p_timetable_id: timetableId }),
      client
        .from('timetables')
        .select('id, name, academic_year, term_number, is_active, published, published_at')
        .order('created_at', { ascending: false }),
      // The school's classes come from its PUPILS, not from timetable slots. Deriving
      // them from slots meant a new timetable had no classes, so no cell could be
      // opened, so no slot could ever be created.
      client.rpc('school_class_list'),
      classId
        ? client.rpc('timetable_slot_options', { p_class_id: classId })
        : Promise.resolve({ data: [], error: null }),
    ])

    if (grid.error) {
      if (grid.error.code === '42501') return fail('FORBIDDEN', grid.error.message)
      return fromPostgrestError(grid.error)
    }

    const caller = await getAuthProvider().getSessionUser()
    const canEdit = can(caller?.role as Role, 'settings:write')

    type Option = {
      out_kind: string
      out_id: string
      out_label: string | null
      out_detail: string | null
      out_subject_id: string | null
    }
    const opts = (options.data ?? []) as unknown as Option[]

    return ok({
      grid: grid.data ?? [],
      timetables: timetables.data ?? [],
      classes: classes.data ?? [],
      subjects: opts
        .filter((o) => o.out_kind === 'subject')
        .map((o) => ({ id: o.out_id, name: o.out_label, detail: o.out_detail })),
      staff: opts
        .filter((o) => o.out_kind === 'teacher')
        .map((o) => ({
          id: o.out_id,
          name: o.out_label,
          detail: o.out_detail,
          // Which subject the assignment covers — null for a form teacher, who covers
          // any. Lets the screen narrow the list once a subject is chosen.
          subjectId: o.out_subject_id,
        })),
      // The screen renders read-only for a teacher rather than hiding itself: seeing
      // the school's week is useful even when editing it is not yours to do.
      canEdit,
    })
  })
}

const slotSchema = z.object({
  timetableId: z.string().uuid(),
  classId: z.string().trim().min(1).max(60),
  periodId: z.string().uuid(),
  dayOfWeek: z.number().int().min(1).max(5),
  subjectId: z.string().uuid().nullable().optional(),
  staffUserId: z.string().trim().max(120).nullable().optional(),
  slotType: z.enum(['lesson', 'break', 'assembly', 'free', 'exam']).default('lesson'),
  room: z.string().trim().max(60).nullable().optional(),
  // The spec's panel includes it; `0205` added the parameter it had been missing, so
  // a note typed here used to be saved into nothing.
  notes: z.string().trim().max(500).nullable().optional(),
})

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = slotSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .rpc('set_timetable_slot', {
        p_timetable_id: parsed.data.timetableId,
        p_class_id: parsed.data.classId,
        p_period_id: parsed.data.periodId,
        p_day_of_week: parsed.data.dayOfWeek,
        p_subject_id: parsed.data.subjectId ?? null,
        p_staff_user_id: parsed.data.staffUserId ?? null,
        p_slot_type: parsed.data.slotType,
        p_room: parsed.data.room ?? null,
        p_notes: parsed.data.notes ?? null,
      })
      .maybeSingle()

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      // The clash, already phrased for a human by the function.
      if (error.code === '23505') return fail('CONFLICT', error.message)
      // A lesson in a break, or a day the period does not run.
      if (error.code === '23514') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    const row = (data ?? {}) as { out_slot_id?: string; out_message?: string }
    return ok({ slotId: row.out_slot_id, message: row.out_message })
  })
}

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('clear'), slotId: z.string().uuid() }),
  /*
    Creating the timetable and defining the school day live here too.

    `0197` and `0200` built everything that EDITS a grid and nothing that creates one,
    so the builder could only ever say "ask AfriTech". A feature nobody can start is
    the failure this project keeps repeating.
  */
  z.object({
    action: z.literal('create'),
    academicYear: z.string().trim().min(4).max(9),
    termNumber: z.number().int().min(1).max(4),
    name: z.string().trim().max(60).optional(),
  }),
  z.object({
    action: z.literal('period'),
    periodId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1).max(60),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    order: z.number().int().min(1).max(99),
    appliesDays: z.array(z.number().int().min(1).max(5)).min(1),
    teaching: z.boolean().default(true),
  }),
  z.object({ action: z.literal('deletePeriod'), periodId: z.string().uuid() }),
  z.object({
    action: z.literal('publish'),
    timetableId: z.string().uuid(),
    published: z.boolean(),
  }),
])

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    if (parsed.data.action === 'create') {
      const { data, error } = await client
        .rpc('create_timetable', {
          p_academic_year: parsed.data.academicYear,
          p_term_number: parsed.data.termNumber,
          p_name: parsed.data.name ?? 'Main Timetable',
          p_make_active: true,
        })
        .maybeSingle()

      if (error) {
        if (error.code === '42501') return fail('FORBIDDEN', error.message)
        return fromPostgrestError(error)
      }
      const row = (data ?? {}) as { out_timetable_id?: string }
      return ok({ timetableId: row.out_timetable_id })
    }

    if (parsed.data.action === 'period') {
      const { data, error } = await client
        .rpc('set_timetable_period', {
          p_period_id: parsed.data.periodId ?? null,
          p_name: parsed.data.name,
          p_start_time: parsed.data.startTime,
          p_end_time: parsed.data.endTime,
          p_order: parsed.data.order,
          p_applies_days: parsed.data.appliesDays,
          p_teaching: parsed.data.teaching,
        })
        .maybeSingle()

      if (error) {
        if (error.code === '42501') return fail('FORBIDDEN', error.message)
        // A backwards period, no days, or a position already taken.
        if (error.code === '22023' || error.code === '23505') {
          return fail('VALIDATION_ERROR', error.message)
        }
        return fromPostgrestError(error)
      }
      const row = (data ?? {}) as { out_period_id?: string }
      return ok({ periodId: row.out_period_id })
    }

    if (parsed.data.action === 'deletePeriod') {
      const { data, error } = await client
        .rpc('delete_timetable_period', { p_period_id: parsed.data.periodId })
        .maybeSingle()

      if (error) {
        if (error.code === '42501') return fail('FORBIDDEN', error.message)
        return fromPostgrestError(error)
      }
      const row = (data ?? {}) as { out_done?: boolean; out_message?: string }
      // Refused because lessons sit in it — a real answer carrying the count, not an
      // error. CONFLICT rather than NOT_FOUND: the period exists and is in use.
      if (!row.out_done) return fail('CONFLICT', row.out_message ?? 'Could not remove it.')
      return ok({ removed: true })
    }

    if (parsed.data.action === 'clear') {
      const { data, error } = await client
        .rpc('clear_timetable_slot', { p_slot_id: parsed.data.slotId })
        .maybeSingle()

      if (error) {
        if (error.code === '42501') return fail('FORBIDDEN', error.message)
        return fromPostgrestError(error)
      }
      const row = (data ?? {}) as { out_done?: boolean; out_message?: string }
      if (!row.out_done) return fail('NOT_FOUND', row.out_message ?? 'Nothing to clear.')
      return ok({ cleared: true })
    }

    const { data, error } = await client
      .rpc('publish_timetable', {
        p_timetable_id: parsed.data.timetableId,
        p_published: parsed.data.published,
      })
      .maybeSingle()

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      return fromPostgrestError(error)
    }

    const row = (data ?? {}) as {
      out_done?: boolean
      out_message?: string
      out_unstaffed?: number
    }
    if (!row.out_done) return fail('NOT_FOUND', row.out_message ?? 'No such timetable.')

    return ok({
      published: parsed.data.published,
      message: row.out_message,
      // Reported rather than enforced: a lesson with no teacher is normal the week
      // before term, and a school publishing so teachers can see their week is right.
      unstaffed: row.out_unstaffed ?? 0,
    })
  })
}
