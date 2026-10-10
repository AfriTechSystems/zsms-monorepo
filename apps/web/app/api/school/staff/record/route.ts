/**
 * PATCH /api/school/staff/record — edit a member of staff's record.
 *
 * Spec: `Official Documentation/08 Staff Management/STAFF.md` → *Staff Profile Fields*
 *
 * ## What this closes
 *
 * The Staff screen could invite somebody and change their Clerk role, and could change
 * **nothing about the person**. Staff number, department, employment type, join date,
 * phone, location and qualifications were all displayed or stored and none could be
 * edited — so a school correcting a misspelled name, or recording that a teacher is on a
 * contract, had nowhere to do it.
 *
 * ## Role and record are separate routes on purpose
 *
 * `/api/school/staff/members` changes what somebody may DO; this changes who they ARE. The
 * first writes to Clerk and takes effect on their next token; the second writes a row.
 * Collapsing them would make one PATCH sometimes an access change, which is the kind of
 * thing that gets clicked by accident.
 *
 * `clerk_user_id` is therefore absent from the schema below. It is how the row is found,
 * never something the row can change.
 *
 * ## `staff:write` — owner and principal
 *
 * STAFF.md says "Admin, Owner" edit these fields and `roles.ts` grants `staff:write` to
 * owner and principal. The matrix wins: inventing a permission to match the prose would
 * put the rule somewhere nothing tests, and a principal running a school is who the
 * document means by "Admin" in a Zambian context.
 *
 * A member of staff editing their OWN profile — which STAFF.md also describes — is a
 * different surface with a different permission, and is not built here.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { getAuthProvider, type Role } from '@zsms/auth-provider'
import { can } from '../../../../../lib/roles'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  // How the row is found. Never a field it can change.
  staffId: z.string().uuid(),

  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  staffNumber: z.string().trim().max(40).optional().or(z.literal('')),
  phone: z.string().trim().max(25).optional().or(z.literal('')),
  department: z.string().trim().max(80).optional().or(z.literal('')),
  // Mirrors the CHECK on the column. Listed rather than free text so a typo is a
  // validation error here instead of a 23514 from the driver.
  employmentType: z.enum(['full_time', 'part_time', 'contract', 'volunteer']).optional(),
  joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  location: z.string().trim().max(120).optional().or(z.literal('')),
  qualifications: z.string().trim().max(500).optional().or(z.literal('')),
})

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    if (!can(caller.role as Role, 'staff:write')) {
      return fail('FORBIDDEN', 'Only the owner or principal may change a staff record.')
    }

    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const i = parsed.data
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

    /*
      Undefined means "unchanged"; empty string means "clear it".

      Two distinct intentions that collapse into one if both map to null — a school
      removing a department that was entered by mistake has to be able to, and a form
      sending every field on every save must not blank the ones it did not show.
    */
    const text = (v: string | undefined): string | null | undefined =>
      v === undefined ? undefined : v === '' ? null : v

    if (i.firstName !== undefined) patch['first_name'] = i.firstName
    if (i.lastName !== undefined) patch['last_name'] = i.lastName
    if (text(i.staffNumber) !== undefined) patch['staff_number'] = text(i.staffNumber)
    if (text(i.phone) !== undefined) patch['phone_e164'] = text(i.phone)
    if (text(i.department) !== undefined) patch['department'] = text(i.department)
    if (i.employmentType !== undefined) patch['employment_type'] = i.employmentType
    if (text(i.joinDate) !== undefined) patch['join_date'] = text(i.joinDate)
    if (text(i.location) !== undefined) patch['location'] = text(i.location)
    if (text(i.qualifications) !== undefined) patch['qualifications'] = text(i.qualifications)

    // No school filter: the `staff_members` policies scope to the caller's own school,
    // and a second rule here saying the same thing is one that can drift from the first.
    const { data, error } = await client
      .from('staff_members')
      .update(patch)
      .eq('id', i.staffId)
      .select(
        'id, clerk_user_id, staff_number, first_name, last_name, email, phone_e164, department, employment_type, join_date, location, qualifications, is_active',
      )
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    // Not found and not permitted are one answer: distinguishing them would confirm that
    // another school's staff id exists.
    if (!data) return fail('NOT_FOUND', 'That staff member is not available to change.')

    return ok(data)
  })
}
