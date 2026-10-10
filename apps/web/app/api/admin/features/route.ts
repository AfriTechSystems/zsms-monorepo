/**
 * GET   /api/admin/features — the feature catalogue and the tier matrix.
 * PATCH /api/admin/features — toggle one cell of the matrix.
 *
 * Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
 *       `Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md`
 *
 * A cell here affects every school on that tier immediately. There is no
 * publish step and no draft: `DYNAMIC_CONFIG.md`'s whole premise is that a
 * business person changes this without a deployment. The screen's job is to
 * make the blast radius visible before the click, not to add a workflow.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { resolveAdminContext } from '../../../../lib/admin-context'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const toggleSchema = z.object({
  tierName: z.enum(['starter', 'growth', 'professional', 'enterprise']),
  featureKey: z.string().min(1).max(64),
  included: z.boolean(),
})

export async function GET(): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const [features, matrix, tiers, counts] = await Promise.all([
      client
        .from('feature_catalogue')
        .select('*')
        .order('display_order', { ascending: true }),
      client.from('tier_feature_matrix').select('*'),
      client
        .from('subscription_tier_catalogue')
        .select('tier_name, display_name, display_order')
        .order('display_order', { ascending: true }),
      // How many schools sit on each tier. Without it the operator is toggling
      // a cell with no idea whether it touches two schools or two hundred.
      client.from('schools').select('subscription_tier'),
    ])

    if (features.error) return fromPostgrestError(features.error)
    if (matrix.error) return fromPostgrestError(matrix.error)
    if (tiers.error) return fromPostgrestError(tiers.error)

    const schoolsPerTier: Record<string, number> = {}
    for (const row of (counts.data ?? []) as Array<{ subscription_tier: string }>) {
      schoolsPerTier[row.subscription_tier] = (schoolsPerTier[row.subscription_tier] ?? 0) + 1
    }

    return ok({
      features: features.data ?? [],
      matrix: matrix.data ?? [],
      tiers: tiers.data ?? [],
      schoolsPerTier,
    })
  })
}

export async function PATCH(request: NextRequest): Promise<Response> {
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

    const parsed = toggleSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const { tierName, featureKey, included } = parsed.data

    const { error } = await client.rpc('admin_set_tier_feature', {
      p_tier: tierName,
      p_feature_key: featureKey,
      p_included: included,
      // Attribution is taken from the session, never from the body. An audit
      // trail a caller can forge is not an audit trail.
      p_actor: admin.userId,
    })

    if (error) return fromPostgrestError(error)

    return ok({ tierName, featureKey, included })
  })
}
