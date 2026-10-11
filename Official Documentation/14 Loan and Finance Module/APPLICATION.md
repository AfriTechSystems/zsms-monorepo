# APPLICATION.md — Loan Application Form and Submission

## Related Documents

- `docs/modules/loans/LOANS.md` — loan module overview
- `docs/modules/loans/CONSENT.md` — consent flow that precedes application
- `docs/modules/loans/BEHAVIOUR_SCORE.md` — score calculated during submission
- `docs/modules/loans/SUBMISSION.md` — security model for submissions
- `docs/modules/loans/LENDER_INTEGRATION.md` — what happens after submission
- `docs/DATABASE.md` — private.loan_applications table
- `docs/infra/R2.md` — payslip storage in private bucket

---

## Implementation Status (2026-10-11)

**Built end to end.** `submit_loan_application()` writes to `private.loan_applications`,
`lenders_for_application()` matches a parent against eligible lenders by amount and
behaviour score, and `my_loan_applications()` / `school_loan_applications()` /
`admin_loan_applications()` give each audience its own view.

Every field this document specifies exists on the table, including `payslip_url`,
`monthly_income`, `employer_name` and `behaviour_score_breakdown`.

**Zero applications exist on dev**, which is correct rather than a gap: a synthetic loan
application would mean synthetic income and employment data, and `TEST_DATA.md` is the
place to decide whether that is wanted.

---

## Purpose

This document defines the complete loan application form — every field, validation rule, and what happens from the moment the parent clicks submit to when the lender receives the application. Every Claude Code session building the application form or submission Edge Function must read this document.

---

## Overview

The loan application form is shown immediately after the parent completes the consent flow. It is the most sensitive data collection form in ZSMS — it handles income declarations, document uploads, and financial commitments. The form is designed to be simple and mobile-friendly while collecting everything a lender needs to make a decision.

---

## Application Entry Points

### Entry Point 1 — From a Fee Record (School Fee Loan)

```
Parent portal → Fees → [Outstanding fee record] → Apply for fee loan

Pre-filled automatically:
- School name
- Student name and grade
- Fee description and amount outstanding
- Lender options filtered to school_fee product type
```

### Entry Point 2 — From the Loan Portal (Any Loan Type, Phase 3)

```
Parent portal → Finance → Apply for a Loan

Parent selects:
- Loan type: School Fees / Personal / Emergency / Device / Other
- Amount requested
- Lender from available options
```

### Entry Point 3 — Alumni Portal (Phase 3)

```
Alumni portal → Finance → Loan Products

Alumni see non-school loan products from ZSMS and partner MFIs
Requires marketing_opt_in = TRUE
```

---

## The Application Form

After consent is recorded, the parent sees the application form. Fields are grouped into logical sections.

### Section 1 — Loan Details (Pre-filled for school fee loans)

```
Loan Purpose:    School Fees — Term 2, 2026
School:          Sunrise Academy
Student:         Chanda Bwalya (Grade 9A)
Fee Description: Tuition Fee
Outstanding:     K3,400.00

Amount Requested: [K3,400.00 — pre-filled, editable down, not up]
                  Minimum: K500.00
                  Maximum: K[lender.max_loan_amount]

Lender:          [Madison Finance — selected in consent flow, not editable here]
Loan Product:    School Fee Loan — up to 6 months repayment
Interest Rate:   18% per annum (displayed from lender.interest_rate_display)
```

**Amount validation:**
- Cannot exceed the outstanding fee balance (for school fee loans)
- Cannot exceed the lender's maximum loan amount
- Cannot be below the lender's minimum loan amount

### Section 2 — Employment and Income

```
Employment Type:
○ Employed (formal — with payslip)
○ Self-employed / Business owner
○ Informal employment
○ Pension / Retirement
○ Other

[If Employed or Pension:]
Employer / Organisation Name: [text field]
Job Title / Position: [text field — optional]
How long at this employer: [dropdown — under 1 year / 1-3 years / 3-5 years / over 5 years]

Monthly Gross Income: K [number field]
  ⓘ Your gross income is encrypted immediately — the school
    does not see this information, only the lender.

Monthly Take-Home (Net): K [number field — optional]
  ⓘ If different from gross due to deductions

[If Self-employed:]
Business Name: [text field — optional]
Type of Business: [text field]
Monthly Business Income (Estimate): K [number field]
```

### Section 3 — Income Documentation

