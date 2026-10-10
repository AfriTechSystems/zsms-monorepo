/**
 * Parents asking to be connected to a child at this school.
 *
 *   GET  /api/school/parent-claims — pending claims
 *   POST /api/school/parent-claims — approve or decline one
 *
 * Spec: `Official Documentation/07 Students and Parents/PARENTS.md`
 *
 * ## Why these exist at all
 *
 * A parent whose email the school recorded links automatically — Clerk verified the address
 * and the school chose it, so there is nothing for staff to decide. These are the others:
 * a parent the school recorded by phone only, where the number is unverified and the OTP
 * that would verify it cannot be delivered until there are Meta or Twilio credentials.
 *
 * Approving one hands over a child's attendance, marks and fees. The screen says so.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider, type Role } from '@zsms/auth-provider'
import { can } from '../../../../lib/roles'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const decideSchema = z.object({
  claimId: z.string().uuid(),
  approve: z.boolean(),
})

export async function GET(): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    // Same gate as editing a pupil's record, because that is the access being granted.
    if (!can(caller.role as Role, 'students:write')) {
      return fail('FORBIDDEN', 'Your role does not include pupil records.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    // No school filter: `school_read_parent_link_claims` scopes this already.
    const { data, error } = await client
      .from('parent_link_claims')
      .select('id, claimant_email, matched_on, requested_at, parents(full_name, phone_e164)')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true })

    if (error) return fromPostgrestError(error)

    return ok({ claims: data ?? [] })
  })
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const caller = await getAuthProvider().getSessionUser()
    if (!caller) return fail('UNAUTHORIZED', 'Authentication required.')

    if (!can(caller.role as Role, 'students:write')) {
      return fail('FORBIDDEN', 'Your role does not include pupil records.')
    }

    const parsed = decideSchema.safeParse(await request.json())
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .rpc('school_decide_parent_claim', {
        p_claim_id: parsed.data.claimId,
        p_approve: parsed.data.approve,
      })
      .maybeSingle()

    if (error) return fromPostgrestError(error)

    const row = (data ?? {}) as { out_decided?: boolean; out_linked?: boolean }

    // One answer for "already decided" and "not yours" — distinguishing them would
    // confirm that another school's claim id exists.
    if (!row.out_decided) return fail('NOT_FOUND', 'That request is no longer pending.')

    return ok({ decided: true, linked: row.out_linked ?? false })
  })
}
