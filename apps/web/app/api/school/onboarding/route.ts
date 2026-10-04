/**
 * GET /api/school/onboarding — how ready this school is, and what is left.
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
 *       `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md`
 *
 * ## Why a school reads its own
 *
 * `ONBOARDING.md` frames this as AfriTech's queue, and it is — but the school is the one
 * who has to DO most of it. Nobody at AfriTech can enter a school's subjects or set its
 * term dates. A head teacher who can see "fee structure missing, which blocks fee
 * tracking" acts on it; one who cannot waits for a phone call.
 *
 * ## It recomputes on read
 *
 * Ten of the fourteen items are facts about the database — are there grade levels, is
 * there a fee structure, has a pupil been enrolled — and `my_onboarding_progress()`
 * derives them each time rather than trusting a stored tick. A checklist somebody ticked
 * by hand starts lying the moment reality diverges, and the moment a school opens its
 * dashboard is exactly when the answer has to be current.
 */

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider, type Role } from '@zsms/auth-provider'
import { can } from '../../../../lib/roles'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      `settings:write` — the people who can act on it.

      Showing a readiness checklist to a teacher would be noise: every outstanding item
      is something only management can do, and a list of other people's jobs on your
      dashboard is the definition of clutter.
    */
    if (!can(caller.role as Role, 'settings:write')) {
      return fail('FORBIDDEN', 'Your role does not include school setup.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('my_onboarding_progress')
    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      return fromPostgrestError(error)
    }

    type Item = {
      out_item_key: string
      out_label: string
      out_category: string
      out_blocks: string | null
      out_complete: boolean
      out_derived: boolean
    }

    const items = (data ?? []) as unknown as Item[]
    const complete = items.filter((i) => i.out_complete).length

    return ok({
      items,
      complete,
      total: items.length,
      // Counted here so a progress bar and the list cannot disagree.
      percent: items.length === 0 ? 0 : Math.round((complete / items.length) * 100),
      // What an outstanding item actually costs, which is the part that makes somebody
      // act rather than nod.
      blocked: items
        .filter((i) => !i.out_complete && i.out_blocks)
        .map((i) => ({ item: i.out_label, blocks: i.out_blocks })),
    })
  })
}