```
Upload Proof of Income:

[Upload button]

Accepted documents:
✓ Recent payslip (last 3 months)
✓ Bank statement (last 3 months, showing salary credits)
✓ Business bank statement (for self-employed)
✓ Pension advice letter
✓ Employer letter confirming salary

Accepted formats: PDF, JPG, PNG · Maximum 10MB per file
Up to 3 documents can be uploaded.

[Uploaded: payslip_september.pdf ✓] [Remove]
```

**Upload process:**
```
1. Parent selects file(s)
2. Client requests pre-signed PUT URL from Edge Function
3. File uploaded directly to zsms-private-zm:
   /{school_id}/loan-payslips/{temp_uuid}.{ext}
4. Edge Function validates: file type, file size
5. Key returned and stored temporarily in application state
6. On form submission: key included in application payload
```

### Section 4 — Additional Information

```
NRC / National ID Number: [text field — optional]
  ⓘ Required by some lenders for identity verification.
    Encrypted and shared only with [Lender Name].

Other Monthly Obligations: K [number field — optional]
  e.g. other loan repayments, rent, hire purchase
  ⓘ Helps the lender assess your repayment capacity.

How would you prefer to repay this loan?
○ Mobile Money (Airtel / MTN / Zamtel)
○ Bank transfer
○ Direct debit from salary
○ No preference

Additional notes to lender (optional):
[text area — max 500 characters]
  e.g. "I am applying for my second child's fees at a different school"
```

### Section 5 — Confirmation and Submission

```
Estimated Monthly Repayment:

Loan amount:      K3,400.00
Term:             6 months
Interest (18%):   K  306.00 (approx.)
Total repayable:  K3,706.00 (approx.)
Monthly payment:  K  617.67 (approx.)

⚠️ This is an estimate. Actual terms are set by [Lender Name].

Loan Collection Details:
Your fees will be paid directly to [School Name].
You will repay [Lender Name] in monthly instalments.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
☐ I confirm that all information provided in this application
  is accurate and complete. I understand that providing false
  or misleading information may constitute fraud and could
  result in legal action.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Submit Application →]  ← disabled until checkbox is checked
```

---

## Server-Side Submission Processing

The `loan-submit` Edge Function processes the submission:

```typescript
// POST /api/loans/apply → loan-submit Edge Function

// 1. Validate confirmation_checkbox_at (must be within last 10 minutes)
const checkboxAge = Date.now() - new Date(payload.confirmation_checkbox_at).getTime()
if (checkboxAge > 10 * 60 * 1000) {
  throw new ApiError('MISSING_CONFIRMATION', 400)
}

// 2. Verify consent log exists for this parent + lender
const consent = await getActiveConsent(parentUserId, lenderId)
if (!consent) throw new ApiError('CONSENT_REQUIRED', 422)

// 3. Check for existing active application for this fee_record
if (payload.fee_record_id) {
  const existing = await checkExistingApplication(payload.fee_record_id)
  if (existing) throw new ApiError('LOAN_ALREADY_PENDING', 422)
}

// 4. Check parent active application limit (max 2 simultaneous)
const activeCount = await countActiveApplications(parentUserId)
if (activeCount >= 2) throw new ApiError('MAX_APPLICATIONS_REACHED', 422)

// 5. Encrypt sensitive fields before storage
const encryptedIncome = await encrypt(payload.monthly_income, FIELD_ENCRYPTION_KEY)
const encryptedNrc = payload.nrc ? await encrypt(payload.nrc, FIELD_ENCRYPTION_KEY) : null
const encryptedPayslipKey = await encrypt(payload.payslip_r2_key, FIELD_ENCRYPTION_KEY)

// 6. Calculate behaviour score
const behaviourScore = await calculateBehaviourScore(parentUserId, schoolId)

// 7. Calculate repayment estimates
const estimates = calculateRepaymentEstimates(
  payload.amount_requested,
  lender.default_tenure_months,
  lender.interest_rate_annual
)

// 8. Generate application reference
const applicationRef = await generateApplicationReference(schoolId)
// Format: LAP-ZM-LSK-0001-000001

// 9. Insert into private schema
const { data: application } = await supabaseAdmin
  .from('private.loan_applications')
  .insert({
    school_id: schoolId,
    student_id: studentId,
    parent_user_id: parentUserId,
    fee_record_id: payload.fee_record_id || null,
    lender_id: lenderId,
    loan_product_id: payload.loan_product_id,
    product_type: payload.product_type,
    application_reference: applicationRef,
    consent_log_id: consent.id,
    amount_requested: payload.amount_requested,
    employment_type: payload.employment_type,
    employer_name: payload.employer_name,
    monthly_income_encrypted: encryptedIncome,
    monthly_income_net: payload.monthly_income_net,
    employment_duration: payload.employment_duration,
    payslip_urls_encrypted: encryptedPayslipKey,
    nrc_encrypted: encryptedNrc,
    other_obligations: payload.other_obligations,
    repayment_preference: payload.repayment_preference,
    applicant_notes: payload.applicant_notes,
    behaviour_score: behaviourScore.score,
    behaviour_score_breakdown: behaviourScore.breakdown,
    estimated_monthly_instalment: estimates.monthlyInstalment,
    estimated_total_repayable: estimates.totalRepayable,
    status: 'submitted',
    confirmation_checkbox_at: payload.confirmation_checkbox_at,
    submitted_at: new Date().toISOString(),
    zsms_is_lender: lender.integration_type === 'zsms_internal',
  })
  .select()
  .single()

// 10. Queue lender submission (Phase 1: PDF email, Phase 2: API call)
await enqueueJob('submit-to-lender', {
  application_id: application.id,
  lender_integration_type: lender.integration_type,
})

// 11. Write audit log (PII masked)
await writeAuditLog({
  action: 'loan_application_submit',
  actor_user_id: parentUserId,
  record_id: application.id,
  metadata: {
    application_reference: applicationRef,
    lender_name: lender.display_name,
    amount_requested: payload.amount_requested,
    behaviour_score: behaviourScore.score,
    // Never log: income, NRC, payslip path
  }
})

// 12. Notify parent
await enqueueJob('send-whatsapp', {
  template_id: 'loan_status_update',
  variables: [schoolName, studentFirstName, 'Submitted', 'We will notify you when the lender responds', applicationRef],
})

return { data: { application_id: application.id, reference: applicationRef, status: 'submitted' } }
```

