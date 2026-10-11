# REMINDERS.md — Automated Fee Reminders

## Related Documents

- `docs/modules/fees/PAYMENTS.md` — payment status that affects reminder suppression
- `docs/modules/fees/FEE_STRUCTURES.md` — due_date set when fee records are generated
- `docs/modules/fees/AUDIT.md` — reminder events in the audit trail
- `docs/infra/QSTASH.md` — cron job that runs daily reminder check
- `docs/infra/META_API.md` — WhatsApp quota consumed by reminders
- `docs/modules/communication/MESSAGE_LOG.md` — reminder delivery tracking
- `docs/DATABASE.md` — fee_records reminder fields

---

## Implementation Status (2026-10-11)

**Now configurable per school (`0251`), and the worker reads it (`0252`).**

Until this date the schedule was two constants in
`apps/workers/src/handlers/fee-reminders.ts` — `?? 3` and `?? 7`. Nothing passed those
options, so the defaults *were* the behaviour for every school, and they did not match the
7/14/30 this document specifies.

`school_fee_reminder_settings` holds the rungs (an array, because the list below is a set a
school ticks), the three channels separately, the cooldown, and an off switch that keeps
the schedule. An unconfigured school gets this document's defaults rather than a handler's.

**One deliberate deviation from the rule below, and the reason matters.** This document
specifies **exact day matching** and reasons that it prevents duplicate reminders. It does
— but it also means that if the cron does not run on day 7, **no 7-day reminder is ever
sent**: the condition is false on day 6 and false again on day 8. The duplicate it guards
against is already handled by the `last_reminder_at` cooldown; the failure it introduces
has no other guard and is silent, because a message that never arrives is not an error
anybody sees.

So `0252` counts rungs: send when the number of configured thresholds the arrears have
**passed** exceeds the number of reminders actually **received**. That is the same cadence,
robust to a missed run, and it cannot over-send — at day 30 only three rungs have been
crossed, so a fourth reminder is arithmetically impossible.

Screen: Settings → Fee reminders, gated on `fees:write` so the accountant reaches it.

**Still blocked:** delivery. No Meta, Twilio or Resend credentials, so every channel runs
through the mock provider. The schedule is correct and no parent has received anything.

---

## Purpose

This document defines the automated fee reminder system — how the daily scheduler identifies overdue fee records, how reminders are dispatched, how reminder suppression works, and how the escalation logic flags persistent non-payers. Every Claude Code session building reminder scheduling or notification features must read this document.

---

## Overview

Chasing fee payments is one of the most time-consuming tasks for school accountants. ZSMS automates this by running a daily check that finds fee records past their due date and dispatching reminder messages to the primary parent contact. The system is designed to be helpful rather than aggressive — reminders are sent at deliberate intervals, suppressed when the accountant is actively engaging with the parent, and paused once a payment is submitted (even before it is verified).

---

## Reminder Schedule

The daily queue cron job runs at 06:00 UTC (08:00 Lusaka time) and processes all active schools simultaneously. For each school, it finds fee records matching the reminder criteria.

### Reminder Trigger Points

A reminder is sent when `CURRENT_DATE - due_date` equals exactly:

| Days Overdue | Reminder Type | Template Used |
|---|---|---|
| 7 days | First reminder | `fee_overdue_reminder` |
| 14 days | Second reminder | `fee_overdue_reminder` |
| 30 days | Final reminder | `fee_overdue_final` |

**Why exact day matching instead of "7 or more days":**
Exact matching prevents a fee record from receiving multiple reminders if the system was offline for a day or the due date calculation changes. Each fee record receives at most one reminder per trigger point.

### Eligibility Criteria

A fee record qualifies for a reminder if ALL of the following are true:

```sql
WHERE status IN ('unpaid', 'partial')
  AND is_deleted = FALSE
  AND due_date IS NOT NULL
  AND due_date < CURRENT_DATE  -- Past due date
  AND CURRENT_DATE - due_date IN (7, 14, 30)  -- Exact trigger point
  AND (
    -- Has not already received this reminder
    last_reminder_at IS NULL
    OR CURRENT_DATE - last_reminder_at::date >= 7
  )
```

