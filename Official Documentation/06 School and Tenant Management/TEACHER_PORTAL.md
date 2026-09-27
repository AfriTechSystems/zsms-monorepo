# TEACHER_PORTAL.md — Standalone Teacher Hub

## Related Documents

- `docs/modules/ai/LESSON_PLANNER.md` — RAG lesson planner powering the Teacher Hub tools
- `docs/modules/auth/AUTH.md` — standalone teacher auth flow and account linking
- `docs/modules/auth/ROLES.md` — platform:teacher role definition
- `docs/DATABASE.md` — standalone_teacher_accounts, lesson_plans tables
- `docs/modules/school/SUBSCRIPTION.md` — standalone teacher subscription pricing
- `docs/modules/admin/PRICING.md` — Teacher Hub pricing managed here

---

## Purpose

This document defines the ZSMS Teacher Hub — the standalone teacher-facing product. Covers the account model, UI structure, available tools, the account linking flow when a school joins ZSMS, and the dual-context navigation for linked teachers. Every Claude Code session building any Teacher Hub feature must read this document.

---

## Overview

The Teacher Hub is a standalone productivity product for teachers, independent of any school. A teacher in Zambia who wants great AI-powered lesson planning tools does not need their school to be on ZSMS — they sign up directly, pay their own subscription, and start creating lesson plans immediately.

When their school later registers on ZSMS (or they move to a school already on ZSMS), their account links seamlessly. All previously created lesson plans remain accessible. They gain school tools (attendance, marks, timetable) alongside their personal tools — no re-registration, no data loss.

---

## The Two Teacher Account States

### State A — Standalone (No School Affiliation)

```
Clerk account: platform:teacher metadata, no org membership
Database: standalone_teacher_accounts row, no school_id
Access: Teacher Hub tools only (lesson planner, quiz generator, homework creator)
Billing: Own subscription (K300/month or K3,000/year)
URL context: zsms.co.zm/teacher/...
```

### State B — School-Linked (After School Joins ZSMS)

```
Clerk account: platform:teacher metadata + org:teacher membership
Database: standalone_teacher_accounts.linked_school_id set to school UUID
Access: Teacher Hub tools AND school dashboard
Billing: Own subscription for personal tools + school covers school platform
URL context: zsms.co.zm/teacher/... AND zsms.co.zm/school/[school-id]/...
```

---

## Teacher Hub Registration Flow

### New Teacher Sign-Up

```
1. Teacher visits zsms.co.zm/teacher
   → Sees: "Lesson planning powered by Zambian curriculum AI"
   → [Start free trial — 5 lesson plans, no credit card]

2. Signs up with email and password
   → Clerk creates account with platform:teacher metadata
   → No Clerk organisation created (standalone — no school)
   → standalone_teacher_accounts row created:
     { subscription_status: 'trial', trial_plans_used: 0, trial_plans_limit: 5 }

3. Profile setup (one screen):
   → Full name
   → Subjects taught (multi-select): Mathematics, Science, English, etc.
   → Grades taught (multi-select): Grade 7, Grade 8, Grade 9, etc.
   → Curriculum: ECZ / Cambridge IGCSE / Cambridge A-Level / Mixed

4. → Teacher Hub dashboard (State A)
```

### Trial to Subscription Conversion

After 5 free plans:
```
You've used your 5 free lesson plans.
Subscribe to continue creating unlimited plans.

Monthly: K300/month
Annual:  K3,000/year (K250/month — 2 months free)

[Subscribe — Monthly]   [Subscribe — Annual]
[Maybe later — view plans only]
```

"Maybe later" allows browsing saved plans but blocks new generation.

---

## Teacher Hub Dashboard (State A — Standalone)

