/**
 * /api/announcements/[id]/read — record that the caller opened it.
 *
 * Spec: `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
 *
 * The read is recorded for the CALLER and nobody else. `reader_user_id` is
 * taken from the session and pinned by the policy — a user marking an
 * announcement read on another's behalf would manufacture the exact record a
 * school relies on to claim a parent was informed.
 */

import type { NextRequest } from 'next/server'
import { getAuthProvider } from '@zsms/auth-provider'
import { createUserClient } from '../../../../../lib/supabase'
import { created, fail, fromPostgrestError, guard, ok } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(_request: NextRequest, context: RouteContext): Promise<Response> {
  return guard(async () => {
    const { id } = await context.params
    if (!UUID_RE.test(id)) return fail('VALIDATION_ERROR', 'Announcement id must be a UUID.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    // Read it first so a read cannot be recorded against an announcement the
    // caller cannot see — RLS makes another school's announcement invisible,
    // and this turns that into a clean 404 rather than a foreign-key error.
    const { data: announcement, error: readError } = await client
      .from('announcements')
      .select('id, school_id')
      .eq('id', id)
      .maybeSingle()

    if (readError) return fromPostgrestError(readError)
    if (!announcement) return fail('NOT_FOUND', 'Announcement not found.')

    const readerType =
      session.role === 'org:parent'
        ? 'parent'
        : session.role === 'org:student'
          ? 'student'
          : 'staff'

    const { data, error } = await client
      .from('announcement_reads')
      .upsert(
        {
          school_id: announcement.school_id,
          announcement_id: id,
          reader_user_id: session.userId,
          reader_type: readerType,
        },
        // Opening it twice is not two reads. The unique constraint makes this
        // idempotent rather than a duplicate-key error on every re-open.
        { onConflict: 'announcement_id,reader_user_id', ignoreDuplicates: true },
      )
      .select('id, announcement_id, read_at')
      .maybeSingle()

    if (error) return fromPostgrestError(error)

    // ignoreDuplicates returns no row when it was already read — still success.
    if (!data) return ok({ announcementId: id, alreadyRead: true })

    return created({ ...data, alreadyRead: false })
  })
}
