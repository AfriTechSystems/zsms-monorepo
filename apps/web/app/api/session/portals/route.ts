/**
 * GET /api/session/portals — everywhere this account can go.
 *
 * Spec: `Official Documentation/02 Authentication and Identity/AUTH.md`
 *
 * The enumeration lives in `lib/portals.ts` because `/welcome` needs the same answer to
 * decide where to send somebody. Two copies would drift, and the pair that must agree is
 * exactly "where do we redirect" and "do we offer a way back".
 */

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import { listPortals } from '../../../../lib/portals'
import { fail, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const portals = await listPortals(client, session)

    return ok({
      portals,
      // Told rather than inferred, so `/welcome` can redirect on one and ask on several
      // without counting twice and disagreeing with itself.
      count: portals.length,
      activeOrganisationId: session.organisationId,
    })
  })
}
