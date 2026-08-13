# AUDIT.md — Financial Audit Trail

## Related Documents

- `docs/modules/fees/PAYMENTS.md` — payment events that generate audit entries
- `docs/modules/fees/RECEIPTS.md` — receipt generation events
- `docs/modules/fees/FEE_STRUCTURES.md` — fee record generation events
- `docs/modules/fees/REMINDERS.md` — reminder events
- `docs/DATABASE.md` — audit_logs table, payments table immutability
- `docs/RLS.md` — audit log access policies
- `docs/modules/auth/IMPERSONATION.md` — impersonation audit entries
- `docs/modules/auth/PERMISSIONS.md` — permission grant audit entries

---

## Purpose

This document defines the financial audit trail in ZSMS — what is logged for every financial event, how the audit log is accessed, how reports are generated, and the immutability guarantees that make the trail trustworthy. Every Claude Code session building any financial feature must ensure the appropriate audit log entry is written.

---

## Overview

The financial audit trail serves two purposes. Operationally, it gives school owners and accountants a complete, searchable history of every financial action at their school — who recorded what payment, when, and what changed. Legally and for compliance, it provides an immutable record that satisfies financial record-keeping requirements and can be presented to auditors or regulators.

The audit trail is built on two complementary systems. The `public.audit_logs` table records every create, update, and delete action across all tables including financial ones. The `public.payments` table itself is an immutable ledger — payments are never updated or deleted, corrections are made via reversal records. Together these provide defence in depth: even if the audit log had a gap, the payments ledger tells the true story.

---

## What Is Logged for Financial Events

### Fee Record Generation

When the admin generates fee records for a term:

```json
{
  "action": "fee_records_generated",
  "table_name": "fee_records",
  "actor_user_id": "admin_clerk_id",
  "metadata": {
    "academic_year": "2026",
    "term_number": 2,
    "students_affected": 412,
    "fee_records_created": 1236,
    "fee_records_skipped": 0
  }
}
```

### Payment Submission (Parent)

When a parent submits a payment:

```json
{
  "action": "payment_submit",
  "table_name": "payments",
  "record_id": "payment-uuid",
  "actor_user_id": "parent_clerk_id",
  "new_values": {
    "fee_record_id": "fee-uuid",
    "amount": 2500.00,
    "payment_method": "mobile_money",
    "transaction_reference": "TXN20260915001234",
    "proof_of_payment_url": "r2/private/school_id/proofs/payment-uuid.jpg",
    "status": "pending_verification",
    "confirmation_checkbox_at": "2026-09-15T10:23:00Z"
  },
  "metadata": {
    "student_id": "STU-ZM-LSK-0001-00042",
    "submission_reference": "PAY-ZM-LSK-0001-001234",
    "ip_address": "197.x.x.x"
  }
}
```

Note: The `confirmation_checkbox_at` timestamp is permanently recorded, creating a legal acknowledgement trail.

### Payment Verification

When an accountant verifies a payment:

```json
{
  "action": "payment_verify",
  "table_name": "payments",
  "record_id": "payment-uuid",
  "actor_user_id": "accountant_clerk_id",
  "old_values": { "status": "pending_verification" },
  "new_values": {
    "status": "verified",
    "verified_by": "accountant_clerk_id",
    "verified_at": "2026-09-15T11:45:00Z"
  },
  "metadata": {
    "receipt_number": "REC-ZM-LSK-0001-000042",
    "fee_record_status_after": "paid",
    "amount_paid_after": 2500.00
  }
}
```

### Payment Rejection

```json
{
  "action": "payment_reject",
  "table_name": "payments",
  "record_id": "payment-uuid",
  "actor_user_id": "accountant_clerk_id",
  "old_values": { "status": "pending_verification" },
  "new_values": {
    "status": "rejected",
    "rejection_reason": "Transaction reference not found in our records"
  }
}
```

### Payment Query

```json
{
  "action": "payment_query",
  "table_name": "payments",
  "record_id": "payment-uuid",
  "actor_user_id": "accountant_clerk_id",
  "old_values": { "status": "pending_verification" },
  "new_values": {
    "status": "queried",
    "queried_reason": "Screenshot is unclear. Please resubmit a clearer photo."
  }
}
```

### Payment Reversal

```json
{
  "action": "payment_reverse",
  "table_name": "payments",
  "record_id": "reversal-payment-uuid",
  "actor_user_id": "accountant_clerk_id",
  "new_values": {
    "amount": -2500.00,
    "payment_method": "reversal",
    "reversal_of_payment_id": "original-payment-uuid",
    "notes": "Incorrect amount recorded — re-entering"
  },
  "metadata": {
    "original_payment_id": "original-payment-uuid",
    "original_receipt_number": "REC-ZM-LSK-0001-000042",
    "fee_record_status_after": "partial"
  }
}
```

### Fee Waiver

```json
{
  "action": "fee_waiver",
  "table_name": "fee_records",
  "record_id": "fee-record-uuid",
  "actor_user_id": "accountant_clerk_id",
  "old_values": { "status": "unpaid", "discount_amount": 0 },
  "new_values": {
    "status": "waived",
    "discount_amount": 2500.00,
    "discount_reason": "Scholarship — Academic Merit 2026"
  }
}
```

### AfriTech Super Admin Financial Action

When a super admin makes a financial change (e.g. correcting a payment during support):

