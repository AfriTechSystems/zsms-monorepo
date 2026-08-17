/**
 * GET /api/admin/schools — every school on the platform.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *
 * `/api/schools` deliberately has no collection route — a school can only ever
 * see itself, and offering a list there would imply otherwise. This is the
 * cross-school view that document points at, and it is a different surface with
 * a different policy behind it (`afritech_admin_all_schools`).
 */

import type { NextRequest } from 'next/server'

import { createUserClient } from '../../../../lib/supabase'
import { resolveAdminContext } from '../../../../lib/admin-context'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const params = request.nextUrl.searchParams
    const page = Math.max(1, Number(params.get('page') ?? '1') || 1)
    const status = params.get('status')
    const tier = params.get('tier')
    const search = params.get('q')?.trim()

    let query = client
      .from('schools')
      .select(
        'id, school_id, name, type, level, city_code, country_code, status, subscription_tier, ' +
          'trial_ends_at, subscription_ends_at, finance_module_enabled, whatsapp_enabled, ' +
          'max_students, phone, email, created_at',
        { count: 'exact' },
      )

    if (status && status !== 'all') query = query.eq('status', status)
    if (tier && tier !== 'all') query = query.eq('subscription_tier', tier)

    if (search) {
      // Name or school code. Escaped for PostgREST's `or` grammar, where a comma
      // separates conditions and would otherwise let a search term inject one.
      const safe = search.replace(/[,()*]/g, ' ')
      query = query.or(`name.ilike.%${safe}%,school_id.ilike.%${safe}%`)
    }

    const from = (page - 1) * PAGE_SIZE
    const { data, error, count } = await query
      .order('name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) return fromPostgrestError(error)

    return ok(data ?? [], { page, perPage: PAGE_SIZE, total: count ?? 0 })
  })
}
