# PARENT_LINKING.md — Parent Account Linking

## Related Documents

- `docs/modules/students/STUDENTS.md` — student lifecycle including graduation
- `docs/modules/students/TRANSFER.md` — transfer flow and alumni access
- `docs/DATABASE.md` — parents, student_parent_links, alumni_profiles tables
- `docs/modules/communication/WHATSAPP.md` — notification opt-in
- `docs/RLS.md` — parent access policies

---

## Implementation Status (2026-10-11)

**Built, including the part most likely to have been skipped.**

The 30-day grace period after unlinking **is honoured** — `is_linked_parent_of()` admits
`is_active = TRUE OR (is_active = FALSE AND grace_period_ends_at > NOW())`, so a parent
keeps access for the window this document describes rather than losing it the moment a
school unlinks them.

`claim_parent_links()` matches a parent to their children by **verified email** from the
Clerk token, across every school at once. It takes no arguments on purpose: a function
accepting an email would let any signed-in user link to an address they do not own.

`request_parent_link_by_phone()` handles the phone-only parent, raising a claim the
school approves by hand — the OTP that would justify auto-linking needs a delivery
channel that does not exist yet.

**The two opt-in fields are genuinely separate**, as this document insists:
`whatsapp_opted_in` defaults TRUE and governs service messages; `marketing_opt_in`
defaults FALSE and is AfriTech's. `0229` asserts both defaults at migration time, so a
later change to the legal basis cannot happen quietly.

---

## Purpose

This document defines the complete parent account model — how parents are linked to students, what the marketing_opt_in field controls, how parent accounts persist permanently after graduation, and the alumni promotional content opt-in. Every Claude Code session building any parent-related feature must read this document.

---

## Parent Account Model

A parent in ZSMS is a platform-level identity (`parents` table) linked to one or more students across one or more schools via `student_parent_links`. A parent's account is not deleted when a student leaves — it persists permanently, eventually converting to an alumni account.

```
Parent (parents table — platform level)
    ↓ student_parent_links
Student A (School X) ← currently enrolled
Student B (School Y) ← graduated — alumni
```

---

## Parent Fields

Key fields on `public.parents`:

```sql
id                UUID PRIMARY KEY
clerk_user_id     TEXT UNIQUE — Clerk account
full_name         TEXT NOT NULL
phone_e164        TEXT — +260977123456
email             TEXT
whatsapp_opted_in BOOLEAN DEFAULT TRUE
-- Controls school notification messages (fees, results, attendance)
marketing_opt_in  BOOLEAN DEFAULT FALSE
-- Controls AfriTech promotional content (scholarships, marketplace)
-- ALWAYS defaults to FALSE — never pre-ticked
created_at        TIMESTAMPTZ
updated_at        TIMESTAMPTZ
```

---

## Two Opt-In Fields — Critical Distinction

### `whatsapp_opted_in`
Controls whether the parent receives **school operational notifications** via WhatsApp:
- Fee reminders and receipts
- Absence alerts (if school has per-absence alerts enabled)
- Monthly attendance summaries
- Results published notifications
- School announcements

Default: `TRUE` — parents expect to receive school communications.
Parents can turn this off from their portal profile settings.

### `marketing_opt_in`
Controls whether **AfriTech** can send promotional content:
- Scholarship opportunities for graduated students
- Study abroad programmes
- Marketplace promotions (educational materials, uniforms)
- Career opportunities for Form 6 graduates

Default: `FALSE` — always opt-in, never opt-out.
This field is completely separate from `whatsapp_opted_in`. Turning off school WhatsApp notifications does NOT affect marketing opt-in, and vice versa.

**Marketing opt-in is captured at three points:**
1. Graduation flow — prompt shown after graduation notification
2. Transfer flow — prompt shown after transfer completion
3. Parent profile settings — can be toggled at any time

**Marketing opt-in is NEVER:**
- Pre-ticked in any form
- Set to TRUE by default
- Set automatically without explicit parent action
- Required for any ZSMS feature

---

## Linking a Parent to a Student

### Method 1 — During Bulk Import

When importing students with a parent phone number column, ZSMS automatically:
1. Looks up or creates the parent account by phone number
2. Creates a `student_parent_links` row
3. Sends a WhatsApp or email invitation to the parent to activate their portal