```json
{
  "action": "payment_admin_correction",
  "table_name": "payments",
  "record_id": "payment-uuid",
  "actor_user_id": "mwando_superadmin_id",
  "impersonated_user_id": "accountant_clerk_id",
  "old_values": { "amount": 2500.00 },
  "new_values": { "amount": 2000.00 },
  "metadata": {
    "support_reason": "Support ticket #2847 — amount entered incorrectly",
    "impersonation_session_id": "session-uuid"
  }
}
```

The `impersonated_user_id` clearly distinguishes AfriTech actions from school staff actions, even when acting through impersonation.

---

## Accessing the Audit Trail

### School Owner and Principal View

**Location:** Reports → Audit Log → Financial Events

Filters available:
- Date range
- Event type (payment submission / verification / rejection / waiver / reversal)
- Student name or student ID
- Staff member who performed the action
- Amount range

**Display:**
```
15 Sep 2026  10:23am  Payment submitted
Chanda Bwalya · Tuition Fee Term 2
K2,500.00 · Mobile Money · by Parent (Grace Mwale)
Reference: PAY-ZM-LSK-0001-001234

15 Sep 2026  11:45am  Payment verified ✅
Chanda Bwalya · Tuition Fee Term 2
K2,500.00 · Receipt: REC-ZM-LSK-0001-000042 · by Mrs. Banda (Accountant)
```

### Accountant View

Accountants see the same financial audit events but filtered to their school. They cannot see the raw audit log (which includes all system events) — only the financial events relevant to their role.

### AfriTech Super Admin View

Super admins see the complete audit log across all schools. They can filter by school, by actor (including their own team members), and by event type. They can also see impersonation events — when a team member accessed a school and what they did.

---

## Financial Reports

Two downloadable report formats are generated from the financial audit trail and payment data.

### End-of-Term Financial Summary

**Format:** Both PDF (formatted report) and CSV (raw data)
**Generated by:** School owner or accountant
**Location:** Reports → Financial → Term Summary

**Report contents:**
```
FINANCIAL SUMMARY REPORT
Sunrise Academy — Term 2, Academic Year 2026
Generated: 15 September 2026

COLLECTION SUMMARY
Total fees due:           K1,247,500.00
Total collected:          K1,089,250.00
Total outstanding:        K  158,250.00
Collection rate:          87.3%
Waivers applied:          K   12,500.00 (5 students)

PAYMENT METHODS BREAKDOWN
Cash:                     K  234,500.00  (21.5%)
Mobile Money:             K  612,750.00  (56.3%)
Bank Transfer:            K  189,000.00  (17.4%)
Online Gateway:           K   53,000.00  ( 4.9%)

FEE LINE BREAKDOWN
Tuition Fee:              K  845,000.00 of K  910,000.00 (92.9%)
Activity Fee:             K  178,500.00 of K  182,000.00 (98.1%)
Boarding Fee:             K   65,750.00 of K  155,500.00 (42.3%)

PAYMENT STAFF ACTIVITY
Mrs. Banda (Accountant):  423 payments recorded
Mr. Phiri (Admin):         12 payments recorded (granted access Oct 3-10)

OUTSTANDING STUDENTS: 47
[List of students with outstanding balances, amounts, and last reminder date]
```

### Annual Financial Report

**Format:** PDF and CSV
**Coverage:** Full academic year, all three terms
**Location:** Reports → Financial → Annual Summary

Combines three term summaries into a single report. Suitable for annual school financial review, board presentations, and regulatory filing.

---

## Immutability Guarantees

### Payments Table

The `payments` table has no UPDATE or DELETE RLS policy for any school-level user. Corrections are made by:
1. Inserting a reversal record (negative amount)
2. Marking the original as `is_voided = TRUE`

AfriTech super admins can UPDATE payment records directly (e.g. correcting a data entry error) — but only via the Supabase service role client in an Edge Function, and every such action is logged in the audit trail with the super admin's identity and a mandatory reason.

### Audit Logs Table

The `audit_logs` table has:
- No UPDATE policy for any user including super admins
- No DELETE policy for any user including super admins
- INSERT only via the service role client in Edge Functions

Once an audit log entry is written, it is permanent. Not even AfriTech can delete or modify it.

### Retention

Financial audit records (both `payments` rows and `audit_logs` entries) are retained indefinitely. There is no automatic archiving or deletion. This satisfies the Zambian legal requirement for financial records to be retained for 7 years and provides a complete history for schools that use ZSMS long-term.

---

## Business Rules

1. Every financial action — payment submission, verification, rejection, query, reversal, waiver, fee generation — writes an audit log entry before returning a response to the client. If the audit write fails, the primary operation is rolled back.
2. The `confirmation_checkbox_at` timestamp is permanently recorded in the audit log for every parent-submitted payment. This creates a legal acknowledgement trail.
3. Audit log entries for financial events always include the actor's Clerk user ID. During impersonation, both the real actor and the impersonated user's IDs are recorded.
4. PII fields (NRC numbers, income figures) are never written to the audit log. The `old_values` and `new_values` JSONB fields mask these as `[REDACTED]`.
5. The end-of-term financial summary report is available in both PDF and CSV format. This was confirmed as the correct output format.
6. Financial reports can only be generated by `org:owner`, `org:accountant`, and AfriTech super admins. Teachers and admins do not have access to financial reports.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 9 fee module documentation |
| 2026-04-26 | Added confirmation_checkbox_at to payment submission audit | Legal acknowledgement trail confirmed |
| 2026-04-26 | Added queried status audit entry | Payment queried status confirmed |
| 2026-04-26 | Added PDF + CSV for financial reports | Both formats confirmed for end-of-term report |
| 2026-04-26 | Added AfriTech super admin correction audit pattern | Impersonation with full CRUD confirmed |
