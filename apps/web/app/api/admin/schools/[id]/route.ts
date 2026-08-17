/**
 * GET   /api/admin/schools/[id] — one school, with its feature access resolved.
 * PATCH /api/admin/schools/[id] — status and tier changes.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *       `Official Documentation/17 Integration and Pricing/PRICING.md`
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { resolveAdminContext } from '../../../../../lib/admin-context'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const patchSchema = z
  .object({
    status: z.enum(['pending_verification', 'trial', 'active', 'suspended', 'terminated']).optional(),
    subscriptionTier: z.enum(['starter', 'growth', 'professional', 'enterprise']).optional(),
    financeModuleEnabled: z.boolean().optional(),
    whatsappEnabled: z.boolean().optional(),
    maxStudents: z.number().int().min(0).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes supplied.' })

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { id } = await params

    const { data: school, error } = await client
      .from('schools')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!school) return fail('NOT_FOUND', 'No such school.')

    // Feature access is *resolved*, not listed. Showing the tier matrix alone
    // would be misleading for any school carrying an override — which is
    // precisely the school an operator is most likely to be looking at.
    const { data: features, error: featureError } = await client
      .from('feature_catalogue')
      .select('feature_key, display_name, category, monthly_addon_price_zmw, is_available_as_addon')
      .eq('is_active', true)
      .order('display_order', { ascending: true })

    if (featureError) return fromPostgrestError(featureError)

    const resolved = await Promise.all(
      (features ?? []).map(async (f) => {
        const { data: has } = await client.rpc('school_has_feature', {
          p_school_id: id,
          p_feature_key: f.feature_key as string,
        })
        return { ...f, enabled: has === true }
      }),
    )

    const [overrides, counts] = await Promise.all([
      client
        .from('school_feature_exceptions')
        .select('*')
        .eq('school_id', id)
        .order('created_at', { ascending: false }),
      client
        .from('students')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', id)
        .eq('is_deleted', false),
    ])

    return ok({
      school,
      features: resolved,
      overrides: overrides.data ?? [],
      studentCount: counts.count ?? 0,
    })
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { id } = await params

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const input = parsed.data
    const patch: Record<string, unknown> = {}
    if (input.status !== undefined) patch['status'] = input.status
    if (input.subscriptionTier !== undefined) patch['subscription_tier'] = input.subscriptionTier
    if (input.financeModuleEnabled !== undefined) patch['finance_module_enabled'] = input.financeModuleEnabled
    if (input.whatsappEnabled !== undefined) patch['whatsapp_enabled'] = input.whatsappEnabled
    if (input.maxStudents !== undefined) patch['max_students'] = input.maxStudents

    const { data, error } = await client
      .from('schools')
      .update(patch)
      .eq('id', id)
      .select('id, school_id, name, status, subscription_tier, finance_module_enabled, whatsapp_enabled, max_students, updated_at')

    if (error) return fromPostgrestError(error)

    // Zero rows means the policy matched nothing. For a school-scoped route that
    // would mean "not the owner"; here it means the caller is not an AfriTech
    // admin after all, so the courtesy check above and the policy disagree —
    // worth surfacing as FORBIDDEN rather than as an empty success.
    if (!data || data.length === 0) {
      return fail('FORBIDDEN', 'This change was refused. Platform administrator rights are required.')
    }

    return ok(data[0])
  })
}
