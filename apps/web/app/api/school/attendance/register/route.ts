/**
 * GET  /api/school/attendance/register?classId=&date= — the register to mark.
 * POST /api/school/attendance/register — save it.
 *
 * Spec: `Official Documentation/11 Attendance/ATTENDANCE.md`
 *       `Official Documentation/01 Foundation Layer/RLS.md`
 *       `Official Documentation/01 Foundation Layer/DECISIONS.md` — ADR-037
 *
 * ## The register is not a list of records, it is a list of pupils
 *
 * A naive endpoint returns today's `attendance_records` for a class. That is
 * wrong on the day it matters: before anyone marks anything there are no rows,
 * so the register renders empty and the teacher has nothing to tick. What a
 * register *is* is every pupil on the roll for that class, each carrying whatever
 * mark already exists — usually none.
 *
 * So the pupils come from `students` and the marks are joined onto them. A pupil
 * with no row comes back with `status: null`, which the screen renders as
 * unmarked rather than as present. Defaulting to present would mean a register
 * nobody opened reads as a full attendance.
 *
 * ## Scope is the database's answer, not this file's
 *
 * A teacher only sees pupils in classes `teacher_reaches_class()` admits, and
 * the same predicate gates the insert. Nothing here filters by teacher: the
 * SELECT policy on `students` already does it, so asking for a class they do not
 * teach returns no pupils — an empty register rather than a refusal, which is the
 * same answer a class with no pupils gives, and deliberately so. Confirming that
 * a class exists but is not theirs is a disclosure the boundary avoids.
 *
 * ## Saving is an upsert, because a register is corrected all morning
 *
 * `(school_id, student_id, attendance_date)` is unique. A latecomer arriving at
 * 08:20 is the same row as the absence recorded at 08:05, not a second one. The
 * write is therefore `upsert`, and one consequence is worth knowing: PostgREST's
 * upsert must satisfy BOTH the insert and the update policy. `attendance_update`
 * admits the recorder themselves, the owner and the principal — but not an
 * administrator, who may insert. So an administrator can mark a fresh register
 * and cannot correct one, and that asymmetry comes back as a clear message
 * rather than a silent no-op.
 */

import type { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAuthProvider, type Role } from '@zsms/auth-provider'

import { createUserClient } from '../../../../../lib/supabase'
import { AFRITECH_ORG_SLUG } from '../../../../../lib/admin-context'
import { can } from '../../../../../lib/roles'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const querySchema = z.object({
  classId: z.string().trim().min(1).max(50),
  date: z.string().regex(ISO_DATE, 'Must be YYYY-MM-DD'),
})

const markSchema = z.object({
  studentId: z.string().uuid(),
  status: z.enum(['present', 'absent', 'late', 'excused', 'holiday']),
  // `excused` without a reason is refused by `attendance_excused_needs_reason`.
  // Validated here so the message names the pupil's row rather than arriving as
  // a 23514 from the driver.
  excuseReason: z.string().trim().max(300).optional(),
})

const saveSchema = z.object({
  classId: z.string().trim().min(1).max(50),
  date: z.string().regex(ISO_DATE, 'Must be YYYY-MM-DD'),
  termNumber: z.coerce.number().int().min(1).max(4),
  marks: z.array(markSchema).min(1).max(200),
})

async function resolveCaller(): Promise<
  { ok: true; role: Role | 'none'; userId: string } | { ok: false; response: NextResponse }
> {
  const session = await getAuthProvider().getSessionUser()
  if (!session) return { ok: false, response: fail('UNAUTHORIZED', 'Authentication required.') }
  if (session.organisationSlug === AFRITECH_ORG_SLUG || !session.organisationId) {
    return { ok: false, response: fail('FORBIDDEN', 'This is a school endpoint.') }
  }
  return { ok: true, role: session.role, userId: session.userId }
}

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'attendance:read')) {
      return fail('FORBIDDEN', 'Your role does not include attendance.')
    }

    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if (!parsed.success) return validationFailed(parsed.error)

    const { classId, date } = parsed.data

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    // Pupils first — the register is the roll, not the records. Only those on
    // the roll: a transferred pupil is not absent, they are gone.
    const [pupils, marks] = await Promise.all([
      client
        .from('students')
        .select('id, student_id, first_name, last_name, class_id, status')
        .eq('class_id', classId)
        .eq('is_deleted', false)
        .in('status', ['active', 'on_leave'])
        .order('last_name', { ascending: true }),
      client
        .from('attendance_records')
        .select('id, student_id, status, excuse_reason, recorded_by_user_id, updated_at')
        .eq('class_id', classId)
        .eq('attendance_date', date),
    ])

    if (pupils.error) return fromPostgrestError(pupils.error)
    if (marks.error) return fromPostgrestError(marks.error)

    const byStudent = new Map(
      (marks.data ?? []).map((m) => [m.student_id as string, m]),
    )

    return ok({
      classId,
      date,
      register: (pupils.data ?? []).map((p) => {
        const mark = byStudent.get(p.id as string)
        return {
          studentId: p.id,
          studentNumber: p.student_id,
          firstName: p.first_name,
          lastName: p.last_name,
          onLeave: p.status === 'on_leave',
          // NULL, never 'present'. An unopened register must not read as a full
          // attendance — the whole point of the day's record is the difference.
          status: mark?.status ?? null,
          excuseReason: mark?.excuse_reason ?? null,
          recordedBy: mark?.recorded_by_user_id ?? null,
        }
      }),
      alreadyMarked: (marks.data ?? []).length > 0,
      canMark: can(caller.role, 'attendance:write'),
    })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'attendance:write')) {
      return fail('FORBIDDEN', 'Your role does not include marking registers.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = saveSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const { classId, date, termNumber, marks } = parsed.data

    const missingReason = marks.find((m) => m.status === 'excused' && !m.excuseReason)
    if (missingReason) {
      return fail(
        'VALIDATION_ERROR',
        'An excused absence needs a reason. Without one there is nothing to distinguish it from an unexplained absence.',
      )
    }

    // From the session, never the body — the same rule as every other write.
    const { data: schools } = await client.from('schools').select('id').limit(2)
    const school = schools?.[0]
    if (!school || schools.length !== 1) {
      return fail('FORBIDDEN', 'This session is not associated with a single school.')
    }

    const { error } = await client.from('attendance_records').upsert(
      marks.map((m) => ({
        school_id: school.id,
        student_id: m.studentId,
        class_id: classId,
        recorded_by_user_id: caller.userId,
        attendance_date: date,
        // Derived from the date being marked rather than from today's clock: a
        // register backfilled in January for December belongs to December's
        // academic year, not to the year someone happens to be typing in.
        academic_year: date.slice(0, 4),
        term_number: termNumber,
        status: m.status,
        excuse_reason: m.status === 'excused' ? (m.excuseReason ?? null) : null,
        sync_source: 'web',
      })),
      { onConflict: 'school_id,student_id,attendance_date' },
    )

    if (error) {
      // The administrator case described in the header: they may insert and may
      // not update, so correcting an existing register fails here where marking
      // a fresh one succeeds. Worth naming rather than reporting as a generic
      // refusal, because the person will have just seen it work yesterday.
      if (error.code === '42501') {
        return fail(
          'FORBIDDEN',
          'You cannot change a register that someone else has already marked. The teacher who marked it, the principal, or the school owner can.',
        )
      }
      return fromPostgrestError(error)
    }

    return ok({ classId, date, saved: marks.length })
  })
}
