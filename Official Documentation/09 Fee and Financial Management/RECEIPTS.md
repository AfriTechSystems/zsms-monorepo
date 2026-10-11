# RECEIPTS.md — Receipt Generation and Management

## Related Documents

- `docs/modules/fees/PAYMENTS.md` — payment verification that triggers receipt generation
- `docs/modules/fees/FEE_STRUCTURES.md` — fee labels shown on receipts
- `docs/modules/fees/AUDIT.md` — receipt events in the audit trail
- `docs/modules/documents/TEMPLATE_SYSTEM.md` — receipt PDF template configuration
- `docs/modules/documents/STORAGE.md` — R2 storage paths for receipts
- `docs/infra/R2.md` — receipt PDF upload and signed URL generation
- `docs/infra/META_API.md` — WhatsApp delivery of receipt links
- `docs/DATABASE.md` — payments table receipt fields

---

## Implementation Status (2026-10-11)

**Built and verified end to end.** The number format below is exactly what the database
produces — checked against live rows on 2026-10-11 (`REC-ZM-LSK-9001-000078`).

Generation, storage and delivery all work as of the R2 configuration on 2026-10-10:
`npm run docs:smoke` proves the whole chain — the worker stores the file,
`generated_documents` records it, the route signs the recorded path, and the bytes served
are byte-identical to the ones stored.

**Worth knowing:** `generate-receipt` was enqueued from a route no screen had ever called,
so for a long time no receipt had been produced for anybody. Found by `npm run gaps`, which
is the check that exists for that class of failure.

---

## Purpose

This document defines receipt generation — when receipts are created, how receipt numbers are sequenced, what receipts contain, how they are stored and accessed, and how parents receive them. Every Claude Code session building any receipt-related feature must read this document.

---

## Overview

A receipt is generated when a payment is verified — not when it is submitted. This distinction is important: the parent's submission acknowledgement reference (`PAY-ZM-LSK-0001-XXXXXX`) confirms the school received their submission. The formal receipt (`REC-ZM-LSK-0001-000001`) confirms the school has accepted and verified the payment. The receipt is the school's official financial document.

Receipts are PDF files generated using `@react-pdf/renderer` in a Supabase Edge Function, stored in Cloudflare R2, and delivered to parents via a signed URL in WhatsApp messages and the parent portal.

---

## Receipt Number Format

```
REC-ZM-LSK-0001-000001
│   │   │   │    │
│   │   │   │    └── 6-digit zero-padded sequential number (per school)
│   │   │   └─────── School sequence number
│   │   └─────────── City code
│   └─────────────── Country code
└─────────────────── Fixed prefix
```

**Examples:**
- `REC-ZM-LSK-0001-000001` — first receipt at this school
- `REC-ZM-LSK-0001-001523` — 1,523rd receipt
- `REC-ZM-CBE-0003-000042` — 42nd receipt at a Copperbelt school

Receipt numbers are sequential per school and generated atomically to prevent duplicates under concurrent payment verification.

```sql
CREATE OR REPLACE FUNCTION get_next_receipt_sequence(p_school_id UUID)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_next INT;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SPLIT_PART(receipt_number, '-', 5) AS INT)
  ), 0) + 1
  INTO v_next
  FROM public.payments
  WHERE school_id = p_school_id
    AND receipt_number IS NOT NULL;
  RETURN v_next;
END;
$$;
```

The receipt number is generated and written to `payments.receipt_number` as the first step of receipt generation. If PDF generation fails after the number is assigned, the number is not reused — the next successful receipt gets the next number in sequence. Gaps in receipt numbers are acceptable and expected.

---

## When Receipts Are Generated

| Payment Path | Receipt Generated When |
|---|---|
| Parent-submitted → accountant verifies | Immediately on accountant clicking "Verify" |
| Online gateway (webhook confirmed) | Immediately on webhook processing |
| Accountant-recorded cash/bank | Immediately on accountant saving the payment |
| Fee waiver | Immediately on waiver being applied |

Receipt generation is synchronous for accountant-recorded and waiver payments (fast — single student, single fee line). For gateway webhooks processing many simultaneous payments, receipts are generated as part of the webhook Edge Function — still fast because it is one receipt per webhook call.

---

## Receipt PDF Contents

The receipt PDF uses the school's configured `payment_receipt` document template. At minimum, every receipt contains:

### Header Section
- School logo (if uploaded)
- School name (full display name)
- School address and contact details
- "OFFICIAL RECEIPT" title
- Receipt number: `REC-ZM-LSK-0001-000001`
- Receipt date: the verified date
- Academic year and term

### Student and Payment Details
- Student full name
- Student ID
- Grade and class
- Fee description (fee_label from fee_records)
- Amount paid (in ZMW with K symbol)
- Payment method (Mobile Money / Bank Transfer / Cash / Gateway name)
- Transaction reference (if provided)
- Payment date (the date the payment was actually made, not the verification date)

### Balance Summary
- Amount due for this fee line
- Discount applied (if any, with reason)
- Amount paid this receipt
- Previous payments against this fee (if partial payments exist)
- Remaining balance

### Footer Section
- "This receipt is issued by [School Name]"
- Accountant name and signature line
- Official school stamp area (placeholder box)
- "Powered by ZSMS · AfriTech Systems Limited"

