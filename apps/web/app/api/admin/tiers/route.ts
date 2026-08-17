/**
 * GET   /api/admin/tiers — the subscription price list.
 * PATCH /api/admin/tiers — change a tier's pricing or limits.
 *
 * Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
 *       `Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md` — ADR-031
 *
 * ADR-031's premise: if a business person might reasonably want to change it, it
 * lives in the database and a super admin changes it without a deployment. A
 * price is the canonical example, so this route exists and nothing anywhere
 * hardcodes K600.
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

const patchSchema = z
  .object({
    tierName: z.enum(['starter', 'growth', 'professional', 'enterprise']),
    // Zero is allowed — a free tier is a real product decision. Negative is not.
    monthlyPriceZmw: z.number().min(0).optional(),
    monthlyPriceUsd: z.number().min(0).optional(),
    annualPriceZmw: z.number().min(0).optional(),
    // -1 means unlimited, matching the function's sentinel. NULL in the column
    // already means unlimited, so it cannot double as "unchanged".
    studentLimit: z.number().int().min(-1).optional(),
    whatsappQuota: z.number().int().min(-1).optional(),
    isPubliclyListed: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 1, { message: 'No changes supplied.' })

export async function GET(): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const [tiers, schools] = await Promise.all([
      client
        .from('subscription_tier_catalogue')
        .select('*')
        .order('display_order', { ascending: true }),
      client.from('schools').select('subscription_tier, status'),
    ])

    if (tiers.error) return fromPostgrestError(tiers.error)

    // Schools per tier, counting only those actually billing. Trial and
    // suspended schools are not revenue and should not inflate a price change's
    // apparent impact.
    const billingPerTier: Record<string, number> = {}
    for (const row of (schools.data ?? []) as Array<{ subscription_tier: string; status: string }>) {
      if (row.status !== 'active') continue
      billingPerTier[row.subscription_tier] = (billingPerTier[row.subscription_tier] ?? 0) + 1
    }

    return ok({ tiers: tiers.data ?? [], billingPerTier })
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

    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const v = parsed.data

    // Undefined is passed through as null, which the function reads as
    // "leave unchanged" — so a partial patch never has to read the row first
    // and echo values back, a read-modify-write that would lose a concurrent edit.
    const { error } = await client.rpc('admin_update_tier', {
      p_tier_name: v.tierName,
      p_monthly_zmw: v.monthlyPriceZmw ?? null,
      p_monthly_usd: v.monthlyPriceUsd ?? null,
      p_annual_zmw: v.annualPriceZmw ?? null,
      p_student_limit: v.studentLimit ?? null,
      p_whatsapp_quota: v.whatsappQuota ?? null,
      p_publicly_listed: v.isPubliclyListed ?? null,
      p_actor: admin.userId,
    })

    if (error) return fromPostgrestError(error)

    const { data } = await client
      .from('subscription_tier_catalogue')
      .select('*')
      .eq('tier_name', v.tierName)
      .maybeSingle()

    return ok(data)
  })
}
