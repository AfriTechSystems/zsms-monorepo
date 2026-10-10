/**
 * The onboarding task queue.
 *
 *   GET   /api/admin/onboarding — the queue, ordered by urgency
 *   POST  /api/admin/onboarding — record a contact attempt, or set a task's state
 *
 * Spec: `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
 *
 * ## Urgency is ordered here, not stored
 *
 * `public.onboarding_queue` computes `outreach_overdue`, `outreach_escalated` and
 * `hours_to_contact` from the first recorded contact against registration time. Nothing writes an
 * "overdue" flag, so nothing can forget to — which matters because the alternative was a queued job
 * and there is no Redis.
 *
 * The ordering below is the document's: schools inside the 24-hour window first, in red, then
 * schools approaching trial expiry, in amber. Both fall out of columns the view already has.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { resolveAdminContext } from '../../../../lib/admin-context'
import { fail, fromPostgrestError, guard, ok, validationFailed } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const params = new URL(request.url).searchParams
    const view = params.get('view') ?? 'open'

    let query = client.from('onboarding_queue').select('*', { count: 'exact' })

    if (view === 'overdue') {
      query = query.eq('outreach_overdue', true)
    } else if (view === 'open') {
      // What still needs somebody. `complete` and `not_interested` are the two states the document
      // treats as finished, so the default view is everything else.
      query = query.not('task_status', 'in', '("complete","not_interested")')
    } else if (view === 'mine') {
      query = query.eq('assigned_to', admin.userId)
    }

    /**
     * Overdue first, then whoever has least time left. `hours_to_contact` goes negative once the
     * window has passed, so ascending order puts the worst breach at the top and a school
     * registered five minutes ago at the bottom — which is the order a person works the list in.
     */
    const { data, error, count } = await query
      .order('outreach_overdue', { ascending: false })
      .order('hours_to_contact', { ascending: true })
      .limit(PAGE_SIZE)

    if (error) return fromPostgrestError(error)

    return ok(data ?? [], { total: count ?? 0, perPage: PAGE_SIZE })
  })
}

const contactSchema = z.object({
  action: z.literal('contact'),
  schoolId: z.string().uuid(),
  outcome: z.enum(['spoke', 'call_scheduled', 'no_answer', 'wrong_number', 'not_interested']),
  channel: z.enum(['phone', 'whatsapp', 'email', 'in_person']).default('phone'),
  note: z.string().trim().max(2000).nullable().optional(),
  followUpAt: z.string().datetime().nullable().optional(),
})

const taskSchema = z.object({
  action: z.literal('task'),
  schoolId: z.string().uuid(),
  taskStatus: z
    .enum(['new', 'assigned', 'in_progress', 'not_interested', 'complete'])
    .nullable()
    .optional(),
  // Empty string clears the assignment. The function turns it back into NULL, which is how
  // "unassign" is expressed without a separate verb.
  assignedTo: z.string().trim().max(200).nullable().optional(),
})

const bodySchema = z.discriminatedUnion('action', [contactSchema, taskSchema])

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)
    const input = parsed.data

    if (input.action === 'contact') {
      /**
       * The note requirement lives in a CHECK on the table, not here: `no_answer` and
       * `wrong_number` may have an empty note because there was nobody to quote, and anything else
       * must say what was said. Checked in the database so a direct RPC cannot skip it, and
       * surfaced here as a readable message rather than a constraint name.
       */
      const { data, error } = await client.rpc('admin_record_onboarding_contact', {
        p_school_id: input.schoolId,
        p_outcome: input.outcome,
        p_note: input.note ?? null,
        p_channel: input.channel,
        p_follow_up_at: input.followUpAt ?? null,
      })

      if (error) {
        if (error.message.includes('note_required')) {
          return fail(
            'VALIDATION_ERROR',
            'Say what was said. A note is only optional when nobody answered.',
          )
        }
        return fromPostgrestError(error)
      }

      const row = (data as unknown as Array<{ out_task_status: string }>)[0]
      return ok({ recorded: true, taskStatus: row?.out_task_status ?? null })
    }

    const { data, error } = await client.rpc('admin_set_onboarding_task', {
      p_school_id: input.schoolId,
      p_task_status: input.taskStatus ?? null,
      p_assigned_to: input.assignedTo ?? null,
    })

    if (error) return fromPostgrestError(error)

    const row = (data as unknown as Array<{ out_task_status: string; out_assigned_to: string | null }>)[0]
    return ok({ taskStatus: row?.out_task_status ?? null, assignedTo: row?.out_assigned_to ?? null })
  })
}