### Waiver Receipt

When a fee is waived, the receipt shows:
- Amount due: K2,500.00
- Scholarship / Waiver: -K2,500.00 (with reason)
- Amount payable: K0.00
- Status: WAIVED
- Authorised by: [Accountant/Admin Name]

---

## Receipt PDF Generation

Receipt generation runs in the `generate-receipt` Edge Function called from the payment verification flow:

```typescript
// Called after payment status set to 'verified'
async function generateReceipt(paymentId: string): Promise<string> {
  // 1. Fetch payment, fee_record, student, school, template config
  const [payment, feeRecord, student, school, template] = await Promise.all([
    getPayment(paymentId),
    getFeeRecord(payment.fee_record_id),
    getStudent(feeRecord.student_id),
    getSchool(feeRecord.school_id),
    getDocumentTemplate(feeRecord.school_id, 'payment_receipt'),
  ])

  // 2. Generate receipt number
  const receiptNumber = await generateReceiptNumber(school.id)

  // 3. Fetch school logo signed URL from R2
  const logoUrl = school.logo_url
    ? await getSignedUrl(R2_PUBLIC_BUCKET, school.logo_url, 3600)
    : null

  // 4. Render PDF using @react-pdf/renderer
  const pdfBuffer = await renderReceiptPdf({
    school, student, payment, feeRecord,
    receiptNumber, logoUrl, template,
  })

  // 5. Upload PDF to R2
  const r2Key = `${school.school_id}/receipts/${payment.academic_year}/term${payment.term_number}/${receiptNumber}.pdf`
  await uploadToR2(R2_PUBLIC_BUCKET, r2Key, pdfBuffer)

  // 6. Update payments row
  await supabaseAdmin
    .from('payments')
    .update({
      receipt_number: receiptNumber,
      receipt_url: r2Key,
    })
    .eq('id', paymentId)

  return r2Key
}
```

---

## Receipt Delivery to Parents

After receipt generation, parents are notified through two channels:

### WhatsApp Notification (within school's monthly quota)

```
Payment confirmed ✓
School: Sunrise Academy
Student: Chanda Bwalya (Grade 9A)
Fee: Tuition Fee — Term 2 2026
Amount: K2,500.00
Receipt: REC-ZM-LSK-0001-000042

Download receipt: [signed link — valid 7 days]

View all fees: zsms.co.zm/portal/fees
```

### In-App Notification (always — no quota required)

The parent's portal fee page updates immediately when the payment is verified. The receipt appears as a downloadable item in the payment history:

```
Payment History — Chanda Bwalya

✅ K2,500.00 · Verified · 15 Sep 2026
   Tuition Fee — Term 2 2026
   Method: Airtel Money · Ref: TXN20260915001234
   Receipt: REC-ZM-LSK-0001-000042  [Download ↓]
```

---

## Receipt Access

### Parent Access

Parents access receipts from:
1. The payment history in their portal — download button on each verified payment
2. The WhatsApp link (7-day signed URL)
3. The email notification (if email registered)

Signed URLs for parent receipt access: 7-day expiry. Parents who need the receipt after 7 days can generate a new link from the portal (the PDF is permanently stored in R2 — only the signed URL expires).

### Accountant Access

Accountants can view and print receipts from the fee dashboard. Receipt PDF opens in browser or downloads. No signed URL needed for dashboard access — the R2 key is fetched server-side and a fresh signed URL generated per request.

### Bulk Receipt Download

At end of term, the accountant can download all receipts for the term as a ZIP archive. This is a queued batch job that compiles all receipt PDFs for the selected term into a single download. Used for filing and audit purposes.

---

## Receipt Printing

For schools that need physical receipts (parents who prefer paper), the accountant can print receipts directly from the dashboard. The PDF is formatted for A4 paper and includes a perforation line suggestion at the bottom for tear-off stubs (optional — configurable in the receipt template).

Some schools issue duplicate receipts — one copy for the parent, one retained by the school. The PDF can be configured to print two copies per page (school copy + parent copy) from the template settings.

---

## Business Rules

1. Receipts are generated only for verified payments. Pending, queried, and rejected payments do not have receipts.
2. Receipt numbers are sequential and permanent. Gaps are acceptable (from voided payments or generation failures). Numbers are never reused.
3. Receipt PDFs are stored permanently in R2. The signed URL expires but the file does not. Parents can always generate a new signed URL from the portal.
4. A receipt is generated for fee waivers — it documents the waiver formally with the reason and the authorising staff member.
5. Reversal payments do not generate receipts — they generate a credit note (different document type) referencing the original receipt number.
6. The receipt PDF uses the school's configured `payment_receipt` document template. Schools without a configured template use the ZSMS default template.
7. Receipt delivery via WhatsApp counts against the school's monthly message quota. In-app notification is always free regardless of quota.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 9 fee module documentation |
| 2026-04-26 | Receipt generated on verification not submission | Confirmed — submission has acknowledgement reference, receipt comes on verify |
| 2026-04-26 | Added waiver receipt | Fee waivers and scholarships need formal documentation |
| 2026-04-26 | Added bulk receipt download for end-of-term filing | Accountant workflow requirement |
