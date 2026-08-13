# PAYMENTS.md — Payment Recording and Verification

## Related Documents

- `docs/modules/fees/FEE_STRUCTURES.md` — fee records that payments are made against
- `docs/modules/fees/RECEIPTS.md` — receipt generation on payment verification
- `docs/modules/fees/REMINDERS.md` — reminder scheduling affected by payment status
- `docs/modules/fees/GATEWAY.md` — online payment gateway integration
- `docs/modules/fees/AUDIT.md` — financial audit trail for all payments
- `docs/modules/students/PARENT_LINKING.md` — parent who submits the payment
- `docs/DATABASE.md` — payments table full schema
- `docs/RLS.md` — payment table RLS policies
- `docs/api/EDGE_FUNCTIONS.md` — webhook-payment function
- `docs/modules/auth/SESSIONS.md` — confirmation checkbox replaces OTP

---

## Purpose

This document defines the complete payment lifecycle in ZSMS — how payments are submitted by parents, recorded by accountants, verified, rejected, queried, and reversed. It covers the updated security model (confirmation checkbox and proof of payment instead of OTP), the verification queue workflow, duplicate detection, and how payment status flows through the system. Every Claude Code session building any payment feature must read this document.

---

## Overview

ZSMS does not process payments directly. It records payment outcomes and manages the verification workflow between parents and school accountants. The payment flow has two main paths:

**Path 1 — Parent-submitted payment:** Parent makes a payment via mobile money, bank transfer, or cash and submits proof through the parent portal. The accountant reviews and verifies.

**Path 2 — Online gateway payment:** Parent pays through a connected payment gateway (Flutterwave, PawaPay, etc.). The gateway webhook automatically records and verifies the payment.

**Path 3 — Accountant-recorded payment:** The accountant records a cash or cheque payment directly in the dashboard on behalf of the parent.

---

## Payment Status Flow

```
                    ┌─────────────────┐
                    │  pending_       │  ← Parent submits / Accountant records
                    │  verification   │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         ┌────────┐    ┌─────────┐    ┌──────────┐
         │verified│    │rejected │    │ queried  │
         └────────┘    └─────────┘    └──────────┘
              │                            │
              │                            ▼
              │                   ┌─────────────────┐
              │                   │ pending_        │  ← Parent responds
              │                   │ verification    │
              │                   └─────────────────┘
              ▼
    fee_records.amount_paid updated
    fee_records.status recalculated
    Receipt PDF generated
    Parent notified via WhatsApp/email
```

### Status Definitions

| Status | Meaning | Who Sets It |
|---|---|---|
| `pending_verification` | Submitted — awaiting accountant review | System (on submit) |
| `verified` | Confirmed — payment accepted | Accountant |
| `rejected` | Declined — payment cannot be verified | Accountant |
| `queried` | Accountant needs more information before deciding | Accountant |

### Fee Record Status (derived from payments)

After any payment verification, `fee_records.status` is recalculated:

| Condition | Fee Record Status |
|---|---|
| No verified payments, amount_paid = 0 | `unpaid` |
| Some verified payments, amount_paid < amount_due | `partial` |
| Verified payments total = amount_due | `paid` |
| Loan disbursement covers the fee | `loan_paid` |
| Admin waived the fee | `waived` |
| Payment exceeds amount_due | `overpaid` |

---

## Path 1 — Parent-Submitted Payment

### Submission Form (Parent Portal)

Parent navigates to Fees → [Student Name] → [Fee Record] → Submit Payment.

**Form fields:**

```
Payment for: Chanda Bwalya — Grade 9A
Fee: Tuition Fee — Term 2 2026
Outstanding: K2,500.00

Amount Paid: [number field — K]
Payment Method: [dropdown]
  ○ Mobile Money (Airtel / MTN / Zamtel)
  ○ Bank Transfer / Deposit
  ○ Cash (paid at school)
  ○ Other

Transaction Reference / ID: [text field]
  (Mobile money confirmation number, bank reference, etc.)

Payment Date: [date picker — defaults to today]

Proof of Payment: [file upload button]
  Upload a photo or screenshot of your payment confirmation
  Accepted: JPG, PNG, PDF · Max 10MB

[Upload Proof of Payment ↑]
✅ payment_confirmation.jpg uploaded

☐ I confirm that this payment has been made and the information
  provided is accurate. I understand that false submissions may
  result in account suspension.

[Submit Payment]  ← disabled until checkbox is checked and proof uploaded
```

