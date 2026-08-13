# LENDER_INTEGRATION.md — Lender Onboarding and Integration

## Related Documents

- `docs/modules/loans/LOANS.md` — loan module overview and evolution phases
- `docs/modules/loans/APPLICATION.md` — application submission that triggers lender dispatch
- `docs/modules/loans/BEHAVIOUR_SCORE.md` — score included in lender package
- `docs/modules/loans/REPAYMENT.md` — disbursement webhook and repayment tracking
- `docs/DATABASE.md` — lenders table
- `docs/api/WEBHOOKS.md` — loan disbursement webhook
- `docs/api/EDGE_FUNCTIONS.md` — submit-to-lender and webhook-loan functions

---

## Purpose

This document defines how lenders are onboarded onto the ZSMS platform and how integration works across the three phases of the loan module — email intake, API integration, and in-house ZSMS lending. Every Claude Code session building lender management or application dispatch features must read this document.

---

## Overview

ZSMS operates a lender marketplace — multiple lending institutions are available to parents, each with their own products, rates, and eligibility criteria. AfriTech onboards lenders as partners, agreeing terms and configuring their integration. Parents choose from available lenders when applying. AfriTech earns an origination commission from lenders on every disbursed loan.

---

## The `lenders` Table

```sql
CREATE TABLE public.lenders (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lender_name           TEXT NOT NULL UNIQUE,
  display_name          TEXT NOT NULL,
  -- E.g. "Madison Finance" — shown to parents
  tagline               TEXT,
  -- E.g. "Fast, flexible school fee loans"
  logo_url              TEXT,
  -- R2 path to lender logo for parent-facing UI
  description           TEXT,
  -- Shown in lender selection screen
  country_codes         TEXT[] NOT NULL DEFAULT '{ZM}',
  -- Countries this lender is active in
  loan_products         JSONB NOT NULL DEFAULT '[]',
  -- Array of LoanProduct objects — see below
  max_loan_amount       NUMERIC(12,2) NOT NULL,
  min_loan_amount       NUMERIC(12,2) NOT NULL DEFAULT 500,
  min_behaviour_score   INT DEFAULT 450,
  -- Lender's minimum acceptable score — applications below this are not shown to parent
  interest_rate_display TEXT NOT NULL,
  -- Human-readable: "18% per annum" — AfriTech does not store the actual rate as a number
  -- to avoid liability for rate display accuracy
  turnaround_label      TEXT NOT NULL,
  -- E.g. "Decision within 3-5 business days"
  integration_type      TEXT NOT NULL
                        CHECK (integration_type IN ('email', 'api', 'zsms_internal')),
  intake_email          TEXT,
  -- Phase 1: applications emailed here
  api_endpoint          TEXT,
  -- Phase 2: applications POSTed here
  api_key_encrypted     TEXT,
  -- Phase 2: lender's API key encrypted with GATEWAY_ENCRYPTION_KEY
  webhook_secret        TEXT,
  -- For HMAC-verifying disbursement webhooks from this lender
  commission_rate       NUMERIC(5,4) NOT NULL,
  -- e.g. 0.0250 = 2.5% of disbursed amount paid to AfriTech
  commission_terms      TEXT,
  -- Human-readable commission agreement summary (internal only)
  collection_account    JSONB,
  -- Payment details parents use to repay (shown in repayment screen)
  -- { mobile_money: '+260977XXXXXX', network: 'Airtel', bank_name: '...', account: '...', paybill: '...' }
  collection_instructions TEXT,
  -- Human-readable: "Send Airtel Money to 0977XXXXXX, use your reference number as the reason"
  eligibility_summary   TEXT[],
  -- Shown to parents: ["Zambian national or resident", "18 years or older", "Formal employment"]
  required_documents    TEXT[],
  -- ["Recent payslip (last 3 months)", "National ID or NRC"]
  is_active             BOOLEAN DEFAULT TRUE,
  is_featured           BOOLEAN DEFAULT FALSE,
  -- Featured lenders shown prominently in the selection UI
  onboarded_at          TIMESTAMPTZ DEFAULT NOW(),
  onboarded_by          TEXT NOT NULL,
  -- AfriTech staff Clerk user ID
  notes                 TEXT
  -- Internal AfriTech notes about this lender relationship
);

CREATE INDEX idx_lenders_active ON public.lenders(is_active, country_codes)
  WHERE is_active = TRUE;
```

