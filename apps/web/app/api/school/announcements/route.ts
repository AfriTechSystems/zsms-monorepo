/**
 * GET   /api/school/announcements — what has been sent, scheduled, or drafted.
 * POST  /api/school/announcements — write one; save, schedule, or send.
 * PATCH /api/school/announcements — cancel one that has not gone yet.
 *
 * Spec: `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
 *       `Official Documentation/17 Integration and Pricing/PRICING.md` — WhatsApp quota
 *
 * ## Nothing sends synchronously, and the response says so
 *
 * "Send now" sets `status = 'scheduled'` with `scheduled_at = now()`, and the
 * worker claims it (`worker_claim_scheduled_announcements`). There is no code
 * path that delivers a message inside this request, and pretending otherwise
 * would be the single most misleading thing this endpoint could do — a head
 * teacher who believes 300 parents have been told something, when the queue has
 * not run, will not follow up.
 *
 * **And on this machine the queue does not run at all.** There is no Redis and
 * no provider credentials, so a queued announcement stays queued. That is
 * reported rather than hidden; see `deliveryConfigured`.
 *
 * ## A recipient count before sending, not after
 *
 * WhatsApp is metered and the quota is per tier. An announcement to
 * `all_parents` at a 250-pupil school is not a small act, so the count and the
 * remaining quota come back with the form rather than being discovered in a
 * billing surprise. Counted through `worker_announcement_recipients`? No — that
 * is a worker-boundary function and this is a user request. The count is derived
 * from the same tables the policies already scope.
 *
 * **This paragraph described the recipient count and nothing else until 2026-10-02.**
 * `school_message_quotas` has always held `quota_limit`, `messages_used` and the
 * 80%-alert timestamp, and no route read it — so a school could see that an announcement
 * would reach 250 parents without being able to see that it had 40 messages left. The
 * audit found the table had no reader at all. It is returned now, and the composer shows
 * what remains before the send rather than after it.
 *
 * ## Read receipts
 *
 * `announcement_reads` has had a route for marking one read and nothing that counted
 * them, so a head teacher could send a fee notice and never learn whether a single parent
 * opened it. Counted per announcement in one grouped query rather than per row, because a
 * term's worth of announcements would otherwise be one request each.
 */

import type { NextRequest } from 'next/server'
import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { resolveFeeCaller as resolveSchoolCaller } from '../../../../lib/fee-context'
import { resolveSchoolContext } from '../../../../lib/school-context'
import { can } from '../../../../lib/roles'
import {
  created,
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * Audience and scope are independent (migration `0114`), which is what makes
 * "Grade 7 pupils" expressible — the old flattened `target_type` could only say
 * "grade", and meant parents by accident of implementation.
 *
 * `everyone`/`platform` is excluded: a platform notice has a NULL `school_id` and
 * the table's CHECK refuses it from a school context, so offering it here would
 * produce a constraint error for an action a school may never take.
 */
const AUDIENCES = ['parents', 'students', 'staff', 'individuals'] as const
const SCOPES = ['school', 'grade', 'class', 'individual'] as const

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(4000),
    importance: z.enum(['regular', 'important']).default('regular'),
    /*
      Which channels the sender asked for.

      In-app is added below whether or not it appears here: it is how a notice reaches
      the portal and the phone app, and the database rejects an announcement without it.
      The rest record an INTENT — WhatsApp and email have no credentials and push has no
      tokens, so the composer says which are live rather than pretending.
    */
    channels: z.array(z.enum(['in_app', 'push', 'whatsapp', 'email', 'sms'])).optional(),
    targetAudience: z.enum(AUDIENCES),
    targetScope: z.enum(SCOPES),
    // Grade ids, class ids, or Clerk user ids depending on scope. 500 rather than
    // 50: an individual send to a whole year group's worth of named people is a
    // legitimate use, and the old cap was sized for grade ids only.
    targetIds: z.array(z.string().trim().min(1).max(60)).max(500).optional(),
    // 'draft' saves without sending. 'now' and 'schedule' both hand it to the
    // worker; the only difference is when it becomes claimable.
    action: z.enum(['draft', 'now', 'schedule']),
    scheduledAt: z.string().datetime().optional(),
  })
  .refine((v) => v.action !== 'schedule' || Boolean(v.scheduledAt), {
    message: 'Choose when it should go out.',
    path: ['scheduledAt'],
  })
  // Mirrors the table's `announcements_audience_scope_shape` CHECK. Caught here so
  // the message names the control rather than quoting a constraint.
  .refine(
    (v) =>
      (v.targetAudience === 'individuals') === (v.targetScope === 'individual'),
    {
      message: 'Addressing named people is its own audience — choose Individuals.',
      path: ['targetScope'],
    },
  )
  .refine(
    (v) =>
      !['grade', 'class', 'individual'].includes(v.targetScope) ||
      (v.targetIds?.length ?? 0) > 0,
    {
      message: 'Choose at least one grade, class, or person.',
      path: ['targetIds'],
    },
  )
  .refine((v) => ['grade', 'class', 'individual'].includes(v.targetScope) || (v.targetIds?.length ?? 0) === 0, {
    message: 'A whole-school notice takes no grades, classes, or people.',
    path: ['targetIds'],
  })

