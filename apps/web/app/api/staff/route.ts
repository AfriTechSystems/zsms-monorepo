/**
 * /api/staff — collection.
 *
 * Spec: `Official Documentation/08 Staff Management/STAFF.md`
 *       `Official Documentation/01 Foundation Layer/RLS.md` — staff_members table
 *
 * Note the asymmetry with students: management_read_staff is limited to owner,
 * principal, and admin — accountants are NOT included, unlike on students where
 * they are. That is RLS.md's rule, not an oversight here. Staff records carry
 * employment details that fee handling has no business reading.
 */

import type { NextRequest } from 'next/server'
import { createUserClient } from '../../../lib/supabase'
import {
  created,
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../lib/api-response'
import { createStaffSchema, listStaffQuerySchema } from '../../../lib/validation'
import { resolveSchoolContext } from '../../../lib/school-context'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = listStaffQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    )
    if (!parsed.success) return validationFailed(parsed.error)

    const { page, perPage, isActive, department } = parsed.data
    const from = (page - 1) * perPage

    let query = client
      .from('staff_members')
      .select(
        'id, school_id, clerk_user_id, staff_number, first_name, last_name, phone_e164, email, department, employment_type, join_date, is_active, created_at, updated_at',
        { count: 'exact' },
      )
      .order('last_name', { ascending: true })
      .range(from, from + perPage - 1)

    if (isActive !== undefined) query = query.eq('is_active', isActive)
    if (department) query = query.eq('department', department)

    const { data, error, count } = await query
    if (error) return fromPostgrestError(error)

    return ok(data ?? [], { page, perPage, total: count ?? 0 })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = createStaffSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This session is not associated with a school.')

    const input = parsed.data
    const row: Record<string, unknown> = {
      school_id: school.uuid,
      clerk_user_id: input.clerkUserId,
      first_name: input.firstName,
      last_name: input.lastName,
    }
    if (input.email !== undefined) row['email'] = input.email
    if (input.phoneE164 !== undefined) row['phone_e164'] = input.phoneE164
    if (input.department !== undefined) row['department'] = input.department
    if (input.staffNumber !== undefined) row['staff_number'] = input.staffNumber
    if (input.employmentType !== undefined) row['employment_type'] = input.employmentType
    if (input.joinDate !== undefined) row['join_date'] = input.joinDate

    const { data, error } = await client
      .from('staff_members')
      .insert(row)
      .select('id, school_id, clerk_user_id, first_name, last_name, department, employment_type, is_active, created_at')
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!data) {
      return fail('FORBIDDEN', 'Only the school owner or principal may add staff.')
    }

    return created(data)
  })
}
