/**
 * GET/POST /api/parent/loans — a parent's school fee loans.
 *
 * Spec: `Official Documentation/14 Loan and Finance Module/` — APPLICATION.md,
 *       CONSENT.md, SUBMISSION.md, REPAYMENT.md
 *
 * ## Nothing here touches `private` directly
 *
 * The applications live in `private`, which PostgREST cannot see at all and which
 * prohibition 9 forbids client code from referencing. Every read and write goes through
 * the `public` functions from `0225`, each of which re-establishes who the caller is.
 *
 * A `.from('loan_applications')` in this file would not compile against the generated
 * types and would not work if it did. That is the design.
 *
 * ## Consent is captured, not assumed
 *
 * `CONSENT.md` makes the consent log the legal foundation for disclosing a parent's
 * financial data to a lender. So the submission carries the version, the hash of the
 * exact text shown, and the moment it was agreed — and `submit_loan_application()`
 * refuses one older than thirty minutes, because a form left open means the person
 * submitting may not be the person who read the terms.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, created, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const url = new URL(request.url)

    /*
      The lender list, filtered by the score.

      Asked for separately from the applications because the parent needs it BEFORE
      applying, and `LENDER_INTEGRATION.md` is explicit that a lender whose minimum the
      parent cannot meet "is not shown to the parent" — being declined by a list is
      kinder than being declined by a lender.
    */
    if (url.searchParams.get('lenders') === 'true') {
      const score = await client.rpc('calculate_behaviour_score', {
        p_parent_user_id: null,
        p_monthly_income: null,
      })

      /*
        Null, and it would be ignored anyway.

        `0225` took this argument on trust, so any signed-in user could have scored
        another parent and read their unpaid-fee count. `0227` makes the function resolve
        from the session — the argument now only means anything to AfriTech, who may name
        a parent in order to explain a score to somebody disputing it.
      */
      const scored = ((score.data ?? []) as Array<Record<string, unknown>>)[0]
      const value = scored ? Number(scored['out_score']) : null

      const lenders = await client.rpc('lenders_for_application', { p_score: value })
      if (lenders.error) return fromPostgrestError(lenders.error)

      return ok({
        score: value,
        breakdown: scored?.['out_breakdown'] ?? null,
        lenders: ((lenders.data ?? []) as Array<Record<string, unknown>>).map((l) => ({
          id: l['out_id'],
          displayName: l['out_display_name'],
          tagline: l['out_tagline'],
          logoUrl: l['out_logo_url'],
          description: l['out_description'],
          minAmount: Number(l['out_min_amount'] ?? 0),
          maxAmount: Number(l['out_max_amount'] ?? 0),
          interestRate: l['out_interest_rate_display'],
          turnaround: l['out_turnaround_label'],
          eligibility: l['out_eligibility_summary'] ?? [],
          documents: l['out_required_documents'] ?? [],
          featured: l['out_is_featured'] === true,
        })),
      })
    }

    const { data, error } = await client.rpc('my_loan_applications')
    if (error) return fromPostgrestError(error)

    const rows = (data ?? []) as Array<Record<string, unknown>>

    return ok({
      applications: rows.map((a) => ({
        id: a['out_id'],
        amount: Number(a['out_amount'] ?? 0),
        status: a['out_status'],
        lenderName: a['out_lender_name'],
        /*
          The parent's own score and its full breakdown.

          `BEHAVIOUR_SCORE.md`: "Parents have the right to understand their score." A
          number with no explanation is a refusal they cannot argue with.
        */
        score: a['out_score'],
        breakdown: a['out_breakdown'],
        declineReason: a['out_decline_reason'],
        lenderReference: a['out_lender_reference'],
        disbursedAmount: a['out_disbursed_amount'],
        disbursedAt: a['out_disbursed_at'],
        repaymentSchedule: a['out_repayment_schedule'],
        // Null until disbursed — see the function.
        collectionInstructions: a['out_collection_instructions'],
        collectionAccount: a['out_collection_account'],
        createdAt: a['out_created_at'],
      })),
    })
  })
}

const applySchema = z.object({
  feeRecordId: z.string().uuid(),
  amount: z.number().positive().max(9_999_999.99),
  lenderId: z.string().uuid(),

  employmentType: z.enum(['employed', 'self_employed', 'informal', 'unemployed']),
  employerName: z.string().trim().max(160).optional(),
  monthlyIncome: z.number().nonnegative().max(99_999_999).optional(),
  /** A stored path from the proof upload, not a URL. */
  payslipPath: z.string().trim().max(500).optional(),

  /*
    The three things that make the disclosure lawful, per `CONSENT.md`: which version
    was shown, a hash of the exact text, and when it was agreed.
  */
  consentVersion: z.string().trim().min(1).max(20),
  consentTextHash: z.string().trim().min(8).max(128),
  consentedAt: z.string().datetime(),
})

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = applySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid application.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const v = parsed.data

    const { data, error } = await client.rpc('submit_loan_application', {
      p_fee_record_id: v.feeRecordId,
      p_amount: v.amount,
      p_lender_id: v.lenderId,
      p_employment_type: v.employmentType,
      p_employer_name: v.employerName ?? null,
      p_monthly_income: v.monthlyIncome ?? null,
      p_payslip_url: v.payslipPath ?? null,
      p_consent_version: v.consentVersion,
      p_consented_at: v.consentedAt,
      p_consent_text_hash: v.consentTextHash,
      /*
        Recorded on the consent row as evidence of where it was given.

        `x-forwarded-for` is the client address behind Vercel's proxy; the first entry is
        the originating one.
      */
      p_ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      p_user_agent: request.headers.get('user-agent'),
    })

    if (error) {
      /*
        The function's messages are written for a parent to read — "that lender lends
        between K500 and K50,000", "there is already an open application against this
        fee" — so they are passed through rather than replaced.
      */
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      if (error.code === '23505') return fail('CONFLICT', error.message)
      if (error.code === 'P0002') return fail('NOT_FOUND', error.message)
      return fromPostgrestError(error)
    }

    return created({
      id: data as string,
      message:
        'Your application has been sent. The lender usually decides within a few business days, and we will tell you here.',
    })
  })
}
