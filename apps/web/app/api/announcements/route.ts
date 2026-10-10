/**
 * /api/announcements — list and create.
 *
 * Spec: `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
 *
 * No school filter appears in either handler. The policies already decide what
 * each role sees — management sees drafts, everyone else sees only what has
 * been sent — and repeating that here would put the rule in two places that can
 * drift apart.
 */

import type { NextRequest } from 'next/server'
import { getAuthProvider } from '@zsms/auth-provider'
import { createUserClient } from '../../../lib/supabase'
import {
  created,
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../lib/api-response'
import { createAnnouncementSchema, listAnnouncementsQuerySchema } from '../../../lib/validation'
import { resolveSchoolContext } from '../../../lib/school-context'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = listAnnouncementsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    )
    if (!parsed.success) return validationFailed(parsed.error)

    const { page, perPage, status } = parsed.data
    const from = (page - 1) * perPage

    let query = client
      .from('announcements')
      .select(
        'id, school_id, title, body, importance, target_type, target_ids, status, scheduled_at, sent_at, created_by, created_at',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(from, from + perPage - 1)

    if (status) query = query.eq('status', status)

    const { data, error, count } = await query
    if (error) return fromPostgrestError(error)

    return ok(data ?? [], { page, perPage, total: count ?? 0 })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = createAnnouncementSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This session is not associated with a school.')

    const i = parsed.data

    const row: Record<string, unknown> = {
      school_id: school.uuid,
      title: i.title,
      body: i.body,
      target_type: i.targetType,
      target_ids: i.targetIds ?? [],
      // Pinned to the caller. The INSERT policy also enforces this — an
      // announcement is a statement by a named person, and the audit value
      // disappears if the author can be chosen.
      created_by: session.userId,
      // A scheduled announcement waits for the 15-minute cron; an unscheduled
      // one is a draft until someone sends it. Neither dispatches from here.
      status: i.scheduledAt ? 'scheduled' : 'draft',
    }
    if (i.importance !== undefined) row['importance'] = i.importance
    if (i.scheduledAt !== undefined) row['scheduled_at'] = i.scheduledAt

    const { data, error } = await client
      .from('announcements')
      .insert(row)
      .select('id, title, target_type, status, scheduled_at, created_at')
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!data) {
      return fail('FORBIDDEN', 'You do not have permission to create announcements at this school.')
    }

    return created(data)
  })
}
