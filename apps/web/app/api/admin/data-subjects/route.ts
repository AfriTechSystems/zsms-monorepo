/**
 * Data subject rights — access, portability and erasure.
 *
 *   POST /api/admin/data-subjects  { action: 'export',    kind, id }
 *   POST /api/admin/data-subjects  { action: 'anonymise', kind, id, reason }
 *
 * Spec: `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *         → *Data Subject Rights Procedures*
 *
 * ## Why this is AfriTech's and not a school's
 *
 * Under the ZDPA, AfriTech Systems Limited is the **controller** — it determines the
 * purposes and means of processing — and a school is a processor acting on its
 * instructions. The obligation, and the 30-day clock, is AfriTech's. `0187` enforces that
 * inside the functions; this route does not re-check, because a second copy of the rule
 * would be the one a direct PostgREST call bypasses.
 *
 * ## Erasure cannot be undone and the response says so
 *
 * Zambian financial regulation requires seven years of payment records, so erasure
 * anonymises rather than deletes: the markers `COMPLIANCE.md` specifies replace the
 * identifying columns and the financial rows keep their amounts and dates. The function
 * returns what was retained, and the screen shows it — somebody actioning a legal request
 * needs to be able to tell the subject exactly what survives.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('export'),
    kind: z.enum(['student', 'parent', 'staff']),
    id: z.string().uuid(),
  }),
  z.object({
    action: z.literal('anonymise'),
    kind: z.enum(['student', 'parent', 'staff']),
    id: z.string().uuid(),
    // Mirrors the function's own requirement. Erasure removes the evidence of why it
    // happened; the reason is the only thing that survives to answer for it.
    reason: z.string().trim().min(8, 'Record why this erasure was requested.').max(500),
  }),
])

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const input = parsed.data

    if (input.action === 'export') {
      const { data, error } = await client.rpc('admin_export_data_subject', {
        p_kind: input.kind,
        p_id: input.id,
      })

      if (error) {
        if (error.code === '42501') return fail('FORBIDDEN', error.message)
        if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
        if (error.code === 'P0002') return fail('NOT_FOUND', error.message)
        return fromPostgrestError(error)
      }

      return ok({ export: data })
    }

    const { data, error } = await client
      .rpc('admin_anonymise_data_subject', {
        p_kind: input.kind,
        p_id: input.id,
        p_reason: input.reason,
      })
      .maybeSingle()

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    const row = (data ?? {}) as {
      out_done?: boolean
      out_retained?: string
      out_message?: string
    }
    if (!row.out_done) return fail('NOT_FOUND', row.out_message ?? 'No such data subject.')

    return ok({
      done: true,
      // Surfaced so the operator can tell the subject precisely what survives and why.
      retained: row.out_retained ?? null,
      message: row.out_message,
    })
  })
}
