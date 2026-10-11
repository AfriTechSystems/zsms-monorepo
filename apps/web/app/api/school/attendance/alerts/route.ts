/**
 * GET/PUT /api/school/attendance/alerts — whether marking a child absent tells their parent.
 *
 * Spec: `10 Attendance/TRIGGERS.md` → *Per-Absence Alert Toggle*
 *       `10 Attendance/NOTIFICATIONS.md` → *Channel 3*
 *
 * ## Why this is off by default
 *
 * NOTIFICATIONS.md does the arithmetic: 400 pupils at 5% daily absence is roughly 400
 * messages a month, which is about 80% of the Starter tier's entire quota spent on
 * absence alerts alone. The GET returns the school's own projection so the decision is
 * made with the number in front of somebody, rather than discovered when the quota runs
 * out mid-term.
 *
 * ## The no-argument form, deliberately
 *
 * `my_attendance_alerts()` resolves the school from the caller's claims.
 * `school_attendance_alerts(UUID)` exists for the worker and is `service_role` only —
 * an id-taking DEFINER function granted to `authenticated` is what `0254` had to undo
 * three migrations earlier, so `0255` separated them from birth.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

interface AlertRow {
  out_enabled: boolean
  out_statuses: string[]
  out_via_whatsapp: boolean
  out_via_email: boolean
  out_via_push: boolean
  out_max_age_days: number
  out_configured: boolean
}

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client.rpc('my_attendance_alerts').maybeSingle()

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      return fromPostgrestError(error)
    }

    // Cast: a no-argument set-returning function generates as `Args: never`, which
    // defeats row inference and leaves `data` as `{}`.
    const row = data as AlertRow | null

    /*
      The projection, so the quota cost is visible before the switch is thrown.

      A secondary read that fails must not fail the page, so a missing roll simply
      leaves the estimate out rather than erroring — the toggle still works.
    */
    let projection: { students: number; perMonth: number } | null = null
    const roll = await client
      .from('students')
      .select('id', { count: 'exact', head: true })
      .in('status', ['active', 'on_leave'])

    if (!roll.error && typeof roll.count === 'number') {
      projection = {
        students: roll.count,
        /*
          5% daily absence over 20 school days, which is NOTIFICATIONS.md's own
          assumption. Rounded, and presented as an estimate rather than a promise —
          the real rate is a property of the school, not of this arithmetic.
        */
        perMonth: Math.round(roll.count * 0.05 * 20),
      }
    }

    return ok({
      enabled: row?.out_enabled ?? false,
      statuses: row?.out_statuses ?? ['absent'],
      viaWhatsapp: row?.out_via_whatsapp ?? true,
      viaEmail: row?.out_via_email ?? true,
      viaPush: row?.out_via_push ?? true,
      maxAgeDays: row?.out_max_age_days ?? 2,
      isConfigured: row?.out_configured ?? false,
      projection,
    })
  })
}

const schema = z.object({
  enabled: z.boolean(),
  // The three marks `0255`'s CHECK admits. 'present' is deliberately not among them.
  statuses: z.array(z.enum(['absent', 'late', 'excused'])).min(1).max(3),
  viaWhatsapp: z.boolean(),
  viaEmail: z.boolean(),
  viaPush: z.boolean(),
  maxAgeDays: z.number().int().min(1).max(30),
})

export async function PUT(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const v = parsed.data

    const { error } = await client.rpc('set_attendance_alerts', {
      p_enabled: v.enabled,
      p_statuses: v.statuses,
      p_via_whatsapp: v.viaWhatsapp,
      p_via_email: v.viaEmail,
      p_via_push: v.viaPush,
      p_max_age_days: v.maxAgeDays,
    })

    if (error) {
      // The function's own refusals, which are the enforcement.
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    return ok({
      message: v.enabled
        ? 'Saved. Parents will now be told when their child is marked ' +
          `${v.statuses.join(' or ')}.`
        : 'Saved. Parents are no longer messaged about individual absences — they still see them in the portal.',
    })
  })
}
