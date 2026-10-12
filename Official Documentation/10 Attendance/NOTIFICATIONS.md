# NOTIFICATIONS.md — Parent Attendance Notifications

## Related Documents

- `docs/modules/attendance/ATTENDANCE.md` — attendance recording overview
- `docs/modules/attendance/TRIGGERS.md` — database trigger that initiates notifications
- `docs/modules/attendance/OFFLINE_SYNC.md` — bulk sync rate limiting
- `docs/infra/META_API.md` — WhatsApp quota and template system
- `docs/infra/QSTASH.md` — notification job queue
- `docs/modules/communication/MESSAGE_LOG.md` — delivery tracking
- `docs/DATABASE.md` — school_message_quotas, message_log tables

---

## Implementation Status (2026-10-11)

**Channel 1 (in-app badge)** — built. The parent attendance screen reads the records
directly through RLS, and it is always on because it costs nothing.

**Channel 3 (per-absence alert)** — built as of `0255`, default OFF, configured at
Settings → Attendance alerts. The screen shows this document's own quota arithmetic
computed from the school's **actual roll** before the switch is thrown, because a school
that enables this blind finds out when the quota runs dry mid-term and a fee reminder
cannot go out.

It is a polled worker rather than the trigger `TRIGGERS.md` specifies — ADR-047.

The `absence_alert` template existed for WhatsApp and email but had **no in-app row**,
though in-app is a channel a school can choose, so that choice would have sent nothing
silently. Seeded in `0255`, which asserts the coverage.

**Channels 2, 4 and 5 are not built.** Push needs the mobile app (no screens exist);
the monthly summary and the WhatsApp `ATTENDANCE` chatbot command both need a live Meta
account.

**Delivery remains unproven for all of it.** No Meta, Twilio or Resend credentials, so
every channel runs through the mock provider and no message has left this machine.

---

## Purpose

This document defines the complete parent notification flow for attendance — from the moment a student is marked absent to the parent receiving confirmation, and the monthly summary model that replaces per-absence alerts as the default. Every Claude Code session building any attendance notification feature must read this document.

---

## Overview

The portal-first communication model means ZSMS does not send a WhatsApp message for every absence by default. The primary attendance communication channels are the parent portal (always available, no cost), in-app push notifications (free via FCM/APNS), and monthly attendance summaries (one WhatsApp per student per month). Per-absence WhatsApp alerts are available as an optional school setting that consumes quota.

This design reduces messaging costs significantly while ensuring parents who check the portal regularly have full visibility. Schools with parents who are not portal-active can enable per-absence alerts.

---

## Communication Channels by Type

| Notification Type | Channel | Cost | Default |
|---|---|---|---|
| Per-absence alert | WhatsApp | Quota | Opt-in (off by default) |
| Per-absence alert | Push notification | Free | On |
| Per-absence alert | In-app badge | Free | On |
| Monthly summary | WhatsApp | Quota (1 per student) | On |
| Monthly summary | Email | Free | On (if email registered) |
| Chatbot ATTENDANCE response | WhatsApp | Quota | On demand |

---

## Channel 1 — In-App Attendance Badge (Always Active)

The parent portal home screen shows an attendance badge for each linked child that updates daily. No messaging quota is consumed. No notification is sent — the parent sees it when they open the app.

```
My Children:

● Chanda Bwalya · Grade 9A · Sunrise Academy
  ✅ Present today                          ← updated each morning
  Fee balance: K2,500.00 outstanding

● Mwamba Mwale · Grade 6 · Sunrise Academy
  ❌ Absent today                           ← shown in red when absent
  Fee balance: Paid ✓
```

The badge data is populated from the most recent attendance record for the child for today's date. If no attendance has been recorded yet today (teacher has not marked it), the badge shows "Not yet marked."

**Implementation:** The parent portal home screen queries `attendance_records` for today's date for each linked student. This is a simple indexed query — `school_id + student_id + attendance_date` composite index makes it fast.

---

## Channel 2 — Push Notifications (Mobile App)

When a student is marked absent, a push notification is sent to the parent's phone via Expo Push Notifications (FCM for Android, APNs for iOS). This is free — no WhatsApp quota consumed.

