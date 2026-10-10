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

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider, type Role } from '@zsms/auth-provider'
import { can } from '../../../../lib/roles'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'

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
      out_description: string | null
      out_category: string
      out_blocks: string | null
      /** Done by either route — derived from data, or signed off by a person. */
      out_complete: boolean
      /** What the data alone says. Kept separate so a sign-off never hides it. */
      out_from_data: boolean
      out_overridden: boolean
      out_reason: string | null
      out_by_role: string | null
      out_at: string | null
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

/**
 * POST — sign a checklist item off, or withdraw the sign-off.
 *
 * ## Why a school may do this at all
 *
 * Most of the list is derived from the school's own data and ticks itself. A sign-off
 * is for the cases the data cannot see: AfriTech was paid to do the setup, the school
 * runs fees in an accounting package so a ZSMS fee structure is never coming, or the
 * work was training rather than a record.
 *
 * The derivation keeps running underneath and both answers are returned, so a sign-off
 * adds a human judgement rather than hiding the facts.
 */
const signOffSchema = z.object({
  itemKey: z.string().trim().min(1).max(60),
  override: z.boolean(),
  reason: z.string().trim().max(500).optional(),
})

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = signOffSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      `p_school_id` is null on purpose.

      The function resolves a school caller from their own session and ignores the
      argument — passing one from the browser would be inviting it to be changed.
    */
    const { data, error } = await client
      .rpc('set_onboarding_override', {
        p_school_id: null,
        p_item_key: parsed.data.itemKey,
        p_override: parsed.data.override,
        p_reason: parsed.data.reason ?? null,
      })
      .maybeSingle()

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      // The function refusing a sign-off with no reason, which is a user error.
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    const row = (data ?? {}) as { out_done?: boolean; out_message?: string }
    if (!row.out_done) return fail('NOT_FOUND', row.out_message ?? 'No such checklist item.')

    return ok({ done: true, message: row.out_message })
  })
}
