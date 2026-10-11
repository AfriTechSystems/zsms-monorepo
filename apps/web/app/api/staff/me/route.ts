/**
 * GET/PATCH /api/staff/me — a member of staff manages their own profile.
 *
 * Spec: `08 Staff Management/STAFF.md` → *Staff Profile Self-Management*
 *
 * ## Why PATCH goes through a function rather than the table
 *
 * `authenticated` already holds a **table-level UPDATE** on `staff_members`, granted so
 * `management_write_staff` could work. A self-scoped UPDATE policy would therefore let
 * a teacher write **any** column on their own row — `school_id`, moving themselves into
 * another school's roster; `is_active`, undoing their own removal.
 *
 * `0249`'s assertion caught exactly that in the first draft. So self-service goes
 * through `update_my_staff_profile()`, which names the seven fields STAFF.md permits
 * and cannot reach the others because it never mentions them.
 *
 * ## One person, possibly several schools
 *
 * STAFF.md's *Multi-School Staff* case is real: one Clerk account can be staff at two
 * schools. The function updates **every** row for that person, because a teacher
 * correcting their phone number means it everywhere — having to fix it per school is
 * the kind of chore that leaves one of them permanently wrong.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      `staff_read_own_record` scopes this to the caller, so no filter is written here
      — a second copy of that rule is one that drifts, and it is the copy a direct
      PostgREST call skips.
    */
    const { data, error } = await client
      .from('staff_members')
      .select(
        'id, school_id, staff_number, first_name, last_name, phone_e164, email, photo_url, department, employment_type, join_date, location, qualifications, is_active, schools(name, school_id)',
      )
      .order('created_at')

    if (error) return fromPostgrestError(error)

    const rows = data ?? []

    if (rows.length === 0) {
      /*
        Not an error. A parent, a pupil or a standalone teacher opening the account
        page is simply not staff anywhere — the section renders nothing rather than
        showing a failure.
      */
      return ok({ isStaff: false, records: [] })
    }

    return ok({
      isStaff: true,
      /*
        Self-managed fields come from the first record, because they are properties of
        the PERSON — the same name and phone wherever they teach. The per-school rows
        below carry what differs.
      */
      profile: {
        firstName: rows[0]!.first_name,
        lastName: rows[0]!.last_name,
        phone: rows[0]!.phone_e164,
        email: rows[0]!.email,
        photoUrl: rows[0]!.photo_url,
        location: rows[0]!.location,
        qualifications: rows[0]!.qualifications,
      },
      records: rows.map((r) => {
        const school = r.schools as { name?: string; school_id?: string } | null
        return {
          id: r.id,
          schoolName: school?.name ?? 'A school',
          schoolCode: school?.school_id ?? '',
          // Admin-managed, shown read-only so somebody can see what to ask about.
          staffNumber: r.staff_number,
          department: r.department,
          employmentType: r.employment_type,
          joinDate: r.join_date,
          isActive: r.is_active,
        }
      }),
    })
  })
}

const schema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  /*
    Empty string is allowed and means "clear this", which `0249` honours. Absence
    means "leave alone" — a form that omits a field must not wipe it.
  */
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().max(160).optional(),
  photoUrl: z.string().trim().max(500).optional(),
  location: z.string().trim().max(120).optional(),
  qualifications: z.string().trim().max(500).optional(),
})

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const v = parsed.data

    const { data, error } = await client.rpc('update_my_staff_profile', {
      // `?? null` and not `?? ''`: null is "leave alone", empty string is "clear".
      p_first_name: v.firstName ?? null,
      p_last_name: v.lastName ?? null,
      p_phone_e164: v.phone ?? null,
      p_email: v.email ?? null,
      p_photo_url: v.photoUrl ?? null,
      p_location: v.location ?? null,
      p_qualifications: v.qualifications ?? null,
    })

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      return fromPostgrestError(error)
    }

    if (data !== true) {
      return fail('NOT_FOUND', 'You do not have a staff record to update.')
    }

    return ok({
      message:
        'Saved. Your details are updated everywhere you are on staff — you do not need to change them school by school.',
    })
  })
}