### Method 2 — Manual Linking by Admin

```
Student profile → Parents → Link Parent

Search by phone: [+260977123456]
→ If found: Link [Grace Mwale] to Chanda Bwalya
→ If not found: Create new parent account
   Name: [text field]
   Phone: [+260977123456]
   Email: [optional]
   [Create and link]

Relationship: ● Mother  ○ Father  ○ Guardian  ○ Other
Is primary contact: ☑ (receives all notifications)
```

### Method 3 — Parent Self-Registration

Parents can claim their child's record by entering the student ID:

```
Parent portal → Link my child
Student ID: STU-ZM-LSK-0001-00042
[Request link]
→ School admin receives notification to approve
→ Admin approves → parent linked
```

---

## Primary Contact

Every student should have one primary contact (`student_parent_links.is_primary = TRUE`). The primary contact receives all automated notifications (fee reminders, absence alerts, results notifications). Secondary contacts receive announcements and major updates only.

```sql
-- Only one primary contact per student
CREATE UNIQUE INDEX idx_spl_primary
  ON public.student_parent_links(student_id)
  WHERE is_primary = TRUE AND is_active = TRUE;
```

---

## Grace Period After Unlinking

When a parent is unlinked from a student, their access continues for 30 days (the grace period). This allows parents to:
- Download any final reports
- Access receipts for recently paid fees
- Review the student's final results

After 30 days, the link fully deactivates and the parent can no longer access the student's data through the school portal.

```sql
student_parent_links.is_active = FALSE
student_parent_links.grace_period_ends_at = NOW() + INTERVAL '30 days'
```

---

## Parent Account After Graduation

When a student graduates, the parent's account does NOT get deleted or deactivated. The process:

```
Student graduates
       ↓
parent.whatsapp_opted_in preserved (unchanged)
parent.marketing_opt_in prompted (opt-in screen shown)
       ↓
If parent has OTHER active children at ZSMS schools:
→ org:parent role retained for those schools
→ Alumni access added for the graduated student

If ALL children have graduated:
→ org:parent Clerk membership ends
→ platform:alumni role assigned
→ Full alumni access to all historical records
```

This means a parent with children at multiple schools retains full school portal access for the schools where their children are still enrolled.

---

## Alumni Promotional Content

Once `marketing_opt_in = TRUE`, the parent enters AfriTech's alumni marketing audience. This is a valuable audience for:
- Scholarship announcements targeted by graduation year and subject performance
- Study abroad partnerships
- Educational marketplace promotions
- Career placement services for graduates

AfriTech limits marketing messages to maximum **4 per month** per parent regardless of how many graduated children they have. Parents can opt out at any time from their alumni portal profile settings.

Marketing messages are sent via:
- WhatsApp (uses AfriTech's own quota — never the school's quota)
- Email via Resend

Marketing messages are clearly identified as coming from AfriTech, not from the school.

---

## Business Rules

1. `marketing_opt_in` defaults to FALSE and can only be set to TRUE by explicit parent action. It is never set by AfriTech staff, school admins, or automated processes without the parent's explicit click.
2. `whatsapp_opted_in` and `marketing_opt_in` are completely independent fields. Changing one never affects the other.
3. The primary contact flag (`is_primary`) has a UNIQUE index preventing more than one primary contact per student at any time.
4. Parent accounts persist permanently — they are never deleted. If a parent requests account deletion, their personal data (name, phone, email) is anonymised but the account record and payment history references are retained for audit purposes.
5. Alumni marketing messages count against AfriTech's own WhatsApp quota — never against the school's quota.
6. The grace period (30 days after unlinking) is enforced by the RLS policy checking `grace_period_ends_at`. After expiry, the parent's access to that student's data ends automatically.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Parent linking reference |
| 2026-04-26 | Added marketing_opt_in field | Alumni promotional content — separate from school notifications |
| 2026-04-26 | Added permanent account persistence after graduation | Graduated account model confirmed |
| 2026-04-26 | Added alumni promotional content flow | AfriTech marketing revenue stream |
| 2026-04-26 | Clarified two opt-in field distinction | Critical — whatsapp_opted_in and marketing_opt_in are independent |
