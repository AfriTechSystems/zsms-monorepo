# REPAYMENT.md — Loan Repayment Tracking and Collection UX

## Related Documents

- `docs/modules/loans/LOANS.md` — loan module overview
- `docs/modules/loans/LENDER_INTEGRATION.md` — disbursement webhook that initiates repayment tracking
- `docs/modules/loans/SUBMISSION.md` — security model reference
- `docs/DATABASE.md` — private.loan_applications repayment_schedule field
- `docs/infra/META_API.md` — WhatsApp repayment reminders
- `docs/modules/fees/GATEWAY.md` — payment gateways used for in-portal repayments

---

## Implementation Status (2026-10-11)

**Phase 1 is now actually built. It was the one thing in this folder that was not.**

Phase 1, as this document defines it, is entirely *"surfacing the lender's collection
details prominently, showing the repayment schedule clearly"*. ZSMS moves no money.

The route had been returning `collectionAccount` and `repaymentSchedule` all along and
**the screen rendered neither** — it showed `collection_instructions` and stopped. With
the one seeded lender, that produced "How to repay: Airtel Money" and nothing else: a
parent with a debt, a channel name, and no way to pay it. Worse than an empty screen,
because it reads as an answer.

Now rendered: the mobile money number or bank account, the branch, the parent's own
reference (every lender's instructions say to quote it, and an unidentified repayment is
the one that goes missing), and the instalment table.

**`0260` makes the underlying state impossible.** An active lender must now have a
`collection_account` carrying at least one route for money — a mobile number, a paybill or
an account number. A bank *name* alone is refused, because a row that looks populated is
the one nobody checks. The seeded lender was deactivated rather than given invented
details: writing a plausible Airtel number against a real company would put fabricated
payment details in front of a parent about to send money, which is the most harmful thing
a seed could do in this module.

**Phase 2 and 3 are correctly not built.** Phase 2 needs a payment gateway, which the
platform does not have in any form. `loan_repayment_log` belongs there, and the schedule's
`status` and `paid_at` fields are written by the lender webhook — which needs a lender
agreement before it needs code.

---

## Purpose

This document defines how loan repayments are tracked, how the repayment UX works in the parent portal, how parents can initiate repayments through ZSMS, and how the repayment collection model evolves across the three phases. Every Claude Code session building any repayment feature must read this document.

---

## Overview

ZSMS does not process repayments in Phase 1 — the parent repays the lender directly. ZSMS's role is to make the repayment process as convenient as possible by surfacing the lender's collection details prominently, showing the repayment schedule clearly, and — in Phase 2 — allowing parents to initiate repayments from within the ZSMS portal without needing to know the lender's mobile money number.

The repayment model evolves significantly across phases:

| Phase | ZSMS Role in Repayment | Parent Experience |
|---|---|---|
| Phase 1 | Display lender's collection details | Parent pays lender directly (mobile money, bank) |
| Phase 2 | Initiate payment via ZSMS gateway on parent's behalf | Parent taps "Pay instalment" in ZSMS — done |
| Phase 3 (ZSMS as MFI) | Collect directly into AfriTech float account | Full in-house — ZSMS is the lender and collector |

---

## Repayment Schedule Storage

When a loan is disbursed, the repayment schedule is stored in `private.loan_applications.repayment_schedule` as a JSONB array:

```typescript
interface RepaymentInstalment {
  instalment_number: number
  due_date: string                   // ISO date: '2026-10-18'
  amount: number                     // Instalment amount in ZMW
  status: 'pending' | 'paid' | 'overdue' | 'waived'
  paid_at?: string                   // Set when lender confirms payment
  paid_amount?: number               // Actual amount paid (may differ from scheduled)
  lender_reference?: string          // Lender's internal payment reference
}

// Example schedule stored in loan_applications.repayment_schedule
[
  { "instalment_number": 1, "due_date": "2026-10-18", "amount": 617.67, "status": "paid",    "paid_at": "2026-10-15" },
  { "instalment_number": 2, "due_date": "2026-11-18", "amount": 617.67, "status": "pending" },
  { "instalment_number": 3, "due_date": "2026-12-18", "amount": 617.67, "status": "pending" },
  { "instalment_number": 4, "due_date": "2027-01-18", "amount": 617.67, "status": "pending" },
  { "instalment_number": 5, "due_date": "2027-02-18", "amount": 617.67, "status": "pending" },
  { "instalment_number": 6, "due_date": "2027-03-18", "amount": 617.65, "status": "pending" }
]
```

**Loan application status values after disbursement:**

| Status | Meaning |
|---|---|
| `disbursed` | Loan disbursed — repayment active |
| `current` | All instalments up to date |
| `in_arrears` | One or more instalments overdue |
| `fully_repaid` | All instalments paid |
| `cancelled` | Loan cancelled before full repayment (rare) |
| `written_off` | Lender has written off the loan (Phase 3 only) |

---

## Parent Portal — Repayment Dashboard

