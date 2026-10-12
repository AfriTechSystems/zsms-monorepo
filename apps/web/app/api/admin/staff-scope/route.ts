/**
 * GET/POST /api/admin/staff-scope — AfriTech roles and regional scope.
 *
 * Spec: `02 Authentication and Identity/ROLES.md`
 *
 * ## What this surfaces
 *
 * `ROLES.md` describes six distinct AfriTech roles, each with a stated limit. Until
 * `0237` the build had one boolean — a finance officer could read loan PII, a developer
 * could have impersonated. `has_afritech_capability()` now resolves the matrix, and this
 * route lets a super admin see who holds what and scope a regional manager.
 *
 * ## Why there is no role check in this file
 *
 * `admin_set_staff_scope()` refuses anyone who is not a super admin — deliberately
 * narrower than `is_afritech_admin()`, because otherwise a regional manager could widen
 * their own scope. `my_afritech_capabilities()` is safe for any AfriTech member to call:
 * it reports only the caller's own role.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const mine = await client.rpc('my_afritech_capabilities').maybeSingle()
    if (mine.error) return fromPostgrestError(mine.error)

    const me = mine.data as {
      out_role: string | null
      out_capabilities: string[] | null
      out_scoped: boolean | null
    } | null

    if (!me?.out_role) {
      return fail('FORBIDDEN', 'This area is for AfriTech staff.')
    }

    /*
      The scope rows, and the schools they could point at.

      Read directly rather than through a function: the table's policy already admits
      AfriTech staff for SELECT, and there is no narrowing to express.
    */
    const [scopes, schools] = await Promise.all([
      client
        .schema('afritech')
        .from('staff_scope_assignments')
        .select('id, staff_user_id, scope_kind, country_code, school_id, assigned_at, is_active, expires_at')
        .eq('is_active', true)
        .order('assigned_at', { ascending: false }),
      client.from('schools').select('id, name, school_id, country_code').order('name'),
    ])

    return ok({
      me: {
        role: me.out_role,
        capabilities: me.out_capabilities ?? [],
        isScoped: me.out_scoped ?? false,
      },
      /*
        `scopesLoaded: false` rather than failing the page.

        `afritech` is not in PostgREST's exposed schemas, so this read may well be
        refused. The caller's own role still renders, which is the useful half.
      */
      scopesLoaded: !scopes.error,
      scopes: scopes.error ? [] : (scopes.data ?? []),
      schools: schools.error ? [] : (schools.data ?? []),
      /** The matrix, so the screen states it rather than hardcoding a copy. */
      roles: [
        { role: 'afritech:super_admin', summary: 'Everything, including impersonation' },
        { role: 'afritech:regional_manager', summary: 'Schools in scope; cannot change billing' },
        { role: 'afritech:support_agent', summary: 'Read-only; writes need a grant' },
        { role: 'afritech:loan_officer', summary: 'Loan portfolio only — no revenue data' },
        { role: 'afritech:finance_officer', summary: 'Revenue and billing — no loan PII' },
        { role: 'afritech:developer', summary: 'Can see the platform; cannot impersonate' },
      ],
    })
  })
}

const schema = z
  .object({
    staffUserId: z.string().trim().min(1).max(80),
    scopeKind: z.enum(['country', 'school']),
    countryCode: z.string().trim().regex(/^[A-Z]{2}$/).nullable().optional(),
    schoolId: z.string().uuid().nullable().optional(),
  })
  /*
    The kind and the target must agree. The database's CHECK enforces this too; saying
    it here turns a constraint violation into a sentence somebody can act on.
  */
  .refine(
    (v) =>
      (v.scopeKind === 'country' && v.countryCode && !v.schoolId) ||
      (v.scopeKind === 'school' && v.schoolId && !v.countryCode),
    { message: 'Choose either a country or a single school, not both.' },
  )

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('admin_set_staff_scope', {
      p_staff_user_id: parsed.data.staffUserId,
      p_scope_kind: parsed.data.scopeKind,
      p_country_code: parsed.data.countryCode ?? null,
      p_school_id: parsed.data.schoolId ?? null,
    })

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '23514') {
        return fail('VALIDATION_ERROR', 'Choose either a country or a single school.')
      }
      return fromPostgrestError(error)
    }

    return ok({
      id: data as string,
      message: 'Scope added. They now see only what it covers.',
    })
  })
}
