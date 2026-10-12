# LOANS.md — Loan Module Overview

## Related Documents

- `docs/modules/loans/CONSENT.md` — explicit consent flow
- `docs/modules/loans/APPLICATION.md` — application form and submission
- `docs/modules/loans/BEHAVIOUR_SCORE.md` — credit scoring algorithm
- `docs/modules/loans/LENDER_INTEGRATION.md` — lender onboarding and integration
- `docs/modules/loans/REPAYMENT.md` — repayment tracking and collection UX
- `docs/modules/loans/SUBMISSION.md` — security model for loan submissions
- `docs/modules/fees/PAYMENTS.md` — loan disbursement creates a payment record
- `docs/modules/school/SUBSCRIPTION.md` — loan module as feature add-on
- `docs/DATABASE.md` — private.loan_applications, lenders tables

---

## Implementation Status (2026-10-11)

**Built, and gated.** `loan_module` has been a feature flag since `0095`, enforced in
**both** places that matter: `submit_loan_application()` refuses without it, and
`/api/school/loans` checks `schoolHasFeature()` before rendering. A school on Starter does
not see the module at all.

Screens: `/admin/loans` and `/admin/lenders` for AfriTech, `/school/[code]/fees/loans` for
the school, `/parent/loans` for the parent.

**The data lives in `private`**, not `public` — `private.loan_applications`,
`private.loan_consent_log`, `private.consent_templates`. That is ADR-018 and it is the
right call: a loan application holds an employer, a monthly income and a payslip, which is
materially more sensitive than anything else in the tree, and `private` is never reachable
from client-side code (prohibition 9).

---

## Purpose

This document defines the complete loan module — what it is, how it works across three phases of evolution, the three-party relationship between ZSMS, parents, and lenders, and how the module connects to the rest of the ZSMS system. Every Claude Code session building any loan feature must read this document before starting.

---

## What the Loan Module Is

The loan module connects parents who need help paying school fees with lending partners — MFIs, banks, and eventually ZSMS itself as a licensed lender. ZSMS is not currently a lender. In Phase 1, ZSMS is a facilitator and originator — it collects, verifies, and packages loan applications and sends them to partner lenders, earning an origination commission on each disbursed loan.

The strategic direction is clear: ZSMS will register as a licensed MFI and become its own lender. When that happens, the same module that today sends applications to third-party lenders will instead process them in-house. The architecture is built for this transition from day one.

---

## Three-Party Relationship

```
                    AfriTech / ZSMS
                    (Facilitator → Future MFI)
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
         Parent                     MFI / Bank
  (Borrower — applies          (Lender — disburses
   via ZSMS portal)             to school account)
              │                         │
              └────────────┬────────────┘
                           ▼
                         School
              (Receives fee payment from lender)
```

**Money flows:**
1. Lender disburses loan amount → School's account (not the parent's account)
2. School marks fee as paid (loan_paid status)
3. Parent repays lender in monthly instalments
4. Lender pays AfriTech origination commission (1-3% of disbursed amount)

**What ZSMS earns:** Origination commission from lenders. Not interest. Not fees from parents. This model changes when ZSMS becomes the lender — then ZSMS earns the interest spread directly.

---

## Loan Module Evolution — Three Phases

### Phase 1 — Facilitation (Current)

