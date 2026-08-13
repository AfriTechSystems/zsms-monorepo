# TEMPLATES.md — WhatsApp Message Templates

## Related Documents

- `docs/modules/communication/WHATSAPP.md` — template usage per message type
- `docs/modules/communication/MESSAGE_LOG.md` — template_id field in logs
- `docs/modules/communication/CHATBOT.md` — chatbot response templates
- `docs/infra/META_API.md` — Meta template submission and approval
- `docs/DATABASE.md` — no template table — templates managed at Meta level

---

## Purpose

This document is the complete reference for all WhatsApp message templates used in ZSMS — what each template contains, its variable structure, character limits, approval status, and how new templates are added. Every Claude Code session dispatching a WhatsApp message must reference this document to ensure the correct template ID and variable order are used.

---

## Overview

WhatsApp Business API requires all outbound messages to use pre-approved templates unless the conversation is within a 24-hour session window opened by an inbound message. Every template must be submitted to Meta and approved before use. ZSMS maintains a master set of templates registered under the AfriTech WhatsApp Business account. Schools using their own WhatsApp number register the same template specifications under their own account.

Templates use numbered variables (`{{1}}`, `{{2}}`, `{{3}}`) in the order they appear in the message body. The `send-whatsapp` Edge Function maps database fields to these variables in the correct order.

---

## Template Registry

### `results_published`

**Category:** Utility
**Trigger:** Principal publishes results AND generates report cards
**Quota impact:** 1 per student

```
Subject: 📊 Term {{1}} Results — {{2}}

{{3}}'s Term {{1}} results are now available.

Class position: {{4}} of {{5}}
{{6}} credits achieved.

Download report card:
{{7}}

View all results: zsms.co.zm/portal/results
```

**Variable mapping:**
```typescript
variables: [
  termNumber,                    // {{1}} "2"
  schoolName,                    // {{2}} "Sunrise Academy"
  studentFirstName,              // {{3}} "Chanda"
  classPosition,                 // {{4}} "3"
  classSize,                     // {{5}} "38"
  creditCount + ' of ' + totalSubjects,  // {{6}} "4 of 6" (ECZ only — else "6 subjects passed")
  reportCardSignedUrl,           // {{7}} signed R2 URL
]
```

**Character limit check:** Body with max-length variables: ~180 characters. Well within 1,024 limit.

---

### `fee_payment_confirmed`

**Category:** Utility
**Trigger:** Accountant verifies a payment
**Quota impact:** 1 per verified payment

```
✅ Payment Confirmed — {{1}}

{{2}} · {{3}}
Amount: {{4}}
Fee: {{5}} · {{6}}
Receipt: {{7}}

Download receipt:
{{8}}

View fee history: zsms.co.zm/portal/fees
```

**Variable mapping:**
```typescript
variables: [
  schoolName,              // {{1}} "Sunrise Academy"
  studentFullName,         // {{2}} "Chanda Bwalya"
  gradeDisplay,            // {{3}} "Grade 9A"
  formattedAmount,         // {{4}} "K2,500.00"
  feeLabel,                // {{5}} "Tuition Fee"
  termLabel,               // {{6}} "Term 2 2026"
  receiptNumber,           // {{7}} "REC-ZM-LSK-0001-000042"
  receiptSignedUrl,        // {{8}} signed R2 URL (7-day expiry)
]
```

---

### `fee_payment_rejected`

**Category:** Utility
**Trigger:** Accountant rejects a payment submission
**Quota impact:** 1 per rejection

```
⚠️ Payment Not Verified — {{1}}

Your payment submission for {{2}} ({{3}}) could not be verified.

Fee: {{4}} · {{5}}
Reason: {{6}}

Please contact the school or resubmit:
zsms.co.zm/portal/fees
```

**Variable mapping:**
```typescript
variables: [
  schoolName,        // {{1}}
  studentFirstName,  // {{2}}
  gradeDisplay,      // {{3}}
  feeLabel,          // {{4}}
  termLabel,         // {{5}}
  rejectionReason,   // {{6}} — truncated to 200 chars if longer
]
```