### Server-Side Validation

The API route validates before writing:

```typescript
// POST /api/fees/payments
const schema = z.object({
  fee_record_id: z.string().uuid(),
  amount: z.number().positive(),
  payment_method: z.enum(['mobile_money', 'bank_deposit', 'cash', 'other']),
  transaction_reference: z.string().optional(),
  proof_of_payment_url: z.string().min(1),  // Required — cannot be empty
  payment_date: z.string().date(),
  confirmation_checkbox_at: z.string().datetime(),  // Required — must be present
})

// Additional business logic checks:
// 1. fee_record belongs to this school
// 2. parent is linked to the student on this fee_record
// 3. fee_record status is not already 'paid', 'waived', or 'loan_paid'
// 4. confirmation_checkbox_at is within the last 10 minutes (freshness check)
// 5. Duplicate transaction reference check
```

### Submission Acknowledgement

Immediately on successful submission (before accountant review), the parent receives:

**In-app notification:**
```
Payment submitted ✓
Reference: PAY-ZM-LSK-0001-001234
Amount: K2,500.00 for Chanda Bwalya — Tuition Fee
Status: Pending verification
You'll be notified when the school reviews your payment.
```

**Email (if parent has email registered):**
```
Subject: Payment submitted — PAY-ZM-LSK-0001-001234

Your payment of K2,500.00 for Chanda Bwalya (Tuition Fee, Term 2)
has been received and is pending verification by the school accountant.

Reference: PAY-ZM-LSK-0001-001234
Submitted: 15 September 2026, 10:23am

You'll receive a confirmation once the school verifies your payment.
```

The submission reference (`PAY-ZM-LSK-0001-XXXXXX`) is generated sequentially per school, same pattern as receipt numbers. It gives the parent a trackable reference before the full receipt is issued.

### Duplicate Transaction Reference Detection

Before the payment INSERT, the API checks for duplicate transaction references:

```typescript
if (transaction_reference) {
  const { data: existing } = await supabase
    .from('payments')
    .select('id, amount, paid_at')
    .eq('school_id', schoolId)
    .eq('transaction_reference', transaction_reference)
    .not('is_voided', 'eq', true)
    .single()

  if (existing) {
    return Response.json({
      error: 'This transaction reference has already been submitted',
      code: 'DUPLICATE_TRANSACTION_REFERENCE',
      details: {
        existing_payment_id: existing.id,
        submitted_amount: existing.amount,
        submitted_at: existing.paid_at,
      }
    }, { status: 409 })
  }
}
```

If the parent sees this error but believes their new payment is different, they can proceed by submitting without the transaction reference or by adding a note clarifying the situation. The duplicate warning is in the UI — the submit button still works after the parent acknowledges.

---

## Path 2 — Online Gateway Payment

When a parent pays through a connected gateway:

```
1. Parent selects gateway from the payment page
2. Redirected to gateway checkout (Flutterwave, PawaPay, etc.)
3. Payment processed by gateway
4. Gateway sends webhook to ZSMS:
   POST /api/webhooks/payment/[gateway_name]
5. webhook-payment Edge Function:
   a. Validates HMAC signature
   b. Finds matching payment row by gateway_reference
   c. Updates payment status to 'verified' automatically
   d. Updates fee_record.amount_paid and status
   e. Generates receipt PDF
   f. Sends WhatsApp confirmation to parent
7. Parent returns to ZSMS — sees "Payment confirmed" screen
```

Gateway payments skip the manual verification queue. The HMAC-verified webhook is treated as authoritative proof. `payments.webhook_verified = TRUE` marks these records.

---

## Path 3 — Accountant-Recorded Payment

The accountant records payments received in person (cash, cheque, bank deposit slip presented at school).

**Location:** Fees → Record Payment (dashboard shortcut) or Fees → [Student] → Add Payment

**Form:**
```
Student: [search by name or student ID]
Fee record: [dropdown — outstanding fees for this student]
Amount: [number]
Payment method: [cash / bank_deposit / cheque / other]
Transaction reference: [optional — cheque number, bank reference]
Payment date: [date picker]
Notes: [optional — "Parent brought bank slip, filed in folder"]
```

Accountant-recorded payments go directly to `status: 'verified'` — no pending verification step since the accountant is recording what they personally received. Receipt is generated immediately.

---

## Payment Verification Queue

The accountant's primary workflow is reviewing parent-submitted payments.

