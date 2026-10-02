/**
 * POST /api/school/fees/revise — change an amount on bills already issued.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/FEE_STRUCTURES.md`
 *         → *Business Rules* 3
 *
 * ## Why this is a separate act from editing the structure
 *
 * Business rule 3: changing a fee structure never re-prices records already generated —
 * `fee_records.amount_due` is copied at issue time and preserved. That is the right default,
 * and it leaves a real gap: a school that issued a whole term at the wrong amount had no way
 * to correct it, because the structure edit deliberately does nothing to existing bills.
 *
 * `revise_fee_records()` is that correction, and it is deliberately NOT what the structure
 * editor does. A bursar raising next term's tuition must not silently re-bill this term's
 * families; a bursar fixing a typo must be able to.
 *
 * ## It refuses the whole batch rather than part of it
 *
 * Found by exercising it: when any record already has verified payments above the new
 * amount, the function raises `23514` naming how many — it does NOT quietly skip them. That
 * is the right choice and worth keeping visible. A partial revision would leave a term
 * priced two different ways with nothing on screen saying so, and reducing a bill below what
 * a family has paid would manufacture a credit the school never agreed. The message says to
 * issue a refund or reversal instead, which is the correct instrument.
 *
 * `skipped_count` still comes back for the ordinary case and is surfaced alongside the
 * revised count, since "40 revised, 3 skipped" is an answer a bursar must act on.
 *
 * ## No role check here
 *
 * The function refuses anybody who is not the owner or accountant, and requires a reason.
 * Both live there because `authenticated` covers every member of staff and the grant cannot
 * express the difference — and this is the half a direct PostgREST call bypasses.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const reviseSchema = z.object({
  academicYear: z.string().trim().regex(/^\d{4}(\/\d{4})?$/, 'Academic year looks wrong.'),
  termNumber: z.number().int().min(1).max(4),
  // The label identifies which charge to revise. Free text because it mirrors
  // `fee_structures.fee_label`, which a school writes itself.
  feeLabel: z.string().trim().min(1).max(100),
  newAmount: z.number().min(0).max(10_000_000),
  // Mirrors the function's own requirement. A bursar changing what families owe after being
  // told the first figure has to leave a record of why.
  reason: z.string().trim().min(4, 'Say briefly why the amount is changing.').max(500),
})

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = reviseSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .rpc('revise_fee_records', {
        p_academic_year: parsed.data.academicYear,
        p_term_number: parsed.data.termNumber,
        p_fee_label: parsed.data.feeLabel,
        p_new_amount: parsed.data.newAmount,
        p_reason: parsed.data.reason,
      })
      .maybeSingle()

    if (error) {
      if (/owner or accountant/i.test(error.message)) return fail('FORBIDDEN', error.message)
      if (/reason|zero or greater|No school/i.test(error.message)) {
        return fail('VALIDATION_ERROR', error.message)
      }
      /*
        23514 — records already carry verified payments above the new amount, so the
        function refused the WHOLE batch and named the count. A CONFLICT rather than a
        server error: nothing is broken, the school is being told that this correction
        needs a refund or reversal instead, and the message already says which.
      */
      if (error.code === '23514') return fail('CONFLICT', error.message)
      return fromPostgrestError(error)
    }

    const row = (data ?? {}) as { revised_count?: number; skipped_count?: number }

    return ok({
      revised: row.revised_count ?? 0,
      // Skipped means the new amount is below what that family has already paid. Named
      // rather than buried, because those records still hold the old figure.
      skipped: row.skipped_count ?? 0,
    })
  })
}
