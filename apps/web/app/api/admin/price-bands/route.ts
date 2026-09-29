/**
 * Per-student price bands, and the switch that turns per-student pricing on.
 *
 *   PATCH  /api/admin/price-bands — set a tier's pricing model (flat / per_student)
 *   POST   /api/admin/price-bands — add or replace a band
 *   DELETE /api/admin/price-bands — remove a band
 *
 * Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
 *
 * ## Why this exists as a separate route
 *
 * `/api/admin/tiers` edits the flat-price fields through `admin_update_tier()`, which does not
 * take `pricing_model` and never did. So per-student pricing — the model intended for most
 * schools — has been fully built in the database since `0124` and settable only by hand-written
 * SQL. `0138` adds the switch; this route is the way to reach it.
 *
 * ## Everything goes through `public.admin_*`, and that is not a style choice
 *
 * `supabase/config.toml` sets `schemas = ["public"]`, so PostgREST resolves `rpc()` and `from()`
 * against `public` and nothing else. A table or function in `afritech` is reachable from SQL and
 * **never from a route**.
 *
 * An earlier draft of this file wrote bands with `client.from('tier_student_price_bands')` and
 * called `afritech.set_tier_pricing_model()`. Neither would have worked, and neither would have
 * failed at build time — it would have been a 404 from PostgREST at runtime. `0139` added the
 * wrappers and the `tier_price_bands` view; this calls those.
 *
 * Overlap is still the database's rule: `0124`'s trigger rejects a band colliding with another and
 * names the one it hit, which is more useful than anything this file could say. Removal is a
 * function rather than a DELETE, because the repository grants DELETE nowhere — the invariant
 * `0129` had to restore twice.
 */

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

const modelSchema = z.object({
  tierName: z.string().trim().min(1).max(40),
  pricingModel: z.enum(['flat', 'per_student']),
})

const bandSchema = z
  .object({
    id: z.string().uuid().optional(),
    tierName: z.string().trim().min(1).max(40),
    minStudents: z.number().int().min(1),
    // Null means "and everything above" — the open-ended top band. Without one, a school that
    // grows past the highest band becomes unpriced, which `school_subscription_charge()` reports
    // rather than guessing at.
    maxStudents: z.number().int().min(1).nullable(),
    pricePerStudentZmw: z.number().min(0),
    pricePerStudentUsd: z.number().min(0),
  })
  .refine((b) => b.maxStudents === null || b.maxStudents >= b.minStudents, {
    message: 'The upper limit cannot be below the lower limit.',
  })

const deleteSchema = z.object({ bandId: z.string().uuid() })

export async function GET(): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /**
     * Read from the view rather than from `subscription_tier_catalogue.price_bands`, which the
     * pricing screen already has. That column is an aggregate with no per-row ids, and an editor
     * needs an id to update or delete one band.
     */
    const { data, error } = await client
      .from('tier_price_bands')
      .select('id, tier_name, min_students, max_students, price_per_student_zmw, price_per_student_usd')
      .order('tier_name')
      .order('min_students')

    if (error) return fromPostgrestError(error)

    const rows = (data ?? []) as unknown as Array<{ tier_name: string }>
    const byTier: Record<string, unknown[]> = {}
    for (const row of rows) {
      byTier[row.tier_name] = [...(byTier[row.tier_name] ?? []), row]
    }

    return ok({ bands: rows, byTier }, { total: rows.length })
  })
}

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = modelSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const { data, error } = await client
      .rpc('admin_set_tier_pricing_model', {
        p_tier_name: parsed.data.tierName,
        p_pricing_model: parsed.data.pricingModel,
      })
      .maybeSingle()

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      if (error.code === 'P0002') return fail('NOT_FOUND', error.message)
      return fromPostgrestError(error)
    }

    /**
     * The band count comes back from the function so the screen can warn. Switching to per-student
     * with no bands is allowed — you have to choose the model before the band form means anything
     * — and a school on such a tier is reported as unpriced rather than billed zero.
     */
    return ok(data)
  })
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = bandSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)
    const b = parsed.data

    const { data, error } = await client.rpc('admin_upsert_tier_price_band', {
      p_tier_name: b.tierName,
      p_min_students: b.minStudents,
      p_max_students: b.maxStudents,
      p_price_zmw: b.pricePerStudentZmw,
      p_price_usd: b.pricePerStudentUsd,
      // Absent creates; present edits that row in place, so a corrected band keeps its identity
      // rather than becoming a second band overlapping the first.
      p_band_id: b.id ?? null,
    })

    if (error) {
      /**
       * `23514` is the overlap trigger from `0124`. Passed through with its own message, which
       * names the band it collides with — far more useful than "check constraint violated", and
       * the whole reason that rule lives in the database rather than in this file.
       */
      if (error.code === '23514') return fail('CONFLICT', error.message)
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      if (error.code === 'P0002') return fail('NOT_FOUND', error.message)
      return fromPostgrestError(error)
    }

    return ok({ bandId: data as unknown as string })
  })
}

export async function DELETE(request: Request): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = deleteSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const { data, error } = await client.rpc('admin_delete_tier_price_band', {
      p_band_id: parsed.data.bandId,
    })

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      return fromPostgrestError(error)
    }

    // The function returns FOUND, so `false` means no such band rather than a failure.
    if (data !== true) return fail('NOT_FOUND', 'No such price band.')

    return ok({ bandId: parsed.data.bandId, deleted: true })
  })
}