---

### `fee_overdue_reminder`

**Category:** Utility
**Trigger:** Daily cron — 7 and 14 days past due_date
**Quota impact:** 1 per fee record per trigger point

```
💳 Fee Reminder — {{1}}

Hi {{2}},

{{3}}'s {{4}} for {{5}} is overdue.

Outstanding: {{6}}
Due date was: {{7}}

Pay online or submit proof:
zsms.co.zm/portal/fees

If already paid, please ignore this message.
```

**Variable mapping:**
```typescript
variables: [
  schoolName,            // {{1}}
  parentFirstName,       // {{2}}
  studentFirstName,      // {{3}}
  feeLabel,              // {{4}}
  termLabel,             // {{5}}
  formattedAmountDue,    // {{6}} "K2,500.00"
  formattedDueDate,      // {{7}} "1 September 2026"
]
```

---

### `fee_overdue_final`

**Category:** Utility
**Trigger:** Daily cron — 30 days past due_date
**Quota impact:** 1 per fee record

```
⚠️ Important — Outstanding Fees · {{1}}

{{2}}'s fees are 30 days overdue.

Outstanding: {{3}} ({{4}}, {{5}})

Please contact the school immediately to arrange payment or discuss a payment plan.

📞 Contact: zsms.co.zm/schools/{{6}}
💳 Pay: zsms.co.zm/portal/fees
```

**Variable mapping:**
```typescript
variables: [
  schoolName,          // {{1}}
  studentFirstName,    // {{2}}
  formattedAmountDue,  // {{3}}
  feeLabel,            // {{4}}
  termLabel,           // {{5}}
  schoolId,            // {{6}} "ZM-LSK-0001"
]
```

---

### `monthly_attendance_summary`

**Category:** Utility
**Trigger:** Monthly cron — last day of each month
**Quota impact:** 1 per student

```
📅 {{1}} Attendance — {{2}}

{{3}} ({{4}}):

This month: Present {{5}} of {{6}} days ({{7}}%)
Absent: {{8}} · Late: {{9}}

This term: Present {{10}} of {{11}} days ({{12}}%)

View full history:
zsms.co.zm/portal/attendance
```

**Variable mapping:**
```typescript
variables: [
  monthName,              // {{1}} "September"
  schoolName,             // {{2}}
  studentFullName,        // {{3}}
  gradeDisplay,           // {{4}}
  monthPresent,           // {{5}} "18"
  monthTotal,             // {{6}} "20"
  monthPercentage,        // {{7}} "90"
  monthAbsent,            // {{8}} "2"
  monthLate,              // {{9}} "0"
  termPresent,            // {{10}} "40"
  termTotal,              // {{11}} "45"
  termPercentage,         // {{12}} "88"
]
```

---

### `absence_alert`

**Category:** Utility
**Trigger:** Attendance trigger (opt-in schools only)
**Quota impact:** 1 per absence

```
⚠️ Attendance Alert — {{1}}

{{2}} was marked absent today
{{3}} · {{4}}

If unexpected, please contact the school.

View attendance:
zsms.co.zm/portal/attendance
```

**Variable mapping:**
```typescript
variables: [
  schoolName,           // {{1}}
  studentFirstName,     // {{2}}
  formattedDate,        // {{3}} "Thursday, 15 September 2026"
  gradeDisplay,         // {{4}} "Grade 9A"
]
```

---

### `school_announcement`

**Category:** Marketing (for important school broadcasts)
**Trigger:** Admin manually sends an important announcement
**Quota impact:** 1 per recipient

```
📢 {{1}} — {{2}}

{{3}}

{{4}}
```

**Variable mapping:**
```typescript
variables: [
  schoolName,      // {{1}}
  title,           // {{2}} "Exam Timetable Update"
  body,            // {{3}} First 800 chars of announcement body
  portalLink,      // {{4}} "Read more: zsms.co.zm/portal/announcements"
]
```

