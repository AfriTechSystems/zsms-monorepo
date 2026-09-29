# SCHOOL_SETUP.md — School Registration and Setup

## Related Documents

- `docs/modules/school/SCHOOL_CONFIG.md` — post-registration configuration
- `docs/modules/school/SUBSCRIPTION.md` — subscription tiers and billing
- `docs/modules/school/TRIAL.md` — 30-day free trial model
- `docs/modules/school/PUBLIC_DIRECTORY.md` — public school directory
- `docs/modules/auth/AUTH.md` — school owner authentication flows
- `docs/modules/auth/ROLES.md` — AfriTech internal roles for onboarding
- `docs/modules/auth/PERMISSIONS.md` — permission grant system
- `docs/infra/CLERK.md` — Clerk Organisation creation
- `docs/infra/SUPABASE.md` — school record creation
- `docs/DATABASE.md` — schools and onboarding_checklists tables
- `docs/api/EDGE_FUNCTIONS.md` — school-onboard Edge Function

---

## Purpose

This document defines every path by which a school gets onto the ZSMS platform — AfriTech manually onboarding a school, and a school self-registering. It covers school ID generation, Clerk Organisation creation, trial activation, verification workflow, and what happens during and after the pending verification period. Every Claude Code session that touches the school creation flow must read this document.

---

## Overview

A school reaches the ZSMS platform through one of two paths. The pilot phase (September 2026) uses exclusively the manual onboarding path — AfriTech creates each school account directly. From the commercial launch (January 2027), the self-registration path opens, allowing school owners to sign up independently with a 30-day free trial.

Both paths result in the same database state — a row in `public.schools` with a generated school ID, a corresponding Clerk Organisation, and a set of onboarding checklist items. The difference is who initiates the process and what the initial `status` value is.

---

## School ID Generation

Every school on the ZSMS platform has a permanent, immutable school ID. The format is:

```
ZM-LSK-0001
{COUNTRY_CODE}-{CITY_CODE}-{4_DIGIT_SEQUENCE}
```

**Country code:** ISO 3166-1 alpha-2 uppercase (ZM for Zambia, BW for Botswana)
**City code:** Three-letter uppercase code from the country config cities map
**Sequence:** Four-digit zero-padded integer, auto-incremented per city

Examples:
- `ZM-LSK-0001` — first school in Lusaka, Zambia
- `ZM-LSK-0042` — forty-second school in Lusaka
- `ZM-CBE-0003` — third school on the Copperbelt
- `BW-GAB-0001` — first school in Gaborone, Botswana

**Generation logic in the `school-onboard` Edge Function:**

```typescript
async function generateSchoolId(
  countryCode: string,
  cityCode: string
): Promise<string> {
  // Get the next sequence number for this country-city combination
  const { data } = await supabaseAdmin.rpc('get_next_school_sequence', {
    p_country_code: countryCode,
    p_city_code: cityCode,
  })

  const sequence = data.toString().padStart(4, '0')
  return `${countryCode}-${cityCode}-${sequence}`
}
```

```sql
-- PostgreSQL function for atomic sequence generation
CREATE OR REPLACE FUNCTION get_next_school_sequence(
  p_country_code TEXT,
  p_city_code TEXT
) RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  v_next INT;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SPLIT_PART(school_id, '-', 3) AS INT)
  ), 0) + 1
  INTO v_next
  FROM public.schools
  WHERE country_code = p_country_code
    AND city_code = p_city_code;

  RETURN v_next;
END;
$$;
```

The school ID is generated atomically within the onboarding transaction. Once assigned, it never changes — even if the school changes its name, moves city, or transfers ownership.

---

## Path 1 — AfriTech Manual Onboarding (Pilot Phase)

Used for all pilot schools and any school that AfriTech onboards directly as part of a partnership or enterprise agreement.

### Who Can Initiate

