/**
 * Notices addressed to whoever is signed in.
 *
 *   GET  /api/session/notices  — what this account can see, newest first
 *   POST /api/session/notices  — mark one read
 *
 * Spec: `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
 *
 * ## Why this is not the parent route
 *
 * `/api/parent/notices` resolves a parent and answers for their children. A teacher has
 * no children in the system and needs the notices addressed to STAFF, which is a
 * different audience and the same table.
 *
 * `announcement_addressed_to_me()` already decides audience inside the RLS policy, so
 * this route selects without an audience filter of its own — the policy IS the filter,
 * and a second rule here would be one that drifts from it. That is also why the same
 * route serves a teacher, an administrator and an accountant without branching.
 *
 * ## Only what has been sent
 *
 * A draft is somebody's unfinished sentence and a scheduled notice has not happened yet.
 * Neither is addressed to anybody, and showing either would mean a teacher reading a fee
 * notice the office is still editing.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import { resolveSchoolContext } from '../../../../lib/school-context'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const readSchema = z.object({ announcementId: z.string().uuid() })

export async function GET(): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const [notices, reads] = await Promise.all([
      client
        .from('announcements')
        .select('id, title, body, importance, target_audience, sent_at, created_at')
        .eq('status', 'sent')
        .order('sent_at', { ascending: false })
        .limit(50),
      // Own receipts only — the policy on `announcement_reads` scopes to the reader.
      client.from('announcement_reads').select('announcement_id'),
    ])

    if (notices.error) return fromPostgrestError(notices.error)

    const readIds = new Set(
      ((reads.data ?? []) as Array<{ announcement_id: string }>).map((r) => r.announcement_id),
    )

    const rows = ((notices.data ?? []) as unknown as Array<{ id: string }>).map((n) => ({
      ...n,
      read: readIds.has(n.id),
    }))

    return ok({
      notices: rows,
      // Counted here so a badge and the list cannot disagree about what is unread.
      unread: rows.filter((n) => !n.read).length,
    })
  })
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = readSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    // `school_id` and `reader_type` are both required, and the CHECK admits exactly
    // parent, student or staff. This route serves the staff audience — a parent reads
    // through `/api/parent/notices`, which records its own type.
    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This session is not associated with a school.')

    const { error } = await client.from('announcement_reads').insert({
      school_id: school.uuid,
      announcement_id: parsed.data.announcementId,
      reader_user_id: session.userId,
      reader_type: 'staff',
    })

    /*
      A duplicate is success.

      Opening the same notice twice is ordinary, and `23505` means the receipt already
      exists — which is exactly the state the caller asked for. Reporting a conflict
      would make the screen show an error for something that worked.
    */
    if (error && error.code !== '23505') return fromPostgrestError(error)

    return ok({ read: true })
  })
}
