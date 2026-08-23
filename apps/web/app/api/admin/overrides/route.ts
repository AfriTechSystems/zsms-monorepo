/**
 * GET    /api/admin/overrides — per-school feature exceptions.
 * POST   /api/admin/overrides — grant one.
 * DELETE /api/admin/overrides — revoke one.
 *
 * Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
 *       `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *
 * An override is a support decision, and the table is the record that it was
 * made. Two consequences run through this file: a `reason` is mandatory rather
 * than encouraged, and DELETE revokes rather than deletes.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { resolveAdminContext } from '../../../../lib/admin-context'
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
    schoolId: z.string().uuid(),
    overrideType: z.enum([
      'grant_feature',
      'revoke_feature',
      'extend_subscription',
      'extend_trial',
      'tier_override',
      'student_limit_override',
    ]),
    featureKey: z.string().min(1).max(64).optional(),
    overrideValue: z.string().min(1).max(64).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    // Not optional, and not allowed to be whitespace. Six months from now this
    // row is the only explanation of why one school has something its tier does
    // not include, and "" answers nothing.
    reason: z.string().trim().min(10, 'Give a reason someone can act on in six months.').max(500),
    ticketRef: z.string().max(64).optional(),
  })
  .refine(
    (v) =>
      ['grant_feature', 'revoke_feature'].includes(v.overrideType)
        ? Boolean(v.featureKey)
        : !v.featureKey,
    { message: 'A feature key is required for grant/revoke, and must be absent otherwise.' },
  )
  .refine((v) => (v.overrideType === 'tier_override' ? Boolean(v.overrideValue) : true), {
    message: 'A tier override must name the tier to treat the school as.',
  })
  // Mirrors the CHECK added in 0101. Validated here as well as there so the
  // operator gets a field-level message rather than a 409 from the driver — the
  // database remains the boundary, this is only the better error.
  .refine(
    (v) =>
      v.overrideType !== 'student_limit_override' ||
      (typeof v.overrideValue === 'string' &&
        (v.overrideValue === 'unlimited' || /^\d+$/.test(v.overrideValue))),
    { message: 'A student limit override must be a whole number, or the word "unlimited".' },
  )

const revokeSchema = z.object({ id: z.string().uuid() })

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const schoolId = request.nextUrl.searchParams.get('schoolId')

    let query = client
      .from('school_feature_exceptions')
      .select('*')
      .order('created_at', { ascending: false })

    if (schoolId) query = query.eq('school_id', schoolId)

    const { data, error } = await query
    if (error) return fromPostgrestError(error)

    return ok(data ?? [])
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')

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

    const { data, error } = await client.rpc('admin_create_override', {
      p_school_id: v.schoolId,
      p_override_type: v.overrideType,
      p_feature_key: v.featureKey ?? null,
      p_override_value: v.overrideValue ?? null,
      p_expires_at: v.expiresAt ?? null,
      p_reason: v.reason,
      p_ticket_ref: v.ticketRef ?? null,
      // From the session. An operator cannot attribute their own decision to
      // someone else.
      p_actor: admin.userId,
    })

    if (error) return fromPostgrestError(error)

    return created({ id: data, ...v, grantedBy: admin.userId })
  })
}

export async function DELETE(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = revokeSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    // DELETE the verb, revoke the effect. The row stays, flagged inactive with
    // the actor and timestamp — CONVENTIONS.md prohibition 8 in spirit, and the
    // only thing an audit could later rely on.
    const { error } = await client.rpc('admin_revoke_override', {
      p_id: parsed.data.id,
      p_actor: admin.userId,
    })

    if (error) return fromPostgrestError(error)

    return ok({ id: parsed.data.id, revoked: true })
  })
}
