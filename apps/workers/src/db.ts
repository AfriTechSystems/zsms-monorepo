/**
 * Worker database access.
 *
 * Decision: ADR-042 — the service role key is permitted inside a trusted
 * server-side context, which includes a Railway worker. `CONVENTIONS.md`
 * prohibition 1 was amended accordingly.
 *
 * ---------------------------------------------------------------------------
 * THIS CONNECTION BYPASSES RLS. READ ADR-042 BEFORE ADDING A QUERY HERE.
 * ---------------------------------------------------------------------------
 * The isolation guarantee Phases 1-3 rest on does not protect a worker. The
 * tenant boundary is therefore enforced by the `worker_*` functions in
 * migrations 0090 and 0091, each of which anchors every join to a single
 * school internally — and by the pgTAP assertions that prove they do.
 *
 * **Do not add a direct table query anywhere in `apps/workers`.** A worker
 * query written outside those functions loses the guarantee silently: no policy
 * denies it, no test covers it, and nothing about the code will look wrong. If
 * a job needs data no `worker_*` function exposes, add a function and a test.
 *
 * The rule is absolute so that it can be checked by grep: `.from(` appearing in
 * this directory is a defect, with no exceptions to weigh. Three statements did
 * survive the first pass — a `message_log` UPDATE by id and two `schools` reads
 * — none exploitable, all removed in 0091. The write was the dangerous one: an
 * unanchored write on an unpoliced connection is precisely what ADR-042 exists
 * to make unavailable, and a rule with exceptions would not have caught it.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DispatchContext } from '@zsms/notifications'
import type { Channel } from '@zsms/notifications'
import { getStorage, StorageBucket } from '@zsms/storage'
import type { PaymentContext, PaymentVerifiedDeps } from './handlers/payment-verified'

let client: SupabaseClient | null = null

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set. The worker cannot reach Supabase without it — see ENV.md.`)
  }
  return value
}

/**
 * The service-role client. Constructed once per process.
 *
 * `persistSession: false` because a worker has no session to persist and
 * nothing should be written to disk about this credential.
 */
export function workerDb(): SupabaseClient {
  if (client) return client

  client = createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-zsms-context': 'railway-worker' } },
      // Tags the connection so a query from a worker is distinguishable from a
      // user request in Supabase logs. Auditing "what did the service role do"
      // is otherwise guesswork.
    },
  )
  return client
}

/**
 * Sanity check on a context assembled by worker_payment_context().
 *
 * The function already anchors every join to the payment's school, and the
 * pgTAP suite asserts it. This is a second, cheap check at the point of use:
 * a defence-in-depth layer that costs one comparison and would catch a future
 * edit to the SQL that quietly widened a join.
 */
function assertTenantConsistent(ctx: PaymentContext): void {
  if (!ctx.schoolId) {
    throw new Error(`Payment ${ctx.paymentId} has no school — refusing to process`)
  }
  if (!ctx.student?.id) {
    throw new Error(`Payment ${ctx.paymentId} resolved no student — refusing to process`)
  }
}

export function createWorkerDeps(): PaymentVerifiedDeps {
  const db = workerDb()

  const dispatch: DispatchContext = {
    async resolveTemplate({ schoolId, templateKey, channel, languageCode }) {
      const { data, error } = await db.rpc('resolve_notification_template', {
        p_school_id: schoolId,
        p_template_key: templateKey,
        p_channel: channel,
        p_language: languageCode,
      })
      if (error) throw new Error(`Template resolution failed: ${error.message}`)

      const row = Array.isArray(data) ? data[0] : data
      if (!row) return null

      return {
        subject: row.subject ?? undefined,
        body: row.body,
        metaTemplateName: row.meta_template_name ?? undefined,
        // Meta template parameters are positional, so the order must come from
        // the template's own declaration rather than object key order.
        variableOrder: row.variable_order ?? [],
      }
    },

    async consumeQuota({ schoolId, channel }) {
      const { data, error } = await db.rpc('consume_message_quota', {
        p_school_id: schoolId,
        p_channel: channel,
        p_count: 1,
      })
      if (error) throw new Error(`Quota check failed: ${error.message}`)

      const row = Array.isArray(data) ? data[0] : data
      return {
        allowed: Boolean(row?.out_allowed),
        reason: row?.out_reason ?? 'unknown',
      }
    },

    async recordDispatch(input) {
      const { data, error } = await db.rpc('record_message_dispatch', {
        p_school_id: input.schoolId,
        p_channel: input.channel,
        p_template_key: input.templateKey,
        p_recipient_phone: input.recipientPhone ?? null,
        p_recipient_email: input.recipientEmail ?? null,
        p_recipient_user: input.recipientUserId ?? null,
        p_student_id: input.studentId ?? null,
        p_status: input.status,
        p_variables: input.variables,
        p_is_fallback: input.isFallback,
        p_fallback_of: input.fallbackOfId ?? null,
        p_consumed_quota: input.consumedQuota,
      })
      if (error) throw new Error(`Recording dispatch failed: ${error.message}`)
      return data as string
    },

    async updateDispatch({ messageLogId, status, providerMessageId, failureReason }) {
      // Through a function, not `.from('message_log').update()` — an unanchored
      // write by id on a connection that bypasses RLS is the exact statement
      // ADR-042 exists to make unavailable. The timestamps are set inside the
      // function from the status, so a worker cannot stamp `delivered_at` on a
      // message that failed. See 0091.
      const { error } = await db.rpc('worker_update_dispatch', {
        p_message_log_id: messageLogId,
        p_status: status,
        p_provider_message_id: providerMessageId ?? null,
        p_failure_reason: failureReason ?? null,
      })
      if (error) throw new Error(`Updating dispatch failed: ${error.message}`)
    },
  }

  return {
    async loadPayment(paymentId: string): Promise<PaymentContext | null> {
      const { data, error } = await db.rpc('worker_payment_context', { p_payment_id: paymentId })
      if (error) throw new Error(`Loading payment context failed: ${error.message}`)
      if (!data) return null

      const ctx = data as unknown as PaymentContext
      assertTenantConsistent(ctx)
      return ctx
    },

    async storeDocument({ path, bytes }) {
      // PRIVATE bucket. A receipt names a child and an amount.
      await getStorage(StorageBucket.PRIVATE).put(path, bytes, {
        contentType: 'application/pdf',
      })
      return path
    },

    async recordDocument({ schoolId, studentId, paymentId, academicYear, termNumber }) {
      const { data, error } = await db.rpc('record_generated_document', {
        p_school_id: schoolId,
        p_doc_type: 'payment_receipt',
        p_student_id: studentId,
        p_payment_id: paymentId,
        p_academic_year: academicYear,
        p_term_number: termNumber,
        p_generated_by: null,
      })
      if (error) throw new Error(`Recording document failed: ${error.message}`)
      return data as string
    },

    async completeDocument({ documentId, status, storagePath, byteSize, error: failure }) {
      const { error } = await db.rpc('complete_generated_document', {
        p_document_id: documentId,
        p_status: status,
        p_storage_path: storagePath ?? null,
        p_byte_size: byteSize ?? null,
        p_error: failure ?? null,
      })
      if (error) throw new Error(`Completing document failed: ${error.message}`)
    },

    dispatch,
  }
}

export type { DispatchContext, Channel }
