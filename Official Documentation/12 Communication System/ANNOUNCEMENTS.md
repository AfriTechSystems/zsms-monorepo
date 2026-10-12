# ANNOUNCEMENTS.md — School Announcements

## Related Documents

- `docs/modules/communication/WHATSAPP.md` — WhatsApp quota for important announcements
- `docs/modules/communication/MESSAGE_LOG.md` — announcement delivery tracking
- `docs/modules/communication/TEMPLATES.md` — school_announcement WhatsApp template
- `docs/DATABASE.md` — announcements, announcement_reads tables
- `docs/RLS.md` — announcement access policies
- `docs/infra/META_API.md` — WhatsApp dispatch for important announcements

---

## Implementation Status (2026-10-11)

**Built end to end**, and the most complete part of this folder.

Composer at `/school/[code]/announcements`, audience targeting through
`set_announcement_target_type()` and `announcement_addressed_to_me()`, scheduling via
`worker_claim_scheduled_announcements()` on a 15-minute cron, read tracking in
`announcement_reads`, and the parent view. The quota is shown on the composer before
sending, drawn from `school_message_quotas`.

A 16-assertion pgTAP suite (`announcement_audience_test`) covers who may see what, which
matters more here than anywhere else in the folder: an announcement addressed to one
class must not reach the whole school.

**What cannot happen is delivery.** The in-app copy appears for parents; the WhatsApp and
email copies go to the mock provider.

---

## Purpose

This document defines the complete school announcement system — how announcements are created, targeted, delivered, and tracked. Covers both school-level announcements and AfriTech platform-level announcements to school owners. Every Claude Code session building any announcement feature must read this document.

---

## Overview

Announcements are the broadcast communication tool for schools. Unlike fee reminders or results notifications which are automated and event-driven, announcements are manually created by school admins or principals when they have something to communicate to a group of people. The system supports granular targeting, multiple delivery channels, and full read tracking for every announcement across every school.

---

## Announcement Types

| Type | Created By | Recipients | WhatsApp |
|---|---|---|---|
| Important school announcement | Admin, Principal, Owner | Selected audience | Yes — uses quota |
| Regular school announcement | Admin, Principal, Owner | Selected audience | No — portal + email only |
| Staff announcement | Admin, Principal, Owner | Staff only | No — portal only |
| AfriTech platform announcement | AfriTech super admin | All school owners | Yes — AfriTech quota |

The distinction between important and regular is set by the creator. Important announcements consume WhatsApp quota and are appropriate for urgent or time-sensitive matters (school closure, exam schedule change, emergency). Regular announcements are for general updates (upcoming events, term dates reminder, curriculum notes).

---

## Creating an Announcement

**Location:** Communication → Announcements → New Announcement

```
Title: [text — required, max 100 chars]
Body:  [rich text — required, max 2,000 chars]

Importance:
○ Regular  (portal + email + push notification)
● Important (portal + email + push notification + WhatsApp)

Target audience:
○ All parents at this school
○ All students (student portal only)
○ All staff
● Selected grades:
  ☑ Grade 9A   ☑ Grade 9B   ☐ Grade 10
○ Selected class: [dropdown]
○ Custom group (future)

Scheduling:
● Send now
○ Schedule for: [date-time picker]

[Preview]   [Send Announcement]
```

**WhatsApp quota warning** (shown when Important is selected):

```
⚠️ This announcement will send WhatsApp messages to approximately
   [N] parents and consume [N] of your [remaining] remaining messages.

   [Send anyway]   [Send as Regular instead]
```

---

## Announcement Database Schema

```sql
CREATE TABLE public.announcements (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID NOT NULL REFERENCES public.schools(id),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  importance      TEXT NOT NULL DEFAULT 'regular'
                  CHECK (importance IN ('regular', 'important')),
  target_type     TEXT NOT NULL
                  CHECK (target_type IN (
                    'all_parents', 'all_students', 'all_staff',
                    'grade', 'class', 'platform'
                  )),
  target_ids      TEXT[],
  -- Grade IDs or class IDs when target_type is 'grade' or 'class'
  -- NULL for all_parents, all_students, all_staff, platform

  created_by      TEXT NOT NULL,
  scheduled_at    TIMESTAMPTZ,
  -- NULL = send immediately
  sent_at         TIMESTAMPTZ,
  -- Set when dispatch begins
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'scheduled', 'sending', 'sent')),

  whatsapp_jobs_queued  INT DEFAULT 0,
  -- How many WhatsApp jobs were queued for this announcement
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_announcements_school ON public.announcements(school_id, created_at DESC);
CREATE INDEX idx_announcements_status ON public.announcements(school_id, status);
```

---

## Full Read Tracking — `announcement_reads` Table

Every announcement read is tracked — all schools, all announcements, all users. One row per user per announcement.

```sql
CREATE TABLE public.announcement_reads (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id        UUID NOT NULL REFERENCES public.schools(id),
  announcement_id  UUID NOT NULL REFERENCES public.announcements(id),
  reader_user_id   TEXT NOT NULL,
  -- Clerk user ID of whoever read the announcement
  reader_type      TEXT NOT NULL
                   CHECK (reader_type IN ('parent', 'student', 'staff')),
  read_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(announcement_id, reader_user_id)
);

CREATE INDEX idx_reads_announcement ON public.announcement_reads(announcement_id);
CREATE INDEX idx_reads_user ON public.announcement_reads(reader_user_id);
CREATE INDEX idx_reads_school ON public.announcement_reads(school_id, announcement_id);
```

