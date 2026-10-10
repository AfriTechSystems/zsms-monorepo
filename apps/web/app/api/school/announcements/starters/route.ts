/**
 * GET /api/school/announcements/starters — pre-written texts to begin an announcement from.
 *
 * Spec: `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
 *
 * ## Not `notification_templates`
 *
 * That table already exists and is the wrong home. Those are TRANSACTIONAL — the system
 * renders `fee_reminder` with variables and sends it, unread by a human. These are
 * drafts a head teacher picks, edits and may discard. Different lifecycle, different
 * author, and `variables`/`meta_template_name` mean nothing for them.
 *
 * ## Global and school-owned, in one list
 *
 * RLS returns both: `school_id IS NULL` is AfriTech's set, a UUID is this school's own.
 * A school that sends "closed due to heavy rain" every rainy season writes it once.
 */

import { createUserClient } from '../../../../../lib/supabase'
import { getAuthProvider, type Role } from '@zsms/auth-provider'
import { can } from '../../../../../lib/roles'
import { fail, fromPostgrestError, guard, ok } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    // The same permission the composer needs. Offering starters to somebody who cannot
    // send is a menu with no kitchen behind it.
    if (!can(caller.role as Role, 'announcements:write')) {
      return fail('FORBIDDEN', 'Your role does not include sending announcements.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .from('announcement_starters')
      .select('id, school_id, label, title, body, importance, audience')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error) return fromPostgrestError(error)

    return ok({
      starters: (data ?? []).map((row) => ({
        ...row,
        // So the picker can mark a school's own, which it may edit, apart from
        // AfriTech's, which it may not.
        isOwn: row.school_id !== null,
      })),
    })
  })
}
