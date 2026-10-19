/**
 * GET/PATCH /api/parent/preferences — how a parent wishes to be contacted (ADR-015).
 *
 * Spec: `01 Foundation Layer/DECISIONS.md` → ADR-015,
 *       `01 Foundation Layer/COMPLIANCE.md`
 *
 * ## The two consents are not one setting
 *
 * `whatsapp_opted_in` governs SERVICE messages — a fee is due, your child was absent.
 * That is what a parent enrolled in order to receive, and it defaults TRUE.
 *
 * `marketing_opt_in` is AfriTech selling something to a person who is its customer's
 * customer. Under the Zambia Data Protection Act that needs consent given rather than
 * assumed, so it defaults FALSE and ADR-015 states plainly that the two are independent.
 *
 * Presenting them as one switch would be the whole problem, so they are two, with the
 * difference written on the screen.
 *
 * ## Why this route writes four columns and not the row
 *
 * `parent_update_own_record` admits any column on the caller's own row, so a route that
 * echoed the request body back into the table would let a preferences screen rewrite
 * `national_id` and `full_name`. The policy is the security boundary and it holds; this
 * is about not handing a form more reach than its purpose.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      The departure prompt rides along with the preferences read.

      It belongs here rather than on its own endpoint because the parent portal
      already fetches preferences, and a second request on every page load to ask
      "should I show a card" is a round-trip for a question whose answer is almost
      always no.
    */
    const prompt = await client.rpc('my_departure_prompt').maybeSingle()

    const { data, error } = await client
      .from('parents')
      .select(
        'id, full_name, email, phone_e164, preferred_contact, whatsapp_opted_in, marketing_opt_in, marketing_opt_in_at, photo_url',
      )
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!data) {
      /*
        A signed-in parent with no `parents` row has not been matched to a school's
        records yet. That is a real and common state — say what it means rather than
        returning an empty form that saves into nothing.
      */
      return ok({
        linked: false,
        message:
          'Your account is not linked to a school yet, so there are no contact preferences to set.',
      })
    }

    return ok({
      linked: true,
      fullName: data.full_name,
      /*
        The parent's OWN picture (`0265`). Theirs to set, unlike their child's, which
        the school sets and a parent sees without being able to change — a school's
        record of a pupil is the school's.
      */
      photoUrl: data.photo_url,
      email: data.email,
      phone: data.phone_e164,
      preferredContact: data.preferred_contact,
      serviceMessages: data.whatsapp_opted_in,
      marketing: data.marketing_opt_in,
      marketingChangedAt: data.marketing_opt_in_at,

      /*
        TRANSFER.md and PARENT_LINKING.md both describe this: asked once when a
        child leaves, never pre-ticked. A failure to resolve it must not fail the
        preferences page, so an error reads as "do not ask".
      */
      departurePrompt: prompt.error
        ? null
        : (() => {
            const row = prompt.data as {
              out_show: boolean
              out_student_name: string | null
              out_school_name: string | null
              out_status: string | null
            } | null
            return row?.out_show
              ? {
                  studentName: row.out_student_name,
                  schoolName: row.out_school_name,
                  status: row.out_status,
                }
              : null
          })(),
    })
  })
}

const schema = z.object({
  preferredContact: z.enum(['phone', 'email', 'whatsapp']).optional(),
  serviceMessages: z.boolean().optional(),
  marketing: z.boolean().optional(),
})

export async function PATCH(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const patch: Record<string, unknown> = {}
    if (parsed.data.preferredContact !== undefined) {
      patch['preferred_contact'] = parsed.data.preferredContact
    }
    if (parsed.data.serviceMessages !== undefined) {
      patch['whatsapp_opted_in'] = parsed.data.serviceMessages
    }
    if (parsed.data.marketing !== undefined) {
      patch['marketing_opt_in'] = parsed.data.marketing
    }

    if (Object.keys(patch).length === 0) {
      return fail('VALIDATION_ERROR', 'Nothing to change.')
    }

    /*
      No `.eq()` on the id.

      `parent_update_own_record` is `clerk_user_id = get_user_id()` in both USING and
      WITH CHECK, so the policy scopes this to exactly one row and a caller cannot give
      their record away. Adding a filter here would be a second copy of that rule, and
      the copy a direct PostgREST call skips.

      `marketing_opt_in_at` is NOT set here — a BEFORE trigger stamps it, so the
      evidence of consent cannot be forged by a client sending its own timestamp.
    */
    const { error } = await client.from('parents').update(patch)

    if (error) return fromPostgrestError(error)

    return ok({
      message:
        parsed.data.marketing === true
          ? 'Saved. You will now receive occasional news from AfriTech.'
          : parsed.data.marketing === false
            ? 'Saved. AfriTech will not send you promotional messages.'
            : 'Preferences saved.',
    })
  })
}

/**
 * Answers the departure prompt.
 *
 * Separate from PATCH because it is not a preference change — it is a one-time
 * question, and clicking Continue without ticking is an ANSWER. `answer_departure_prompt()`
 * stamps `marketing_prompted_at` either way so the card does not return, which a plain
 * preference update would not do.
 */
export async function PUT(request: Request): Promise<Response> {
  return guard(async () => {
    const body = await request.json().catch(() => null)
    const optIn = (body as { optIn?: unknown } | null)?.optIn === true

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { error } = await client.rpc('answer_departure_prompt', { p_opt_in: optIn })
    if (error) return fromPostgrestError(error)

    return ok({
      message: optIn
        ? 'Thank you. You will hear from AfriTech occasionally — no more than four messages a month.'
        : 'Noted. AfriTech will not send you anything.',
    })
  })
}
