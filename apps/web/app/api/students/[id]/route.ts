/**
 * /api/students/[id] — single student.
 *
 * Spec: `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
 *       `Official Documentation/01 Foundation Layer/RLS.md` — students table
 *
 * A cross-tenant GET here returns 404, not 403. Answering 403 would confirm
 * that the ID exists at some other school, which is itself a disclosure. RLS
 * makes the row invisible rather than forbidden, and this route keeps that
 * distinction intact.
 */

import type { NextRequest } from 'next/server'
import { getAuthProvider } from '@zsms/auth-provider'
import { createUserClient } from '../../../../lib/supabase'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'
import { updateStudentSchema } from '../../../../lib/validation'

export const dynamic = 'force-dynamic'

// Next.js 15 made route params asynchronous (ADR-036).
type RouteContext = { params: Promise<{ id: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(_request: NextRequest, context: RouteContext): Promise<Response> {
  return guard(async () => {
    const { id } = await context.params
    if (!UUID_RE.test(id)) return fail('VALIDATION_ERROR', 'Student id must be a UUID.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .from('students')
      .select(
        'id, student_id, school_id, first_name, last_name, grade_id, class_id, is_boarding, status, enrolment_date, date_of_birth, gender, photo_url, created_at, updated_at',
      )
      .eq('id', id)
      .eq('is_deleted', false)
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!data) return fail('NOT_FOUND', 'Student not found.')

    /*
      The guardians, which this route never returned.

      A pupil's record showed no way to reach anybody responsible for them — no name, no
      phone, no email — so a bursar chasing fees or an office ringing about an absence had to
      leave ZSMS to find a number. The data has always been there; nothing asked for it.

      `school_management_links` and `school_management_read_parents` (0016) already admit
      school staff, so this needs no new policy and no new grant. The link row carries the
      relationship and which guardian is primary; `parents` carries how to reach them.

      Read as a second query rather than an embed because `parents` has no `school_id` — a
      parent may have children at several schools — so the join crosses a tenant boundary
      that only the policies understand. Fetching it separately keeps PostgREST resolving
      each table under its own policy, which is also what makes a parent at another school
      invisible here.

      A failure is NOT fatal: the pupil's own record still renders, with guardians absent and
      the screen saying so. Losing a whole page because a contact list would not load is a
      worse outcome than a page missing one card.
    */
    const guardians = await client
      .from('student_parent_links')
      .select(
        // The LINK's own id, which unlinking needs — the parent id identifies a person,
        // not their connection to this pupil, and a guardian with four children here has
        // one parent id and four links.
        'id, relationship, is_primary, is_active, '
          + 'parents(id, full_name, phone_e164, email, preferred_contact, clerk_user_id)',
      )
      .eq('student_id', id)
      .eq('is_active', true)
      .order('is_primary', { ascending: false })

    return ok({
      ...data,
      guardians: guardians.data ?? [],
      // Told rather than inferred, so the screen never has to guess whether an empty list
      // means "no guardians recorded" or "the query failed".
      guardiansLoaded: guardians.error === null,
    })
  })
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  return guard(async () => {
    const { id } = await context.params
    if (!UUID_RE.test(id)) return fail('VALIDATION_ERROR', 'Student id must be a UUID.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = updateStudentSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const input = parsed.data
    const patch: Record<string, unknown> = {}
    if (input.firstName !== undefined) patch['first_name'] = input.firstName
    if (input.lastName !== undefined) patch['last_name'] = input.lastName
    if (input.gradeId !== undefined) patch['grade_id'] = input.gradeId
    if (input.classId !== undefined) patch['class_id'] = input.classId
    if (input.dateOfBirth !== undefined) patch['date_of_birth'] = input.dateOfBirth
    if (input.gender !== undefined) patch['gender'] = input.gender
    if (input.isBoarding !== undefined) patch['is_boarding'] = input.isBoarding
    if (input.enrolmentDate !== undefined) patch['enrolment_date'] = input.enrolmentDate
    if (input.photoUrl !== undefined) patch['photo_url'] = input.photoUrl
    if (input.status !== undefined) patch['status'] = input.status

    const { data, error } = await client
      .from('students')
      .update(patch)
      .eq('id', id)
      .eq('is_deleted', false)
      .select('id, student_id, first_name, last_name, grade_id, class_id, status, updated_at')

    if (error) return fromPostgrestError(error)
    if (!data || data.length === 0) {
      // Either the row is invisible to this caller or the UPDATE policy denied
      // it. Both are reported as NOT_FOUND for the reason in the file header.
      return fail('NOT_FOUND', 'Student not found.')
    }

    return ok(data[0])
  })
}

/**
 * Soft delete. Hard deletes on students are forbidden (CONVENTIONS.md
 * prohibition 8), so this is an UPDATE — there is no DELETE policy or DELETE
 * privilege on the table for any role, including the school owner.
 */
export async function DELETE(_request: NextRequest, context: RouteContext): Promise<Response> {
  return guard(async () => {
    const { id } = await context.params
    if (!UUID_RE.test(id)) return fail('VALIDATION_ERROR', 'Student id must be a UUID.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    // The Clerk user ID comes from the auth provider, not from
    // client.auth.getUser() — that reads a Supabase Auth session, which does not
    // exist here. ZSMS authenticates through Clerk and only forwards the token.
    const session = await getAuthProvider().getSessionUser()

    const { data, error } = await client
      .from('students')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: session?.userId ?? null,
      })
      .eq('id', id)
      .eq('is_deleted', false)
      .select('id, student_id, is_deleted, deleted_at')

    if (error) return fromPostgrestError(error)
    if (!data || data.length === 0) return fail('NOT_FOUND', 'Student not found.')

    return ok(data[0])
  })
}
