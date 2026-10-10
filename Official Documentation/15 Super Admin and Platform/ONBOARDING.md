# ONBOARDING.md — AfriTech School Onboarding Workflow

## Related Documents

- `docs/modules/admin/SUPERADMIN.md` — admin panel where onboarding is managed
- `docs/modules/admin/PLATFORM_METRICS.md` — onboarding completion metrics
- `docs/modules/school/SCHOOL_SETUP.md` — how schools register
- `docs/modules/school/SCHOOL_CONFIG.md` — configuration steps during onboarding
- `docs/modules/school/TRIAL.md` — trial model and conversion
- `docs/infra/QSTASH.md` — scheduled onboarding reminder jobs
- `docs/DATABASE.md` — onboarding_checklists table

---

## Purpose

This document defines the AfriTech-side onboarding workflow — how AfriTech manages the process of getting a new school from registration to a fully configured, actively using ZSMS account. Covers outreach requirements, the task queue, the onboarding call checklist, email automation, and escalation rules. Every Claude Code session building AfriTech admin onboarding features must read this document.

---

## Overview

Onboarding is the most important activity AfriTech performs after a school registers. A school that completes setup and starts using ZSMS actively is likely to convert to a paid subscription and stay long-term. A school that registers and then stalls — because nobody helped them — will let the trial expire and never return.

The 24-hour outreach rule is the most important operational rule at AfriTech: every new self-registered school must be contacted within 24 hours of registration.

---

## The Onboarding Task Queue

When a school self-registers, the system automatically creates an onboarding task in the admin panel:

```
Admin → Schools → Onboarding → New Tasks

┌──────────────────────────────────────────────────────────┐
│ 🆕 NEW — Sunrise Academy (ZM-LSK-0048)                   │
│ Registered: 15 Sep 2026 · 09:14am                        │
│ Owner: Grace Mwale · +260977123456                        │
│ City: Lusaka · Type: Day · Level: Secondary              │
│ Trial ends: 15 Oct 2026 (30 days)                        │
│                                                          │
│ ⏰ Contact required by: 16 Sep 2026 · 09:14am            │
│                                                          │
│ [Assign to me]  [Assign to team]  [Record contact]       │
└──────────────────────────────────────────────────────────┘
```

Tasks are ordered by urgency — new schools within the 24-hour window appear at the top in red. Schools approaching their trial expiry appear next in amber.

**Task states:**

| State | Description |
|---|---|
| New | Just registered — contact not yet made |
| Assigned | Assigned to a regional manager or support agent |
| Contacted — Call scheduled | Contact made, onboarding call booked |
| Contacted — No answer | Tried to call, no response |
| Contacted — Not interested | School registered but decided not to proceed |
| In Progress | Actively setting up ZSMS |
| Complete | School fully set up, checklist ≥ 80% |
| Converted | Trial converted to paid subscription |
| Expired | Trial expired without conversion |

---

## 24-Hour Outreach Requirement

Every self-registered school must be contacted within 24 hours. This is not optional.

**Enforcement:**

```typescript
// queued job scheduled at registration time — fires 24 hours later
await enqueueJob('check-outreach-required', {
  school_id: schoolId,
  registered_at: new Date().toISOString(),
  delay_seconds: 24 * 60 * 60,  // 24 hours
})

// Edge Function — check-outreach-required
async function checkOutreachRequired(schoolId: string) {
  const task = await getOnboardingTask(schoolId)

  if (task.status === 'new') {
    // No contact recorded in 24 hours — escalate
    await escalateToSuperAdmin(schoolId)
    await createUrgentNotification(
      'afritech_super_admin',
      `URGENT: Sunrise Academy (${schoolId}) registered 24 hours ago — no contact recorded`
    )
  }
}
```

---

## Onboarding Call Checklist

When a regional manager calls the school owner, they work through this checklist. The checklist is displayed in the admin panel alongside the school's current configuration state.

### Section 1 — Introduction (5 minutes)

- Introduce AfriTech and ZSMS
- Confirm the school owner's role and decision-making authority
- Confirm they understand the 30-day trial with no payment required
- Ask: "What was your main reason for registering for ZSMS?"
  (Captures the pain point — use to tailor the rest of the call)

### Section 2 — Academic Structure Setup (10 minutes)

- Guide them through Settings → Academic Structure
- Help them select the correct curriculum type (Traditional ECZ / New Curriculum / Hybrid)
- Walk through the grade level builder — confirm their grades and classes match reality
- Help them select the grading system (ECZ Percentage / Cambridge / Custom)
- Confirm subjects are configured correctly for their curriculum

**Common issues to watch for:**
- Schools unsure whether they are ECZ or New Curriculum — help them identify by what exams their students sit
- Schools with both Grade 7-9 (old) and Form 1-3 (new) in the same school year — guide to Hybrid option
- Subject list includes subjects the school doesn't actually teach — prune it together

### Section 3 — Student Import (10 minutes)

- Confirm they have an existing student list (Excel, CSV, or handwritten register)
- Walk them through the bulk import template download
- Explain the column mapping feature — they do not need to reformat their spreadsheet
- Schedule a follow-up if they need help with the import
- Target: at least one student imported by end of day

