/**
 * GET  /api/parent/notices — announcements addressed to this parent.
 * POST /api/parent/notices — record that one has been read.
 *
 * Spec: `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
 *
 * ## The read receipt is the point, not a nicety
 *
 * `importance` only means something because an unread important notice can
 * escalate to WhatsApp. That rule needs to know who has read what, and without a
 * parent-side receipt it never fires for the audience it exists to protect —
 * the escalation would only ever consider staff.
 *
 * ## The audience filter is a policy, not a query
 *
 * No `target_type` filter appears below. Migration `0113` decides it, so a
 * parent cannot reach a notice addressed to staff even if this route forgot to
 * exclude it. That matters because this file is exactly where such a filter would
 * later be "simplified" away.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { resolveSchoolContext } from '../../../../lib/school-context'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../lib/api-response'
import { resolveParentCaller } from '../../../../lib/parent-context'

export const dynamic = 'force-dynamic'

const readSchema = z.object({ announcementId: z.string().uuid() })

export async function GET(): Promise<Response> {
  return guard(async () => {
    const caller = await resolveParentCaller()
    if (!caller.ok) return caller.response

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const [notices, reads] = await Promise.all([
      client
        .from('announcements')
        .select('id, title, body, importance, target_type, sent_at')
        .order('sent_at', { ascending: false })
        .limit(100),
      client.from('announcement_reads').select('announcement_id'),
    ])

    if (notices.error) return fromPostgrestError(notices.error)

    const readIds = new Set(
      ((reads.data ?? []) as Array<{ announcement_id: string }>).map((r) => r.announcement_id),
    )

    return ok({
      notices: (notices.data ?? []).map((n) => ({ ...n, read: readIds.has(n.id as string) })),
      unread: (notices.data ?? []).filter((n) => !readIds.has(n.id as string)).length,
    })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveParentCaller()
    if (!caller.ok) return caller.response

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = readSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This session is not associated with a school.')

    const { error } = await client.from('announcement_reads').insert({
      school_id: school.uuid,
      announcement_id: parsed.data.announcementId,
      reader_user_id: caller.caller.userId,
      reader_type: 'parent',
    })

    if (error) {
      // 23505 — already recorded. Re-reading a notice is not an error and must
      // not surface as one; the receipt already exists, which is the desired
      // state. Returning success here is what lets the screen mark-on-open
      // without tracking whether it has already done so.
      if (error.code === '23505') return ok({ recorded: true, alreadyRead: true })
      // 42501 — the WITH CHECK in 0113 refused it, which means the notice is not
      // addressed to this reader. Reported as not-found rather than forbidden so
      // the answer does not confirm the announcement exists.
      if (error.code === '42501') return fail('NOT_FOUND', 'That notice is not available to you.')
      return fromPostgrestError(error)
    }

    return ok({ recorded: true, alreadyRead: false })
  })
}
