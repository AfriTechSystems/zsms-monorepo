/**
 * POST /api/parent/photo — a parent sets their own photograph.
 *
 * Spec: migration `0265`
 *
 * A thin wrapper over `set_my_parent_photo()`, which takes **no parent id**. That is
 * the whole security design: a function accepting one would let any signed-in user
 * set a photograph on somebody else's parent record, and no amount of checking in
 * this file would stop a direct PostgREST call doing it. The function resolves the
 * caller from `get_user_id()` and nothing else.
 *
 * The URL itself has already been produced by `/api/uploads/photo`, which is where
 * the 2MB cap, the format allow-list and the magic-byte check live. `0265`'s CHECK
 * then refuses anything that is not https, so a stored value cannot be a `javascript:`
 * or `data:` URL even if this route were bypassed entirely.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const schema = z.object({
  /**
   * `null` clears the photograph, which is distinct from omitting the field.
   *
   * A parent who wants no picture must be able to say so — the alternative is that
   * one uploaded by mistake is permanent.
   */
  photoUrl: z.string().url().startsWith('https://').nullable(),
})

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', 'That photograph address is not valid.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { error } = await client.rpc('set_my_parent_photo', {
      p_photo_url: parsed.data.photoUrl,
    })

    if (error) {
      // The function raises this when the caller has no parent record — which is a
      // real state, not an error in the request: a signed-in user who has never been
      // linked to a child.
      if (error.code === '42501') {
        return fail('FORBIDDEN', 'This account is not linked to a parent record.')
      }
      return fromPostgrestError(error)
    }

    return ok({ photoUrl: parsed.data.photoUrl })
  })
}
