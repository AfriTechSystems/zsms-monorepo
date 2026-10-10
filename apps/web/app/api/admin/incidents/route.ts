/**
 * Platform incidents.
 *
 *   GET   /api/admin/incidents — what is broken, worst first
 *   PATCH /api/admin/incidents — acknowledge or resolve one
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
 *
 * ## Why `meta.total` matters more than usual here
 *
 * The sidebar badge reads this endpoint with `limit=1` purely for the count. So `total` has to be
 * the number of matching incidents rather than the number returned — a badge showing "1" during a
 * total outage because that is how many rows came back would be actively misleading.
 *
 * ## Severity order is explicit, not alphabetical
 *
 * Sorting by the `severity` text would put `critical` after `error` and before `info` by accident
 * of the alphabet. A reader scanning for the worst thing has to find it first, so the order is
 * stated.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { resolveAdminContext } from '../../../../lib/admin-context'
import {
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const SEVERITY_RANK: Record<string, number> = {
  critical: 0,
  error: 1,
  warning: 2,
  info: 3,
}

interface IncidentRow {
  id: string
  source: string
  kind: string
  severity: string
  title: string
  detail: string | null
  school_id: string | null
  feature_key: string | null
  dedupe_key: string
  occurrence_count: number
  first_seen_at: string
  last_seen_at: string
  status: string
  acknowledged_by: string | null
  resolved_by: string | null
  resolution_note: string | null
  metadata: Record<string, unknown>
}

const patchSchema = z.object({
  incidentId: z.string().uuid(),
  status: z.enum(['open', 'acknowledged', 'resolved']),
  note: z.string().trim().max(1000).optional(),
})

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 200)

    let query = client
      .from('platform_incidents')
      .select(
        'id, source, kind, severity, title, detail, school_id, feature_key, dedupe_key, '
          + 'occurrence_count, first_seen_at, last_seen_at, status, acknowledged_by, '
          + 'resolved_by, resolution_note, metadata',
        // The count the badge needs: how many MATCH, not how many were returned.
        { count: 'exact' },
      )
      .order('last_seen_at', { ascending: false })
      .limit(limit)

    if (status === 'open') {
      // "Open" to a reader means "not dealt with", which includes acknowledged — somebody has
      // seen it, nobody has fixed it. Excluding acknowledged would make the badge drop to zero
      // the moment an admin clicked, while the key was still dead.
      query = query.neq('status', 'resolved')
    } else if (status) {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query
    if (error) return fromPostgrestError(error)

    // Narrowed after the error check — the documented recurring cast in this codebase.
    const rows = (data ?? []) as unknown as IncidentRow[]

    const sorted = [...rows].sort((a, b) => {
      const bySeverity = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)
      if (bySeverity !== 0) return bySeverity
      return b.last_seen_at.localeCompare(a.last_seen_at)
    })

    return ok(
      {
        incidents: sorted,
        counts: {
          critical: rows.filter((r) => r.severity === 'critical' && r.status !== 'resolved').length,
          error: rows.filter((r) => r.severity === 'error' && r.status !== 'resolved').length,
          warning: rows.filter((r) => r.severity === 'warning' && r.status !== 'resolved').length,
          open: rows.filter((r) => r.status !== 'resolved').length,
        },
      },
      { total: count ?? rows.length },
    )
  })
}

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = patchSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)
    const body = parsed.data

    const { data, error } = await client.rpc('set_incident_status', {
      p_incident_id: body.incidentId,
      p_status: body.status,
      p_note: body.note ?? null,
    })

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    // The function returns FOUND, so `false` means no such incident rather than a failure.
    if (data !== true) return fail('NOT_FOUND', 'No such incident.')

    return ok({ incidentId: body.incidentId, status: body.status })
  })
}