Only users with the `afritech:super_admin` or `afritech:regional_manager` role can create school records. The API endpoint `POST /api/schools/onboard` enforces this.

### The Onboarding Form

The AfriTech admin panel shows a school creation form with these fields:

**Required:**
- School name
- School type (Day / Boarding / Both)
- School level (Pre-school / Primary / Secondary / Combined / A-Level)
- Country (defaults to ZM — Zambia)
- Province
- City (dropdown from country config cities)
- School owner first name
- School owner last name
- School owner email
- School owner phone (E.164 format)
- Subscription tier (defaults to Starter)

**Optional:**
- Physical address
- School registration number (for AfriTech verification records — not shown to parents)
- Notes (internal AfriTech notes — not shown to school)

**Pre-configured default role set by school type:**

When creating a school, AfriTech can optionally apply a default custom role template. This pre-creates suggested custom roles appropriate for the school type so the owner sees relevant role suggestions on first login.

| School Type | Pre-created Custom Role Suggestions |
|---|---|
| Day school | Class Monitor, Library Assistant |
| Boarding school | Head of Boarding, Dormitory Matron/Master, Dining Manager, Catering Staff, School Nurse |
| Combined | All of the above |

These are suggestions only — the school owner can rename, delete, or add their own custom roles at any time.

### What Happens on Submission

```
1. Input validated with Zod schema
2. School ID generated (atomic sequence)
3. Clerk Organisation created:
   - name: school name
   - slug: lowercase school_id with hyphens (zm-lsk-0001)
4. School record inserted into public.schools:
   - status: 'pending_verification'
   - subscription_tier: selected tier
   - trial_ends_at: NULL (manual onboarding skips trial)
5. Onboarding checklist rows created (all items incomplete)
6. Custom role template applied if selected
7. School owner Clerk user account created (or looked up if existing)
8. School owner added to Clerk Organisation as org:owner
9. Welcome email sent to owner via Resend
10. In-app notification created in AfriTech admin panel
11. Audit log entry written
```

### Verification and Activation

After creation, the school status is `pending_verification`. AfriTech calls the school owner to confirm details and verify the school is legitimate. Once verified:

```
AfriTech admin opens the school in the admin panel
→ Clicks "Activate School"
→ Status changes to 'active'
→ School owner receives welcome notification: "Your ZSMS account is now active"
→ School appears in the public directory
→ Audit log entry written
```

---

## Path 2 — School Self-Registration (From January 2027)

School owners discover ZSMS and register independently. No AfriTech involvement until post-registration outreach.

### The Registration Page

URL: `zsms.co.zm/register`
Authentication: None required — fully public

**Step 1 — School Details:**
- School name (required)
- School type: Day / Boarding / Both (required)
- School level: Pre-school / Primary / Secondary / Combined / A-Level (required)
- Country (auto-detected from domain — ZM for zsms.co.zm)
- Province (required — dropdown)
- City (required — dropdown from province)

**Step 2 — Owner Details:**
- First name (required)
- Last name (required)
- Email address (required — used for account creation)
- Phone number (required — E.164, used as parent-style identity)
- How did you hear about us? (optional dropdown — word of mouth / social media / referred by school / other)

**Step 3 — Confirmation:**
- Summary of entered details
- Terms of Service checkbox (required)
- Privacy Policy checkbox (required)
- "Start Free Trial" button — no payment, no credit card

### What Happens on Submission

```
1. Input validated
2. School ID generated
3. Clerk Organisation created
4. School record inserted:
   - status: 'trial'
   - subscription_tier: 'starter'
   - trial_ends_at: NOW() + 30 days
5. Onboarding checklist rows created
6. School owner Clerk account created with email OTP verification
7. Owner receives welcome email with portal link
8. AfriTech admin panel: notification created — "New trial school — contact within 24h"
9. queued job scheduled: AfriTech outreach reminder in 24 hours
10. School appears in public directory immediately (as 'trial' badge)
11. PostHog event: school_trial_started
12. Audit log entry written
```

