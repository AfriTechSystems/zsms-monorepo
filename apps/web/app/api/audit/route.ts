/**
 * GET /api/audit — the audit trail, filtered.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/AUDIT.md`,
 *       `Official Documentation/01 Foundation Layer/SECURITY_POLICIES.md`
 *
 * ## Why this route did not exist until now
 *
 * `audit_logs` has been written to since `0131` and **nothing has ever read it**. Every
 * financial action, every change to a child's record, every staff invitation — recorded
 * faithfully and unreachable. A trail nobody can read is a trail that does not do its
 * job, and the first time anybody needed it would have been a dispute.
 *
 * ## Who sees what is the policy's decision, not this route's
 *
 * `leadership_read_own_school_audit_logs` admits `org:owner` and `org:principal` for their
 * own school, and AfriTech for everything. This route adds no role check: a second copy
 * would drift, and it is the copy a direct PostgREST call skips. A teacher gets an empty
 * list from the database, not a refusal from here.
 *
 * ## Why the actor is resolved to a name
 *
 * `actor_user_id` is a Clerk id. A trail reading `user_3K6Gzh5Rxy4lPzueBbYztnbDFvQ`
 * changed an account number answers "what" and not "who", which is half the point of
 * having it. Resolved through `staff_members` where possible, and left as the id where
 * not — an id is a worse answer than a name and a better one than nothing.
 */

import { z } from 'zod'

import { createUserClient } from '../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../lib/api-response'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  /** A table name, so "show me everything that touched payments" works. */
  table: z.string().trim().max(60).optional(),
  /** An action, such as `payment_verified` or `assistant_confirmed_record_attendance`. */
  action: z.string().trim().max(80).optional(),
  /** One record's whole history, which is what a dispute actually needs. */
  recordId: z.string().uuid().optional(),
  actor: z.string().trim().max(80).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** AfriTech only; ignored for anybody else, because RLS scopes them anyway. */
  schoolId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
})

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const url = new URL(request.url)
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))

    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid filter.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const v = parsed.data

    /*
      One literal `select`. Concatenating it kills PostgREST's row-type inference and the
      symptom is a `GenericStringError` naming nothing useful.
    */
    let q = client
      .from('audit_logs')
      .select(
        'id, school_id, actor_user_id, impersonated_user_id, action, table_name, record_id, old_values, new_values, ip_address, user_agent, metadata, created_at',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false })
      .range(v.offset, v.offset + v.limit - 1)

    if (v.table) q = q.eq('table_name', v.table)
    if (v.action) q = q.eq('action', v.action)
    if (v.recordId) q = q.eq('record_id', v.recordId)
    if (v.actor) q = q.eq('actor_user_id', v.actor)
    if (v.schoolId) q = q.eq('school_id', v.schoolId)
    if (v.from) q = q.gte('created_at', `${v.from}T00:00:00Z`)
    // Inclusive of the whole day, because somebody filtering "to 6 October" means
    // everything that happened on the 6th, not everything before midnight starting it.
    if (v.to) q = q.lte('created_at', `${v.to}T23:59:59.999Z`)

    const { data, error, count } = await q
    if (error) return fromPostgrestError(error)

    const rows = data ?? []

    /*
      Resolve the Clerk ids to names, in one query rather than one per row.

      Scoped by RLS like everything else, so an actor from another school stays an id —
      which is correct: a name is school data.
    */
    const actorIds = [
      ...new Set(
        rows.flatMap((r) =>
          [r.actor_user_id, r.impersonated_user_id].filter((x): x is string => Boolean(x)),
        ),
      ),
    ]

    const names = new Map<string, string>()
    if (actorIds.length > 0) {
      const { data: staff } = await client
        .from('staff_members')
        .select('clerk_user_id, first_name, last_name')
        .in('clerk_user_id', actorIds)

      for (const s of staff ?? []) {
        names.set(s.clerk_user_id, `${s.first_name} ${s.last_name}`.trim())
      }
    }

    return ok({
      entries: rows.map((r) => ({
        id: r.id,
        // WHEN
        at: r.created_at,
        // WHO — a name where one is resolvable, the id where it is not.
        actor: {
          id: r.actor_user_id,
          name: names.get(r.actor_user_id) ?? null,
        },
        /*
          WHO, really.

          An action taken during impersonation names the AfriTech operator AND the person
          whose account they were acting as. A trail that shows only one of the two is
          the trail an impersonation feature exists to make honest.
        */
        impersonating: r.impersonated_user_id
          ? { id: r.impersonated_user_id, name: names.get(r.impersonated_user_id) ?? null }
          : null,
        // WHAT
        action: r.action,
        table: r.table_name,
        recordId: r.record_id,
        before: r.old_values,
        after: r.new_values,
        // WHERE
        schoolId: r.school_id,
        ipAddress: r.ip_address,
        userAgent: r.user_agent,
        // WHY — a reason lives in metadata, written by the explicit log calls.
        reason:
          (r.metadata as Record<string, unknown> | null)?.['reason'] ??
          (r.metadata as Record<string, unknown> | null)?.['utterance'] ??
          null,
        metadata: r.metadata,
      })),
      meta: {
        total: count ?? 0,
        limit: v.limit,
        offset: v.offset,
        /*
          Whether this caller is seeing one school or all of them.

          Said explicitly so the screen can label itself honestly rather than implying a
          school owner is looking at the platform.
        */
        scope: v.schoolId ? 'school' : 'session',
      },
    })
  })
}
