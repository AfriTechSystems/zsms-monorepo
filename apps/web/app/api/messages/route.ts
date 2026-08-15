/**
 * /api/messages — message history.
 *
 * Spec: `Official Documentation/12 Communication System/MESSAGE_LOG.md`
 *
 * Read-only, deliberately. `message_log` grants no INSERT or UPDATE to any
 * end-user role (0089): a fabricated 'delivered' row is the artefact a school
 * would rely on to claim a parent was warned, so the log is written only by
 * the worker through a SECURITY DEFINER function.
 *
 * Who sees what is decided by policy: management sees their school's history,
 * a parent sees messages addressed to them, and a teacher sees none.
 */

import type { NextRequest } from 'next/server'
import { createUserClient } from '../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../lib/api-response'
import { listMessagesQuerySchema } from '../../../lib/validation'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = listMessagesQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    )
    if (!parsed.success) return validationFailed(parsed.error)

    const { page, perPage, channel, status, studentId, templateKey } = parsed.data
    const from = (page - 1) * perPage

    let query = client
      .from('message_log')
      .select(
        // recipient_phone and recipient_email are included: a school reviewing
        // its own history needs to see where a message went. They are already
        // scoped by policy to that school's own messages.
        'id, school_id, channel, template_key, recipient_phone, recipient_email, recipient_user_id, student_id, status, provider_message_id, sent_at, delivered_at, read_at, failed_at, failure_reason, retry_count, is_fallback, fallback_of_id, consumed_quota, created_at',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(from, from + perPage - 1)

    if (channel) query = query.eq('channel', channel)
    if (status) query = query.eq('status', status)
    if (studentId) query = query.eq('student_id', studentId)
    if (templateKey) query = query.eq('template_key', templateKey)

    const { data, error, count } = await query
    if (error) return fromPostgrestError(error)

    return ok(data ?? [], { page, perPage, total: count ?? 0 })
  })
}