**Push notification content:**
```
Title: ⚠️ Sunrise Academy
Body:  Chanda was marked absent today (Thu 15 Sep)
       Tap to view attendance history
Action: Opens parent portal → Chanda's attendance tab
```

**How push notifications work in the mobile app:**

```typescript
// apps/mobile/lib/notifications.ts
import * as Notifications from 'expo-notifications'

// Register device for push notifications on first login
export async function registerPushToken(parentUserId: string) {
  const token = await Notifications.getExpoPushTokenAsync()

  await supabase
    .from('parent_push_tokens')
    .upsert({
      parent_user_id: parentUserId,
      push_token: token.data,
      platform: Platform.OS,
      updated_at: new Date().toISOString(),
    })
}
```

The `send-whatsapp` Edge Function (or a separate `send-push` Edge Function) reads the parent's push token from a `parent_push_tokens` table and calls the Expo Push API to deliver the notification.

**Push token storage table:**

```sql
CREATE TABLE public.parent_push_tokens (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_user_id  TEXT NOT NULL,
  push_token      TEXT NOT NULL,
  platform        TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  is_active       BOOLEAN DEFAULT TRUE,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(parent_user_id, platform)
);
```

---

## Channel 3 — Per-Absence WhatsApp Alert (Optional — Quota Consuming)

Enabled in Settings → Communication → Attendance Alerts → Per-absence WhatsApp alerts.

When enabled, every absent mark triggers a WhatsApp message via the template `absence_alert`:

```
⚠️ Attendance Alert — Sunrise Academy

Chanda Bwalya was marked absent today
Thursday, 15 September 2026 · Grade 9A

If this is unexpected, please contact the school.

View attendance history: zsms.co.zm/portal/attendance
```

**Quota impact calculation:**
A school with 400 students and an average 5% daily absence rate sends:
- 400 × 5% = 20 absence alerts per day
- 20 × 20 school days per month = 400 messages/month
- This consumes 80% of the Starter tier's 500-message monthly quota on absence alerts alone

This is why per-absence alerts are opt-in. Schools that enable this should be on Growth tier (1,500 messages/month) or higher.

**The opt-in prompt:**
When a school owner tries to enable per-absence alerts on Starter tier, ZSMS shows:

```
⚠️ High quota usage warning

Per-absence WhatsApp alerts for a school with 400 students
may consume approximately 400 messages/month.

Your current quota: 500 messages/month (Starter)
Estimated remaining for other messages: ~100

Consider upgrading to Growth (1,500 messages/month) before
enabling this feature.

[Enable anyway]   [View upgrade options]   [Cancel]
```

---

## Channel 4 — Monthly Attendance Summary (Default WhatsApp)

The default WhatsApp attendance communication is a monthly summary sent at the end of each calendar month. One message per student per parent. This is the primary WhatsApp attendance channel.

**When it fires:** queue cron on the last day of each month at 08:00 UTC.

**Template: `monthly_attendance_summary`**

```
📅 September Attendance — Sunrise Academy

Chanda Bwalya (Grade 9A)

Days present:    18 of 20 (90%)
Days absent:      2
Days late:        0

Attendance this term: 40 of 45 days (88.9%)

View full history: zsms.co.zm/portal/attendance

— Sunrise Academy
```

**Monthly summary generation:**

```typescript
// schedule-monthly-attendance-summaries Edge Function
async function generateMonthlySummaries(schoolId: string, month: string) {
  // Get all active students with primary parent contacts
  const students = await getActiveStudentsWithPrimaryContacts(schoolId)

  for (const student of students) {
    // Calculate monthly attendance stats
    const stats = await getMonthlyAttendanceStats(
      student.id,
      schoolId,
      month
    )

    // Only send if student had at least one school day this month
    if (stats.total_days === 0) continue

    // Queue WhatsApp job (counts against quota)
    await enqueueJob('send-whatsapp', {
      recipient_phone: student.primary_parent_phone,
      template_id: 'monthly_attendance_summary',
      variables: [
        student.first_name + ' ' + student.last_name,
        formatMonth(month),
        school.name,
        student.grade_display_name,
        stats.present_days.toString(),
        stats.total_days.toString(),
        Math.round((stats.present_days / stats.total_days) * 100).toString(),
        stats.absent_days.toString(),
        stats.late_days.toString(),
        stats.term_present.toString(),
        stats.term_total.toString(),
        Math.round((stats.term_present / stats.term_total) * 100).toString(),
        `zsms.co.zm/portal/attendance`,
      ],
      school_id: schoolId,
      student_id: student.id,
      fallback_to_email: true,
    })

    // Also send email summary (free)
    await enqueueJob('send-email', {
      template: 'monthly_attendance_summary',
      recipient_email: student.primary_parent_email,
      school_id: schoolId,
      data: { student, stats, school, month },
    })
  }
}
```