**When a read row is created:** When the user opens the announcement detail view in the portal or app. Opening the notification feed (list view) does not count as read — only opening the full announcement.

**Read tracking for WhatsApp:** WhatsApp delivery tracking (sent → delivered → read) via Meta webhooks is stored in `message_log`. The `announcement_reads` table tracks portal/app reads separately. An announcement can be "read" via WhatsApp (Meta read receipt) and via portal (announcement_reads row) — both are tracked.

---

## Announcement Feed in the Portal

### Parent Portal

```
📢 Announcements — Sunrise Academy

[🔴 Unread] Important · 15 Sep
EXAM TIMETABLE UPDATE
Final exam dates have been adjusted...
                                    [Tap to read]

[✅ Read] Regular · 12 Sep
Sports Day This Friday
All students should bring...
                                    [Tap to re-read]

[✅ Read] Regular · 1 Sep
Welcome to Term 2
We welcome all students back...
                                    [Tap to re-read]
```

The unread badge on the portal home screen increments for each new announcement targeting this parent's children.

### Staff Dashboard

Staff see announcements in a separate "Staff Announcements" section. School-wide parent announcements are also visible to staff (so they are informed of what parents were told).

### Student Portal

Students see announcements targeted at their grade or class, plus school-wide announcements. Important announcements show at the top of their portal home screen.

---

## Announcement Read Analytics

Admins and principals see read analytics for each announcement:

**Location:** Communication → Announcements → [Announcement Title] → Analytics

```
EXAM TIMETABLE UPDATE — 15 Sep 2026

Delivery:
WhatsApp sent:       412 messages
WhatsApp delivered:  398 (96.6%)
WhatsApp read:       341 (82.8%)

Portal reads:        287 parents (69.7%)

Overall reach:       409 of 412 parents (99.3%)
(reached = WhatsApp delivered OR portal read)

Unread parents: 3
  Grace Mwale     — not delivered (invalid number)
  Peter Banda     — delivered but not read (WhatsApp)
  [Contact]       — opens the parent's contact details
```

The "Contact" button for unread parents allows the admin to manually follow up on important announcements.

---

## Scheduled Announcements

Announcements can be scheduled for future delivery. A queue cron checks for scheduled announcements every 15 minutes and dispatches any due:

```typescript
// check-scheduled-announcements — queue cron every 15 minutes
const dueAnnouncements = await supabase
  .from('announcements')
  .select('*')
  .eq('status', 'scheduled')
  .lte('scheduled_at', new Date().toISOString())

for (const announcement of dueAnnouncements) {
  await dispatchAnnouncement(announcement)
}
```

---

## AfriTech Platform Announcements

AfriTech super admins can send platform-wide announcements to all school owners simultaneously. These appear in the school owner's portal as a distinct "Platform Update" announcement.

**Use cases:**
- New feature announcements ("Timetable builder now available")
- Maintenance windows ("System maintenance Saturday 02:00–04:00 UTC")
- Policy updates ("Terms of Service updated")
- Regulatory notices

**Delivery:** Portal notification + email to school owner. WhatsApp for critical platform updates only (uses AfriTech's own quota, not school quotas).

Platform announcements are identified by `target_type = 'platform'` and `school_id = NULL` (no specific school).

---

## Alumni and Graduated User Announcements

AfriTech uses the announcement system to send promotional content to opted-in alumni and parents of graduated students. These are **not school announcements** — they originate from AfriTech and are delivered as platform-level messages.

**Content types:**
- Scholarship opportunities (e.g. "Applications open for ABC Scholarship 2027")
- Marketplace product promotions (educational materials, uniforms)
- Study abroad agency partnerships
- Alumni networking events
- Career opportunities for Form 6 graduates

**Targeting:** Alumni are targeted by graduation year, school attended, and academic performance tier (opt-in only). Marketing content is never sent to users with `parents.marketing_opt_in = FALSE`.

**Frequency limit:** AfriTech limits marketing messages to maximum 4 per month per user to prevent fatigue. Users can further reduce frequency or opt out entirely from their profile settings.

---

## Business Rules

1. All announcements are tracked for reads regardless of importance level. The `announcement_reads` table receives entries for every user who opens any announcement.
2. Important announcements consume school WhatsApp quota. Regular announcements never consume WhatsApp quota regardless of school settings.
3. Scheduled announcements are dispatched within 15 minutes of their scheduled time.
4. AfriTech platform announcements are visible to school owners only — not to teachers, parents, or students.
5. Marketing promotional content from AfriTech is sent only to users with `marketing_opt_in = TRUE`. Default is FALSE — opt-in must be explicit.
6. The marketing_opt_in opt-in is captured at the graduation/departure flow. It is never pre-checked or defaulted to TRUE.
7. School announcements target only users linked to that school. A parent at School A never receives an announcement from School B.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 12 communication documentation |
| 2026-04-26 | Full read tracking for all announcements | Decision 2 confirmed — track all reads |
| 2026-04-26 | Added alumni promotional content section | Graduated account model confirmed |
| 2026-04-26 | Added AfriTech platform announcements | AfriTech needs to communicate platform updates to owners |
