/**
 * POST /api/school/results/unlock — unlock ONE published result so it can be corrected.
 *
 * Spec: `Official Documentation/11 Examinations and Results/PUBLISHING.md`
 *         → *Post-Publication Corrections*
 *
 * ## Why a route of its own rather than a flag on the save
 *
 * Unlocking is not editing. It is a principal deciding that a mark a parent has already
 * seen was wrong, and the documented workflow makes it a separate, reasoned act for that
 * reason. Folding it into the mark-sheet PATCH would make "save" sometimes mean "overrule
 * the publication lock", which is the one thing that must never happen by accident.
 *
 * ## The route checks nothing, deliberately
 *
 * `unlock_result_for_correction()` refuses anybody who is not the owner or principal,
 * refuses a blank reason, and refuses a result belonging to another school — all inside the
 * function, because `authenticated` covers every member of staff and the grant cannot
 * express the difference. A second copy of those rules here is one that can drift from the
 * first, and this is the half a direct PostgREST call bypasses.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const unlockSchema = z.object({
  resultId: z.string().uuid(),
  // Mirrors the NOT NULL check in the function. Required because a correction changes a
  // child's academic record after the school has told the family what it was — six months
  // later, "why does this say 82 when the report card said 28" has to be answerable.
  reason: z.string().trim().min(4, 'Say briefly why this mark is being corrected.').max(500),
})

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = unlockSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .rpc('unlock_result_for_correction', {
        p_result_id: parsed.data.resultId,
        p_reason: parsed.data.reason,
      })
      .maybeSingle()

    if (error) {
      // The function raises 42501 for "not a principal" and 22023 for a blank reason. Both
      // are answers a user should read, not server errors.
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    const row = (data ?? {}) as { out_unlocked?: boolean; out_message?: string }
    if (!row.out_unlocked) {
      return fail('CONFLICT', row.out_message ?? 'That result could not be unlocked.')
    }

    return ok({ unlocked: true, message: row.out_message })
  })
}