**Quota impact:** One message per student per month. A 400-student school uses 400 of their monthly quota on the monthly summary — manageable on Starter (500 total) and comfortable on Growth (1,500 total).

---

## Channel 5 — WhatsApp Chatbot `ATTENDANCE` Command

Parents can text `ATTENDANCE` to the ZSMS WhatsApp Business number at any time to get an instant attendance summary for their linked children.

**Response:**

```
📅 Attendance for your children — Sunrise Academy

Chanda Bwalya (Grade 9A):
This month: Present 18/20 · Absent 2
Last absence: Mon 12 Sep 2026

Mwamba Mwale (Grade 6):
This month: Present 20/20 · No absences ✅

View full history: zsms.co.zm/portal
```

This command works regardless of the per-absence alert setting. It is a pull mechanism — the parent requests the information when they want it.

---

## Delivery Tracking

Every attendance notification is logged in `public.message_log`:

| Field | Value |
|---|---|
| `school_id` | The school |
| `student_id` | The student whose attendance this relates to |
| `channel` | whatsapp / sms / email |
| `template_id` | absence_alert / monthly_attendance_summary |
| `status` | queued → sent → delivered → read / failed |
| `provider_message_id` | Meta message ID for delivery webhook matching |

When the Meta delivery webhook fires, the message_log row is updated with `delivered_at` and `read_at` timestamps.

After delivery is confirmed, the corresponding `attendance_records` row is updated:

```sql
UPDATE public.attendance_records
SET
  parent_notified = TRUE,
  notification_sent_at = NOW()
WHERE id = attendance_record_id;
```

This flag (`parent_notified`) is used by:
- The school admin dashboard to show which absence notifications have been delivered
- The daily reconciliation job to find missed notifications
- The accountant view to understand parent communication history alongside fee records

---

## Notification Preferences (Parent-Configurable)

Parents can configure their notification preferences in the parent portal Profile → Notifications:

```
Attendance notifications:
☑ In-app badge (always shown)
☑ Push notifications on my phone
☑ Monthly summary email
☑ Monthly summary WhatsApp

WhatsApp opted out: [toggle]
  Turning this off stops all WhatsApp messages from ZSMS.
  You'll still receive in-app and email notifications.
```

**WhatsApp opt-out:** Sets `parents.whatsapp_opted_in = FALSE`. All WhatsApp jobs for this parent are automatically skipped by the `send-whatsapp` Edge Function. Email and in-app notifications continue.

---

## Business Rules

1. Per-absence WhatsApp alerts are disabled by default for all schools. Schools must explicitly enable them in settings.
2. Monthly attendance summaries (WhatsApp + email) are sent by default on the last day of each calendar month regardless of whether per-absence alerts are enabled.
3. In-app attendance badge and push notifications are always active and cannot be disabled by the school — only by the parent for push notifications.
4. WhatsApp opt-out by a parent suppresses ALL WhatsApp messages from ZSMS to that parent — not just attendance alerts. Fee reminders, results notifications, and loan updates are also suppressed.
5. The rate limit of 10 WhatsApp messages per parent per hour applies to per-absence alerts during bulk offline sync. Monthly summaries are not subject to this rate limit as they are sent once per student.
6. Delivery tracking via the Meta webhook updates `attendance_records.parent_notified = TRUE`. This field is used for the missed notification reconciliation job.
7. Parents of students at multiple schools receive separate attendance notifications per school — one monthly summary per school per student.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 10 attendance documentation |
| 2026-04-26 | Per-absence alerts opt-in with quota warning | Portal-first model confirmed |
| 2026-04-26 | Monthly summary as default WhatsApp channel | Replaces per-absence default |
| 2026-04-26 | Added push notifications via Expo | Free channel for mobile app parents |
| 2026-04-26 | Added parent_push_tokens table | Required for Expo push notification delivery |