### Reminder Suppression

Reminders are **NOT sent** when any of the following conditions apply:

| Condition | Why Suppressed |
|---|---|
| `payments.status = 'pending_verification'` | Parent has submitted a payment — awaiting review. Sending a reminder would be confusing and unfair. |
| `payments.status = 'queried'` | Accountant is actively engaging with the parent. Reminder would interfere. |
| `fee_records.status = 'paid'` | Fee is settled — no reminder needed. |
| `fee_records.status = 'waived'` | Fee has been waived — no reminder needed. |
| `fee_records.status = 'loan_paid'` | Loan covered the fee — no reminder needed. |
| `parents.whatsapp_opted_in = FALSE` | Parent has opted out of WhatsApp messages. Email fallback only. |
| School WhatsApp quota = 0 | School has exhausted their WhatsApp allowance. Email fallback only. |

**Pending payment suppression detail:**
The suppression check looks at any payment for this fee record with `status IN ('pending_verification', 'queried')`. If any such payment exists — even if it was submitted hours ago — the reminder is suppressed. This prevents the embarrassing situation where a parent submits a payment and immediately receives an overdue reminder.

---

## Reminder Message Content

### WhatsApp Template: `fee_overdue_reminder` (7 and 14 days)

```
💳 Fee Reminder — Sunrise Academy

Hi [Parent Name],

[Student Name]'s Tuition Fee for Term 2 is overdue.

Outstanding: K2,500.00
Due date was: 1 September 2026

You can pay online or submit proof of payment at:
zsms.co.zm/portal/fees

If you've already paid, please ignore this message.
Contact the school for payment arrangements.
```

### WhatsApp Template: `fee_overdue_final` (30 days)

```
⚠️ Important — Outstanding Fees · Sunrise Academy

[Student Name]'s fees are 30 days overdue.

Outstanding: K2,500.00 (Tuition Fee, Term 2)

Please contact the school immediately to arrange payment
or discuss a payment plan.

📞 Contact school: zsms.co.zm/schools/ZM-LSK-0001
💳 Pay online: zsms.co.zm/portal/fees
```

### Email Fallback

When WhatsApp is not available (opted out or quota exhausted), an email is sent via Resend. The email uses the same content as the WhatsApp template but formatted as HTML email. No additional quota is consumed for email reminders.

### In-App Notification (Always)

Regardless of WhatsApp or email delivery, an in-app notification is created in the parent's portal for every reminder. This is always free and does not depend on any quota or delivery channel.

---

## Reminder Processing Flow

