/**
 * GET/PATCH /api/admin/lenders — the partner lenders AfriTech has onboarded.
 *
 * Spec: `Official Documentation/14 Loan and Finance Module/LENDER_INTEGRATION.md`
 *
 * ## The commercial columns stay on this side
 *
 * `lenders` holds `commission_rate`, `commission_terms`, `api_key_encrypted` and
 * `webhook_secret` alongside the parent-facing description. A parent choosing a lender
 * must never see what AfriTech earns from sending them there, which is why they read
 * through `lenders_for_application()` and this route is AfriTech-only.
 *
 * **The secrets are never returned at all**, even here. `api_key_encrypted` and
 * `webhook_secret` are written and used server-side; a screen that displayed them would
 * put a lender's credentials in a browser's memory and a screenshot.
 *
 * ## Deactivated, not deleted
 *
 * A lender with applications behind them must stop being offered while those applications
 * keep their meaning. There is no delete action.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      One literal `select`, and deliberately NOT `*`.

      `api_key_encrypted` and `webhook_secret` are excluded by naming the columns rather
      than by filtering afterwards — a later `*` would quietly start returning them.
    */
    const { data, error } = await client
      .from('lenders')
      .select(
        'id, lender_name, display_name, tagline, logo_url, description, country_codes, min_loan_amount, max_loan_amount, min_behaviour_score, interest_rate_display, turnaround_label, integration_type, intake_email, api_endpoint, commission_rate, commission_terms, collection_instructions, collection_account, eligibility_summary, required_documents, is_active, is_featured, onboarded_at, onboarded_by, notes',
      )
      .order('is_featured', { ascending: false })
      .order('display_name')

    /*
      The policy admits any signed-in caller to ACTIVE lenders — a parent has to see
      them. So a non-AfriTech caller reaching this route gets the active list and none of
      the commercial detail they have no business with... except the select above does
      include `commission_rate`. Hence the explicit check: this is the one route where
      the policy is deliberately wider than the route should be.
    */
    const admin = await client.rpc('is_afritech_admin')
    if (admin.data !== true) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    if (error) return fromPostgrestError(error)

    const rows = data ?? []

    return ok({
      lenders: rows.map((l) => ({
        id: l.id,
        lenderName: l.lender_name,
        displayName: l.display_name,
        tagline: l.tagline,
        logoUrl: l.logo_url,
        description: l.description,
        countryCodes: l.country_codes,
        minAmount: Number(l.min_loan_amount ?? 0),
        maxAmount: Number(l.max_loan_amount ?? 0),
        minScore: l.min_behaviour_score,
        interestRate: l.interest_rate_display,
        turnaround: l.turnaround_label,
        integrationType: l.integration_type,
        intakeEmail: l.intake_email,
        apiEndpoint: l.api_endpoint,
        commissionRate: Number(l.commission_rate ?? 0),
        commissionTerms: l.commission_terms,
        collectionInstructions: l.collection_instructions,
        collectionAccount: l.collection_account,
        eligibility: l.eligibility_summary ?? [],
        documents: l.required_documents ?? [],
        isActive: l.is_active,
        isFeatured: l.is_featured,
        onboardedAt: l.onboarded_at,
        onboardedBy: l.onboarded_by,
        notes: l.notes,
      })),
    })
  })
}

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save'),
    id: z.string().uuid().optional(),
    lenderName: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(1).max(120),
    tagline: z.string().trim().max(160).nullable().optional(),
    description: z.string().trim().max(1000).nullable().optional(),

    minAmount: z.number().nonnegative().max(99_999_999),
    maxAmount: z.number().positive().max(99_999_999),
    /** On the 300–850 scale. See `0224`. */
    minScore: z.number().int().min(300).max(850),

    interestRate: z.string().trim().min(1).max(120),
    turnaround: z.string().trim().min(1).max(120),

    integrationType: z.enum(['email', 'api', 'zsms_internal']),
    intakeEmail: z.string().trim().email().max(160).nullable().optional(),
    apiEndpoint: z.string().trim().url().max(300).nullable().optional(),

    commissionRate: z.number().min(0).max(1),
    commissionTerms: z.string().trim().max(600).nullable().optional(),

    collectionInstructions: z.string().trim().max(600).nullable().optional(),
    eligibility: z.array(z.string().trim().max(160)).max(12).optional(),
    documents: z.array(z.string().trim().max(160)).max(12).optional(),
    isFeatured: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('setActive'),
    id: z.string().uuid(),
    isActive: z.boolean(),
  }),
])

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    if (parsed.data.action === 'setActive') {
      const { error } = await client
        .from('lenders')
        .update({ is_active: parsed.data.isActive })
        .eq('id', parsed.data.id)

      if (error) return mapError(error)
      return ok({
        message: parsed.data.isActive
          ? 'Parents can choose this lender again.'
          : 'Withdrawn. Applications already with this lender are unaffected.',
      })
    }

    const v = parsed.data

    const who = await client.rpc('get_user_id')
    const userId = (who.data as string | null) ?? null
    if (!userId) return fail('UNAUTHORIZED', 'Could not identify you.')

    const row = {
      lender_name: v.lenderName,
      display_name: v.displayName,
      tagline: v.tagline ?? null,
      description: v.description ?? null,
      min_loan_amount: v.minAmount,
      max_loan_amount: v.maxAmount,
      min_behaviour_score: v.minScore,
      interest_rate_display: v.interestRate,
      turnaround_label: v.turnaround,
      integration_type: v.integrationType,
      intake_email: v.intakeEmail ?? null,
      api_endpoint: v.apiEndpoint ?? null,
      commission_rate: v.commissionRate,
      commission_terms: v.commissionTerms ?? null,
      collection_instructions: v.collectionInstructions ?? null,
      eligibility_summary: v.eligibility ?? null,
      required_documents: v.documents ?? null,
      is_featured: v.isFeatured ?? false,
    }

    if (v.id) {
      const { error } = await client.from('lenders').update(row).eq('id', v.id)
      if (error) return mapError(error)
      return ok({ message: 'Lender updated.' })
    }

    const { data, error } = await client
      .from('lenders')
      .insert({ ...row, onboarded_by: userId })
      .select('id')
      .maybeSingle()

    if (error) return mapError(error)
    if (!data) {
      return fail('FORBIDDEN', 'That lender could not be saved.')
    }

    return ok({ id: data.id, message: 'Lender added. Parents can choose them now.' })
  })
}

/** Turns the table's CHECK constraints into something a person can act on. */
function mapError(error: { code?: string; message: string }): Response {
  if (error.code === '23514') {
    return fail(
      'VALIDATION_ERROR',
      'That lender cannot be reached by the integration you chose — an email lender needs an intake address, and an API lender needs an endpoint. Check also that the maximum is not below the minimum.',
    )
  }
  if (error.code === '23505') {
    return fail('CONFLICT', 'A lender with that name already exists.')
  }
  if (error.code === '42501') {
    return fail('FORBIDDEN', 'Only AfriTech can manage lenders.')
  }
  return fromPostgrestError(error)
}
