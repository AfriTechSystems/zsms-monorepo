# TRIGGERS.md — Attendance Database Triggers

## Related Documents

- `docs/modules/attendance/ATTENDANCE.md` — attendance recording overview
- `docs/modules/attendance/OFFLINE_SYNC.md` — offline sync that triggers bulk notifications
- `docs/modules/attendance/NOTIFICATIONS.md` — notification flow after trigger fires
- `docs/infra/QSTASH.md` — job queue called by the trigger
- `docs/infra/SUPABASE.md` — trigger deployment in migrations
- `docs/DATABASE.md` — attendance_records table

---

## Implementation Status (2026-10-11)

**Trigger 1 was never built, and is now deliberately NOT going to be — see ADR-047.**

Trigger 2 (`updated_at`) is built and attached. Trigger 3 was already marked future.

The absence notification described below is now **built as a polled worker**
(`worker_due_absence_alerts()`, `0255`) rather than a trigger. Three independent reasons,
recorded in full in ADR-047:

1. It puts an HTTP call inside the register's own transaction. A teacher marking forty
   pupils with eight absences blocks the INSERT on eight sequential round-trips, and a
   failure leaves only two outcomes, both wrong: roll back the teacher's attendance
   because a notification could not be queued, or swallow the error and drop the alert.
   **Attendance is the record of record; a notification is a convenience.**
2. It needs a Supabase Edge Function, and **ADR-044 settled that those are superseded** —
   the Railway workers already do this work over BullMQ.
3. It stores a **service-role key in database configuration**, where every SECURITY
   DEFINER function can read it, to save a lookup. That key bypasses RLS entirely.

Polling also buys a property the trigger cannot have: a crashed worker **retries**. With
a trigger, the moment of the INSERT is the only chance to send.

**The *Per-Absence Alert Toggle* below is built** as
`school_attendance_alert_settings` (`0255`), default OFF, at Settings → Attendance alerts.
`attendance_records.parent_notified` and `.notification_sent_at` have existed since `0074`
and **nothing had ever read or written either** — they are now the idempotency key they
were shaped to be.

---

## Purpose

This document defines every database trigger related to attendance — what fires, when, what it does, and how failures are handled. Every Claude Code session writing attendance-related triggers or modifying the notification pipeline must read this document.

---

## Overview

Database triggers are the connection between attendance being recorded in the database and parents being notified. They run automatically after every attendance INSERT — whether the record came from the web dashboard, the mobile app online, or a PowerSync offline sync. The trigger is the single point of truth for notification dispatch — no application code needs to remember to queue a notification because the database does it automatically.

---

## Trigger 1 — Absence Notification Queue

### Definition

```sql
CREATE OR REPLACE FUNCTION trigger_queue_absence_notification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_parent_phone    TEXT;
  v_parent_user_id  TEXT;
  v_student_name    TEXT;
  v_school_name     TEXT;
  v_message_count   INT;
  v_quota_remaining INT;
BEGIN
  -- Only fire for absent records
  IF NEW.status != 'absent' THEN
    RETURN NEW;
  END IF;

  -- Get primary parent contact for this student
  SELECT
    p.phone_e164,
    p.clerk_user_id,
    s.first_name || ' ' || s.last_name,
    sch.name
  INTO
    v_parent_phone,
    v_parent_user_id,
    v_student_name,
    v_school_name
  FROM public.student_parent_links spl
  JOIN public.parents p ON p.id = spl.parent_id
  JOIN public.students s ON s.id = NEW.student_id
  JOIN public.schools sch ON sch.id = NEW.school_id
  WHERE spl.student_id = NEW.student_id
    AND spl.is_primary = TRUE
    AND spl.is_active = TRUE
  LIMIT 1;

  -- No primary parent found — skip notification
  IF v_parent_phone IS NULL THEN
    RETURN NEW;
  END IF;

  -- Rate limit check: max 10 WhatsApp messages to this parent per hour
  SELECT COUNT(*) INTO v_message_count
  FROM public.message_log
  WHERE recipient_user_id = v_parent_user_id
    AND channel = 'whatsapp'
    AND created_at > NOW() - INTERVAL '1 hour';

  IF v_message_count >= 10 THEN
    -- Rate limit exceeded — queue email/in-app only, not WhatsApp
    PERFORM net.http_post(
      url := current_setting('app.qstash_endpoint') || '/send-email',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.qstash_token'),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'type', 'absence_alert_overflow',
        'student_id', NEW.student_id,
        'school_id', NEW.school_id,
        'attendance_record_id', NEW.id,
        'parent_user_id', v_parent_user_id
      )::TEXT
    );
    RETURN NEW;
  END IF;

  -- Check school WhatsApp quota
  SELECT quota_limit - messages_used INTO v_quota_remaining
  FROM public.school_message_quotas
  WHERE school_id = NEW.school_id
    AND billing_period = TO_CHAR(NOW(), 'YYYY-MM');

  -- Queue WhatsApp job (or email if quota exhausted)
  PERFORM net.http_post(
    url := current_setting('app.qstash_endpoint') || '/send-whatsapp',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.qstash_token'),
      'Content-Type', 'application/json',
      'Upstash-Retries', '3',
      'Upstash-Retry-Delay', '10s'
    ),
    body := jsonb_build_object(
      'type', 'absence_alert',
      'student_id', NEW.student_id,
      'school_id', NEW.school_id,
      'attendance_record_id', NEW.id,
      'attendance_date', NEW.attendance_date,
      'use_whatsapp', (v_quota_remaining > 0),
      'fallback_to_email', TRUE
    )::TEXT
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER queue_absence_notification
  AFTER INSERT ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION trigger_queue_absence_notification();
```

### When It Fires

