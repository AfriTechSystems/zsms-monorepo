# MESSAGE_LOG.md — Message Log

## Related Documents

- `docs/modules/communication/WHATSAPP.md` — WhatsApp messages logged here
- `docs/modules/communication/SMS.md` — SMS fallback messages logged here
- `docs/modules/communication/ANNOUNCEMENTS.md` — announcement delivery tracked here
- `docs/modules/communication/CHATBOT.md` — chatbot interactions logged here
- `docs/infra/META_API.md` — delivery status webhooks that update log
- `docs/DATABASE.md` — message_log table full schema
- `docs/RLS.md` — message log access policies

---

## Purpose

This document defines the message log — the append-only record of every outbound message sent from ZSMS. Covers what is stored, how delivery status updates work, how the log is queried by school admins, and retention policy. Every Claude Code session writing any message dispatch code must ensure a message_log row is created.

---

## Overview

The message log is the single source of truth for all communication that ZSMS has sent. It answers: "Did the parent receive this message? When? Was it read?" It is used by accountants investigating payment queries, admins checking announcement reach, AfriTech support investigating delivery failures, and the quota tracking system counting messages per billing period.

---

## Message Log Schema

```sql
CREATE TABLE public.message_log (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id           UUID REFERENCES public.schools(id),
  -- NULL for AfriTech platform messages (alumni marketing, platform announcements)

  recipient_phone     TEXT NOT NULL,
  recipient_user_id   TEXT,
  -- Clerk user ID — NULL if parent not yet registered

  student_id          UUID REFERENCES public.students(id),
  -- NULL for staff messages, platform announcements

  channel             TEXT NOT NULL
                      CHECK (channel IN ('whatsapp', 'sms', 'email', 'push', 'in_app')),

  template_id         TEXT NOT NULL,
  -- Template name: 'fee_payment_confirmed', 'absence_alert',
  -- 'monthly_attendance_summary', 'school_announcement', etc.
  -- For chatbot responses: 'chatbot_fees', 'chatbot_results', etc.

  message_body        TEXT,
  -- Stored for SMS and chatbot (free-form). NULL for WhatsApp templates
  -- (body is derivable from template + variables)

  variables           JSONB,
  -- Template variables used — for audit and debugging

  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN (
                        'queued', 'sent', 'delivered', 'read',
                        'failed', 'fallback_sent', 'quota_exceeded',
                        'opted_out', 'bounced'
                      )),

  provider_message_id TEXT,
  -- Meta wamid, Twilio SID, Resend message ID, Expo push ticket ID

  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  read_at             TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,
  failure_reason      TEXT,

  retry_count         INT DEFAULT 0,
  is_fallback         BOOLEAN DEFAULT FALSE,
  -- TRUE when this is a fallback (e.g. SMS after WhatsApp failed)
  fallback_of_log_id  UUID REFERENCES public.message_log(id),
  -- Points to the original failed message log entry

  -- Announcement tracking
  announcement_id     UUID REFERENCES public.announcements(id),
  -- Set when message relates to an announcement

  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common query patterns
CREATE INDEX idx_message_log_school ON public.message_log(school_id, created_at DESC);
CREATE INDEX idx_message_log_student ON public.message_log(student_id) WHERE student_id IS NOT NULL;
CREATE INDEX idx_message_log_recipient ON public.message_log(recipient_user_id) WHERE recipient_user_id IS NOT NULL;
CREATE INDEX idx_message_log_provider ON public.message_log(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX idx_message_log_status ON public.message_log(school_id, status, created_at DESC);
CREATE INDEX idx_message_log_quota ON public.message_log(school_id, channel, created_at)
  WHERE channel = 'whatsapp';
-- Quota tracking index — only WhatsApp counted against quota
```

---

## Status Lifecycle

```
queued
  ↓ (job picked up by send-whatsapp Edge Function)
sent         ← Message accepted by Meta/Twilio/Resend
  ↓ (delivery webhook from Meta)
delivered    ← Message delivered to device
  ↓ (read webhook from Meta)
read         ← Parent opened the message

OR:

queued → failed      ← Provider rejected (invalid number, template error)
queued → opted_out   ← Parent has whatsapp_opted_in = FALSE
queued → quota_exceeded ← School quota at zero
sent   → bounced     ← Email hard bounce (Resend)
failed → fallback_sent ← SMS fallback was triggered
```

---

## Creating a Log Entry

Every message dispatch creates a log entry before the queued job is enqueued:

```typescript
// Always create the log entry first — before any dispatch
async function createMessageLogEntry(params: {
  schoolId: string | null,
  recipientPhone: string,
  recipientUserId?: string,
  studentId?: string,
  channel: 'whatsapp' | 'sms' | 'email' | 'push' | 'in_app',
  templateId: string,
  variables?: Record<string, string>,
  announcementId?: string,
}): Promise<string> {
  const { data } = await supabaseAdmin
    .from('message_log')
    .insert({
      school_id: params.schoolId,
      recipient_phone: params.recipientPhone,
      recipient_user_id: params.recipientUserId,
      student_id: params.studentId,
      channel: params.channel,
      template_id: params.templateId,
      variables: params.variables,
      announcement_id: params.announcementId,
      status: 'queued',
    })
    .select('id')
    .single()

  return data.id  // Pass this ID to the queued job payload
}
```

