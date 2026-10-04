/**
 * POST /api/session/push-token — remember this device so it can be pushed to.
 * DELETE — forget it, on sign-out.
 *
 * Spec: `Official Documentation/12 Communication System/NOTIFICATIONS.md`
 *
 * ## Why this existed as SQL with no caller
 *
 * `register_push_token()` and `retire_push_token()` have been in the database since the
 * push work was specified, and `npm run gaps` has listed them as unreachable ever since
 * — "mobile only, no client exists yet". The table holds **zero rows**, which means push
 * had no delivery path at all: not blocked on Meta credentials, blocked on nobody ever
 * having told the server which devices to send to.
 *
 * ## Not only parents, despite the table's name
 *
 * The column is `parent_user_id` because parents were the first audience specified. The
 * function has never checked for one — it writes `get_user_id()` — so a teacher's phone
 * registers through exactly this path. The name is a wart, not a restriction; renaming
 * it would touch the worker boundary functions and a pgTAP suite for no behaviour
 * change, so it is documented instead.
 *
 * ## Sign-out retires the token
 *
 * A shared phone is ordinary in a Zambian school. Leaving a token registered after
 * sign-out means the next notice for that person lands on a handset somebody else is
 * holding, which is a disclosure rather than an inconvenience.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const registerSchema = z.object({
  /*
    An Expo push token, `ExponentPushToken[...]`.

    Length-capped rather than pattern-matched: the format is Expo's to change, and a
    regex here would reject a valid future token with an error nobody could diagnose
    from a phone.
  */
  token: z.string().trim().min(10).max(255),
  platform: z.enum(['ios', 'android']),
})

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = registerSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { error } = await client
      .rpc('register_push_token', {
        p_push_token: parsed.data.token,
        p_platform: parsed.data.platform,
      })
      .maybeSingle()

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      return fromPostgrestError(error)
    }

    // The token itself is never echoed. It is a capability to reach somebody's phone,
    // and a response body is the easiest place for one to end up in a log.
    return ok({ registered: true })
  })
}

const retireSchema = z.object({ token: z.string().trim().min(10).max(255) })

export async function DELETE(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = retireSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('retire_push_token', {
      p_push_token: parsed.data.token,
    })

    if (error) return fromPostgrestError(error)

    // `false` means the token was not this caller's. Reported as success anyway: a
    // sign-out should not fail, and distinguishing the two would tell a caller whether
    // somebody else's token exists.
    return ok({ retired: data === true })
  })
}
