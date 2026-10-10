/**
 * A standalone teacher asking to be linked to a school.
 *
 *   GET    /api/teacher/school-link — this teacher's own requests
 *   POST   /api/teacher/school-link — ask a school, by its exact code
 *   DELETE /api/teacher/school-link — withdraw a pending request
 *
 * Spec: `Official Documentation/13 Teacher Portal/TEACHER_PORTAL.md`
 *       `Official Documentation/02 Authentication and Identity/ROLES.md`
 *
 * ## No school id in this file either
 *
 * Like the rest of the Hub, the caller here has no organisation — that is the whole point
 * of the feature. `current_school_uuid()` is NULL for them, so nothing in this route can
 * resolve a school the usual way. The school is named by its printed code and resolved
 * inside `request_school_link()`, which is SECURITY DEFINER precisely because the caller
 * cannot read `schools` at all.
 *
 * ## The response is the same whether or not the code matched
 *
 * `request_school_link()` returns `submitted: true` for a code matching no school, and this
 * route passes that through unchanged rather than "helpfully" checking first and reporting
 * a 404. Reporting it would turn the endpoint into an oracle for which schools are ZSMS
 * customers — including the ones that stayed out of the public directory on purpose.
 *
 * It is worth being explicit that this is a deliberate worse experience for the teacher who
 * mistypes their code. They see a pending request that will never be answered. The Hub
 * screen states the format and lets them withdraw, which is the cost of not publishing a
 * customer list.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * `ZM-LSK-0001`. Validated here so an obviously malformed code never reaches the database,
 * but the shape is all that is checked — whether it names a real school is deliberately not
 * knowable from the response.
 */
const requestSchema = z.object({
  schoolCode: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z]{2}-[A-Za-z]{3}-\d{4}$/,
      'A school code looks like ZM-LSK-0001. Ask the school office if you are not sure.',
    ),
  fullName: z.string().trim().min(1, 'Your name is required.').max(120),
  email: z.string().trim().email('A valid email address is required.'),
  note: z.string().trim().max(500).optional(),
})

const withdrawSchema = z.object({ requestId: z.string().uuid() })

export async function GET(): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      A plain select, not an RPC. `requester_read_school_join_requests` already scopes this
      to the caller's own rows, so the policy is the filter — adding `.eq('requester_user_id',
      …)` here would be a second rule saying the same thing, which is the kind of duplication
      that drifts.

      `schools` is joined for the name. The teacher may read it because the FK is theirs:
      PostgREST resolves the embed through the same policies, and a school they never asked
      about produces no row.
    */
    const { data, error } = await client
      .from('school_join_requests')
      .select('id, status, note, requested_at, decided_at, granted_role, schools(name, school_id)')
      .order('requested_at', { ascending: false })

    if (error) return fromPostgrestError(error)

    return ok({ requests: data ?? [] })
  })
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = requestSchema.safeParse(await request.json())
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .rpc('request_school_link', {
        p_school_code: parsed.data.schoolCode,
        p_full_name: parsed.data.fullName,
        p_email: parsed.data.email,
        p_note: parsed.data.note ?? null,
      })
      .maybeSingle()

    if (error) return fromPostgrestError(error)

    const row = (data ?? {}) as {
      out_request_id?: string | null
      out_submitted?: boolean
      out_message?: string
    }

    /*
      `submitted: false` is the pending cap, not a failure of the request — the only case
      where the function declines rather than accepting. It gets a 409 so the screen can
      show the message rather than a generic error.
    */
    if (row.out_submitted === false) {
      return fail('CONFLICT', row.out_message ?? 'You have too many requests waiting.')
    }

    return ok({
      requestId: row.out_request_id ?? null,
      message: row.out_message ?? 'Your request has been sent to the school.',
    })
  })
}

export async function DELETE(request: Request): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = withdrawSchema.safeParse(await request.json())
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('withdraw_school_link_request', {
      p_request_id: parsed.data.requestId,
    })

    if (error) return fromPostgrestError(error)

    // The function returns false for a request that is not the caller's, or is no longer
    // pending. Both are NOT_FOUND from here: saying which would tell a caller whether
    // somebody else's request id exists.
    if (data !== true) {
      return fail('NOT_FOUND', 'That request is no longer pending.')
    }

    return ok({ withdrawn: true })
  })
}