After a loan is disbursed, the parent sees a repayment dashboard in their Finance section:

```
My Loans — Finance
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Madison Finance — School Fee Loan
Reference: LOAN-GRACE-98765
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Loan amount:      K3,400.00
Total repayable:  K3,706.00
Monthly payment:  K  617.67
Status:           ✅ Current

Progress:
[████████████░░░░░░░░░░░░] 2 of 6 paid (33%)

Repayment Schedule:

✅ Instalment 1   K617.67   Due 18 Oct 2026   Paid 15 Oct 2026
✅ Instalment 2   K617.67   Due 18 Nov 2026   Paid 14 Nov 2026
⏳ Instalment 3   K617.67   Due 18 Dec 2026   → 12 days away
   Instalment 4   K617.67   Due 18 Jan 2027
   Instalment 5   K617.67   Due 18 Feb 2027
   Instalment 6   K617.65   Due 18 Mar 2027

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW TO REPAY — INSTALMENT 3 (K617.67)

Airtel Money:
  Send to: 0977 XXX XXX
  Reason: LOAN-GRACE-98765

FNB Bank Transfer:
  Account: XXXXXXXXXXXX
  Branch:  Cairo Road, Lusaka
  Reference: LOAN-GRACE-98765

Always use your loan reference as the payment reason.

[📋 Copy reference]   [📞 Contact Madison Finance]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

The collection details from `lenders.collection_account` and `lenders.collection_instructions` are displayed prominently. The parent can copy the loan reference number with one tap.

---

## Phase 2 — In-Portal Repayment Initiation

In Phase 2, the parent can initiate the repayment from within ZSMS without knowing the lender's details. ZSMS acts as the payment initiator on the parent's behalf.

```
⏳ Instalment 3   K617.67   Due 18 Dec 2026   → 12 days away

[Pay this instalment →]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pay Instalment 3 — K617.67
Madison Finance · Loan LOAN-GRACE-98765

Choose payment method:
○ Airtel Money (from your registered number)
○ MTN MoMo
○ Bank Transfer

[Confirm and Pay K617.67]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Technical flow for Phase 2 repayment:**

```typescript
// POST /api/loans/repayments/initiate
async function initiateRepayment(
  loanApplicationId: string,
  instalmentNumber: number,
  paymentMethod: 'airtel_money' | 'mtn_momo' | 'bank_transfer',
  parentUserId: string
) {
  // 1. Fetch loan application and lender details
  const loan = await getLoanApplication(loanApplicationId)
  const lender = await getLender(loan.lender_id)

  // 2. Identify the instalment
  const instalment = loan.repayment_schedule.find(
    i => i.instalment_number === instalmentNumber
  )

  // 3. Initiate payment via PawaPay to lender's collection account
  const paymentResult = await initiatePawaPay({
    amount: instalment.amount,
    currency: 'ZMW',
    recipient: lender.collection_account.mobile_money,
    correspondent: paymentMethod === 'airtel_money' ? 'AIRTEL_ZAMBIA' : 'MTN_ZAMBIA',
    customerPhone: loan.parent_phone,
    reference: `${loan.collection_reference}-INS${instalmentNumber}`,
  })

  // 4. Create a payment record in the loan repayment log
  await supabaseAdmin.from('private.loan_repayment_log').insert({
    loan_application_id: loanApplicationId,
    instalment_number: instalmentNumber,
    amount: instalment.amount,
    payment_method: paymentMethod,
    gateway_reference: paymentResult.payoutId,
    status: 'initiated',
    initiated_by: parentUserId,
    initiated_at: new Date().toISOString(),
  })

  return { status: 'initiated', reference: paymentResult.payoutId }
}
```

The lender then confirms receipt and sends an updated repayment status via webhook — updating the instalment to `paid`.

---

## Repayment Tracking Updates

### Phase 1 — Manual Updates

AfriTech loan officer receives confirmation from the lender (email or phone) and manually updates the repayment schedule in the admin panel:

```
AfriTech Admin → Loan Applications → [LAP-ZM-LSK-0001-000001] → Repayments

Instalment 3 — K617.67 — Due 18 Dec 2026
[Mark as Paid]   Date paid: [date picker]   Amount paid: [K617.67]
```

### Phase 2 — Webhook Updates

Lender sends a webhook to ZSMS when an instalment is paid:

```json
{
  "event": "repayment.received",
  "zsms_reference": "LAP-ZM-LSK-0001-000001",
  "instalment_number": 3,
  "amount_received": 617.67,
  "received_at": "2026-12-15T09:15:00Z",
  "lender_reference": "PMT-2026-12345",
  "remaining_balance": 1852.97
}
```

The `webhook-loan` Edge Function processes this and updates the repayment schedule JSONB:

