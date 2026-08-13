# SUBMISSION.md — Loan Submission Security Model

## Related Documents

- `docs/modules/loans/CONSENT.md` — Layer 1 of the security model
- `docs/modules/loans/APPLICATION.md` — the form that implements this model
- `docs/modules/loans/BEHAVIOUR_SCORE.md` — score calculated during submission
- `docs/modules/loans/LENDER_INTEGRATION.md` — what lenders receive as assurance
- `docs/modules/auth/SESSIONS.md` — confirmed no OTP for financial submissions
- `docs/DATABASE.md` — private.loan_applications confirmation fields
- `docs/api/ERROR_CODES.md` — MISSING_CONFIRMATION, CONSENT_REQUIRED errors

---

## Purpose

This document defines the complete security model for loan application submissions — why OTP was removed, what replaced it, how the three-layer model satisfies financial services compliance requirements, and what assurance the lender receives. Every Claude Code session building the loan submission flow must read this document.

---

## Overview

The original design considered OTP (one-time password via SMS) as a verification mechanism for financial submissions. This was rejected for three reasons:

1. **Reliability:** SMS delivery in Zambia is inconsistent. A parent in a low-connectivity area who cannot receive an OTP cannot submit a legitimate loan application — a significant UX failure for the exact customers the loan module is designed to serve.

2. **False security:** OTP verifies that a phone number is accessible at a point in time. It does not verify identity, income accuracy, or the authenticity of uploaded documents. It provides a perception of security without meaningful fraud prevention for loan applications.

3. **Friction:** The additional step increases abandonment. A parent who has navigated the consent flow, filled the form, and uploaded a payslip deserves a clean submission — not an SMS code to hunt for.

The three-layer security model that replaces OTP is more robust for the specific fraud risks of loan applications, while being more accessible to the users who need it most.

---

## The Three-Layer Security Model

### Layer 1 — Explicit, Lender-Specific Consent (Legal Foundation)

**What it is:** The parent completed a multi-screen consent flow specifically naming the lender they are applying with, scrolled to the bottom of the full consent text, ticked an explicit checkbox, and clicked a dedicated consent button. The exact consent text shown is SHA-256 hashed and stored with a timestamp.

**What it prevents:** Uninformed consent, consent by a third party using the parent's device, replay of old consent for new applications.

**Server-side validation:**
```typescript
// Verify active consent exists for this parent + lender
const consent = await supabaseAdmin
  .from('private.loan_consent_log')
  .select('id, consented_at, lender_id, consent_version')
  .eq('parent_user_id', parentUserId)
  .eq('lender_id', lenderId)
  .gte('consented_at', thirtyDaysAgo)  // Consent valid for 30 days
  .order('consented_at', { ascending: false })
  .limit(1)
  .single()

if (!consent.data) {
  throw new ApiError('CONSENT_REQUIRED', 422, {
    message: 'You must complete the consent process before submitting an application'
  })
}
```

**Legal weight:** The consent log is permanently immutable. In a dispute, AfriTech can produce:
- The exact timestamp of consent
- The exact text the parent consented to (reconstructed from the versioned template)
- The hash confirming the text was not altered after the fact
- The IP address and device fingerprint at the time of consent
- The Clerk session ID confirming the authenticated user who consented

This is legally equivalent to a signed consent form and is accepted practice in digital financial services under the Zambia Electronic Communications and Transactions Act.

---

### Layer 2 — Confirmation Checkbox with Timestamp (Acknowledgement of Accuracy)

**What it is:** At the bottom of the application form, a mandatory checkbox states: "I confirm that all information provided in this application is accurate and complete. I understand that providing false or misleading information may constitute fraud and could result in legal action." The parent must tick this before the submit button activates. The timestamp of the tick is captured client-side and validated server-side.

**What it prevents:** Accidental submissions, casual misrepresentation of income, third-party submissions without the parent's knowledge.

**Server-side validation:**
```typescript
// Validate confirmation_checkbox_at
const checkboxTimestamp = new Date(payload.confirmation_checkbox_at)
const now = new Date()
const ageMs = now.getTime() - checkboxTimestamp.getTime()
const maxAgeMs = 10 * 60 * 1000  // 10 minutes

if (isNaN(checkboxTimestamp.getTime())) {
  throw new ApiError('MISSING_CONFIRMATION', 400, {
    message: 'Confirmation timestamp is invalid'
  })
}

if (ageMs > maxAgeMs) {
  throw new ApiError('MISSING_CONFIRMATION', 400, {
    message: 'Your session has expired. Please refresh and try again.'
  })
}

if (ageMs < 0) {
  // Timestamp in the future — clock skew or injection attempt
  throw new ApiError('MISSING_CONFIRMATION', 400, {
    message: 'Invalid confirmation timestamp'
  })
}
```

**The 10-minute window:** The checkbox must have been ticked within the last 10 minutes before submission. This prevents replay attacks where a previously captured valid payload is resubmitted. A legitimate parent who fills the form normally will always have a fresh timestamp.

**Legal weight:** The `confirmation_checkbox_at` timestamp is stored permanently in `private.loan_applications` and logged in the audit trail. It creates a clear record that the parent affirmatively acknowledged the accuracy of their submission immediately before submitting — not days or weeks earlier.

---

### Layer 3 — Documentary Evidence (Physical Verification)

**What it is:** The parent uploads at least one income document — a payslip, bank statement, employer letter, or pension advice. This is uploaded to the R2 private bucket before submission. The R2 object key is included in the submission payload and validated server-side (must be a key that exists in the correct path prefix).

**What it prevents:** Pure false income declarations — a parent cannot claim K50,000/month income without providing a document that at least claims to show it. The document verification is not automated — the lender reviews it — but the requirement to produce a document raises the barrier to fraud significantly.

