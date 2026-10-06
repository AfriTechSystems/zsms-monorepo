/**
 * GET/PATCH /api/admin/loans — the AfriTech loan officer's queue.
 *
 * Spec: `Official Documentation/14 Loan and Finance Module/` — LOANS.md Phase 1,
 *       SUBMISSION.md, LENDER_INTEGRATION.md
 *
 * ## Phase 1 is manual, deliberately
 *
 * `LOANS.md`: ZSMS packages applications and emails them to partner lenders, who "make
 * manual decisions (3-5 business days)", and "AfriTech loan officer manually updates
 * application status". There is no automation to build here yet, and pretending otherwise
 * would mean a status nobody has verified.
 *
 * ## The commission accrues here, not on approval
 *
 * `admin_update_loan_application()` writes `afritech.loan_commissions` when a loan reaches
 * `disbursed`. An approved loan that is never paid out earns nothing, and accruing on
 * approval would put revenue on AfriTech's books for money that never moved.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const STATUSES = [
  'pending',
  'submitted',
  'under_review',
  'approved',
  'declined',
  'disbursed',
  'cancelled',
] as const

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const status = new URL(request.url).searchParams.get('status')

    const { data, error } = await client.rpc('admin_loan_applications', {
      p_status: status && (STATUSES as readonly string[]).includes(status) ? status : null,
    })

    // The function raises 42501 for anybody but AfriTech, which `fromPostgrestError`
    // renders as FORBIDDEN. No second copy of that rule here.
    if (error) return fromPostgrestError(error)

    const rows = (data ?? []) as Array<Record<string, unknown>>

    return ok({
      applications: rows.map((a) => ({
        id: a['out_id'],
        schoolId: a['out_school_id'],
        amount: Number(a['out_amount'] ?? 0),
        status: a['out_status'],
        lenderName: a['out_lender_name'],
        /*
          The score and the income ARE shown to AfriTech — they are the loan officer
          packaging the application for the lender, and `BEHAVIOUR_SCORE.md` has them
          explaining a disputed score to a parent. This is the one audience that sees
          them besides the parent themselves.
        */
        score: a['out_score'],
        employmentType: a['out_employment'],
        monthlyIncome: a['out_monthly_income'],
        createdAt: a['out_created_at'],
      })),
      meta: {
        // The queue that needs working, which is what the screen leads with.
        awaitingAction: rows.filter((a) =>
          ['submitted', 'under_review'].includes(String(a['out_status'])),
        ).length,
      },
    })
  })
}

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(STATUSES),
  lenderReference: z.string().trim().max(120).optional(),
  /** Required when declining — the function refuses a decline without one. */
  declineReason: z.string().trim().max(500).optional(),
  disbursedAmount: z.number().positive().max(9_999_999.99).optional(),
  notes: z.string().trim().max(500).optional(),
})

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid update.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const v = parsed.data

    const { data, error } = await client.rpc('admin_update_loan_application', {
      p_id: v.id,
      p_status: v.status,
      p_lender_reference: v.lenderReference ?? null,
      p_decline_reason: v.declineReason ?? null,
      p_disbursed_amount: v.disbursedAmount ?? null,
      p_notes: v.notes ?? null,
    })

    if (error) {
      // The function's messages are written for a loan officer to read.
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      if (error.code === 'P0002') return fail('NOT_FOUND', error.message)
      return fromPostgrestError(error)
    }

    return ok({
      status: data as string,
      message:
        v.status === 'disbursed'
          ? 'Marked disbursed. The commission has been accrued and the school can now settle the fee.'
          : v.status === 'declined'
            ? 'Declined. The parent will see the reason you gave.'
            : 'Updated. The parent will see the new status.',
    })
  })
}