---

## Loan Products per Lender

Each lender defines their loan products in the `loan_products` JSONB array:

```typescript
interface LoanProduct {
  product_id: string              // Internal ID: 'madison_school_fee_6m'
  product_name: string            // "School Fee Loan — 6 Months"
  product_type: 'school_fees' | 'personal' | 'emergency' | 'device' | 'uniform' | 'university'
  max_amount: number
  min_amount: number
  max_tenure_months: number
  description: string             // Shown to parent in product selection
  eligibility_criteria: string[]  // Additional product-specific criteria
  required_documents: string[]    // Documents beyond lender defaults
  is_active: boolean
}
```

**Example lender configuration:**

```json
{
  "display_name": "Madison Finance",
  "tagline": "Fast decisions, flexible repayment",
  "loan_products": [
    {
      "product_id": "madison_school_fee_6m",
      "product_name": "School Fee Loan",
      "product_type": "school_fees",
      "max_amount": 15000.00,
      "min_amount": 500.00,
      "max_tenure_months": 6,
      "description": "Pay your child's school fees today and repay over up to 6 months.",
      "is_active": true
    },
    {
      "product_id": "madison_emergency_3m",
      "product_name": "Emergency Loan",
      "product_type": "emergency",
      "max_amount": 5000.00,
      "min_amount": 500.00,
      "max_tenure_months": 3,
      "description": "Fast disbursement for urgent needs. Decision within 24 hours.",
      "is_active": true
    }
  ],
  "collection_account": {
    "mobile_money": "+260977XXXXXX",
    "network": "Airtel",
    "bank_name": "First National Bank Zambia",
    "account_number": "XXXXXXXXXXXX",
    "branch": "Cairo Road, Lusaka"
  },
  "collection_instructions": "To repay your loan, send Airtel Money to 0977XXXXXX. Always include your loan reference number as the reason for payment.",
  "min_behaviour_score": 500,
  "commission_rate": 0.0250
}
```

---

## Lender Onboarding Process

Adding a new lender to the ZSMS platform is an AfriTech business development activity. No school is involved.

### Step 1 — Commercial Agreement

AfriTech and the lender sign a partnership agreement covering:
- Commission rate (% of disbursed amount paid to AfriTech)
- Integration method (Phase 1: email, Phase 2: API)
- Turnaround time SLA for application decisions
- Minimum and maximum loan amounts
- Eligible products and customer criteria
- Repayment collection method and account details
- Data sharing terms (DPA — Data Processing Agreement)
- Webhook specifications for disbursement notifications

### Step 2 — Lender Record Creation

AfriTech loan officer creates the lender record via the AfriTech admin panel:

```
AfriTech Admin → Finance → Lenders → Add New Lender

[Form with all lenders table fields]
[Add loan products]
[Set is_active = FALSE until testing is complete]
[Save]
```

### Step 3 — Integration Testing

**Phase 1 (Email):**
1. Submit a test application for a fictional parent at a test school
2. Verify the PDF loan package is generated correctly and emailed to the intake address
3. Verify the email contains all required information (see PDF package contents below)
4. Lender confirms receipt
5. Set `is_active = TRUE`

**Phase 2 (API):**
1. Configure API endpoint and key in the lender record
2. Submit a test application to the lender's sandbox environment
3. Simulate a disbursement webhook from the lender's sandbox
4. Verify `webhook-loan` Edge Function processes it correctly
5. Verify fee record updates to `loan_paid` status
6. Verify parent WhatsApp notification is sent
7. Set `is_active = TRUE`