### Section 4 — Fee Setup (10 minutes)

- Help them configure their fee structure for the current term
- Walk through adding fee lines (Tuition, Activity, Boarding if applicable)
- Explain the difference between fee structures (templates) and fee records (per-student)
- Help them generate fee records for current students
- Ask: "Do you want to connect an online payment gateway?" — if yes, guide to Settings → Payment Gateways

### Section 5 — WhatsApp Configuration (5 minutes)

- Explain the two options: AfriTech shared number vs their own number
- For schools wanting their own number: explain the Meta business verification process and timeline
- For schools happy with shared: confirm no setup needed
- Explain the monthly quota and what messages consume it

### Section 6 — Staff and Parent Setup (5 minutes)

- Guide to Staff → Add Staff Member — invite at least one teacher
- Explain parent linking — automatic when students are imported with parent phone numbers
- Show them the parent portal URL and how parents log in

### Section 7 — Next Steps (5 minutes)

- Confirm what they will do before the next call (import students, configure fees)
- Schedule a follow-up call in 3-5 days
- Share the help documentation URL
- Confirm their questions are answered

---

## Automated Email Sequence

ZSMS sends automated emails via Resend during the trial period. These are sent regardless of whether the AfriTech team has made contact.

| Day | Email | Condition |
|---|---|---|
| Day 0 (registration) | Welcome — Getting Started Guide | Always |
| Day 3 | "Have you set up your grade structure?" | Only if `grade_structure` checklist item incomplete |
| Day 7 | "How your first week went" + tips | Always |
| Day 10 | "Import your students in minutes" | Only if `first_student` checklist item incomplete |
| Day 14 | Mid-trial check-in | Only if not yet subscribed |
| Day 20 | "10 days left in your trial" | Only if not yet subscribed |
| Day 25 | "5 days left — don't lose your data" | Only if not yet subscribed |
| Day 28 | "2 days left" | Only if not yet subscribed |
| Day 30 | "Your trial ends today" | Only if not yet subscribed |
| Day 33 | "Your data is safe — subscribe to regain access" | Only if trial expired |

---

## WhatsApp Configured Checklist Item

The onboarding checklist now includes a `whatsapp_configured` item:

```typescript
// Added to the onboarding checklist items created at registration
const checklistItems = [
  'school_profile',
  'grade_structure',
  'grading_system',
  'subjects',
  'fee_structure',
  'first_student',
  'first_staff',
  'parent_links',
  'payment_gateway',
  'term_dates',
  'whatsapp_configured',  // NEW — choose shared or own number
  'logo',
  'document_templates',
]
```

`whatsapp_configured` is marked complete when:
- School selects "Use ZSMS shared number" (immediate — zero setup required)
- OR school configures and verifies their own WhatsApp Business number (requires test message confirmation)

Default: marked as `whatsapp_configured = FALSE` at registration. Completing this step is prompted during the onboarding call.

---

## Onboarding Escalation Rules

| Condition | Escalation Action |
|---|---|
| No contact in 24 hours | Urgent notification to super admin |
| No contact in 48 hours | Super admin personally calls the school |
| Checklist < 30% after 7 days | Amber alert in admin panel + follow-up email triggered |
| Checklist < 30% after 14 days | Red alert + regional manager assigned if not already |
| Trial expires with checklist < 50% | Post-expiry outreach email + phone call |
| School contacted but says "not interested" | Record reason + tag for quarterly re-outreach |

---

## Pilot School Onboarding (Manual — AfriTech Creates Account)

For pilot schools during the September 2026 launch, AfriTech creates accounts manually rather than waiting for self-registration.

**Pilot onboarding process:**

```
1. Super admin creates school via Admin → Schools → Add School (manual)
   Status: pending_verification (not trial)
   Trial: NOT activated — pilot schools go straight to active

2. Super admin invites school owner to Clerk organisation
   Owner receives invitation email

3. AfriTech sets up a 2-hour guided onboarding session:
   - Screen share with school owner
   - Walk through every configuration step together
   - Set up at least one fee structure and generate fee records
   - Invite at least 2 teachers and confirm they can log in

   **AMENDED 2026-09-30 — activate before importing pupils.** This step used to import student
   data during the session, with activation at step 5 afterwards. Migration `0153` makes that
   impossible, deliberately: `pending_verification` means AfriTech has not yet confirmed the school
   is real, and accepting several hundred children's names and dates of birth from an unverified
   party makes AfriTech their processor under the ZDPA before anybody has established there is a
   school behind it. Activate at the point in the call where the details are confirmed, then import.
   It reorders two steps and changes nothing about how long the call takes.

4. Post-session follow-up:
   - Email with everything configured, what to do next
   - Phone check-in after 3 days

5. Activate school: Admin → [School] → Activate
   Status: active
   Subscription: set to agreed pilot tier (free for pilot period)
```

Pilot schools get white-glove onboarding. Self-registered schools get guided + automated. Enterprise schools get dedicated account manager.