```typescript
// schedule-reminders Edge Function
async function processReminders(schoolId: string, today: Date) {
  // 1. Find eligible fee records
  const eligibleRecords = await findEligibleFeeRecords(schoolId, today)

  for (const record of eligibleRecords) {
    // 2. Check suppression conditions
    const hasPendingPayment = await checkPendingPayment(record.id)
    if (hasPendingPayment) continue

    // 3. Determine reminder type based on days overdue
    const daysOverdue = differenceInDays(today, new Date(record.due_date))
    const templateId = daysOverdue === 30
      ? 'fee_overdue_final'
      : 'fee_overdue_reminder'

    // 4. Check WhatsApp quota
    const quotaAvailable = await checkAndDeductQuota(schoolId, 1)

    // 5. Queue message job
    if (quotaAvailable) {
      await enqueueJob('send-whatsapp', {
        recipient_phone: record.parent_primary_phone,
        template_id: templateId,
        variables: [
          record.parent_name,
          record.student_name,
          record.fee_label,
          record.term_label,
          formatCurrency(record.amount_due - record.amount_paid, 'ZMW'),
          formatDate(record.due_date),
          `zsms.co.zm/portal/fees`,
        ],
        school_id: schoolId,
        student_id: record.student_id,
        fallback_to_email: true,
      })
    } else {
      // Fallback to email if quota exhausted
      await enqueueJob('send-email', {
        template: templateId,
        recipient_email: record.parent_email,
        school_id: schoolId,
        student_id: record.student_id,
        data: { ...record }
      })
    }

    // 6. Update fee_record reminder tracking
    await supabase
      .from('fee_records')
      .update({
        last_reminder_at: today.toISOString(),
        reminder_count: record.reminder_count + 1,
      })
      .eq('id', record.id)

    // 7. Create in-app notification for parent
    await createInAppNotification(record.parent_user_id, {
      type: 'fee_reminder',
      message: `Fee reminder: ${record.student_name}'s ${record.fee_label} is overdue`,
      action_url: '/portal/fees',
    })

    // 8. Log to message_log
    await logMessage(schoolId, record.student_id, templateId, 'queued')
  }
}
```

---

## Escalation Logic

After the final 30-day reminder, if the fee remains unpaid, the accountant sees a persistent flag on that student's fee record in the dashboard:

**"Follow-up required" flag:**
- Appears after `reminder_count >= 3` and fee is still unpaid/partial
- Shown in the fee dashboard as a red flag icon
- The accountant sees a summary: "5 students require follow-up on overdue fees"
- Clicking the summary shows the list of flagged students with contact details

The system does not automatically take further action after 30 days — escalation beyond the automated reminders is a human decision by the accountant or principal.

---

## School Configuration for Reminders

Schools can configure reminder behaviour in Settings → Fees → Reminder Settings:

**Reminder channels:**
```
Send reminders via:
☑ WhatsApp (uses monthly quota)
☑ Email (free — when email available)
☑ In-app notification (always free)
```

**Reminder timing:**
```
Send reminders at:
☑ 7 days overdue
☑ 14 days overdue
☑ 30 days overdue
☐ 3 days overdue (optional — earlier reminder)
☐ 60 days overdue (optional — final escalation)
```

**Custom due dates:**
Schools can set a school-wide payment due date (e.g. "fees due by the 15th of each term's first month") which is applied to all fee records when they are generated. Individual fee records can have their due date overridden by the accountant.

---

## Reminder Audit Trail

Every reminder dispatch is logged:

| Event | Logged In |
|---|---|
| Reminder queued | `public.message_log` with `template_id`, `status: 'queued'` |
| WhatsApp delivered | `public.message_log` updated — `status: 'delivered'` |
| WhatsApp failed | `public.message_log` updated — `status: 'failed'`, email fallback triggered |
| Email sent | `public.message_log` — new row with `channel: 'email'` |
| fee_record updated | `fee_records.last_reminder_at`, `reminder_count` updated |

The school's communication log (Fees → Communication Log) shows all reminders sent, their delivery status, and which fee they related to. This gives accountants visibility into which parents have been contacted and whether messages were delivered.

---

## Business Rules

1. Reminders are sent at 7, 14, and 30 days past the `due_date` only. Not at "7 or more days" — exact trigger points prevent duplicate reminders from scheduling issues.
2. Reminders are suppressed for fee records with any payment in `pending_verification` or `queried` status. The parent has engaged — do not send a reminder.
3. After the 30-day reminder, no further automated reminders are sent. The accountant handles escalation manually.
4. WhatsApp reminders consume the school's monthly quota. When quota is exhausted, the system falls back to email automatically — no interruption to the reminder schedule.
5. Each reminder trigger point updates `fee_records.last_reminder_at` and increments `reminder_count`. These fields are used to prevent duplicate reminders and to power the escalation flag.
6. The reminder cron job runs school by school — a failure processing one school does not affect other schools.
7. Reminders are only sent to the primary contact (`student_parent_links.is_primary = TRUE`). Non-primary guardians do not receive automated reminders.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 9 fee module documentation |
| 2026-04-26 | Added pending payment suppression | Critical UX — do not remind parent who already submitted |
| 2026-04-26 | Added queried status suppression | Accountant actively working with parent |
| 2026-04-26 | WhatsApp quota fallback to email | Portal-first model — email is free fallback channel |
| 2026-04-26 | Added escalation flag after 30-day reminder | Accountants need to know which cases need manual follow-up |
