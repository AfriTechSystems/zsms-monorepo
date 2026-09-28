/**
 * The Teacher Hub account.
 *
 *   GET   /api/teacher/hub — account, entitlement and the plan catalogue, in one call
 *   POST  /api/teacher/hub — self-registration
 *   PATCH /api/teacher/hub — profile edits
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## No school id anywhere in this file
 *
 * Every other portal route resolves a school first. This one cannot: a standalone teacher
 * has no organisation, `current_school_uuid()` is NULL for them, and the tables here are
 * scoped on the Clerk **user** id instead. `my_teacher_hub()` is SECURITY INVOKER, so the
 * account row comes back through the caller's own policy — this route never passes a user
 * id and so cannot pass the wrong one.
 *
 * ## What POST is deliberately unable to do
 *
 * Registration is a plain INSERT, not an RPC, because the privilege system already says
 * exactly what a teacher may supply: the column-level GRANT in `0130` covers identity and
 * profile and omits `plan_code`, `subscription_status`, `trial_allowance_override` and both
 * counters. A request naming any of those is refused by Postgres before RLS is consulted.
 * Validating that in TypeScript as well would be a second rule to keep in step.
 */

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import {
  created,
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'
import { liveGenerationEnabled } from '@zsms/ai'
import {
  ENTITLEMENT_MESSAGES,
  profileSchema,
  registerSchema,
  type HubPayload,
} from '../../../../lib/teacher-hub'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('my_teacher_hub').maybeSingle()
    if (error) return fromPostgrestError(error)

    const payload = (data ?? { account: null, entitlement: null, plans: [] }) as HubPayload

    return ok({
      ...payload,
      /**
       * `account: null` is not an error — it is a teacher who has signed in but not yet
       * completed the profile step. The screen needs to tell those two apart, so it is
       * stated rather than inferred from a missing key.
       */
      needsRegistration: payload.account === null,
      entitlementMessage: payload.entitlement?.reason
        ? (ENTITLEMENT_MESSAGES[payload.entitlement.reason] ?? null)
        : null,
      /**
       * Whether live generation is PERMITTED — which is all this route can honestly say, since
       * the per-request answer also depends on a prompt row that the generate endpoint
       * resolves. The screens use it to decide whether to show the "structured plans, not
       * AI-written" notice, because a teacher paying for AI planning who is handed a scaffold
       * unlabelled has been misled.
       */
      modelBacked: liveGenerationEnabled(),
    })
  })
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = registerSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)
    const body = parsed.data

    const { data, error } = await client
      .from('standalone_teacher_accounts')
      .insert({
        // From the session, never from the body. The INSERT policy compares this to
        // get_user_id() and refuses a mismatch, so a forged value fails rather than works.
        clerk_user_id: session.userId,
        full_name: body.fullName,
        email: body.email,
        phone_e164: body.phoneE164 ?? null,
        country_code: body.countryCode,
        curriculum_types: body.curriculumTypes,
        subjects: body.subjects,
        grade_levels: body.gradeLevels,
      })
      .select('clerk_user_id, full_name, plan_code, subscription_status')
      .single()

    if (error) {
      // The UNIQUE on clerk_user_id. Registering twice is a person pressing the button
      // again, not an error worth a stack trace.
      if (error.code === '23505') {
        return fail('CONFLICT', 'You already have a Teacher Hub account.')
      }
      return fromPostgrestError(error)
    }

    return created(data)
  })
}

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = profileSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)
    const body = parsed.data

    const patch: Record<string, unknown> = {}
    if (body.fullName !== undefined) patch['full_name'] = body.fullName
    if (body.phoneE164 !== undefined) patch['phone_e164'] = body.phoneE164
    if (body.countryCode !== undefined) patch['country_code'] = body.countryCode
    if (body.curriculumTypes !== undefined) patch['curriculum_types'] = body.curriculumTypes
    if (body.subjects !== undefined) patch['subjects'] = body.subjects
    if (body.gradeLevels !== undefined) patch['grade_levels'] = body.gradeLevels

    const { data, error } = await client
      .from('standalone_teacher_accounts')
      .update(patch)
      .eq('clerk_user_id', session.userId)
      .select('full_name, phone_e164, curriculum_types, subjects, grade_levels')

    if (error) return fromPostgrestError(error)

    /**
     * An UPDATE a policy refuses raises NOTHING — it matches no rows and reports zero
     * affected, which over PostgREST is indistinguishable from "no such row". The pgTAP
     * suite pins that behaviour, and this is the consequence for a caller: the row count
     * has to be checked, or a silently discarded save looks like a successful one.
     */
    if (!data || data.length === 0) {
      return fail('NOT_FOUND', 'No Teacher Hub account to update.')
    }

    return ok(data[0])
  })
}
