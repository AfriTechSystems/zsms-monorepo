/**
 * POST /api/admin/schools/[id]/checklist — tick a manual onboarding item, or refresh.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
 *
 * ## What was broken
 *
 * `ensure_onboarding_checklist()` created 14 rows per school, all `false`;
 * `school_onboarding_completion()` read them; and **nothing in the system ever set one
 * to true**. The checklist was created at 0% and stayed there, which is exactly what
 * "AfriTech cannot complete a school's onboarding" looks like from the outside.
 *
 * ## Ten of fourteen are not tickable, by design
 *
 * `admin_set_checklist_item()` refuses the derived keys. Letting an operator mark "Grade
 * levels" done by hand would make the dashboard disagree with the database the moment
 * the next refresh runs, and whoever read it in between would act on a number that was
 * never true. `refresh` recomputes those from live data instead.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('refresh') }),
  z.object({
    action: z.literal('set'),
    itemKey: z.string().trim().min(1).max(60),
    complete: z.boolean(),
  }),
])

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const { id } = await params

    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    // Both functions refuse anybody who is not AfriTech, inside themselves. No second
    // check here: it would be the copy a direct PostgREST call bypasses.
    if (parsed.data.action === 'refresh') {
      const { data, error } = await client.rpc('refresh_onboarding_checklist', {
        p_school_id: id,
      })
      if (error) {
        if (error.code === '42501') return fail('FORBIDDEN', error.message)
        return fromPostgrestError(error)
      }
      // How many items the recompute actually moved — the number that tells an operator
      // whether anything changed.
      return ok({ changed: (data ?? []).length })
    }

    const { data, error } = await client
      .rpc('admin_set_checklist_item', {
        p_school_id: id,
        p_item_key: parsed.data.itemKey,
        p_complete: parsed.data.complete,
      })
      .maybeSingle()

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      // 22023 is the function refusing a DERIVED key, and its message names which.
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    const row = (data ?? {}) as { out_done?: boolean; out_message?: string }
    if (!row.out_done) return fail('NOT_FOUND', row.out_message ?? 'No such checklist item.')

    return ok({ done: true, message: row.out_message })
  })
}