- After every INSERT on `public.attendance_records`
- Evaluates the `NEW.status` — only proceeds if `status = 'absent'`
- Does NOT fire on UPDATE — only on INSERT

**Why only INSERT and not UPDATE:**
If a teacher marks a student absent and then corrects it to present, the original notification has already been sent. The notification system cannot unsend a WhatsApp message. The UPDATE case (correcting an error) is handled by the admin/teacher leaving a note in the attendance record — the parent is not automatically notified of corrections.

### What It Does Not Do

- Does not write a `message_log` row — that is done by the `send-whatsapp` Edge Function after the message is sent
- Does not update `attendance_records.parent_notified` — that is updated by the webhook when Meta confirms delivery
- Does not handle per-absence alerts toggle — that logic lives in the `send-whatsapp` Edge Function

---

## Trigger 2 — `updated_at` Auto-Update

Applied to `attendance_records` like all other tables:

```sql
CREATE TRIGGER set_updated_at_on_attendance
  BEFORE UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
```

---

## Trigger 3 — Attendance Statistics Update (Future)

A planned future trigger that will maintain a `class_attendance_stats` summary table — updating running totals of present/absent/late counts per class per date when attendance is inserted or updated. This avoids expensive COUNT queries on the full `attendance_records` table for the school dashboard. Not implemented in Phase 1 — the dashboard queries the attendance_records table directly.

---

## Trigger Failure Handling

If the `net.http_post()` call to the queue endpoint fails within the trigger (endpoint unreachable, network error):

- The trigger does not cause the attendance INSERT to fail — the `RETURN NEW` at the end of the trigger body always executes
- The attendance record is saved successfully even if the notification cannot be queued
- The failure is logged via `RAISE WARNING` which appears in the Supabase function logs
- Sentry is notified via a background call (best effort — the trigger does not wait for Sentry)
- The `parent_notified` field on the attendance record remains `FALSE` — the missed notification is detectable

**Recovery:**
A daily reconciliation job (queue cron) scans for `attendance_records` where `status = 'absent'` and `parent_notified = FALSE` and `created_at > NOW() - INTERVAL '24 hours'`. These are records where the trigger notification may have failed. The job re-queues the notification. This provides eventual delivery even if the initial trigger failed.

---

## Configuring App Settings for the Trigger

The trigger reads two PostgreSQL configuration settings using `current_setting()`:

```sql
-- Set during Supabase project setup (run once)
ALTER DATABASE postgres SET app.qstash_endpoint = 'https://qstash.upstash.io/v2/publish';
ALTER DATABASE postgres SET app.qstash_token = 'your-qstash-token';
```

These settings allow the trigger to reach the queue endpoint without hardcoding secrets in the trigger function body. The token is a database-level setting — accessible to triggers but not exposed via the PostgREST API.

**Alternative approach for production:**
Rather than storing a queue credential in the database configuration, the trigger calls a ZSMS-internal Edge Function URL, which then enqueues through the queue abstraction. This keeps all queue credentials out of the database. Recommended for production — and required under the BullMQ default (ADR-035), since BullMQ has no HTTP publish endpoint a trigger could call directly:

```sql
-- Trigger calls ZSMS Edge Function (no queue credential in database)
PERFORM net.http_post(
  url := 'https://[project].supabase.co/functions/v1/queue-absence-notification',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || current_setting('app.supabase_service_key'),
    'Content-Type', 'application/json'
  ),
  body := jsonb_build_object(
    'attendance_record_id', NEW.id
  )::TEXT
);
```

The Edge Function then fetches the full notification details and enqueues through the queue abstraction. Cleaner security boundary, and provider-independent.

---

## Per-Absence Alert Toggle

Schools can enable per-absence WhatsApp alerts as an optional feature (disabled by default in the portal-first model). This toggle lives in Settings → Communication → Attendance Alerts.

The trigger always fires and always queues the job. The decision of whether to send WhatsApp or fall back to in-app only is made in the `send-whatsapp` Edge Function, which checks:

```typescript
// In send-whatsapp Edge Function
const { data: school } = await supabase
  .from('schools')
  .select('absence_alerts_enabled')
  .eq('id', payload.school_id)
  .single()

if (!school.absence_alerts_enabled && payload.type === 'absence_alert') {
  // Per-absence alerts disabled — create in-app notification only
  await createInAppNotification(payload.parent_user_id, ...)
  return
}

// Per-absence alerts enabled — send WhatsApp
await sendWhatsAppMessage(...)
```

This means the trigger and queued job always run — the toggle only affects the final delivery channel. This keeps the trigger simple and the channel decision in application code where it is easier to manage.

---

## Business Rules

1. The absence notification trigger fires on INSERT only — not on UPDATE. Corrections to attendance do not trigger parent notifications.
2. The trigger never causes the attendance INSERT to fail. If the queue endpoint is unreachable, the attendance record is saved and the notification failure is logged for recovery.
3. The rate limit of 10 WhatsApp messages per parent per hour is enforced in the trigger. Excess notifications from bulk offline syncs are converted to email/in-app.
4. Queue credentials are never stored in PostgreSQL database configuration or in the trigger function body. The trigger calls an intermediary Edge Function which enqueues through the queue abstraction — required under the BullMQ default, since BullMQ has no HTTP publish endpoint.
5. The reconciliation job checks for un-notified absences daily and re-queues missed notifications — providing eventual delivery even when the trigger fails.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 10 attendance documentation |
| 2026-04-26 | Added rate limiting in trigger body | Prevents WhatsApp flooding from bulk offline sync |
| 2026-04-26 | Added per-absence alert toggle via Edge Function | Portal-first model — alerts opt-in not default |
| 2026-04-26 | Added reconciliation job for missed notifications | Trigger failure recovery mechanism |
