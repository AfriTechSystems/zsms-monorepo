/**
 * GET    /api/school/teaching — who teaches what, and everything needed to add to it.
 * POST   /api/school/teaching — assign a teacher to a class, or to a subject in a class.
 * DELETE /api/school/teaching — remove an assignment.
 *
 * Spec: `Official Documentation/08 Staff Management/TEACHING_ASSIGNMENTS.md`
 *       `Official Documentation/01 Foundation Layer/DECISIONS.md` — ADR-037
 *       `Official Documentation/01 Foundation Layer/RLS.md`
 *
 * ## This is the table attendance and marks are scoped by
 *
 * `teacher_reaches_class()` reads `teacher_assignments`, and that predicate is
 * what decides which pupils a teacher can see, whose register they can mark, and
 * whose marks they can enter. Every row written here widens somebody's access to
 * children's records. That is why the write policy is owner and principal only
 * while the read policy also admits an administrator: seeing the map is
 * administration, redrawing it is not.
 *
 * ## Two scopes, and the CHECK that keeps them honest
 *
 * ADR-037 gives an assignment one of two shapes:
 *
 *   - `class`   — a class teacher. Reaches the whole class, every subject.
 *   - `subject` — a subject teacher. Reaches that class for that subject only.
 *
 * `teacher_assignment_scope_shape` enforces the pairing in the database: a
 * `class` row must carry no `subject_id`, a `subject` row must carry one. The
 * API mirrors it so a mistake is a 400 naming the field rather than a 23514 from
 * the driver — but the database is what makes it true.
 */

import type { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAuthProvider, type Role } from '@zsms/auth-provider'

import { createUserClient } from '../../../../lib/supabase'
import { AFRITECH_ORG_SLUG } from '../../../../lib/admin-context'
import { can } from '../../../../lib/roles'
import {
  created,
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const createSchema = z
  .object({
    teacherUserId: z.string().trim().min(1),
    scope: z.enum(['class', 'subject']),
    classId: z.string().trim().min(1).max(50),
    subjectId: z.string().uuid().optional(),
    academicYear: z
      .string()
      .regex(/^\d{4}$/, 'Must be a four-digit year')
      .optional(),
  })
  // Mirrors `teacher_assignment_scope_shape`. Checked here so the message names
  // the field; enforced there so it is true regardless of the caller.
  .refine((v) => (v.scope === 'subject' ? Boolean(v.subjectId) : !v.subjectId), {
    message: 'A subject assignment needs a subject, and a class assignment must not carry one.',
  })

const deleteSchema = z.object({ id: z.string().uuid() })

async function resolveCaller(): Promise<
  { ok: true; role: Role | 'none' } | { ok: false; response: NextResponse }
> {
  const session = await getAuthProvider().getSessionUser()
  if (!session) return { ok: false, response: fail('UNAUTHORIZED', 'Authentication required.') }
  if (session.organisationSlug === AFRITECH_ORG_SLUG || !session.organisationId) {
    return { ok: false, response: fail('FORBIDDEN', 'This is a school endpoint.') }
  }
  return { ok: true, role: session.role }
}

export async function GET(): Promise<Response> {
  return guard(async () => {
    const caller = await resolveCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'assignments:read')) {
      return fail('FORBIDDEN', 'Only the owner, the principal, and administrators can see teaching assignments.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    // Every query is scoped by its own policy, so none carries a school filter.
    const [assignments, subjects, staff, classes] = await Promise.all([
      client
        .from('teacher_assignments')
        .select('id, teacher_user_id, scope, class_id, subject_id, academic_year, created_at')
        .order('class_id', { ascending: true }),
      client
        .from('school_subjects')
        .select('id, subject_code, subject_name, level_type')
        .order('subject_name', { ascending: true }),
      client
        .from('staff_members')
        .select('clerk_user_id, first_name, last_name, is_active')
        .eq('is_active', true)
        .order('last_name', { ascending: true }),
      // Classes are derived from the roll — there is no classes table, and a
      // class exists because pupils are in it. Same reasoning as
      // /api/school/structure.
      client.from('students').select('class_id, grade_id').eq('is_deleted', false),
    ])

    if (assignments.error) return fromPostgrestError(assignments.error)

    const classSet = new Map<string, string>()
    for (const row of (classes.data ?? []) as Array<{ class_id: string; grade_id: string }>) {
      if (row.class_id) classSet.set(row.class_id, row.grade_id)
    }

    return ok({
      assignments: assignments.data ?? [],
      subjects: subjects.data ?? [],
      teachers: staff.data ?? [],
      classes: [...classSet.entries()]
        .map(([classId, gradeId]) => ({ classId, gradeId }))
        .sort((a, b) => a.classId.localeCompare(b.classId)),
      canManage: can(caller.role, 'assignments:write'),
      // The year an assignment defaults to. Sent rather than computed on the
      // client so a phone with a wrong clock cannot file an assignment under
      // the wrong academic year.
      currentYear: String(new Date().getFullYear()),
    })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'assignments:write')) {
      return fail(
        'FORBIDDEN',
        'Only the school owner and the principal can change who teaches what.',
      )
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const v = parsed.data

    // `school_id` from the session, never the body — the same rule as every
    // other write. `current_school_uuid()` is resolved by the database rather
    // than trusted from the client.
    const { data: schools } = await client.from('schools').select('id').limit(2)
    const school = schools?.[0]
    if (!school || schools.length !== 1) {
      return fail('FORBIDDEN', 'This session is not associated with a single school.')
    }

    const { data, error } = await client
      .from('teacher_assignments')
      .insert({
        school_id: school.id,
        teacher_user_id: v.teacherUserId,
        scope: v.scope,
        class_id: v.classId,
        subject_id: v.scope === 'subject' ? v.subjectId : null,
        academic_year: v.academicYear ?? String(new Date().getFullYear()),
      })
      .select('id, teacher_user_id, scope, class_id, subject_id, academic_year')
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!data) {
      return fail('FORBIDDEN', 'You do not have permission to change teaching assignments here.')
    }

    return created(data)
  })
}

export async function DELETE(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'assignments:write')) {
      return fail('FORBIDDEN', 'Only the school owner and the principal can change teaching assignments.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = deleteSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    // A hard DELETE, and deliberately so — unlike a pupil or a payment, an
    // assignment is not a record of something that happened. It is a statement
    // of who currently teaches what, and a withdrawn one has nothing to
    // preserve. The registers and marks it allowed remain, attributed to the
    // teacher who entered them.
    const { data, error } = await client
      .from('teacher_assignments')
      .delete()
      .eq('id', parsed.data.id)
      .select('id')

    if (error) return fromPostgrestError(error)
    if (!data || data.length === 0) {
      return fail('NOT_FOUND', 'That assignment no longer exists.')
    }

    return ok({ id: parsed.data.id, removed: true })
  })
}