```typescript
// Update instalment status in the JSONB array
await supabaseAdmin.rpc('update_loan_instalment_status', {
  p_application_id: applicationId,
  p_instalment_number: 3,
  p_status: 'paid',
  p_paid_at: '2026-12-15T09:15:00Z',
  p_paid_amount: 617.67,
})

// Check if fully repaid
const allPaid = updatedSchedule.every(i => i.status === 'paid')
if (allPaid) {
  await updateLoanStatus(applicationId, 'fully_repaid')
  // Notify parent: loan fully repaid — improves behaviour score on next application
  await enqueueJob('send-whatsapp', {
    template_id: 'loan_status_update',
    variables: ['school', 'student', 'Fully Repaid', 'Congratulations — your loan is fully repaid!', lenderRef],
  })
}
```

---

## Repayment Reminders

ZSMS sends repayment reminders to parents as a service — not as a collection agent (that is the lender's responsibility).

```
3 days before instalment due date:

📅 Loan Repayment Reminder — Madison Finance

Instalment 3 of 6 is due in 3 days.
Amount: K617.67 · Due: 18 Dec 2026

Repay via Airtel Money: 0977 XXX XXX
Reference: LOAN-GRACE-98765

View your loan: zsms.co.zm/portal/finance
```

Reminders are sent via:
- **In-app notification:** Always
- **WhatsApp:** Counts against school quota (since the loan is school-related) OR AfriTech platform quota (for non-school loans) — configurable
- **Email:** Free via Resend

Reminder frequency: 7 days before due date and 3 days before due date. Never on the due date itself or after (that is the lender's domain).

---

## Arrears Handling

When an instalment is overdue (past due_date with status still `pending`):

```
⚠️ Loan Status: IN ARREARS

Instalment 3 was due 18 Dec 2026 — 5 days overdue.

Please contact Madison Finance immediately:
📞 +260 977 XXX XXX
📧 collections@madisonfinance.zm

ZSMS cannot intervene in loan collections.
Please work directly with your lender.

[Contact Madison Finance]
```

ZSMS shows the arrears status clearly but explicitly states it cannot intervene. The parent is directed to the lender. This is important legally — ZSMS is not a debt collector.

The arrears status affects the parent's behaviour score on future applications:
- Instalment overdue but paid within 14 days: minor penalty
- Instalment overdue more than 30 days: significant penalty
- Loan written off by lender: severe penalty — may result in all future ZSMS loan applications being declined

---

## Phase 3 — ZSMS as MFI Repayment Collection

When ZSMS is the lender, repayment collection is fully in-house:

```typescript
// Phase 3: ZSMS MFI repayment collection
// Parent pays into AfriTech's mobile money float account
// ZSMS reconciles payments daily from float statements
// Overdue accounts trigger ZSMS's own collections workflow
// Credit bureau (ZCR) reporting for repaid and defaulted loans
```

The parent experience in Phase 3 is seamless — "Pay instalment" in the portal triggers a PawaPay collection into AfriTech's own account. ZSMS sends the receipt immediately. No third-party lender involved.

---

## `private.loan_repayment_log` Table

Tracks every repayment event — both Phase 2 portal-initiated and webhook-confirmed repayments:

```sql
CREATE TABLE private.loan_repayment_log (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_application_id  UUID NOT NULL,
  instalment_number    INT NOT NULL,
  amount               NUMERIC(12,2) NOT NULL,
  payment_method       TEXT,
  gateway_reference    TEXT,
  status               TEXT NOT NULL DEFAULT 'initiated'
                       CHECK (status IN ('initiated', 'confirmed', 'failed', 'manual')),
  initiated_by         TEXT,         -- Parent's Clerk user ID (if portal-initiated)
  initiated_at         TIMESTAMPTZ,
  confirmed_at         TIMESTAMPTZ,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Business Rules

1. ZSMS displays lender collection details prominently after every disbursement. Parents should never need to call AfriTech to find out how to repay.
2. Repayment reminders are sent 7 days and 3 days before the due date. Never after the due date — overdue handling is the lender's responsibility.
3. ZSMS explicitly states it cannot intervene in collections when a loan is in arrears. The parent is always directed to the lender.
4. In Phase 2, portal-initiated repayments go directly to the lender's collection account via PawaPay. ZSMS never holds repayment funds in Phase 1 or 2.
5. Repayment history updates the parent's behaviour score for future loan applications — paying on time improves the score, arrears reduces it.
6. In Phase 3 (ZSMS as MFI), repayments flow into AfriTech's float account. The entire collections workflow including overdue follow-up becomes AfriTech's responsibility.
7. Loan repayment reminders from ZSMS count against WhatsApp quota for school-fee loans (school_id is set). For non-school loans (alumni, personal), they count against AfriTech's platform quota.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 14 loan module documentation |
| 2026-04-26 | Added Phase 2 in-portal repayment initiation | Confirmed — build for later |
| 2026-04-26 | Added collection details display in Phase 1 | UX convenience confirmed |
| 2026-04-26 | Added repayment_log table | Audit trail for portal-initiated repayments |
| 2026-04-26 | Added arrears handling with explicit lender redirect | ZSMS is not a debt collector |