---

## Submission Acknowledgement

Immediately after submission, the parent sees:

```
Application Submitted ✓
━━━━━━━━━━━━━━━━━━━━━━

Reference: LAP-ZM-LSK-0001-000001
Lender: Madison Finance
Amount: K3,400.00
Submitted: 15 Sep 2026 · 10:45am

What happens next:
1. Your application is sent to Madison Finance
2. Madison Finance reviews your application (typically 3-5 days)
3. You'll receive a notification with their decision
4. If approved, fees are paid directly to Sunrise Academy

Questions? Contact Madison Finance:
+260 977 XXX XXX · loans@madisonfinance.zm

[View my application →]   [Back to fees →]
```

---

## Application Status Tracking

The parent can track their application status from the portal:

```
My Loan Applications

LAP-ZM-LSK-0001-000001
Madison Finance · K3,400.00 · Tuition Fee Term 2
Submitted: 15 Sep 2026

Status: ⏳ Under Review
Madison Finance is reviewing your application.
Expected decision: within 5 business days.

[View details]   [Contact lender]   [Withdraw application]
```

---

## Business Rules

1. `confirmation_checkbox_at` must be present and within 10 minutes of the submission timestamp. Stale or missing timestamps return 400 `MISSING_CONFIRMATION`.
2. At least one payslip or income document must be uploaded. Submissions without `payslip_r2_keys` return 400 `MISSING_PROOF_OF_INCOME`.
3. All financial fields (monthly_income, NRC) are encrypted before the INSERT statement executes. They never appear in plaintext in logs, API responses, or audit records.
4. A parent cannot have more than 2 active (non-declined/non-cancelled) loan applications simultaneously across all schools and lenders.
5. For school fee loans, the requested amount cannot exceed the outstanding fee balance on the referenced fee_record.
6. The behaviour score is calculated server-side during submission — the client never sends a score. Any client-sent score is ignored.
7. The audit log entry for loan submission never includes income figures, NRC numbers, or payslip R2 keys — these are masked as `[ENCRYPTED]`.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 14 loan module documentation |
| 2026-04-26 | Added non-school loan entry points | Phase 3 — alumni and personal loans |
| 2026-04-26 | Added fee_record_id as nullable | Non-school loans have no fee record |
| 2026-04-26 | Max 2 simultaneous applications limit | Prevents over-borrowing through platform |
| 2026-04-26 | All sensitive fields encrypted before INSERT | Income, NRC never stored in plaintext |
