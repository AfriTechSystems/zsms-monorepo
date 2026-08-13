# CONSENT.md — Loan Application Consent Flow

## Related Documents

- `docs/modules/loans/LOANS.md` — loan module overview
- `docs/modules/loans/APPLICATION.md` — application form that follows consent
- `docs/modules/loans/SUBMISSION.md` — security model including consent layer
- `docs/modules/loans/LENDER_INTEGRATION.md` — lender whose name appears in consent
- `docs/DATABASE.md` — private.loan_consent_log table
- `docs/RLS.md` — consent log immutability policies

---

## Purpose

This document defines the explicit consent flow that every parent must complete before any loan application data is collected. It covers the consent screens, the consent text, scroll verification, the consent log record, and why this design satisfies Zambian financial services and data protection requirements. Every Claude Code session building the consent flow must read this document in full.

---

## Overview

Consent for the loan module is the most legally sensitive user flow in ZSMS. It is not a checkbox at the bottom of a form. It is a deliberate, informed, lender-specific consent process that creates a permanent, cryptographically verifiable record of what the parent agreed to, when, and under what terms.

The consent must be:
- **Explicit** — no pre-ticked boxes, no implied consent
- **Informed** — the parent must understand what they are consenting to
- **Lender-specific** — consent for Lender A does not cover Lender B
- **Verifiable** — the exact text shown must be reproducible from the stored hash
- **Immutable** — once recorded, the consent log cannot be modified by anyone

---

## Consent Flow — Three Screens

### Screen 1 — Introduction and Explanation

This screen appears before the parent selects a lender or sees any application form.

```
Apply for a School Fee Loan
━━━━━━━━━━━━━━━━━━━━━━━━━━

Sunrise Academy has enabled school fee loan referrals
through ZSMS Finance.

What this means:
✓ AfriTech Systems (ZSMS) will collect your application
✓ Your application will be shared with a lending partner
✓ If approved, the lender pays your fees directly to the school
✓ You repay the lender in monthly instalments

What ZSMS is NOT:
✗ ZSMS is not a lender — we do not provide the loan
✗ ZSMS does not guarantee approval
✗ ZSMS does not set the interest rate or terms

Your financial information is encrypted and shared only
with the lender you select. We never sell your data.

[Continue →]   [Cancel]
```

**Cancel** returns to the fee record page. No data is collected at this point.

### Screen 2 — Lender Selection and Specific Consent

After selecting a lender, the full consent text is displayed. The parent must scroll to the bottom before the confirmation checkbox appears.

**Scroll verification implementation:**
```typescript
// Track scroll position in the consent text container
const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false)

const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
  const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 20  // 20px tolerance
  if (isAtBottom) setHasScrolledToBottom(true)
}

// Checkbox only appears when hasScrolledToBottom is true
```

**The consent text (stored verbatim and hashed):**

```
CONSENT TO SHARE PERSONAL AND FINANCIAL INFORMATION

I, [Parent Full Name], hereby consent to the following:

1. DATA SHARING
   I consent to AfriTech Systems Limited (operator of ZSMS)
   collecting and sharing my personal and financial information
   with [LENDER NAME] for the purpose of assessing my loan
   application for school fees at [School Name].

2. INFORMATION TO BE SHARED
   The following information will be shared with [LENDER NAME]:
   - My full name and contact details
   - My employment details and declared monthly income
   - My income documentation (payslip or equivalent)
   - My child's name, grade, and fee balance at [School Name]
   - My payment history score calculated by ZSMS
   - The details of this consent, including the date and time

3. PURPOSE OF SHARING
   This information is shared solely for the purpose of
   assessing and processing my loan application. [LENDER NAME]
   will not use this information for any other purpose without
   my additional consent.

4. NO GUARANTEE OF APPROVAL
   I understand that submitting this application does not
   guarantee loan approval. The lending decision is made
   entirely by [LENDER NAME] based on their own criteria.

5. REPAYMENT OBLIGATION
   I understand that if a loan is approved and disbursed, I am
   personally responsible for repaying the full amount including
   interest and fees to [LENDER NAME] according to the agreed
   repayment schedule.

6. ACCURACY OF INFORMATION
   I confirm that all information I provide in this application
   is accurate and complete. I understand that providing false
   information may constitute fraud.

7. DATA PROTECTION
   My data is processed in accordance with the Zambia Data
   Protection Act 2021 and AfriTech Systems' Privacy Policy.
   I have the right to request access to, correction of, or
   deletion of my personal data by contacting
   privacy@afritechsystems.com

8. WITHDRAWAL OF CONSENT
   I may withdraw this consent at any time before my application
   is submitted to [LENDER NAME] by closing this form. After
   submission, withdrawal requests should be directed to
   [LENDER NAME] directly.

This consent was provided on [DATE] at [TIME] [TIMEZONE].
Application reference: [GENERATED ON SUBMISSION]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☐ I have read and understood the above consent statement.
  I freely and voluntarily consent to the sharing of my
  personal and financial information with [LENDER NAME]
  for the purpose of processing my loan application.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Checkbox only appears after scrolling to this point]

[I Consent — Continue to Application →]
[I Do Not Consent — Cancel]
```

Variables substituted from the database:
- `[Parent Full Name]` — from `parents.full_name`
- `[LENDER NAME]` — from `lenders.display_name`
- `[School Name]` — from `schools.name`
- `[DATE]`, `[TIME]`, `[TIMEZONE]` — server timestamp at consent display time

### Screen 3 — Consent Summary

After the parent ticks the checkbox and clicks consent:

```
Consent Recorded ✓
━━━━━━━━━━━━━━━━━

Your consent has been recorded:

Your name:    Grace Mwale
Lender:       Madison Finance
School:       Sunrise Academy
Date / Time:  15 Sep 2026 · 10:23:45 CAT
Reference:    CONS-ZM-0001-2026-001234

Your application details are encrypted and will only
be shared with Madison Finance.

[Proceed to Application →]
```

The consent reference number (`CONS-ZM-0001-YYYY-XXXXXX`) is generated and shown. This is the consent log ID in a human-readable format.

---

## Consent Log Record

The consent log is written immediately when the parent clicks "I Consent" — before the application form is shown.

```sql
-- private.loan_consent_log — IMMUTABLE
INSERT INTO private.loan_consent_log (
  parent_user_id,
  parent_full_name,
  parent_phone,
  lender_id,
  lender_name,
  school_id,
  school_name,
  consent_version,         -- e.g. 'v2.1' — incremented when consent text changes
  consent_text_hash,       -- SHA-256 of the exact consent text shown (with substitutions)
  consent_text_length,     -- Character count — quick validation check
  scrolled_to_bottom,      -- Boolean — was scroll verification passed?
  checkbox_checked_at,     -- Timestamp when checkbox was ticked
  consented_at,            -- Timestamp when "I Consent" button was clicked
  ip_address,              -- Parent's IP at time of consent
  device_fingerprint,      -- Browser fingerprint (screen size, UA string hash)
  session_id               -- Clerk session ID at time of consent
)
```

**SHA-256 hash generation:**
```typescript
async function hashConsentText(consentText: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(consentText)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}
```

The hash allows verification at any future point that the stored consent matches the text that was shown. If AfriTech ever needs to prove in a dispute that a parent consented to specific terms, the hash is compared against the consent template version stored separately.

---

## Consent Versioning

The consent text changes when:
- A new lender is added with different terms
- The ZDPA or financial regulations require updated disclosures
- AfriTech's privacy policy changes in a material way

Each version of the consent text is stored in a `consent_templates` table with a version number. The `loan_consent_log.consent_version` field references this version, enabling exact reproduction of the text shown at any future date.

```sql
CREATE TABLE private.consent_templates (
  version         TEXT PRIMARY KEY,  -- 'v1.0', 'v2.0', 'v2.1'
  template_text   TEXT NOT NULL,     -- Full consent text with {{VARIABLE}} placeholders
  effective_from  TIMESTAMPTZ NOT NULL,
  superseded_at   TIMESTAMPTZ,       -- NULL if current version
  created_by      TEXT NOT NULL      -- AfriTech staff
);
```

When the consent text is updated, all new consent log entries use the new version. Historical entries retain their version reference — a parent who consented under v1.0 remains bound by v1.0 terms for that specific application.

---

## Lender-Specific Consent

A parent who has previously consented to share data with Madison Finance must complete a fresh consent flow before applying with a second lender (e.g. Bayport Financial Services). The consent log stores the `lender_id` — the same parent has separate consent log entries per lender.

**Why lender-specific:** Under the ZDPA, consent to share data with one party does not automatically extend to another party. Each lender is a separate data recipient requiring separate explicit consent.

**UI handling:**
```typescript
// Check if parent has already consented to this lender (for this application context)
const existingConsent = await getActiveConsent(parentUserId, lenderId)

if (existingConsent && isWithinConsentWindow(existingConsent.consented_at)) {
  // Consent already recorded within the last 30 days — skip screens 1 and 2
  // Show Screen 3 summary: "You previously consented to share with [Lender] on [Date]"
  // Allow parent to proceed or re-consent
} else {
  // Show full consent flow from Screen 1
}
```

A consent is valid for 30 days — if the parent does not complete and submit an application within 30 days of consenting, they must consent again. This prevents stale consent from being used on a new application months later.

---

## What Happens If the Parent Abandons Mid-Flow

If the parent starts the consent flow but does not complete it:

| Point of Abandonment | Data Recorded | Action Required |
|---|---|---|
| Screen 1 — clicks Cancel | Nothing | No action |
| Screen 2 — closes browser before checkbox | Nothing | No action |
| Screen 2 — ticks checkbox but doesn't click I Consent | Nothing | No action |
| Between Screen 2 and Screen 3 | Nothing | No action |
| After Screen 3 — abandons application form | Consent log recorded | Consent log entry remains — no application record |

The consent log is only written after the parent actively clicks "I Consent." Partial flows leave no data.

An orphaned consent log entry (consent recorded but no subsequent application) is cleaned up after 30 days by a daily cron job. The cleanup is a soft-delete — the record is retained in the archive for compliance.

---

## Business Rules

1. The consent flow is mandatory — no loan application can be submitted without a corresponding consent log entry. The submission API validates this before accepting any application data.
2. Consent is lender-specific. A parent must consent separately for each lender they apply with.
3. The scroll-to-bottom verification is enforced client-side. The checkbox does not appear until the parent scrolls to the bottom of the consent text. This is UX enforcement — it cannot be bypassed by a determined user, but that is the parent's responsibility.
4. The consent log is permanently immutable. No UPDATE or DELETE policy for any user including AfriTech super admins.
5. The SHA-256 hash of the consent text is stored — not the full text. The full text is reconstructed from the consent template version when needed for verification.
6. Consent is valid for 30 days. Applications submitted more than 30 days after consent require a fresh consent flow.
7. When ZSMS becomes an MFI and is the lender, the consent flow still runs with ZSMS listed as the lender. The legal obligation does not disappear when the lending is in-house.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 14 loan module documentation |
| 2026-04-26 | Added scroll verification implementation | Ensures parent actually reads the consent text |
| 2026-04-26 | Added consent versioning system | Consent text will evolve as regulations change |
| 2026-04-26 | Added lender-specific consent with 30-day validity | ZDPA requires separate consent per data recipient |
