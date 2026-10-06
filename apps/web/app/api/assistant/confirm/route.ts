/**
 * POST /api/assistant/confirm — perform a write the user has confirmed.
 *
 * Spec: `Official Documentation/18 AI Module/AI_ASSISTANT.md` → *Write and CRUD
 *       operations — always approval-gated*, business rules 7 and 11.
 *
 * ## This is the ONLY place an assistant write happens
 *
 * `/api/assistant` prepares and stops. This endpoint performs — and it will only perform
 * an action that is already stored on a message row, in a conversation belonging to the
 * caller, that has not been acted on before.
 *
 * That matters more than it looks. If the action travelled in the request body, a caller
 * could confirm something nobody previewed: the preview would show one change and the
 * confirmation carry another, which is precisely the failure the approval gate exists to
 * prevent. **The confirmation names a message; the message holds the action.**
 *
 * ## It is still the user who writes
 *
 * The write goes through the caller's own client and the same policies as the register
 * screen. The assistant holds no elevated capability and no service role — business rule
 * 8 — so a teacher confirming an action for a pupil they do not teach is refused by RLS
 * exactly as the screen would refuse it.
 *
 * ## Replay is refused
 *
 * `acted_at` is set in the same statement that claims the row, so two taps on Confirm
 * cannot mark a pupil absent twice or send one notice twice.
 */

import { z } from 'zod'

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const schema = z.object({
  messageId: z.string().uuid(),
})

interface AttendanceChange {
  studentId: string
  name: string
  from: string
  to: string
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return fail('VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid request.')
    }

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    /*
      Claim the message FIRST, and only if it has not been acted on.

      `.is('acted_at', null)` in the update is what makes a double tap safe: the second
      one matches no row and gets the CONFLICT below, rather than performing the write
      again. Checking and then updating would leave a window between the two.
    */
    const claim = await client
      .from('ai_messages')
      .update({ acted_at: new Date().toISOString() })
      .eq('id', parsed.data.messageId)
      .is('acted_at', null)
      .not('pending_action', 'is', null)
      .select('id, conversation_id, content, pending_action')
      .maybeSingle()

    if (claim.error) return fromPostgrestError(claim.error)

    if (!claim.data) {
      /*
        Already done, never prepared, or not the caller's — one answer.

        Distinguishing them would tell a caller that somebody else's message exists.
      */
      return fail(
        'CONFLICT',
        'That action is no longer waiting for confirmation. It may already have been done.',
      )
    }

    const action = claim.data.pending_action as Record<string, unknown> | null
    const kind = String(action?.['kind'] ?? '')

    /*
      Business rule 11: the audit row carries the utterance.

      Written BEFORE the attempt, so an action that fails halfway is still recorded as
      having been asked for and confirmed — which is the sequence an auditor needs.
    */
    await client
      .rpc('log_audit_event', {
        p_action: `assistant_confirmed_${kind}`,
        p_table_name: 'ai_messages',
        p_record_id: null,
        p_metadata: {
          kind,
          action,
          message_id: parsed.data.messageId,
          conversation_id: claim.data.conversation_id,
        },
        p_school_id: null,
        p_ip_address: null,
        p_user_agent: null,
      })
      .then(
        () => undefined,
        (err: unknown) => console.error('[assistant] confirm audit failed', err),
      )

    if (kind === 'record_attendance') {
      const changes = (action?.['changes'] ?? []) as AttendanceChange[]
      const date = String(action?.['date'] ?? '')
      const classId = String(action?.['classId'] ?? '')
      const academicYear = action?.['academicYear']
      const termNumber = action?.['termNumber']

      if (changes.length === 0 || !date || !classId || !academicYear || !termNumber) {
        return fail(
          'VALIDATION_ERROR',
          'That action is missing something it needs. Ask again and I will prepare it afresh.',
        )
      }

      const { data: school } = await client.from('schools').select('id').limit(1).maybeSingle()
      if (!school) return fail('FORBIDDEN', 'No school is available to this session.')

      // Who is marking it. NOT NULL on the table, and the person a parent will be told
      // about if they query the mark.
      const who = await client.rpc('get_user_id')
      const userId = (who.data as string | null) ?? null
      if (!userId) return fail('UNAUTHORIZED', 'Could not identify you.')

      /*
        The same upsert the register screen performs, through the same policies.

        Not a call to that route: a server-to-server request would need the caller's
        token forwarded, and the authorisation it would apply is this same RLS. The
        statement is duplicated; the RULE is not.
      */
      const { error } = await client.from('attendance_records').upsert(
        changes.map((c) => ({
          school_id: school.id,
          student_id: c.studentId,
          class_id: classId,
          attendance_date: date,
          academic_year: String(academicYear),
          term_number: Number(termNumber),
          status: c.to,
          recorded_by_user_id: userId,
          /*
            `academic_year` comes from the DATE being marked, matching the register
            screen — a register backfilled in January for December belongs to December's
            year, not to the year somebody happens to be typing in.
          */
          /*
            `web`, because the CHECK admits only web, mobile_online and mobile_offline.

            Adding an `assistant` value would be a migration on a column PowerSync reads
            to decide conflict resolution, and the assistant IS the web app — a mark made
            through it came from the same place by the same person. The audit row
            records that the assistant prepared it.
          */
          sync_source: 'web',
        })),
        // The real unique constraint is (school_id, student_id, attendance_date). Naming
        // only two of the three would upsert against an index that does not exist.
        { onConflict: 'school_id,student_id,attendance_date' },
      )

      if (error) {
        /*
          Undo the claim, so a refused write can be confirmed again once the cause is
          fixed. Leaving it claimed would strand the action.
        */
        await client
          .from('ai_messages')
          .update({ acted_at: null })
          .eq('id', parsed.data.messageId)

        if (error.code === '42501') {
          return fail('FORBIDDEN', 'You cannot mark attendance for that pupil.')
        }
        return fromPostgrestError(error)
      }

      return ok({
        done: true,
        message:
          changes.length === 1
            ? `${changes[0]?.name} marked ${changes[0]?.to}.`
            : `${changes.length} pupils updated.`,
      })
    }

    /*
      An announcement is not sent from here.

      It carries a channel choice, a schedule and an audience that a one-line utterance
      cannot express, so confirming it opens the composer rather than sending something
      the user never saw in full. The claim is released, because nothing was performed.
    */
    if (kind === 'create_announcement') {
      await client
        .from('ai_messages')
        .update({ acted_at: null })
        .eq('id', parsed.data.messageId)

      return ok({
        done: false,
        route: String(action?.['route'] ?? '/'),
        message: 'Opening the announcement composer.',
      })
    }

    await client
      .from('ai_messages')
      .update({ acted_at: null })
      .eq('id', parsed.data.messageId)

    return fail('VALIDATION_ERROR', 'I do not know how to carry out that action.')
  })
}