**Note on body truncation:** WhatsApp template bodies have a 1,024 character limit. The announcement body is truncated to 800 characters with "..." and a portal link to read the full announcement.

---

### `loan_status_update`

**Category:** Utility
**Trigger:** Loan application status change (submitted, approved, declined, disbursed)
**Quota impact:** 1 per status change

```
🏦 Loan Update — {{1}}

{{2}}'s fee loan application:
Status: {{3}}
{{4}}

Reference: {{5}}

View details: zsms.co.zm/portal/loan
```

**Variable mapping:**
```typescript
variables: [
  schoolName,        // {{1}}
  studentFirstName,  // {{2}}
  statusDisplay,     // {{3}} "Approved" | "Declined" | "Disbursed" | "Under Review"
  statusNote,        // {{4}} Context-specific note:
                     //   Approved: "Funds will be disbursed within 2-3 business days"
                     //   Declined: "Please contact the school to discuss alternatives"
                     //   Disbursed: "K2,500 has been applied to the school fee account"
                     //   Under Review: "The lender is reviewing your application"
  lenderReference,   // {{5}} "MFI-LOAN-REF-001"
]
```

---

## Adding New Templates

When a new message type is needed that is not in the template registry:

```
1. Write the template body following WhatsApp guidelines:
   - 1,024 character limit for the body
   - Variables use {{N}} notation starting from {{1}}
   - No clickable phone numbers or email addresses in the body
   - No promotional language in Utility category templates

2. Submit to Meta via the Meta Business Manager:
   - Category: Utility (transactional) or Marketing (promotional)
   - Language: English (en)
   - Name: snake_case matching the template_id used in the codebase

3. Wait for Meta approval: typically 24-72 hours

4. After approval, add to this document:
   - Template name and ID
   - Variable mapping in TypeScript
   - Character limit check
   - Quota impact

5. Update the send-whatsapp Edge Function to handle the new template_id

6. For schools using their own WhatsApp number:
   - Provide the template specification to the school
   - School submits the same template to Meta under their account
   - Template must be approved before the school can use the message type
```

---

## Schools With Own WhatsApp Number — Template Requirements

Schools using their own WhatsApp Business number must register all required templates under their own Meta account. AfriTech provides:
- The exact template specification (name, body, variable count and meaning)
- A checklist of which templates are required vs optional
- Support during the Meta approval process

Required templates for a school using their own number:
```
required:
  - fee_payment_confirmed
  - fee_payment_rejected
  - fee_overdue_reminder
  - fee_overdue_final
  - monthly_attendance_summary
  - results_published

optional (based on features enabled):
  - absence_alert (if per-absence alerts enabled)
  - school_announcement (if important announcements needed)
  - loan_status_update (if loan module enabled)
```

Schools cannot use ZSMS WhatsApp templates under their own number — Meta's templates are tied to the WABA account that submitted them. The school must register equivalent templates under their own account.

---

## Business Rules

1. Variable order within each template is fixed. The `send-whatsapp` Edge Function must pass variables in exactly the order documented above. Wrong order results in garbled messages.
2. Template bodies must pass Meta's approval. Templates that reference competitors, make guarantees, or contain prohibited content will be rejected.
3. All template IDs in the codebase must match an approved Meta template name exactly (case-sensitive, underscores).
4. Marketing category templates (school_announcement, future alumni promotions) have stricter Meta review than Utility templates. Allow up to 5 business days for marketing template approval.
5. Schools using own WhatsApp numbers are responsible for their own template approvals. ZSMS does not submit templates on their behalf but provides specifications.
6. Template variables are truncated server-side before dispatch to prevent exceeding the 1,024-character body limit. Truncation rules: announcement body max 800 chars, rejection reasons max 200 chars, all other text fields max 100 chars.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 12 communication documentation |
| 2026-04-26 | Added school own-number template requirements | School-specific WhatsApp number support |
| 2026-04-26 | Added character limit checks per template | Prevents dispatch failures from oversized content |
| 2026-04-26 | Added loan_status_update template | Loan module communication |
