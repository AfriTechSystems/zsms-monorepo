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

    const [tiers, schools, allowances] = await Promise.all([
      client
        .from('subscription_tier_catalogue')
        .select('*')
        .order('display_order', { ascending: true }),
      client.from('schools').select('subscription_tier, status'),
      /*
        Included AI credits per tier (`0264`).

        `afritech.tier_ai_allowances` was empty with nothing able to write it, so
        every school on every tier resolved to zero included credits and the only
        way to change that was a migration. That is the failure ADR-031 exists to
        prevent, and this is the read half of the fix.

        Gated on `billing:read`, so its error is tolerated below rather than
        failing the page for an operator who may legitimately not see it.
      */
      client.rpc('admin_tier_ai_allowances'),
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

    /*
      Keyed by tier so the screen can look one up without scanning, and carrying
      `isSet` because "deliberately zero" and "nobody has decided" are different
      facts a pricing screen must not conflate.
    */
    const aiAllowances: Record<string, { credits: number; isSet: boolean }> = {}
    if (!allowances.error) {
      for (const row of (allowances.data ?? []) as Array<Record<string, unknown>>) {
        aiAllowances[row['out_tier_name'] as string] = {
          credits: Number(row['out_monthly_credits'] ?? 0),
          isSet: Boolean(row['out_is_set']),
        }
      }
    }

    return ok({ tiers: tiers.data ?? [], billingPerTier, aiAllowances })
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

/**
 * PUT — set a tier's included monthly AI credits.
 *
 * Spec: `18 AI Module/AI_OVERVIEW.md`, ADR-031
 *
 * Separate from PATCH (which edits prices and ceilings) because it is a different
 * decision made at a different time, and `admin_set_tier_ai_allowance()` requires
 * `billing:write` while some tier fields do not.
 *
 * No amounts are defaulted here or in `0264`: the table stays empty until somebody
 * decides, because a seeded guess would make a commercial decision by accident.
 */
const allowanceSchema = z.object({
  tierName: z.string().trim().min(1).max(40),
  // 0 is meaningful: it records a decision that this tier includes none.
  monthlyCredits: z.number().int().min(0).max(100000),
})

export async function PUT(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const parsed = allowanceSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { error } = await client.rpc('admin_set_tier_ai_allowance', {
      p_tier_name: parsed.data.tierName,
      p_monthly_credits: parsed.data.monthlyCredits,
    })

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    return ok({
      message:
        parsed.data.monthlyCredits === 0
          ? 'Saved. This tier now explicitly includes no AI credits.'
          : `Saved. Schools on this tier now include ${parsed.data.monthlyCredits} AI credits a month.`,
    })
  })
}