```
┌──────────────────────────────────────────────────────────┐
│ ZSMS Teacher Hub          [My Account]  John Banda       │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Good morning, John!                                      │
│  Grade 8-10 · Mathematics, Science · ECZ                 │
│                                                           │
│  ┌─────────────────┐  ┌─────────────────┐               │
│  │  📝 Lesson       │  │  🧪 Quiz         │               │
│  │     Planner      │  │     Generator    │               │
│  │  Create a plan   │  │  Build a quiz    │               │
│  └─────────────────┘  └─────────────────┘               │
│                                                           │
│  ┌─────────────────┐  ┌─────────────────┐               │
│  │  📋 Homework     │  │  📚 My Library   │               │
│  │     Creator      │  │  47 saved plans  │               │
│  └─────────────────┘  └─────────────────┘               │
│                                                           │
│  Recent Activity                           [View all]    │
│  ─────────────────────────────────────────────────────   │
│  📝 Grade 9 Maths — Simultaneous Equations    Yesterday  │
│  🧪 Grade 9 Maths Quiz — Algebra              2 days ago │
│  📝 Grade 8 Science — Photosynthesis          Last week  │
│                                                           │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 🏫 Is your school on ZSMS?                         │  │
│  │                                                     │  │
│  │ Link your account to access school features like   │  │
│  │ attendance, results, and timetable — while keeping │  │
│  │ all your lesson plans.                              │  │
│  │                                                     │  │
│  │ [Enter invitation code]    [Request an invitation] │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## Available Teacher Hub Tools

### 1. Lesson Planner

The core product. Generates structured lesson plans using the Zambian curriculum knowledge base (RAG). See `docs/modules/ai/LESSON_PLANNER.md` for full technical reference.

**Teacher-facing flow:**
```
[New Lesson Plan]
Subject: [Mathematics ▼]
Grade:   [Grade 9 ▼]
Topic:   [Simultaneous Equations          ]
Type:    ○ Introduction  ● Core  ○ Revision  ○ Exam prep
Duration:[40] minutes
Context: [Students have covered linear equations. Some struggle with fractions.]

[Generate →]

→ Generating... (5-10 seconds)

LESSON PLAN: Simultaneous Equations — Grade 9
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Duration: 40 minutes | ECZ Grade 9 Mathematics

Learning Objectives:
✓ Solve a pair of simultaneous linear equations algebraically
✓ Apply simultaneous equations to solve word problems

[Full lesson plan displayed with all sections]

Curriculum alignment:
✓ ECZ Mathematics Grade 9 Syllabus 2023 — Topic 7.3
✓ Golden Opportunities Mathematics Grade 9 — Chapter 12

[Save to Library]  [Export PDF]  [Export Word]  [Rate this plan ★★★★☆]
```

### 2. Quiz Generator

Generates assessment questions for a topic using the same RAG pipeline.

```
[New Quiz]
Subject: Mathematics    Grade: Grade 9
Topic: Simultaneous Equations
Type: ○ Multiple choice  ● Mixed  ○ Short answer  ○ Extended response
Questions: [10]    Difficulty: ○ Standard  ● Exam-style

[Generate Quiz →]