**Server-side validation:**
```typescript
// Validate at least one payslip was uploaded
if (!payload.payslip_r2_keys || payload.payslip_r2_keys.length === 0) {
  throw new ApiError('MISSING_PROOF_OF_INCOME', 400, {
    message: 'At least one income document is required'
  })
}

// Validate the R2 keys belong to this school and are in the correct path
for (const key of payload.payslip_r2_keys) {
  const expectedPrefix = `${schoolId}/loan-payslips/`
  if (!key.startsWith(expectedPrefix)) {
    throw new ApiError('VALIDATION_ERROR', 400, {
      message: 'Invalid document reference'
    })
  }
  // Verify the object actually exists in R2
  const exists = await checkR2ObjectExists('zsms-private-zm', key)
  if (!exists) {
    throw new ApiError('VALIDATION_ERROR', 400, {
      message: 'Document upload not found. Please re-upload your documents.'
    })
  }
}
```

**Legal weight:** The payslip is stored encrypted in the private R2 bucket. The lender receives a 24-hour signed URL to download it. A parent who uploads a fraudulent payslip has committed document fraud — a criminal offence under Zambian law. The stored document creates evidence for any subsequent legal action.

---

## What the Lender Receives as Assurance

The lender is provided with the following assurance information as part of the application package:

```
APPLICATION VERIFICATION SUMMARY

Authentication:
  Submitted by:    Authenticated ZSMS parent account
  Session ID:      clerk_session_xyz (Clerk JWT verified)
  Account age:     18 months on ZSMS platform

Consent:
  Consent recorded: 15 Sep 2026 · 10:23:45 CAT
  Consent version:  v2.1
  Consent reference: CONS-ZM-0001-2026-001234
  Lender consented to: Madison Finance (specific)
  Scroll verification: Confirmed

Confirmation:
  Accuracy acknowledged: 15 Sep 2026 · 10:44:52 CAT
  (3 minutes before submission)
  Checkbox text: "I confirm that all information provided
                  is accurate and complete..."

Documentation:
  Income documents: 1 file uploaded (payslip)
  Download link: [24-hour signed URL]
  File uploaded: 15 Sep 2026 · 10:38:00 CAT

Payment Behaviour Score:
  Score: 687 / 850 (Good)
  Data points: 24 fee records over 18 months
  Score methodology: Available from AfriTech on request

ZSMS Certification:
  AfriTech Systems Limited certifies that this application
  was submitted by an authenticated user who completed
  the required consent and confirmation processes.
  This certification does not guarantee the accuracy of
  declared information — the income documents and lender's
  own verification processes serve that purpose.
```

---

## Why This Model Is Sufficient for Financial Services

**Compared to OTP:**

| Risk | OTP | Three-Layer Model |
|---|---|---|
| Unauthorised submission by third party | Mitigated (if they have the phone) | Mitigated (requires active Clerk session) |
| False income declaration | Not addressed | Addressed by document requirement |
| Parent claims they never consented | Partially addressed | Strongly addressed (consent log + hash) |
| Replay attack on submission | Not addressed | Addressed by 10-minute timestamp check |
| SMS OTP not received | Blocks legitimate submission | Not a factor |
| Identity verification | Phone number only | Clerk account (email verified) + document |

The three-layer model is objectively stronger than SMS OTP for the specific fraud risks of loan applications in this context.

**Regulatory position:** The Zambia Financial Intelligence Centre Act and the Bank of Zambia's digital financial services guidelines accept electronic consent and digital acknowledgement as valid for loan applications. The requirement for two-factor authentication in those guidelines is satisfied by: the parent's authenticated Clerk session (factor 1 — something they have: email-verified account) and the income document (factor 2 — something they produce: physical document evidence). OTP is one implementation of 2FA but not the only one.

---

## Audit Trail for a Complete Submission

Every loan submission creates the following permanent audit records:

```
1. private.loan_consent_log row
   → Timestamp, consent text hash, lender, session ID, IP

2. private.loan_applications row
   → All application fields (sensitive fields encrypted)
   → confirmation_checkbox_at
   → behaviour_score snapshot
   → status: 'submitted'

3. public.audit_logs row
   → action: 'loan_application_submit'
   → actor_user_id: parent clerk ID
   → metadata: { reference, lender, amount, score }
   → PII masked: income marked [ENCRYPTED], NRC marked [ENCRYPTED]

4. private.loan_repayment_log (created on disbursement, not submission)

5. public.message_log row
   → Submission confirmation WhatsApp/in-app to parent
```

These five records together provide a complete, independently verifiable history of the submission event.

---

## Business Rules

1. All three layers must pass before an application is inserted into the database. Failing any layer returns the appropriate error code and the application is not created.
2. The `confirmation_checkbox_at` timestamp must be within 10 minutes of the submission. Older timestamps are rejected regardless of validity.
3. At least one income document must be uploaded to the private R2 bucket with the correct path prefix before submission. The Edge Function verifies the object exists.
4. The consent log entry must be for the same lender as the application. Consent for Lender A cannot be used for an application to Lender B.
5. All sensitive fields (income, NRC, payslip keys) are encrypted before the INSERT statement. They are never stored in plaintext under any circumstances.
6. The audit log entry for loan submission never contains plaintext PII. Income is logged as `[ENCRYPTED]`, NRC as `[ENCRYPTED]`, payslip keys as `[ENCRYPTED]`.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 14 loan module documentation |
| 2026-04-26 | OTP removed — replaced with three-layer model | Confirmed decision — reliability, accessibility, security |
| 2026-04-26 | 10-minute timestamp window | Replay attack prevention |
| 2026-04-26 | R2 object existence validation | Prevents payload injection with fake file references |
