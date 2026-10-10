/**
 * GET   /api/admin/schools/[id] — one school, with its feature access resolved.
 * PATCH /api/admin/schools/[id] — status and tier changes.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *       `Official Documentation/17 Integration and Pricing/PRICING.md`
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { schoolFeatures } from '../../../../../lib/features'
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
    // `maxStudents` USED TO BE HERE and is deliberately gone. `schools.max_students`
    // is a per-school copy of a tier ceiling that nothing has ever enforced;
    // since 0101 the enforced ceiling is resolved by `school_student_limit()`
    // from the tier plus an auditable `student_limit_override`. Leaving both
    // writable gives an operator two fields that look like the same control,
    // one of which does nothing — and the one that does nothing is the one with
    // no reason, no actor, and no expiry attached. See the deprecation note in
    // 0101 and the tracked row in CLAUDE.md.
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

    /*
      One round trip, not one per feature.

      This loop was 13 PostgREST requests and grew with the catalogue — an N+1 over the
      network that CLAUDE.md carried as an open item since `0095`. `schoolFeatures()`
      resolves the whole map through `school_feature_resolution()` (`0215`) and caches it
      for five minutes.

      The resolution order is unchanged: that function reuses `school_has_feature()`
      rather than restating it, so this screen cannot disagree with what a gate enforces.
    */
    const featureMap = await schoolFeatures(client, id)

    const resolved = (features ?? []).map((f) => ({
      ...f,
      enabled: featureMap[f.feature_key as string] === true,
    }))

    // The ceiling is resolved by the same function the enrolment trigger reads,
    // so the number an operator sees here is the number a school will actually
    // hit. A count taken separately would eventually disagree with it — the
    // capacity function's counting rule (on the roll: active or on_leave, not
    // soft-deleted) is the part that must not be reimplemented per caller.
    const [overrides, capacity] = await Promise.all([
      client
        .from('school_feature_exceptions')
        .select('*')
        .eq('school_id', id)
        .order('created_at', { ascending: false }),
      client.rpc('school_student_capacity', { p_school_id: id }),
    ])

    /**
     * Onboarding: the record, the checklist, and the weighted completion.
     *
     * Three reads rather than one join, because they answer different questions and two of them
     * can legitimately come back empty — a school seeded before `0143` has checklist rows only
     * from that migration's backfill, and a school seeded before `0144` has no onboarding record
     * at all. Neither is an error, and a join would make an absent onboarding record hide the
     * checklist too.
     */
    const [onboarding, checklist, completion] = await Promise.all([
      client.from('school_onboarding').select('*').eq('school_id', id).maybeSingle(),
      client
        .from('onboarding_checklists')
        .select('item_key, is_complete, completed_at, completed_by')
        .eq('school_id', id),
      client.rpc('school_onboarding_completion', { p_school_id: id }),
    ])

    const { data: catalogue } = await client
      .from('onboarding_checklist_catalogue')
      .select('item_key, label, description, category, weight, blocks, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    const stateByKey = new Map(
      (checklist.data ?? []).map((c) => [c.item_key as string, c]),
    )

    // Driven by the catalogue, not by the school's rows: an item added to the catalogue after
    // this school was created should appear as outstanding rather than vanish from the list.
    const checklistItems = (catalogue ?? []).map((item) => {
      const state = stateByKey.get(item.item_key as string)
      return {
        ...item,
        isComplete: state?.is_complete === true,
        completedAt: state?.completed_at ?? null,
        // No row at all means the school predates the item. Distinguished from "present and
        // incomplete" so an operator can tell a stale school from a slow one.
        hasRow: state !== undefined,
      }
    })

    const progress = (Array.isArray(completion.data) ? completion.data[0] : completion.data) as
      | {
          completion_pct: number
          completed_weight: number
          total_weight: number
          items_complete: number
          items_total: number
          critical_pct: number
        }
      | undefined

    const cap = (Array.isArray(capacity.data) ? capacity.data[0] : capacity.data) as
      | {
          student_limit: number | null
          is_unlimited: boolean
          source: string
          current_count: number
          remaining: number | null
          at_capacity: boolean
        }
      | undefined

    return ok({
      school,
      features: resolved,
      overrides: overrides.data ?? [],
      capacity: cap ?? null,
      // Kept for callers that only want the headline number. It is the same
      // count the capacity function took, not a second query that could drift.
      studentCount: cap?.current_count ?? 0,
      onboarding: onboarding.data ?? null,
      checklist: checklistItems,
      progress: progress ?? null,
      // Whether the Clerk organisation was ever created. `clerk_org_id` is the tenant key, so a
      // placeholder means no school user can reach this school at all — which the detail screen
      // must say plainly rather than rendering an ordinary-looking school page.
      isProvisioned:
        typeof (school as { clerk_org_id?: unknown }).clerk_org_id === 'string' &&
        !(school as { clerk_org_id: string }).clerk_org_id.startsWith('pending_'),
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

    /**
     * A named function rather than a table write, since `0140`.
     *
     * `authenticated` no longer holds UPDATE on `schools.subscription_tier`, `status`,
     * `trial_ends_at` or the module flags — because before `0140` it did, on every column, and a
     * school OWNER could therefore set their own tier to enterprise and extend their own trial by
     * a decade. The table grant is now the profile columns only, and every commercial term moves
     * through `admin_update_school_commercial()`, which checks AfriTech itself.
     *
     * NULL means "leave it alone", so sending one field does not blank the rest.
     */
    const { data, error } = await client
      .rpc('admin_update_school_commercial', {
        p_school_id: id,
        p_status: input.status ?? null,
        p_subscription_tier: input.subscriptionTier ?? null,
        p_finance_module_enabled: input.financeModuleEnabled ?? null,
        p_whatsapp_enabled: input.whatsappEnabled ?? null,
        p_trial_ends_at: null,
        p_subscription_ends_at: null,
      })
      .maybeSingle()

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === 'P0002') return fail('NOT_FOUND', error.message)
      return fromPostgrestError(error)
    }

    /**
     * The function returns one row rather than a set, so this is a null check rather than the
     * length check it used to be. A refusal now arrives as the `42501` handled above — the
     * function raises rather than matching no rows — which is a clearer signal than an empty
     * result that could equally have meant "no such school".
     */
    if (!data) {
      return fail('NOT_FOUND', 'No school with that id.')
    }

    return ok(data)
  })
}