- ZSMS collects loan applications from parents
- ZSMS packages applications as PDFs and emails to partner lenders
- Partner lenders make manual decisions (3-5 business days)
- AfriTech loan officer manually updates application status
- ZSMS earns origination commission on disbursed loans
- Parent repays lender directly (ZSMS shows lender's collection details)

**What is built now:**
- Application form with income declaration and payslip upload
- Behaviour score calculation
- PDF loan package generation
- Consent flow and consent log
- Application tracking for parents
- Manual status updates by AfriTech loan officer
- Collection details display for parent repayment

### Phase 2 — API Integration

- Direct API connections with partner lenders
- Applications submitted programmatically (no email)
- Decisions returned via webhook (minutes to hours, not days)
- Automatic status updates
- Repayment status webhooks from lenders
- ZSMS initiates repayment collection via payment gateway on parent's behalf

**What is added in Phase 2:**
- Lender API integration layer
- Automated application submission
- Webhook-driven status updates
- In-portal repayment initiation (parent taps "Make repayment" → PawaPay)

### Phase 3 — ZSMS as MFI

- ZSMS processes its own loans after MFI registration
- Proprietary credit scoring drives real-time decisions
- Interest rates personalised by credit score
- ZSMS collects repayments directly into AfriTech float account
- Partner MFIs still available as alternatives (marketplace model)
- Expanded loan products: personal, emergency, device, university application fees
- Alumni and non-school customers served

**What is added in Phase 3:**
- In-house underwriting engine
- ZSMS float account management
- Regulatory reporting (Bank of Zambia requirements)
- Credit bureau reporting (ZCR — Zambia Credit Reference Bureau)
- Full loan product catalogue

---

## Loan Products

Loan products are defined in the `lenders` table under `loan_products` JSONB. Each lender offers one or more products. The system shows relevant products based on the parent's context.

### Current Product Context (Phase 1)

When a parent is viewing an outstanding fee record and clicks "Apply for loan":
- System pre-selects `product_type: 'school_fees'`
- Amount pre-filled from the outstanding balance
- Only lenders offering school fee products are shown

### Future Non-School Products (Phase 3)

Parents and alumni can access the loan portal independently of a fee record:
- Personal loan (any purpose)
- Emergency loan (fast disbursement, smaller amounts, higher rate)
- Device loan (laptop, tablet — for students)
- University application loan (Form 6 graduates applying to university)
- Uniform and supplies loan (start of academic year)

For non-school loans, `fee_record_id` is NULL in the `loan_applications` table. The loan is linked to the parent/alumni account only.

---

## Subscription Access

The loan module is a toggleable feature available as:

| Access Path | Cost |
|---|---|
| Professional tier (base) | Included in K2,000/month |
| Enterprise tier (base) | Included in K3,000/month |
| Add-on for any tier | K275/month module subscription |

Schools must explicitly enable the Finance Module in Settings → Modules → Finance (Loan Referral). Enabling it requires the school owner to confirm they understand the module's purpose and agree to AfriTech's commission terms.

---

## How Loan Disbursement Connects to Fees

When a lender confirms disbursement (webhook in Phase 2, manual update in Phase 1):

```typescript
// webhook-loan Edge Function — on disbursement confirmation
async function processDisbursement(application: LoanApplication) {
  if (application.fee_record_id) {
    // School fee loan — mark fee as paid
    await supabaseAdmin
      .from('payments')
      .insert({
        school_id: application.school_id,
        fee_record_id: application.fee_record_id,
        student_id: application.student_id,
        amount: application.amount_disbursed,
        payment_method: 'loan_disbursement',
        status: 'verified',  // Auto-verified — lender confirmed disbursement
        notes: `Loan disbursed by ${application.lender_name} · Ref: ${application.lender_reference}`,
      })

    // Update fee record status
    await recalculateFeeRecordStatus(application.fee_record_id)
    // fee_records.status → 'loan_paid'

    // Generate receipt
    await generateReceipt(paymentId)
  }

  // Update loan application status
  await supabaseAdmin
    .from('private.loan_applications')
    .update({ status: 'disbursed', disbursed_at: new Date().toISOString() })
    .eq('id', application.id)

  // Notify parent
  await enqueueJob('send-whatsapp', {
    template_id: 'loan_status_update',
    variables: [schoolName, studentFirstName, 'Disbursed', disbursementNote, lenderReference],
    school_id: application.school_id,
  })
}
```

For non-school loans (Phase 3), the `if (application.fee_record_id)` block is skipped. The loan is disbursed to the parent's mobile money account or bank account directly.

---

## Business Rules

1. The loan module is a facilitation service in Phase 1. ZSMS is not a lender and must not be represented as one in any parent-facing UI or documentation.
2. Loans are only available to parents of students at schools with the Finance Module enabled.
3. A parent cannot have more than two active (non-declined, non-cancelled) loan applications simultaneously across all schools. This prevents over-borrowing through the ZSMS platform.
4. For school fee loans, the disbursement goes directly to the school — never to the parent's account.
5. When ZSMS becomes an MFI, the `zsms_is_lender = TRUE` flag on loan applications enables different processing logic without changing the module structure.
6. The behaviour score is calculated fresh at application time. It is never pre-calculated or stored as a user attribute — only as a snapshot within a specific loan application.
7. Alumni and non-school parents can access non-fee loan products (Phase 3) as long as they have `marketing_opt_in = TRUE` and at least 3 months of payment history in the ZSMS system.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 14 loan module documentation |
| 2026-04-26 | Added three-phase evolution model | ZSMS to register as MFI — confirmed strategic direction |
| 2026-04-26 | Added non-school loan products | Alumni and non-school customers to be served |
| 2026-04-26 | Added lender marketplace model | Multiple lenders onboarded onto platform |
| 2026-04-26 | Module available as K275/month add-on any tier | Feature toggle billing model confirmed |