### Trial Period Behaviour

During the trial:
- Full access to all modules (subject to WhatsApp quota of 250 messages)
- A persistent banner on every page: "Trial — X days remaining. [Subscribe Now]"
- No payment required — no credit card collected
- AfriTech contacts within 24 hours for onboarding assistance
- Data entered during trial is preserved when they subscribe

See `docs/modules/school/TRIAL.md` for complete trial lifecycle documentation.

---

## School Status Lifecycle

```
pending_verification  → active         (AfriTech manually activates)
trial                 → active         (School subscribes during trial)
trial                 → trial_expired  (30 days elapse without subscribing)
trial_expired         → active         (School subscribes after expiry)
active                → suspended      (Subscription lapses — 7-day grace)
suspended             → active         (School renews subscription)
suspended             → terminated     (AfriTech terminates — data archived)
```

**Status effects on school functionality:**

| Status | Login | Read Data | Write Data | Public Directory |
|---|---|---|---|---|
| pending_verification | ✅ | ✅ | Limited | ❌ |
| trial | ✅ | ✅ | ✅ | ✅ (trial badge) |
| trial_expired | ✅ | ✅ | ❌ | ✅ |
| active | ✅ | ✅ | ✅ | ✅ |
| suspended | Owner only | ✅ | ❌ | ❌ |
| terminated | ❌ | ❌ | ❌ | ❌ |

---

## Onboarding Checklist

Every school gets a set of onboarding checklist items created at registration. These drive the setup completion indicator on the school dashboard and in the AfriTech admin panel.

**Critical items (blocks core functionality if missing):**

| Item Key | Description | Blocks |
|---|---|---|
| `school_profile` | Name, type, level, contact details | Nothing — always partially complete |
| `grade_structure` | Grade levels configured | Student import, attendance, results |
| `grading_system` | Grading scale selected | Results and report cards |
| `subjects` | Subject list configured | Marks entry |
| `fee_structure` | At least one fee structure for current term | Fee tracking, payment recording |

**Important items (reduces value if missing):**

| Item Key | Description |
|---|---|
| `first_student` | At least one student added or imported |
| `first_staff` | At least one staff member (teacher) invited |
| `parent_links` | At least one parent linked to a student |
| `payment_gateway` | Online payment gateway configured |
| `term_dates` | Current term start and end dates set |

**Optional items:**

| Item Key | Description |
|---|---|
| `logo` | School logo uploaded |
| `document_templates` | Report card and receipt template customised |
| `custom_roles` | Custom staff roles created |

**Checklist completion percentage:**
- Critical items: 60% weight
- Important items: 30% weight
- Optional items: 10% weight

The completion percentage is shown as a progress bar on the school dashboard and as a health indicator in the AfriTech admin panel.

---

## AfriTech View of All Schools

The AfriTech super admin panel shows every school with a health status indicator:

**Green — Healthy:**
- Status: active
- Checklist: 80%+ complete
- Activity: Data written in last 7 days

**Amber — Needs Attention:**
- Status: trial (more than 20 days in)
- Checklist: Under 40% complete
- Activity: No data written in last 14 days

**Red — At Risk:**
- Status: trial_expired or suspended
- Checklist: Under 20% complete
- Activity: No data written in last 30 days

Each school card in the admin panel shows a "Contact" button that opens a quick action panel — send a reminder email, schedule an outreach call, assign to a support agent, or change subscription tier.

---

## What Is Built, and Where It Differs From The Above

*Added 2026-09-29, when Path 1 was implemented. Everything above this section was written before
development; this section is written from the applied schema.*

**Path 1 is built. Path 2 is not.** A school is created through `POST /api/admin/schools/provision`
and the *Add school* screen at `/admin/schools/new`. Self-registration has no route, no page and no
public entry point.

### Four differences from the flow described above

