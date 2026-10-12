/**
 * GET /api/activity — the dashboard's recent-activity panel.
 *
 * Spec: migration `0268`
 *
 * No authorisation here. `recent_activity()` is SECURITY INVOKER, so the existing
 * `audit_logs` policies decide what the caller sees — AfriTech gets platform rows, a
 * school gets its own, and a teacher gets nothing because no policy admits them.
 * Re-checking in this route would be a second copy of a rule that already exists in
 * four policies, and it is the copy a direct call skips.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../lib/api-response'

export const dynamic = 'force-dynamic'

const query = z.object({
  limit: z.coerce.number().int().min(1).max(20).default(6),
})

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('recent_activity', {
      p_limit: parsed.data.limit,
    })

    if (error) return fromPostgrestError(error)

    const rows = (data ?? []) as unknown as Array<{
      out_id: string
      out_at: string
      out_kind: string
      out_title: string
      out_detail: string | null
      out_actor: string | null
    }>

    return ok({
      activity: rows.map((r) => ({
        id: r.out_id,
        at: r.out_at,
        kind: r.out_kind,
        title: r.out_title,
        detail: r.out_detail,
        /*
          The actor's id is returned by the function and deliberately NOT passed on.

          The panel says what happened, not who did it. Naming a colleague on a
          dashboard turns a summary into surveillance, and the audit screen — which
          exists, is permission-gated and is where that question belongs — already
          answers it properly.
        */
      })),
    })
  })
}
