/**
 * Phase 3 gate harness — a verified payment produces a receipt, a WhatsApp
 * message, and an email.
 *
 * Run: npx tsx supabase/tests/e2e/payment-verified-e2e.ts
 *
 * WHAT THIS PROVES
 * ----------------
 * The real `handlePaymentVerified` handler, the real pdf-lib renderer, and the
 * real `sendWithFallback` chain. Not reimplementations — the same modules the
 * worker calls.
 *
 * WHAT IT DOES NOT PROVE
 * ----------------------
 *  - The BullMQ→Redis transport. No Redis is available on this machine, so the
 *    handler is invoked directly rather than pulled off a queue. `worker.ts` is
 *    a thin adapter over exactly this call, but "thin" is an assertion until a
 *    Redis instance exists to demonstrate it.
 *  - Real provider delivery. No Meta, Resend, or Twilio credentials exist, so
 *    channels run through the mock provider. Nothing is sent to a real phone or
 *    inbox — which is also correct for zsms-dev, whose fixtures carry synthetic
 *    but real-shaped phone numbers.
 *  - Database writes. The dependency adapters below record calls in memory. The
 *    database half is proven separately against zsms-dev by the pgTAP suite.
 *
 * The gap is the transport and the providers, not the logic.
 */

import { handlePaymentVerified, type PaymentContext } from '../../../apps/workers/src/handlers/payment-verified'
import type { DispatchContext } from '../../../packages/notifications/src/index'
import { mockSentMessages, resetMockMessages } from '../../../packages/notifications/src/providers/mock'

process.env['NOTIFICATION_PROVIDER'] = 'mock'

let failures = 0
let checks = 0

function check(label: string, condition: boolean, detail?: string): void {
  checks += 1
  if (condition) {
    console.log(`  ok ${checks} - ${label}`)
  } else {
    failures += 1
    console.log(`  not ok ${checks} - ${label}${detail ? `\n      ${detail}` : ''}`)
  }
}

// --- fixture -----------------------------------------------------------------