| Documented | Built | Why |
|---|---|---|
| `school-onboard` Edge Function | `public.admin_create_school()` plus an API route | `supabase/functions/` is empty and PostgREST serves only `public`. A function is testable by pgTAP; an Edge Function is not. |
| One flow creating school and Clerk org | Three steps: create → create org → attach | Postgres cannot roll back an HTTP call. Between steps the school holds a `pending_` placeholder for `clerk_org_id`, which matches no JWT — so it is reachable by nobody rather than half-open. |
| "School owner Clerk user account created" | The owner is **invited** | Clerk is email-OTP only, so a created user has no credential to send and must verify anyway. An invitation expires by itself; an orphan user account does not. |
| `get_next_school_sequence()` as `MAX + 1` | Same, under `pg_advisory_xact_lock` on country+city | The documented form lets two concurrent creations mint the same identifier, and the UNIQUE constraint then fails one rather than giving it the next number. |

### Province

Both forms above require Province; the schema had only `city_code`. `0142` adds
`schools.province_code` using ZM.md's ten codes. **City codes were not touched** — a city code sits
inside every school identifier, and every pupil number and receipt number derived from it.

### Verification

Decided 2026-09-29: verification is a **phone call recorded as a note**, not a document check.
`admin_activate_school()` requires a non-empty note, because the note is the whole of the evidence
and an activation without one is a tick box pretending to be a control.

### The status effects table is NOT enforced

The lifecycle table above says `trial_expired` and `suspended` schools may read and not write.
**Nothing in the schema enforces that today, for any status.** `0142` makes the status recordable
and correct; making it binding touches every policy in the database and is its own migration.

---

## Business Rules

1. School IDs are permanent and immutable. Once assigned, a school ID never changes regardless of name changes, location changes, or ownership transfers.
2. The `afritech-systems-admin` Clerk organisation slug is permanently reserved. The school ID generation function validates that no school receives a slug matching reserved values.
3. Self-registering schools receive status `trial` — never `pending_verification`. Only AfriTech manually onboarded schools receive `pending_verification`.
4. A school in `pending_verification` status can log in and enter basic configuration (grade structure, subjects) but cannot invite parents or import students until activated.
5. AfriTech outreach must happen within 24 hours of any self-registration. The scheduled job creates a task in the admin panel at the 24-hour mark if no outreach has been recorded.
6. School data entered during a trial is preserved indefinitely — it is never automatically deleted when a trial expires. Deletion requires a manual AfriTech super admin action.
7. Custom role templates applied during manual onboarding are suggestions only. The school owner can modify or delete them at any time.

---

## Edge Cases and Error Handling

**School owner email already has a Clerk account:** The onboarding function detects the existing Clerk user and adds them to the new Organisation as `org:owner` rather than creating a duplicate account. The school owner receives an invitation to their existing email.

**Duplicate school name in the same city:** Allowed — two schools named "Sunrise Academy" in Lusaka can both exist with different school IDs (ZM-LSK-0015 and ZM-LSK-0023). The school ID is the unique identifier, not the name.

**School registered with wrong city:** AfriTech admin can update the `city_code` field in the school record. The school ID is not regenerated — it retains the original city code. This is acceptable and documented — the school ID is a permanent identifier, not a live city indicator.

**Self-registration attempt for a country not yet launched:** The registration page reads `NEXT_PUBLIC_COUNTRY_CODE` — if the domain is `zsms.co.zm` (ZM), only Zambia configuration is available. Attempting to register a Botswana school on the Zambia deployment is prevented by the city dropdown being limited to Zambia cities.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 6 school module documentation |
| 2026-04-26 | Added custom role template on onboarding | Custom roles feature confirmed |
| 2026-04-26 | Added school status lifecycle table | Clarity on what each status permits |
| 2026-09-29 | Added *What Is Built, and Where It Differs* | Path 1 implemented in `0142`–`0144`. Four deviations recorded with reasons, plus the province addition and the explicit note that status effects are not enforced. |