The `message_log_id` is always included in the queued job payload so the Edge Function can update the log entry with the provider message ID and status.

---

## Updating Status from Delivery Webhooks

When Meta sends a delivery status update for a WhatsApp message:

```typescript
// In webhook-whatsapp Edge Function — delivery status handler
async function handleDeliveryStatus(status: MetaStatusUpdate) {
  const { data: logEntry } = await supabaseAdmin
    .from('message_log')
    .select('id')
    .eq('provider_message_id', status.id)
    .single()

  if (!logEntry) return  // Unknown message — ignore

  const updates: Partial<MessageLog> = {}

  switch (status.status) {
    case 'sent':
      updates.status = 'sent'
      updates.sent_at = new Date(status.timestamp * 1000).toISOString()
      break
    case 'delivered':
      updates.status = 'delivered'
      updates.delivered_at = new Date(status.timestamp * 1000).toISOString()
      break
    case 'read':
      updates.status = 'read'
      updates.read_at = new Date(status.timestamp * 1000).toISOString()
      // Also update attendance_records.parent_notified if this was an absence alert
      await updateParentNotifiedIfAbsenceAlert(logEntry.id)
      break
    case 'failed':
      updates.status = 'failed'
      updates.failed_at = new Date().toISOString()
      updates.failure_reason = status.errors?.[0]?.message
      updates.retry_count = logEntry.retry_count + 1
      break
  }

  await supabaseAdmin
    .from('message_log')
    .update(updates)
    .eq('id', logEntry.id)
}
```

---

## Quota Tracking Using the Log

Monthly WhatsApp quota consumption is counted from the message_log rather than a separate counter:

```sql
-- Current month quota usage for a school
SELECT COUNT(*) as messages_used
FROM public.message_log
WHERE school_id = $school_id
  AND channel = 'whatsapp'
  AND status NOT IN ('opted_out', 'quota_exceeded')
  AND created_at >= DATE_TRUNC('month', NOW())
  AND created_at < DATE_TRUNC('month', NOW()) + INTERVAL '1 month';
```

This approach means the `school_message_quotas` table is a cached summary — it is updated after each message is dispatched for performance, but the message_log is the authoritative source if there is ever a discrepancy.

---

## Admin Communication Log View

**Location:** Communication → Message Log

School admins, accountants, and principals can view their school's message history:

```
Message Log — Sunrise Academy

Filter: [All channels ▼] [All templates ▼] [Date range] [Search by student/parent]

Date          Channel    Template              Recipient       Status
15 Sep 11:45  WhatsApp   fee_payment_confirmed Grace Mwale    ✅ Read
15 Sep 10:23  WhatsApp   fee_overdue_reminder  Peter Banda    📬 Delivered
15 Sep 08:47  WhatsApp   absence_alert         Mary Phiri     ✅ Read
14 Sep 17:00  Email      monthly_att_summary   John Zulu      📧 Sent
14 Sep 17:00  WhatsApp   monthly_att_summary   Grace Mwale    ✅ Read
...
```

**Investigating a delivery failure:**
```
15 Sep 08:47 · WhatsApp · absence_alert
Recipient: +260977123456 (Peter Banda)
Student: Chanda Bwalya · Grade 9A
Status: ❌ Failed
Reason: "Phone number not registered on WhatsApp"
Fallback: SMS sent at 08:48 ✅

[Contact parent]   [View student]
```

---

## Retention Policy

Message logs are retained for **12 months** then archived. The daily archival job moves rows older than 12 months to a separate `message_log_archive` table in a cold storage Supabase project (not the main production project). The archive is queryable by AfriTech super admins only.

**Why 12 months:** Sufficient for annual audits, disputes about whether reminders were sent, and regulatory compliance. Storage cost at scale: 100 schools × 5,000 messages/month × 12 months = 6 million rows — approximately 2GB at average row size. Manageable on Supabase Pro.

---

## Business Rules

1. A message_log row is created before every message is dispatched. No message is sent without a corresponding log entry.
2. The message_log is append-only. Only the `status`, `sent_at`, `delivered_at`, `read_at`, `failed_at`, `failure_reason`, `retry_count`, and `provider_message_id` fields are updated after creation. All other fields are immutable.
3. WhatsApp quota counting uses the message_log as the authoritative source. The `school_message_quotas` table is a performance cache.
4. Messages to opted-out parents are logged with `status = 'opted_out'` rather than skipped silently. This creates an audit trail showing the message was attempted but suppressed.
5. Alumni marketing messages use `school_id = NULL` in the log. AfriTech filters these from school-level log views.
6. Message logs older than 12 months are archived to cold storage. School admins cannot query archived logs — contact AfriTech support for historical records.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 12 communication documentation |
| 2026-04-26 | Added announcement_id field | Full announcement delivery tracking |
| 2026-04-26 | Added alumni marketing log (school_id = NULL) | Graduated account model |
| 2026-04-26 | Added quota counting via log | Authoritative source for quota disputes |