---

## Onboarding Completion Tracking

The onboarding completion percentage is shown in the admin panel for every school and drives the health indicator.

```typescript
function calculateOnboardingCompletion(items: OnboardingChecklistItem[]): number {
  const weights = {
    // Critical — 60% total weight
    school_profile:       8,
    grade_structure:      12,
    grading_system:       10,
    subjects:             10,
    fee_structure:        12,
    whatsapp_configured:  8,

    // Important — 30% total weight
    first_student:        8,
    first_staff:          6,
    parent_links:         6,
    payment_gateway:      5,
    term_dates:           5,

    // Optional — 10% total weight
    logo:                 4,
    document_templates:   3,
    custom_roles:         3,
  }

  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0)
  const completedWeight = items
    .filter(item => item.is_complete)
    .reduce((sum, item) => sum + (weights[item.item_key] || 0), 0)

  return Math.round((completedWeight / totalWeight) * 100)
}
```

---

## What Is Built

*Added 2026-09-29.*

**The checklist is real.** `afritech.onboarding_checklist_items` holds all fourteen items with the
weights given in `calculateOnboardingCompletion()` above, exposed as
`public.onboarding_checklist_catalogue`. `public.school_onboarding_completion(school_id)` returns
the weighted percentage, and a critical-only percentage besides — a school at 45% with every
critical item done is ready to use, and one at 45% that has only uploaded a logo cannot take a
register.

The items are **data, not a CHECK constraint**. `0010`'s constraint admitted ten keys while this
document named fourteen, and they drifted for thirteen months without anything noticing — because
nothing ever read the table. Adding a fifteenth item is now an INSERT plus
`public.ensure_onboarding_checklist()` per school.

Business rule 4 is satisfied: `0143` backfills every school. In practice that meant creating all
fourteen items for every school, not just `whatsapp_configured`, since no school had any rows.

**The task queue is built** — `public.onboarding_queue`, `/admin/onboarding`, and
`school_onboarding_contacts`. Four differences from the description above, all deliberate:

*The 24-hour rule is computed, not scheduled.* `outreach_overdue` and `outreach_escalated` are
derived from the first recorded contact against registration time, so the panel is correct with no
scheduler at all. Only the escalation *push* waits on Redis, which does not exist
(`CREDENTIALS_CHECKLIST.md`); `platform_incidents` already exists for it to land in. This is the
better decomposition rather than a workaround — a derived flag cannot drift from reality, and
changing the window from 24 hours to 12 needs no backfill.

*Four of the nine task states are computed and five are stored.* New, Converted, Expired and the
percentage behind Complete are facts about the world. Assigned, In Progress, Not Interested and
Complete are judgements a person makes, and business rule 2 says a task is never closed
automatically — so a self-closing state machine would contradict it.

*The window applies to self-registered schools only.* An AfriTech-created school was created by
somebody who was already talking to it; a countdown on calling them back measures nothing, and a red
row against it would train an operator to ignore red rows.

*A recorded contact cannot be edited or deleted by anybody.* The escalation rules below hand
consequences to a super admin on the strength of these rows. A mistaken entry is corrected by adding
another. A note is required for every outcome except "no answer" and "wrong number", where there was
nobody to quote.

**Pilot onboarding is built; self-registration is not.** `POST /api/admin/schools/provision`
creates the school, its Clerk organisation and its checklist, and invites the owner. Activation
records a verification call — see `SCHOOL_SETUP.md`.

---

## Business Rules

1. Every self-registered school must receive a contact attempt within 24 hours of registration. The scheduled escalation job enforces this by alerting the super admin if no contact is recorded.
2. Onboarding tasks are never automatically closed — a human must mark them as Complete or Converted.
3. Pilot schools (manually created by AfriTech) receive guided onboarding sessions — not just the automated email sequence.
4. The `whatsapp_configured` checklist item is new and required — it must be added to every existing school's checklist retroactively via a migration.
5. Schools that self-register and complete the grade structure step within 24 hours of registration have significantly higher trial-to-paid conversion rates — this step is the top priority during the onboarding call.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 15 admin module documentation |
| 2026-04-26 | Added whatsapp_configured checklist item | School-specific WhatsApp number confirmed |
| 2026-04-26 | Added pilot school onboarding process | September 2026 pilot launch approach |
| 2026-04-26 | Added 24h escalation via the queue | Enforcement of outreach requirement |
| 2026-09-29 | Added *What Is Built* | Checklist implemented as data in `0143` with the documented weights; the four missing items added and backfilled per business rule 4. Task queue and 24-hour escalation still unbuilt, with the no-Redis design recorded. |
| 2026-09-30 | Task queue implemented in `0152` | The 24-hour rule is derived in SQL rather than scheduled, since Redis does not exist. Four task states computed, five stored. Contact log append-only. |
| 2026-09-30 | Pilot sequence amended: activate before importing pupils | Resolved the contradiction with SCHOOL_SETUP.md business rule 4 in favour of the stricter reading. An unverified school cannot create pupil records (`0153`); its configuration stays open. |