const PAYMENT: PaymentContext = {
  paymentId: '99999999-0000-0000-0000-000000000001',
  schoolId: '11111111-1111-1111-1111-111111111111',
  school: { name: 'Alpha Academy', schoolCode: 'ZM-LSK-0001', address: 'Great East Road, Lusaka' },
  receiptNumber: 'REC-ZM-LSK-0001-000001',
  paidAt: '2026-08-15 09:14',
  amount: '500.00',
  currency: 'ZMW',
  paymentMethod: 'bank_deposit',
  recordedBy: 'user_parent_a',
  verifiedBy: 'user_acct_a',
  student: { id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Alice Alpha', code: 'STU-ZM-LSK-0001-00001' },
  fee: {
    label: 'Tuition Fee',
    academicYear: '2026',
    termNumber: 1,
    amountPaidToDate: '500.00',
    outstanding: '1000.00',
  },
  parent: {
    userId: 'user_parent_a',
    name: 'Parent Alpha',
    phoneE164: '+260977000001',
    email: 'parent.alpha@example.test',
  },
}

// --- in-memory adapters ------------------------------------------------------

interface Recorded {
  documents: Array<{ id: string; status: string; path?: string; bytes?: number }>
  dispatches: Array<{ id: string; channel: string; status: string; templateKey: string; quota: boolean }>
  quotaCalls: Array<{ channel: string }>
}

function makeDeps(recorded: Recorded, opts: { quotaAllows?: (c: string) => boolean } = {}) {
  let docSeq = 0
  let logSeq = 0

  const dispatch: DispatchContext = {
    async resolveTemplate({ channel, templateKey }) {
      // Mirrors what 0085 seeds. Returning null for an unseeded channel is what
      // makes the chain skip rather than send an empty message.
      const bodies: Record<string, { subject?: string; body: string; order: string[] }> = {
        whatsapp: {
          body: 'Dear {{parent_name}}, we have received {{currency}} {{amount}} for {{student_name}}. Receipt {{receipt_number}}. Outstanding balance: {{currency}} {{outstanding}}. Thank you — {{school_name}}.',
          order: ['parent_name', 'currency', 'amount', 'student_name', 'receipt_number', 'outstanding', 'school_name'],
        },
        email: {
          subject: 'Payment received — {{student_name}} ({{receipt_number}})',
          body: 'Dear {{parent_name}},\n\nWe have received a payment of {{currency}} {{amount}} for {{student_name}}.\n\nReceipt number: {{receipt_number}}\nOutstanding balance: {{currency}} {{outstanding}}\n\n{{school_name}}',
          order: ['parent_name', 'currency', 'amount', 'student_name', 'receipt_number', 'outstanding', 'school_name'],
        },
        sms: {
          body: '{{school_name}}: Received {{currency}} {{amount}} for {{student_name}}. Receipt {{receipt_number}}.',
          order: ['school_name', 'currency', 'amount', 'student_name', 'receipt_number'],
        },
      }
      const t = bodies[channel]
      if (!t || templateKey !== 'fee_payment_confirmed') return null
      return { subject: t.subject, body: t.body, variableOrder: t.order }
    },

    async consumeQuota({ channel }) {
      recorded.quotaCalls.push({ channel })
      const allowed = opts.quotaAllows ? opts.quotaAllows(channel) : true
      return { allowed, reason: allowed ? 'ok' : 'quota_exceeded' }
    },

    async recordDispatch(input) {
      logSeq += 1
      const id = `log_${logSeq}`
      recorded.dispatches.push({
        id,
        channel: input.channel,
        status: input.status,
        templateKey: input.templateKey,
        quota: input.consumedQuota,
      })
      return id
    },

    async updateDispatch({ messageLogId, status }) {
      const row = recorded.dispatches.find((d) => d.id === messageLogId)
      if (row) row.status = status
    },
  }

  return {
    async loadPayment() {
      return PAYMENT
    },
    async storeDocument({ path }: { path: string }) {
      return path
    },
    async recordDocument() {
      docSeq += 1
      const id = `doc_${docSeq}`
      recorded.documents.push({ id, status: 'pending' })
      return id
    },
    async completeDocument({ documentId, status, storagePath, byteSize }: {
      documentId: string; status: 'ready' | 'failed'; storagePath?: string; byteSize?: number
    }) {
      const d = recorded.documents.find((x) => x.id === documentId)
      if (d) {
        d.status = status
        d.path = storagePath
        d.bytes = byteSize
      }
    },
    dispatch,
  }
}

// --- scenarios ---------------------------------------------------------------

async function scenarioHappyPath(): Promise<void> {
  console.log('\n# Scenario 1 — verified payment, WhatsApp reachable')
  resetMockMessages()
  delete process.env['NOTIFICATION_MOCK_FAIL']

  const recorded: Recorded = { documents: [], dispatches: [], quotaCalls: [] }
  const result = await handlePaymentVerified(PAYMENT.paymentId, makeDeps(recorded))

  const doc = recorded.documents[0]
  check('a receipt document row is created and completed', doc?.status === 'ready')
  check('the receipt is a real PDF of non-trivial size', (doc?.bytes ?? 0) > 800, `bytes=${doc?.bytes}`)
  check(
    'the receipt is stored under the school-scoped private path',
    doc?.path === 'ZM-LSK-0001/receipts/2026/REC-ZM-LSK-0001-000001.pdf',
    `path=${doc?.path}`,
  )

  check('delivery is via WhatsApp — the first channel in the chain', result.deliveredVia === 'whatsapp')
  check('exactly one message_log row is written', result.messageLogIds.length === 1)
  check('quota was consumed for WhatsApp', recorded.dispatches[0]?.quota === true)
  check('the log row ends in status sent', recorded.dispatches[0]?.status === 'sent')

  const sent = mockSentMessages()
  check('one message was dispatched', sent.length === 1)
  check(
    'the rendered body carries the receipt number and amount',
    Boolean(sent[0]?.body.includes('REC-ZM-LSK-0001-000001') && sent[0]?.body.includes('500.00')),
  )
  check(
    'no unresolved placeholders remain in the body',
    !/\{\{\w+\}\}/.test(sent[0]?.body ?? ''),
    sent[0]?.body,
  )
}

async function scenarioFallbackToEmail(): Promise<void> {
  console.log('\n# Scenario 2 — WhatsApp fails, chain falls through to email')
  resetMockMessages()
  process.env['NOTIFICATION_MOCK_FAIL'] = 'whatsapp'

  const recorded: Recorded = { documents: [], dispatches: [], quotaCalls: [] }
  const result = await handlePaymentVerified(PAYMENT.paymentId, makeDeps(recorded))

  check('delivery falls through to email', result.deliveredVia === 'email')
  check('two message_log rows are written — the attempt and the fallback', result.messageLogIds.length === 2)
  check('the WhatsApp attempt is recorded as failed', recorded.dispatches[0]?.status === 'failed')
  check('the email attempt is recorded as sent', recorded.dispatches[1]?.status === 'sent')

  const sent = mockSentMessages()
  check('only the email actually dispatched', sent.length === 1 && sent[0]?.channel === 'email')
  check('the email carries a rendered subject', Boolean(sent[0]?.subject?.includes('Alice Alpha')))
  check(
    'SMS was NOT reached — email succeeded, so the last resort stays unused',
    !sent.some((m) => m.channel === 'sms'),
  )
}

async function scenarioQuotaExhausted(): Promise<void> {
  console.log('\n# Scenario 3 — WhatsApp quota exhausted, email still delivers')
  resetMockMessages()
  delete process.env['NOTIFICATION_MOCK_FAIL']

  const recorded: Recorded = { documents: [], dispatches: [], quotaCalls: [] }
  const result = await handlePaymentVerified(
    PAYMENT.paymentId,
    makeDeps(recorded, { quotaAllows: (c) => c !== 'whatsapp' }),
  )

  check('a quota refusal is logged against WhatsApp', recorded.dispatches[0]?.status === 'quota_exceeded')
  check('the refused attempt consumed no quota', recorded.dispatches[0]?.quota === false)
  check('delivery still reaches the parent by email', result.deliveredVia === 'email')
  check(
    'no WhatsApp message was dispatched despite the template existing',
    !mockSentMessages().some((m) => m.channel === 'whatsapp'),
  )
}

async function scenarioAllChannelsFail(): Promise<void> {
  console.log('\n# Scenario 4 — every channel fails')
  resetMockMessages()
  process.env['NOTIFICATION_MOCK_FAIL'] = 'whatsapp,email,sms'

  const recorded: Recorded = { documents: [], dispatches: [], quotaCalls: [] }
  const result = await handlePaymentVerified(PAYMENT.paymentId, makeDeps(recorded))

  check('deliveredVia is null when the chain is exhausted', result.deliveredVia === null)
  check('all three attempts are logged', result.messageLogIds.length === 3)
  check('nothing was dispatched', mockSentMessages().length === 0)
  // The receipt must still exist. A parent who cannot be reached has still paid,
  // and the school still needs the document on file.
  check('the receipt was still generated despite total delivery failure', recorded.documents[0]?.status === 'ready')
}

async function scenarioNoParent(): Promise<void> {
  console.log('\n# Scenario 5 — student has no linked guardian')
  resetMockMessages()
  delete process.env['NOTIFICATION_MOCK_FAIL']

  const recorded: Recorded = { documents: [], dispatches: [], quotaCalls: [] }
  const deps = makeDeps(recorded)
  const original = deps.loadPayment
  deps.loadPayment = async () => ({ ...(await original()), parent: null })

  const result = await handlePaymentVerified(PAYMENT.paymentId, deps)

  check('the receipt is generated', recorded.documents[0]?.status === 'ready')
  check('notification is skipped with a reason, not an error', result.skippedNotification === 'no_linked_parent')
  check('no message is dispatched', mockSentMessages().length === 0)
}

async function main(): Promise<void> {
  console.log('ZSMS Phase 3 gate — payment-verified end to end')
  await scenarioHappyPath()
  await scenarioFallbackToEmail()
  await scenarioQuotaExhausted()
  await scenarioAllChannelsFail()
  await scenarioNoParent()

  console.log(`\n1..${checks}`)
  if (failures > 0) {
    console.log(`# FAILED ${failures} of ${checks}`)
    process.exitCode = 1
  } else {
    console.log(`# All ${checks} checks passed`)
  }
}

void main()