### Step 4 — Lender Appears in Parent UI

Once `is_active = TRUE`, the lender appears in the lender selection screen for parents at eligible schools. Featured lenders (`is_featured = TRUE`) appear at the top with a "Recommended" badge.

---

## Phase 1 — Email Integration (PDF Loan Package)

The `submit-to-lender` Edge Function generates a PDF loan application package and emails it to the lender's intake address.

### PDF Package Contents

```
LOAN APPLICATION PACKAGE — ZSMS Finance
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Application Reference:  LAP-ZM-LSK-0001-000001
Submitted:              15 Sep 2026 · 10:45am CAT
Lender:                 Madison Finance

APPLICANT INFORMATION
━━━━━━━━━━━━━━━━━━━━
Name:                   Grace Mwale
Phone:                  +260977XXXXXX
Relationship to student: Mother

STUDENT AND SCHOOL
━━━━━━━━━━━━━━━━━━
Student:                Chanda Bwalya
Student ID:             STU-ZM-LSK-0001-00042
Grade:                  Grade 9A
School:                 Sunrise Academy (ZM-LSK-0001)
School type:            Private Day School

LOAN REQUEST
━━━━━━━━━━━
Amount requested:       K3,400.00
Purpose:                School Fees — Tuition Fee, Term 2 2026
Product:                School Fee Loan (6 months)

EMPLOYMENT AND INCOME
━━━━━━━━━━━━━━━━━━━━
Employment type:        Employed
Employer:               Ministry of Health, Zambia
Duration at employer:   3-5 years
Declared monthly income: K8,500.00 gross / K6,800.00 net
[Income documents attached as separate PDF]

PAYMENT BEHAVIOUR SCORE
━━━━━━━━━━━━━━━━━━━━━━
Score: 687 / 850 (Good)
[Full breakdown — see BEHAVIOUR_SCORE.md for format]

CONSENT VERIFICATION
━━━━━━━━━━━━━━━━━━━
Consent reference:      CONS-ZM-0001-2026-001234
Consented at:           15 Sep 2026 · 10:23am CAT
Consent version:        v2.1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This application was submitted through ZSMS Finance,
operated by AfriTech Systems Limited, Lusaka, Zambia.
Commission agreement: 2.5% of disbursed amount.
Disbursement should be made directly to Sunrise Academy.
Please notify AfriTech at loans@afritechsystems.com
upon disbursement quoting reference LAP-ZM-LSK-0001-000001.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

The payslip documents are attached as a separate secured PDF, accessible via a 24-hour signed URL included in the email body.

---

## Phase 2 — API Integration

When a lender has an API, the `submit-to-lender` Edge Function POSTs the application directly:

```typescript
async function submitToLenderApi(
  application: LoanApplication,
  lender: Lender
): Promise<{ lenderReference: string }> {
  const payload = buildLenderApiPayload(application, lender)

  const response = await fetch(lender.api_endpoint!, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${decrypt(lender.api_key_encrypted!)}`,
      'Content-Type': 'application/json',
      'X-AfriTech-Application-Ref': application.application_reference,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(`Lender API error: ${response.status} ${await response.text()}`)
  }

  const result = await response.json()
  return { lenderReference: result.reference_id }
}
```

The lender's reference ID is stored in `private.loan_applications.lender_reference` and shown to the parent.

---

## Disbursement Webhook (Both Phases)

When the lender disburses the loan (or declines the application), they send a webhook to ZSMS:

**Phase 1:** AfriTech loan officer manually triggers a status update in the admin panel after receiving lender confirmation.

**Phase 2:** Lender POSTs to `POST /api/webhooks/loan` — processed by `webhook-loan` Edge Function.

```json
{
  "event": "loan.disbursed",
  "zsms_reference": "LAP-ZM-LSK-0001-000001",
  "lender_reference": "MFI-LOAN-2026-98765",
  "status": "disbursed",
  "disbursed_amount": 3400.00,
  "disbursed_to": "Sunrise Academy",
  "disbursed_at": "2026-09-18T09:30:00Z",
  "repayment_schedule": [
    { "instalment_number": 1, "due_date": "2026-10-18", "amount": 617.67 },
    { "instalment_number": 2, "due_date": "2026-11-18", "amount": 617.67 },
    { "instalment_number": 3, "due_date": "2026-12-18", "amount": 617.67 },
    { "instalment_number": 4, "due_date": "2027-01-18", "amount": 617.67 },
    { "instalment_number": 5, "due_date": "2027-02-18", "amount": 617.67 },
    { "instalment_number": 6, "due_date": "2027-03-18", "amount": 617.65 }
  ],
  "total_repayable": 3706.00,
  "collection_reference": "LOAN-GRACE-98765"
  -- Reference the parent uses when making repayments to the lender
}
```

---

## Commission Tracking

AfriTech earns a commission on every disbursed loan. The commission is tracked in an internal AfriTech table:

```sql
CREATE TABLE afritech.loan_commissions (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_application_id UUID NOT NULL,
  lender_id           UUID NOT NULL REFERENCES public.lenders(id),
  disbursed_amount    NUMERIC(12,2) NOT NULL,
  commission_rate     NUMERIC(5,4) NOT NULL,
  commission_amount   NUMERIC(12,2) NOT NULL,
  -- commission_amount = disbursed_amount × commission_rate
  status              TEXT DEFAULT 'pending'
                      CHECK (status IN ('pending', 'invoiced', 'received', 'disputed')),
  invoiced_at         TIMESTAMPTZ,
  received_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
```

The `afritech:finance_officer` role manages commission collection — invoicing lenders monthly for all commissions earned in the period.

---

## ZSMS as Internal Lender (Phase 3)

When ZSMS registers as an MFI, a special lender record is created:

```sql
INSERT INTO public.lenders (
  lender_name, display_name, integration_type, is_featured, commission_rate
) VALUES (
  'zsms_internal',
  'ZSMS Finance',     -- Branded as AfriTech's own product
  'zsms_internal',    -- Special integration type — no API call needed
  TRUE,               -- Featured prominently
  0.0000              -- No commission — AfriTech keeps all interest
);
```

The `submit-to-lender` Edge Function detects `integration_type = 'zsms_internal'` and routes the application to the in-house underwriting engine rather than an external lender. The `zsms_is_lender = TRUE` flag on the application enables different processing through the entire lifecycle.

---

## Business Rules

1. A lender must have `is_active = TRUE` and integration testing passed before appearing in the parent-facing lender selection.
2. Applications below a lender's `min_behaviour_score` are not shown to parents for that lender. The system only presents lenders whose score threshold the parent meets.
3. Commission rates and commercial terms are stored internally and never exposed in parent-facing UI or API responses.
4. The lender's collection account details (for parent repayments) are always shown to the parent after disbursement — making ZSMS the convenient repayment interface even in Phase 1.
5. When ZSMS becomes an internal lender (`zsms_internal`), it is featured prominently but parents always retain the option to choose a partner lender.
6. All lender API keys are encrypted using `GATEWAY_ENCRYPTION_KEY` — the same key used for payment gateway credentials.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 14 loan module documentation |
| 2026-04-26 | Added lender marketplace architecture | Multiple lenders onboarded as platform partners |
| 2026-04-26 | Added min_behaviour_score filter | Only show suitable lenders to each parent |
| 2026-04-26 | Added zsms_internal integration type | ZSMS MFI evolution confirmed |
| 2026-04-26 | Added commission tracking table | AfriTech finance officer needs revenue tracking |