**Location:** Fees → Verification Queue

Displays all payments with `status: 'pending_verification'` ordered by submission time (oldest first).

Each queue item shows:
```
Chanda Bwalya · Grade 9A                    Submitted: 15 Sep 10:23am
Tuition Fee — Term 2 2026
Amount submitted: K2,500.00
Method: Mobile Money
Reference: TXN20260915001234
Proof: [View proof →]

[✅ Verify]   [❓ Query]   [❌ Reject]
```

### Verifying a Payment

```
Accountant clicks Verify
→ Optional note: "Confirmed against Airtel statement"
→ Confirms
→ payments.status = 'verified'
→ payments.verified_by = accountant_user_id
→ payments.verified_at = NOW()
→ fee_records.amount_paid recalculated
→ fee_records.status recalculated
→ Receipt PDF generated → stored in R2
→ Parent notified:
  WhatsApp: "Payment confirmed ✓ K2,500 for Chanda · Receipt: [link]"
  In-app: "Your payment has been verified"
→ Audit log entry written
```

### Querying a Payment

Used when the accountant needs more information before deciding.

```
Accountant clicks Query
→ Message to parent (required): [text field]
  E.g. "The mobile money screenshot is unclear. Please resubmit
        a clearer photo of your confirmation."
→ Confirms
→ payments.status = 'queried'
→ payments.queried_reason = message
→ Parent notified in-app and email with the accountant's message
→ Parent can resubmit proof → status returns to 'pending_verification'
→ No automated fee reminders sent while this payment is 'queried'
```

### Rejecting a Payment

```
Accountant clicks Reject
→ Rejection reason (required): [text field]
  E.g. "This transaction reference was not found in our records.
        Please contact us to clarify."
→ Confirms
→ payments.status = 'rejected'
→ payments.rejection_reason = reason
→ fee_records status unchanged (still unpaid/partial)
→ Parent notified:
  "Your payment submission for Chanda could not be verified.
   Reason: [reason]. Please contact the school."
→ Audit log entry written
```

---

## Payment Reversals

Payments that were verified in error are corrected via reversal — a new payment row with a negative amount.

```
Accountant opens verified payment → Actions → Reverse Payment
→ Reversal reason (required): "Incorrect amount recorded — re-entering"
→ Confirms
→ New payment row created:
  amount: -2500.00
  payment_method: 'reversal'
  reversal_of_payment_id: original_payment_id
  notes: "Reversal of PAY-ZM-LSK-0001-000123 — [reason]"
→ Original payment: is_voided = TRUE
→ fee_records.amount_paid recalculated (reversal removes the amount)
→ fee_records.status recalculated
→ Audit log entry with old and new values
→ Parent notified: "A payment reversal has been applied to your account.
   Contact the school for details."
```

The original payment row is never deleted — it is marked `is_voided = TRUE`. The complete transaction history is always visible.

---

## Business Rules

1. `confirmation_checkbox_at` is required on all parent-submitted payments. Validated server-side — missing value returns 400 `MISSING_CONFIRMATION`.
2. `proof_of_payment_url` is required on all parent-submitted payments. Validated server-side — missing value returns 400 `MISSING_PROOF_OF_PAYMENT`.
3. Payment records are never hard-deleted. Corrections use reversal records.
4. The `is_voided` flag marks reversed payments. Voided payments are excluded from all balance calculations.
5. While a payment is in `queried` status, automated fee reminders are suppressed for that fee record. The accountant is actively working with the parent.
6. Gateway payments (webhook-confirmed) bypass the manual verification queue and are auto-verified.
7. Accountant-recorded cash/bank payments are auto-verified at the time of recording — no pending review step.
8. Duplicate transaction reference detection returns a 409 warning but does not block submission — the parent can acknowledge and proceed.
9. The submission acknowledgement reference (`PAY-ZM-LSK-0001-XXXXXX`) is distinct from the receipt number (`REC-ZM-LSK-0001-000001`) — the submission reference is generated on submit, the receipt number on verification.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 9 fee module documentation |
| 2026-04-26 | OTP removed — replaced with confirmation checkbox and proof of payment | Confirmed security model update |
| 2026-04-26 | Added queried status | Accountants need to request more info before deciding |
| 2026-04-26 | Added submission acknowledgement reference | Parents need confirmation before accountant reviews |
| 2026-04-26 | Added duplicate transaction reference detection | Fraud mitigation |
