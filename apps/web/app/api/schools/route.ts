/**
 * /api/schools — the caller's own school.
 *
 * Spec: `Official Documentation/05 Core Database and API Reference/ENDPOINTS.md`
 *       `Official Documentation/01 Foundation Layer/RLS.md` — schools table
 *
 * There is no "list schools" endpoint and there will not be one. A school can
 * only ever see itself (school_staff_read_own_school); a collection route would
 * imply otherwise. AfriTech's cross-school view is a super-admin surface with
 * its own audited routes (SUPERADMIN.md), not this one.
 */

import type { NextRequest } from 'next/server'
import { createUserClient } from '../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../lib/api-response'
import { updateSchoolSchema } from '../../../lib/validation'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .from('schools')
      .select(
        'id, school_id, name, type, level, city_code, country_code, address, phone, email, logo_url, status, subscription_tier, trial_ends_at, finance_module_enabled, whatsapp_enabled, max_students, created_at, updated_at',
      )
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!data) return fail('NOT_FOUND', 'No school is associated with this session.')

    return ok(data)
  })
}

export async function PATCH(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = updateSchoolSchema.safeParse(body)
    if (!parsed.success) {
      const { validationFailed } = await import('../../../lib/api-response')
      return validationFailed(parsed.error)
    }

    const input = parsed.data
    const patch: Record<string, unknown> = {}
    if (input.name !== undefined) patch['name'] = input.name
    if (input.address !== undefined) patch['address'] = input.address
    if (input.phone !== undefined) patch['phone'] = input.phone
    if (input.email !== undefined) patch['email'] = input.email
    if (input.logoUrl !== undefined) patch['logo_url'] = input.logoUrl
    if (input.type !== undefined) patch['type'] = input.type
    if (input.level !== undefined) patch['level'] = input.level
    if (input.whatsappEnabled !== undefined) patch['whatsapp_enabled'] = input.whatsappEnabled

    // No .eq() filter. owner_update_own_school scopes the statement to the
    // caller's own school; adding a client-supplied id would let the request
    // name a target and make RLS the only thing refusing it.
    const { data, error } = await client
      .from('schools')
      .update(patch)
      .select('id, school_id, name, type, level, address, phone, email, logo_url, whatsapp_enabled, updated_at')

    if (error) return fromPostgrestError(error)

    // Zero rows means the UPDATE policy matched nothing — the caller is not the
    // owner. RLS reports this as "no rows affected", not as an error.
    if (!data || data.length === 0) {
      return fail('FORBIDDEN', 'Only the school owner may update school details.')
    }

    return ok(data[0])
  })
}