const patchSchema = z.object({
  id: z.string().uuid(),
  action: z.literal('cancel'),
})

export async function GET(): Promise<Response> {
  return guard(async () => {
    const caller = await resolveSchoolCaller()
    if (!caller.ok) return caller.response

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This session is not associated with a school.')

    const [list, parents, pupils, staff, tier, quota, reads] = await Promise.all([
      client
        .from('announcements')
        .select(
          'id, title, body, importance, target_audience, target_scope, ' +
            'target_ids, status, scheduled_at, sent_at, whatsapp_jobs_queued, ' +
            'channels, created_at',
        )
        .order('created_at', { ascending: false })
        .limit(100),
      // Distinct parents with an active link. A parent with three children is
      // one recipient, not three — counting links would overstate the quota cost
      // by exactly the number of siblings.
      client
        .from('student_parent_links')
        .select('parent_user_id')
        .eq('is_active', true),
      client
        .from('students')
        .select('id', { count: 'exact', head: true })
        .in('status', ['active', 'on_leave']),
      client.from('staff_members').select('id', { count: 'exact', head: true }),
      client.from('schools').select('subscription_tier').eq('id', school.uuid).maybeSingle(),
      /*
        The real quota, which nothing read until now. `billing_period` is the current
        month's row; ordering by it descending and taking one avoids hardcoding a date
        format the table owns.
      */
      client
        .from('school_message_quotas')
        .select('billing_period, quota_limit, messages_used, overage_credits')
        .order('billing_period', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Every read receipt for this school's announcements, counted in the application
      // rather than per announcement — a term of notices would otherwise be one query each.
      client.from('announcement_reads').select('announcement_id'),
    ])

    if (list.error) return fromPostgrestError(list.error)

    const parentUsers = new Set(
      ((parents.data ?? []) as Array<{ parent_user_id: string | null }>)
        .map((p) => p.parent_user_id)
        .filter((p): p is string => Boolean(p)),
    )

    // announcement_id -> how many recipients have opened it.
    const readCounts = new Map<string, number>()
    for (const r of (reads.data ?? []) as Array<{ announcement_id: string }>) {
      readCounts.set(r.announcement_id, (readCounts.get(r.announcement_id) ?? 0) + 1)
    }

    const q = quota.data as {
      quota_limit?: number
      messages_used?: number
      overage_credits?: number
    } | null

    return ok({
      announcements: ((list.data ?? []) as unknown as Array<{ id: string }>).map((a) => ({
        ...a,
        readCount: readCounts.get(a.id) ?? 0,
      })),
      /*
        Null when the school has no quota row yet — a new school that has sent nothing.
        Distinguished from zero remaining, because "you have used none of your allowance"
        and "we do not know your allowance" are different things to show.
      */
      quota: q
        ? {
            limit: q.quota_limit ?? 0,
            used: q.messages_used ?? 0,
            remaining: Math.max(0, (q.quota_limit ?? 0) - (q.messages_used ?? 0)),
            overageCredits: q.overage_credits ?? 0,
          }
        : null,
      audience: {
        all_parents: parentUsers.size,
        all_students: pupils.count ?? 0,
        all_staff: staff.count ?? 0,
      },
      tier: (tier.data as { subscription_tier?: string } | null)?.subscription_tier ?? null,
      canWrite: can(caller.role, 'announcements:write'),
      /**
       * Whether a queued announcement can actually be delivered from here.
       *
       * False on any machine without Redis and provider credentials, which is
       * every developer machine today. The screen uses it to say "queued, not
       * sent" instead of implying delivery — the alternative is a head teacher
       * assuming 300 parents were told something they were not.
       */
      deliveryConfigured: Boolean(process.env['REDIS_URL'] ?? process.env['UPSTASH_REDIS_REST_URL']),
    })
  })
}

export async function POST(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveSchoolCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'announcements:write')) {
      return fail('FORBIDDEN', 'Only the owner, principal and administrator send announcements.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = createSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)
    const v = parsed.data

    const school = await resolveSchoolContext(client)
    if (!school) return fail('FORBIDDEN', 'This session is not associated with a school.')

    // A scheduled time in the past would be claimed on the next worker tick,
    // which is indistinguishable from "send now" — so it is accepted as exactly
    // that rather than rejected. Refusing it would be pedantry about a clock the
    // operator cannot see.
    const scheduledAt =
      v.action === 'now' ? new Date().toISOString() : (v.scheduledAt ?? null)

    const { data, error } = await client
      .from('announcements')
      .insert({
        school_id: school.uuid,
        title: v.title,
        body: v.body,
        importance: v.importance,
        // `target_type` is NOT set: a trigger derives it from these two (0114).
        // Writing it here would create the second source of truth the derived
        // column exists to avoid.
        target_audience: v.targetAudience,
        target_scope: v.targetScope,
        target_ids: v.targetIds ?? [],
        // In-app always, deduplicated. The CHECK on the column enforces the same thing;
        // doing it here means a caller who omits it gets a working announcement rather
        // than a constraint violation.
        channels: Array.from(new Set(['in_app', ...(v.channels ?? [])])),
        created_by: caller.userId,
        // 'sending' and 'sent' are the worker's to set. An API that wrote 'sent'
        // would be asserting a delivery it has not performed.
        status: v.action === 'draft' ? 'draft' : 'scheduled',
        scheduled_at: scheduledAt,
      })
      .select('id, title, status, scheduled_at, target_audience, target_scope, created_at')
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!data) return fail('FORBIDDEN', 'Not permitted to send announcements at this school.')

    return created({
      announcement: data,
      // Never "sent". Queued is the truthful word for what just happened.
      queued: v.action !== 'draft',
    })
  })
}

export async function PATCH(request: NextRequest): Promise<Response> {
  return guard(async () => {
    const caller = await resolveSchoolCaller()
    if (!caller.ok) return caller.response

    if (!can(caller.role, 'announcements:write')) {
      return fail('FORBIDDEN', 'Only the owner, principal and administrator change announcements.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return fail('VALIDATION_ERROR', 'Request body must be valid JSON.')
    }

    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) return validationFailed(parsed.error)

    // Only while it is still claimable. `status IN ('draft','scheduled')` is the
    // guard: once the worker has moved it to 'sending' some recipients may
    // already have it, and "cancelled" would be a false description of a message
    // that partly went out.
    const { data, error } = await client
      .from('announcements')
      .update({ status: 'cancelled' })
      .eq('id', parsed.data.id)
      .in('status', ['draft', 'scheduled'])
      .select('id, title, status')
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!data) {
      return fail(
        'CONFLICT',
        'That announcement is already going out and cannot be cancelled — some recipients may already have it.',
      )
    }

    return ok(data)
  })
}
