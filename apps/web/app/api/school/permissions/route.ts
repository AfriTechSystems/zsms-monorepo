/**
 * GET/POST/PATCH /api/school/permissions — time-bounded permission grants.
 *
 * Spec: `02 Authentication and Identity/PERMISSIONS.md`
 *
 * ## What this unlocks
 *
 * `has_permission_grant()` has been called by **15 live RLS policies** for a long time —
 * students, parents, teaching assignments, fee structures, fee records, payments,
 * attendance and exam results. There was no way to create a grant, so the function always
 * returned false and the whole delegation capability was dead weight.
 *
 * The scenario it exists for, from the document: the accountant is on medical leave for
 * three weeks, and the principal needs somebody to record cash payments meanwhile.
 *
 * ## Why there is no role check in this file
 *
 * `grant_staff_permission()` refuses anyone who is not owner or principal, refuses a
 * principal attempting financial write, refuses a blank reason, refuses a grantee who does
 * not work here, and refuses granting to yourself. A second copy of those rules here would
 * drift, and it is the copy a direct PostgREST call skips.
 *
 * Direct INSERT on the table is revoked (`0236`), so the function is the only way in.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/** The 15 modules PERMISSIONS.md defines, matching `0236`'s CHECK. */
const MODULES = [
  'fees',
  'payments',
  'attendance',
  'results',
  'results_publish',
  'students',
  'parents',
  'staff',
  'assignments',
  'communication',
  'reports',
  'settings',
  'loans',
  'audit',
  'permissions',
] as const

const ACTIONS = ['read', 'write', 'delete', 'export', 'publish'] as const

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('school_permission_grants')

    if (error) {
      if (error.code === '42501') {
        return fail('FORBIDDEN', 'Your role does not include staff permissions.')
      }
      return fromPostgrestError(error)
    }

    type Row = {
      out_id: string
      out_grantee_id: string
      out_grantee_name: string
      out_grantor_name: string
      out_module: string
      out_action: string
      out_reason: string
      out_scope_detail: string | null
      out_granted_at: string
      out_expires_at: string | null
      out_is_active: boolean
      out_revoked_at: string | null
      out_expires_in_days: number | null
    }

    const rows = (data ?? []) as Row[]

    return ok({
      grants: rows.map((r) => ({
        id: r.out_id,
        granteeId: r.out_grantee_id,
        granteeName: r.out_grantee_name,
        grantorName: r.out_grantor_name,
        module: r.out_module,
        action: r.out_action,
        reason: r.out_reason,
        scopeDetail: r.out_scope_detail,
        grantedAt: r.out_granted_at,
        expiresAt: r.out_expires_at,
        isActive: r.out_is_active,
        revokedAt: r.out_revoked_at,
        expiresInDays: r.out_expires_in_days,
      })),
      modules: MODULES,
      actions: ACTIONS,
      meta: {
        active: rows.filter((r) => r.out_is_active).length,
        /*
          The document promises the grantor is warned two days before a grant lapses.
          There is no notification channel yet, so the screen surfaces it instead —
          a grant that expires silently mid-term is the failure that matters.
        */
        expiringSoon: rows.filter(
          (r) => r.out_is_active && r.out_expires_in_days !== null && r.out_expires_in_days <= 2,
        ).length,
      },
    })
  })
}

const createSchema = z.object({
  granteeUserId: z.string().trim().min(1).max(80),
  module: z.enum(MODULES),
  action: z.enum(ACTIONS),
  reason: z.string().trim().min(1).max(300),
  /** Days from now. Null means manual revocation only. */
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
  scopeDetail: z.string().trim().max(120).nullable().optional(),
})

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = createSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const v = parsed.data

    /*
      Days in, a timestamp out. The screen asks "for how long", which is the question a
      principal can answer; converting here keeps the browser's clock out of a value the
      database compares against `NOW()`.
    */
    const expiresAt =
      v.expiresInDays != null
        ? new Date(Date.now() + v.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null

    const { data, error } = await client
      .rpc('grant_staff_permission', {
        p_grantee_user_id: v.granteeUserId,
        p_module: v.module,
        p_action: v.action,
        p_reason: v.reason,
        p_expires_at: expiresAt,
        p_scope_detail: v.scopeDetail ?? null,
      })
      .maybeSingle()

    if (error) return mapError(error)

    return ok({
      id: (data as { out_grant_id?: string } | null)?.out_grant_id ?? null,
      message: expiresAt
        ? `Granted. It lapses on its own in ${v.expiresInDays} day${v.expiresInDays === 1 ? '' : 's'}.`
        : 'Granted. This one stays until somebody revokes it.',
    })
  })
}

const revokeSchema = z.object({ id: z.string().uuid() })

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = revokeSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', 'A grant id is required.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { error } = await client.rpc('revoke_staff_permission', {
      p_grant_id: parsed.data.id,
    })

    if (error) return mapError(error)

    return ok({ message: 'Revoked. The record of what they could do stays.' })
  })
}

/** The database's refusals carry the reasoning; pass them through rather than reword. */
function mapError(error: { code?: string; message: string }): Response {
  if (error.code === '42501') return fail('FORBIDDEN', error.message)
  if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
  if (error.code === '23514') {
    return fail('VALIDATION_ERROR', 'That is not a module and action ZSMS recognises.')
  }
  return fromPostgrestError(error)
}
