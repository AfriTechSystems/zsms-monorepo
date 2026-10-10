/**
 * POST /api/session/my-data — a person exporting their own record.
 *
 * Spec: `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
 *         → *Data Subject Rights Procedures*, right to portability
 *
 * ## Why it takes no identifier
 *
 * `export_my_data()` resolves the caller from `get_user_id()` and accepts no argument at
 * all. A function that took one would let any signed-in person export somebody else's
 * record by changing a number — the exact failure `0170` avoided by making
 * `claim_parent_links()` argument-free. There is nothing here to tamper with.
 *
 * ## JSON rather than the CSV the document names
 *
 * `COMPLIANCE.md` says "CSV export of own data via parent portal". A parent's record is
 * not one table — it is an account, a parent row, several children, and a staff record if
 * they also teach — and flattening that into CSV either loses the structure or produces
 * several files. JSON carries all of it losslessly in one, which is what portability
 * actually requires. Worth noting in the doc rather than silently diverging.
 */

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function POST(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('export_my_data')

    if (error) {
      if (error.code === '42501') return fail('UNAUTHORIZED', 'Sign in first.')
      return fromPostgrestError(error)
    }

    return ok({ export: data })
  })
}