→ Quiz with 10 questions, answer key, and marking guidelines
```

### 3. Homework Creator

```
[New Homework]
Subject: Mathematics    Grade: Grade 9
Topic: Simultaneous Equations
Duration (minutes): [20]
Include: ☑ Questions  ☑ Instructions  ☐ Answer key (teacher's copy only)

[Generate →]
```

### 4. My Library

All saved lesson plans, quizzes, and homework organised by subject and grade:

```
My Library — 47 items

Filter: [All ▼]  [Mathematics ▼]  [Grade 9 ▼]

Subject          Grade   Topic                          Created
Mathematics      Grade 9  Simultaneous Equations         Yesterday
Mathematics      Grade 9  Quadratic Equations            Last week
Science          Grade 8  Photosynthesis                 2 weeks ago
...

[Bulk export]  [Share selected]
```

### 5. Community Library (Phase 3)

Browse lesson plans shared publicly by other ZSMS teachers:

```
Community Library

Most popular this week:
★★★★★ Grade 9 Mathematics — Pythagoras Theorem (shared by 3 teachers)
★★★★☆ Grade 8 Science — Cell Structure (shared by 5 teachers)

Filter by: Subject / Grade / Curriculum / Rating

[Use this plan]  → Opens in lesson planner pre-filled, teacher can edit before saving
```

Teachers choose which of their plans to share publicly. Shared plans show the teacher's first name and subject specialty — never their full name, school, or contact details.

---

## Account Linking Flow

### Scenario 1 — School Admin Invites an Existing Standalone Teacher

```
Admin: Settings → Staff → Invite Teacher → enters john.banda@gmail.com

System checks: Does this email have an existing ZSMS account?
→ Yes — standalone_teacher_accounts row found

Invite email sent to John:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Subject: Sunrise Academy has invited you to join their school on ZSMS

Hi John,

Sunrise Academy has invited you to join their school on ZSMS.

Good news: You already have a ZSMS Teacher Hub account.
Linking it to Sunrise Academy takes one click — all your
lesson plans and tools remain exactly as they are.

After linking, you'll have access to:
✓ Attendance marking (your classes)
✓ Marks entry
✓ Timetable view
✓ Your existing lesson plans (unchanged)

[Accept & Link Account →]   [Decline]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Teacher clicks Accept & Link:
→ Clerk: org:teacher membership created for school's Clerk org
→ Database: standalone_teacher_accounts.linked_school_id = school UUID
→ staff_members row created (school scope)
→ Teacher redirected to linked dashboard (State B)
```

### Scenario 2 — Teacher Signs Up After School Invites Them

If a teacher signs up via an invite link without having a previous account:
```
→ Clerk creates account with org:teacher membership immediately
→ standalone_teacher_accounts row also created (linked from day one)
→ Teacher has both contexts from first login
→ Teacher Hub tools available immediately
```

### Scenario 3 — Existing School Teacher Activates Teacher Hub

A teacher already at a ZSMS school who wants personal tool access:
```
Teacher profile → Activate Teacher Hub
→ standalone_teacher_accounts row created (linked_school_id already set)
→ Free trial: 5 lesson plans
→ Teacher Hub appears in their navigation
```

---

## Dual-Context Navigation (State B — Linked Teacher)

After linking, the top navigation shows both contexts:

```
┌──────────────────────────────────────────────────────────────┐
│  ZSMS  [My Tools ▼]  [Sunrise Academy ▼]            John B. │
└──────────────────────────────────────────────────────────────┘

[My Tools ▼] dropdown:              [Sunrise Academy ▼] dropdown:
  📝 Lesson Planner                    🏫 School Dashboard
  🧪 Quiz Generator                    📅 Attendance
  📋 Homework Creator                  📊 Marks Entry
  📚 My Library                        📆 My Timetable
  ────────────────                     👥 My Classes
  ⚙️ My Account                        ────────────────
                                       ⚙️ School Settings (if owner)
```

The two contexts have completely separate navigation trees. Personal lesson plans are never mixed with school student data. Switching context is a client-side navigation change — no new authentication required.

**Active context indicator:**
The active context (My Tools vs school name) is highlighted in the navigation so the teacher always knows which context they are in.

---

## Context Detection and Routing

```typescript
// apps/web/middleware.ts
async function detectTeacherContext(userId: string, pathname: string) {
  const [standalone, orgMemberships] = await Promise.all([
    getStandaloneTeacherAccount(userId),
    getClerkOrgMemberships(userId),
  ])

  const schoolMemberships = orgMemberships.filter(m =>
    m.role.startsWith('org:')
  )

  // Route /teacher/* — requires platform:teacher
  if (pathname.startsWith('/teacher')) {
    if (!standalone) {
      return redirect('/teacher/signup')
    }
    return next()  // standalone access
  }

  // Route /school/* — requires org membership
  if (pathname.startsWith('/school')) {
    if (schoolMemberships.length === 0) {
      return redirect('/teacher')  // redirect to Teacher Hub if no school
    }
    return next()
  }
}

// Home page routing — what does the teacher see after login?
function getHomeRoute(context: TeacherContext): string {
  if (context.type === 'dual') {
    // Most recently active context — stored in user preferences
    return context.lastActiveContext === 'school'
      ? `/school/${context.primarySchoolId}/dashboard`
      : '/teacher'
  }
  if (context.type === 'standalone') return '/teacher'
  if (context.type === 'school_only') return `/school/${context.primarySchoolId}/dashboard`
}
```

---

## Teacher Hub Subscription Management

Teachers manage their own subscription from their account settings:

```
My Account → Subscription

Current plan: Monthly · K300/month
Next billing: 15 October 2026

Plans generated: 47 total (this month: 12)

[Change to Annual — save K600/year]
[Cancel subscription]

Cancel confirmation:
"Your lesson plans will remain accessible for reading.
 New plan generation will stop at end of billing period."
```

On cancellation: `subscription_status = 'cancelled'`, plans remain readable, new generation blocked after `subscription_ends_at`.

---

## Phase 3 — Teacher Hub Expansion

When ZSMS registers as an MFI, additional tools become available to standalone teachers:

**Professional Loans:**
Teachers can apply for loans independently:
- Device loan (laptop/tablet for teaching — up to K8,000)
- Professional development loan (workshops, courses — up to K3,000)
- Personal loan (up to K5,000)

These use the same loan application flow but without a school fee record (`fee_record_id = NULL`). The teacher's ZSMS subscription payment history contributes to their behaviour score.

**CPD Portfolio:**
Teachers build a verifiable record of:
- Lesson plans created (count and subjects)
- Community plans shared and their ratings
- Professional development activities
- Teaching subjects and grade levels

The CPD Portfolio is exportable as a PDF for job applications. It becomes a credential — a teacher with 200 highly-rated ZSMS lesson plans is verifiably a prolific, curriculum-aligned educator.

---

## Business Rules

1. Standalone teacher accounts are created via the Teacher Hub signup flow — never via school invitation alone. School invitations create org membership but also trigger standalone_teacher_accounts creation.
2. All lesson plans belong to the teacher (`created_by = clerk_user_id`), not the school. A teacher who leaves a school retains their lesson plans.
3. Account linking never deletes or modifies existing lesson plans. It only sets `linked_school_id` and creates the Clerk org membership.
4. A teacher can be linked to multiple schools (e.g. teaches at two different schools). Both school contexts appear in the navigation dropdown.
5. If a standalone teacher's subscription lapses, they lose plan generation but retain read access to all saved plans permanently.
6. The Teacher Hub free trial (5 plans) is per account — not per device or per period. A teacher gets exactly 5 free plans, ever.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Standalone Teacher Hub confirmed as B2C product |
| 2026-04-26 | Account linking flow defined | Teachers must link seamlessly when school joins ZSMS |
| 2026-04-26 | Dual-context navigation designed | Linked teachers need access to both personal tools and school |
| 2026-04-26 | Phase 3 expansion documented | Professional loans and CPD portfolio as future features |
| 2026-09-27 | **Built: migration `0130`, five API routes, five screens, 23 pgTAP assertions** | `/teacher` (profile setup + dashboard), `/teacher/create`, `/teacher/library`, `/teacher/library/[id]`, `/teacher/account`; `GET/POST/PATCH /api/teacher/hub`, `/api/teacher/hub/resources`, `/api/teacher/hub/resources/[id]`, `DELETE /api/teacher/hub/subscription`, `/api/admin/teacher-hub`. |
| 2026-09-27 | **The AI is not wired, and the screens say so** | No Anthropic SDK, no key, and no curriculum knowledge base has ever been ingested. `packages/ai` is the seam and `templateGenerator` produces a genuinely useful timed lesson scaffold. Every result carries `modelGenerated: false` and the Hub labels it in words: a teacher paying for AI lesson planning who is handed a template unlabelled has been misled. |
| 2026-09-27 | **No Subscribe button; activation is AfriTech's alone** | Payment is recorded by hand, as for school billing. A teacher-callable activation would make the paid product free to anyone who found the endpoint, so `teacher_hub_activate_subscription()` refuses anybody who is not AfriTech and the account screen shows payment instructions instead. |
| 2026-09-27 | **Business rule 4 contradicted the schema it specified** | The DDL gave `standalone_teacher_accounts` a single `linked_school_id` while rule 4 allows several schools. Resolved by dropping the column: `my_schools()` already answers it for any number of schools. |
| 2026-09-27 | **Metering moved to the platform AI credit ledger (`0132`–`0133`)** | The Hub's private `trial_resources_used` counter is retired and backfilled. Five free resources is now a five-credit **lifetime** allowance, so business rule 6 is unchanged. `trial_resources_used` is deprecated and no longer written. |
| 2026-09-27 | **Paid plans gained a 60-credit monthly allowance; "unlimited" is withdrawn** | Unlimited generation for K300/month was safe only while the generator was a template costing nothing to run. With a model behind it, unlimited is an uncapped liability and exactly the flat-price-over-metered-cost trap `AI_CAPTURE.md` warns against. The number is configuration in `afritech.teacher_hub_plans`, so it is a business decision rather than a code change. Top-up credits extend it. |
| 2026-09-27 | Community Library, PDF/Word export and an invitation-code box deliberately not built | Community Library is Phase 3 and needs a SECURITY DEFINER function rather than a widened policy, so a shared plan never exposes `created_by`. Export is browser print. There is no invitation code to type: ZSMS invites staff server-side, so the dashboard says to ask the school to invite you. |
