/**
 * GET /api/school/loans — fee loans against this school's pupils.
 *
 * Spec: `Official Documentation/14 Loan and Finance Module/LOANS.md`
 *
 * ## What a school may see, and what it may not
 *
 * That a fee is being financed, by whom, for how much, and whether it has been paid out.
 * **Not** the parent's income, employer, payslip or behaviour score — `CONSENT.md` scopes
 * the parent's consent to the LENDER, not to their school, and a bursar who could read a
 * parent's salary would have learned it through a loan application the parent made in
 * confidence.
 *
 * `school_loan_applications()` (`0225`) returns only the permitted columns, so there is
 * nothing here to leak even by accident.
 *
 * ## The feature gate
 *
 * `loan_module` has been a flag since `0095`. The SQL function enforces it on submission;
 * this route enforces it on the read so a school that has not bought the module is not
 * shown an empty screen implying they have.
 */

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'
import { schoolHasFeature } from '../../../../lib/features'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    if (!(await schoolHasFeature(client, 'loan_module'))) {
      return fail(
        'FORBIDDEN',
        'Fee loans are not included in your plan. AfriTech can add the Loans module.',
      )
    }

    /*
      The function performs its own role check — owner, admin, principal or accountant —
      and raises 42501 for anybody else. Not re-checked here: one rule, one place, and a
      route-level copy is the one a direct PostgREST call skips.
    */
    const { data, error } = await client.rpc('school_loan_applications')
    if (error) return fromPostgrestError(error)

    const rows = (data ?? []) as Array<Record<string, unknown>>

    return ok({
      applications: rows.map((a) => ({
        id: a['out_id'],
        studentId: a['out_student_id'],
        amount: Number(a['out_amount'] ?? 0),
        status: a['out_status'],
        lenderName: a['out_lender_name'],
        disbursedAmount: a['out_disbursed_amount'],
        disbursedAt: a['out_disbursed_at'],
        createdAt: a['out_created_at'],
      })),
      /*
        What the school actually needs to act on.

        A disbursed loan means money has reached their account and the fee should be
        marked `loan_paid` — which is the one thing on this screen that requires them to
        do something.
      */
      meta: {
        awaitingDecision: rows.filter((a) =>
          ['submitted', 'under_review'].includes(String(a['out_status'])),
        ).length,
        disbursed: rows.filter((a) => a['out_status'] === 'disbursed').length,
      },
    })
  })
}
