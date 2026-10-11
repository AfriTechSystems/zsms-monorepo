/**
 * GET /api/school/messages/log — what ZSMS has sent on this school's behalf.
 *
 * Spec: `12 Communication System/MESSAGE_LOG.md` → *Admin Communication Log View*
 *
 * ## Why this matters more than it looks
 *
 * Every channel currently runs through the **mock provider** — there are no Meta,
 * Twilio or Resend credentials, so no message has left the machine. This log is
 * therefore the only honest answer to "did the parent get it", and right now that
 * answer is no. A screen that implied otherwise would be worse than none.
 *
 * When credentials do arrive, this is also the screen that proves delivery started
 * working, and the one that answers a parent saying they were never told.
 *
 * ## Read-only, and that is structural
 *
 * `authenticated` holds SELECT on `message_log` and nothing else — the pgTAP suite
 * asserts no end-user role can INSERT or UPDATE it. A delivery record is the provider's
 * word about what happened, not a user's, so there is no write path here to expose.
 *
 * RLS scopes the rows: `school_management_read_message_log` admits the owner, principal,
 * administrator and — since `0257` — the accountant. No filter is written in this route,
 * because a second copy of that rule is the copy a direct PostgREST call skips.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const query = z.object({
  channel: z.enum(['whatsapp', 'sms', 'email', 'push', 'in_app']).optional(),
  templateKey: z.string().trim().max(60).optional(),
  status: z.enum(['queued', 'sent', 'delivered', 'read', 'failed']).optional(),
  // A search across the recipient, so "did Mrs Banda get it" is answerable.
  search: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid filter.')
    }
    const q = parsed.data

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let builder = client
      .from('message_log')
      /*
        ONE literal, deliberately. Concatenating this string kills PostgREST's
        row-type inference and every field access below becomes an error on
        `GenericStringError` — which is what the first draft of this file did.
      */
      .select(
        'id, channel, template_key, recipient_phone, recipient_email, status, sent_at, delivered_at, read_at, failed_at, failure_reason, retry_count, is_fallback, fallback_of_id, consumed_quota, created_at, students(first_name, last_name)',
      )
      .order('created_at', { ascending: false })
      .limit(q.limit)

    if (q.channel) builder = builder.eq('channel', q.channel)
    if (q.templateKey) builder = builder.eq('template_key', q.templateKey)
    if (q.status) builder = builder.eq('status', q.status)
    if (q.search) {
      // Phone or email. The pupil's name is not searched here because it lives on
      // a joined table and PostgREST cannot filter an embed with `or`.
      const term = `%${q.search}%`
      builder = builder.or(`recipient_phone.ilike.${term},recipient_email.ilike.${term}`)
    }

    const { data, error } = await builder

    if (error) {
      // A role the policy does not admit sees an empty list, not a refusal, because
      // RLS filters rather than errors. A genuine failure is reported as itself.
      return fromPostgrestError(error)
    }

    const rows = data ?? []

    return ok({
      messages: rows.map((m) => {
        const student = m.students as { first_name?: string; last_name?: string } | null
        return {
          id: m.id,
          channel: m.channel,
          templateKey: m.template_key,
          /*
            The recipient, masked to its last four digits.

            A delivery log is read over somebody's shoulder in a school office, and
            the full mobile number of every parent is not needed to answer "did it
            go". The pupil's name identifies the family; the digits confirm which
            number was used.
          */
          recipient:
            m.recipient_phone
              ? `•••• ${m.recipient_phone.slice(-4)}`
              : (m.recipient_email ?? 'In the portal'),
          studentName: student?.first_name
            ? `${student.first_name} ${student.last_name ?? ''}`.trim()
            : null,
          status: m.status,
          // The lifecycle, so a screen can show how far it got rather than one word.
          sentAt: m.sent_at,
          deliveredAt: m.delivered_at,
          readAt: m.read_at,
          failedAt: m.failed_at,
          failureReason: m.failure_reason,
          retryCount: m.retry_count,
          /*
            Whether this was a fallback for a channel that failed. A school looking
            at "email · delivered" deserves to know the WhatsApp attempt before it
            did not arrive — that is the difference between a working fallback chain
            and a channel quietly never working.
          */
          isFallback: m.is_fallback,
          fallbackOfId: m.fallback_of_id,
          // Which messages actually cost the school quota.
          consumedQuota: m.consumed_quota,
          createdAt: m.created_at,
        }
      }),
      /*
        Said by the server rather than hardcoded in the screen, so the day
        credentials are configured the banner stops appearing without a deployment.
      */
      providerIsMock: !process.env.META_WHATSAPP_TOKEN && !process.env.RESEND_API_KEY,
    })
  })
}
