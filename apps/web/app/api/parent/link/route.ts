/**
 * Connecting a parent account to the children a school recorded.
 *
 *   POST /api/parent/link            — retry the verified-email match
 *   POST /api/parent/link {phone}    — raise a claim for a phone-only record
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *       `Official Documentation/07 Students and Parents/PARENTS.md`
 *
 * ## The email is never a parameter
 *
 * `claim_parent_links()` takes no arguments and reads the verified address off the session
 * token. This route cannot pass one even if somebody wanted it to — 0170 asserts the
 * function has no parameters, at migration time, for exactly that reason. Linking to an
 * address you do not own is the one operation that would hand a stranger a family.
 *
 * ## A missing email claim is reported as configuration, not as "no children"
 *
 * `P0003` means Clerk is not sending the `email` claim. That is an instance setting, and it
 * presents identically to a parent whose school never recorded their address — which is the
 * silent-empty-portal failure the whole feature exists to end. So it is given its own
 * message naming the cause.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  phone: z.string().trim().min(6).max(25).optional(),
})

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
    const phone = parsed.success ? parsed.data.phone : undefined

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    if (phone) {
      const { data, error } = await client
        .rpc('request_parent_link_by_phone', { p_phone: phone })
        .maybeSingle()
      if (error) return fromPostgrestError(error)

      const row = (data ?? {}) as { out_submitted?: boolean; out_message?: string }
      return ok({
        submitted: row.out_submitted ?? false,
        message: row.out_message ?? 'Your request has been sent.',
      })
    }

    const { data, error } = await client.rpc('claim_parent_links').maybeSingle()

    if (error) {
      // See the header: a configuration fault must not read as "no children found".
      if (error.code === 'P0003') {
        return fail(
          'SERVER_ERROR',
          'Your sign-in is missing a verified email address. Please contact AfriTech — this is a '
            + 'configuration problem on our side, not something you can fix.',
        )
      }
      return fromPostgrestError(error)
    }

    const row = (data ?? {}) as {
      out_linked?: number
      out_already_linked?: number
      out_email?: string
    }

    return ok({
      linked: row.out_linked ?? 0,
      alreadyLinked: row.out_already_linked ?? 0,
      // Shown back to the parent so they can read it to the school office. This turns
      // "we cannot find you" into one phone call rather than a dead end.
      email: row.out_email ?? session.email,
    })
  })
}
