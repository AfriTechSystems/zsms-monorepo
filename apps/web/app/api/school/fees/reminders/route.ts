/**
 * GET/PUT /api/school/fees/reminders — when and how a school chases overdue fees.
 *
 * Spec: `09 Fee and Financial Management/REMINDERS.md` → *Reminder Settings*
 *
 * ## What this replaced
 *
 * Two constants in `apps/workers/src/handlers/fee-reminders.ts` — `?? 3` and `?? 7` —
 * that decided when every school in Zambia chased a parent for money, and that did not
 * match REMINDERS.md's documented 7/14/30 schedule.
 *
 * ## No role check here
 *
 * `set_reminder_settings()` (`0251`) refuses anybody but the owner, principal or
 * accountant, and that refusal is the enforcement — a direct PostgREST call skips this
 * route entirely. Re-checking here would be a second copy of the rule, and it is the
 * copy that can be bypassed.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      `my_reminder_settings()` takes NO argument, which is the point. The id-taking
      form bypasses RLS and had no tenant clause, so calling it from here would have
      let anyone read another school's configuration by changing a UUID — `0254`
      revoked it from signed-in users for exactly that reason.
    */
    const { data, error } = await client.rpc('my_reminder_settings').maybeSingle()

    if (error) {
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      return fromPostgrestError(error)
    }

    /*
      Cast because the generated type for a no-argument set-returning function is
      `Args: never`, which defeats supabase-js's row inference and leaves `data` as
      `{}`. Same shape as `my_departure_prompt` in the parent preferences route.
    */
    const row = data as {
      out_reminder_days: number[]
      out_via_whatsapp: boolean
      out_via_email: boolean
      out_via_in_app: boolean
      out_cooldown_days: number
      out_is_enabled: boolean
      out_configured: boolean
    } | null

    return ok({
      /*
        `0251` always returns a row, so there is no "unconfigured" branch to handle —
        a school that has never opened this screen gets REMINDERS.md's documented
        defaults rather than whatever a caller last passed.
      */
      reminderDays: row?.out_reminder_days ?? [7, 14, 30],
      viaWhatsapp: row?.out_via_whatsapp ?? true,
      viaEmail: row?.out_via_email ?? true,
      viaInApp: row?.out_via_in_app ?? true,
      cooldownDays: row?.out_cooldown_days ?? 7,
      isEnabled: row?.out_is_enabled ?? true,
      // So the screen can say "using the defaults" rather than implying somebody chose.
      isConfigured: row?.out_configured ?? false,
    })
  })
}

const schema = z.object({
  /*
    The rungs REMINDERS.md offers, plus anything else within the bounds `0251`
    enforces. Not restricted to the five the document lists: a school that wants to
    chase at 45 days is making an ordinary decision about its own parents, and a
    closed list here would mean a deployment to honour it.
  */
  reminderDays: z.array(z.number().int().min(1).max(730)).max(10),
  viaWhatsapp: z.boolean(),
  viaEmail: z.boolean(),
  viaInApp: z.boolean(),
  cooldownDays: z.number().int().min(1).max(90),
  isEnabled: z.boolean(),
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

    const { error } = await client.rpc('set_reminder_settings', {
      p_reminder_days: v.reminderDays,
      p_via_whatsapp: v.viaWhatsapp,
      p_via_email: v.viaEmail,
      p_via_in_app: v.viaInApp,
      p_cooldown_days: v.cooldownDays,
      p_is_enabled: v.isEnabled,
    })

    if (error) {
      // The function's own codes, mapped to answers somebody should read.
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === '22023') return fail('VALIDATION_ERROR', error.message)
      return fromPostgrestError(error)
    }

    return ok({
      message: v.isEnabled
        ? `Saved. Reminders will go out at ${v.reminderDays.join(', ')} days overdue.`
        : 'Saved. Fee reminders are switched off — your schedule is kept for when you turn them back on.',
    })
  })
}
