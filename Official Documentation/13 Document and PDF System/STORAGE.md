# STORAGE.md — Document Storage Reference

## Related Documents

- `docs/infra/R2.md` — R2 infrastructure configuration and bucket setup
- `docs/modules/documents/PDF_GENERATION.md` — PDFs generated and uploaded here
- `docs/modules/documents/TEMPLATE_SYSTEM.md` — custom templates stored here
- `docs/modules/fees/PAYMENTS.md` — payment proofs uploaded to private bucket
- `docs/modules/loans/APPLICATION.md` — payslips stored in private bucket
- `docs/modules/results/REPORT_CARDS.md` — report card access by role
- `docs/api/EDGE_FUNCTIONS.md` — generate-upload-url function
- `docs/ENV.md` — R2 environment variables

---

## Purpose

This document is the complete storage reference for every file ZSMS generates, receives, or stores — where it lives, how it is named, who can access it, how long signed URLs last, and what happens to files over time. Every Claude Code session building any feature that reads or writes files must read this document before choosing a storage path or URL expiry.

---

## Overview

ZSMS uses Cloudflare R2 as its object storage layer. Two buckets handle all file storage — one public-accessible (via signed URLs) for documents the school and parents need to download, and one private (no public access at all) for sensitive uploads like payment proofs and loan payslips.

No file is ever stored in the Supabase database. The database stores R2 object keys (path strings). The actual files live exclusively in R2.

---

## Two-Bucket Architecture

### `zsms-public-zm` — School Documents and Assets

Contains files that legitimate users need to download. All access is via signed URLs — the bucket is not publicly browsable even though files can be served publicly when a valid signed URL is generated. Signed URLs expire — the file remains in R2 permanently but access requires a fresh URL after expiry.

### `zsms-private-zm` — Sensitive Uploads

Contains files that must never be publicly accessible under any circumstances. No public access policy. Access is via signed URLs with very short expiry windows, generated only within Edge Functions using the service role key. The accountant's browser never receives the R2 credentials — only a time-limited signed URL.

---

## Complete File Path Reference

### Public Bucket — `zsms-public-zm`

```
School assets:
/{school_id}/logo/logo.{ext}
  Example: /ZM-LSK-0001/logo/logo.png
  Updated when: School uploads a new logo
  Signed URL expiry: 1 hour (regenerated on each dashboard load)

/{school_id}/branding/stamp.{ext}
  Example: /ZM-LSK-0001/branding/stamp.png
  Used for: Digital stamp on certificates (optional — few schools use this)

Custom document templates (Professional/Enterprise):
/{school_id}/templates/report_card_custom.js
  Access: Service role only — never exposed to browsers

Report cards:
/{school_id}/reports/{academic_year}/term{N}/{class_id}/{student_id}.pdf
  Example: /ZM-LSK-0001/reports/2026/term2/grade_9a/550e8400-uuid.pdf
  Generated when: Bulk generation run completes
  Signed URL expiry: 30 days
  Overwritten when: Report card is regenerated after a correction

Payment receipts:
/{school_id}/receipts/{academic_year}/term{N}/{payment_id}.pdf
  Example: /ZM-LSK-0001/receipts/2026/term2/a3f8-uuid.pdf
  Generated when: Payment is verified
  Signed URL expiry: 7 days (parent can regenerate from portal)

Fee statements:
/{school_id}/statements/{academic_year}/{student_id}/{period_label}.pdf
  Example: /ZM-LSK-0001/statements/2026/550e-uuid/term2.pdf
  Generated when: Admin or parent requests on demand
  Signed URL expiry: 7 days

Transfer letters:
/{school_id}/documents/transfers/{transfer_reference}.pdf
  Example: /ZM-LSK-0001/documents/transfers/TRF-ZM-LSK-0001-00042-2026.pdf
  Generated when: Admin initiates a student transfer
  Signed URL expiry: 30 days

Attendance certificates:
/{school_id}/documents/attendance-certs/{certificate_id}.pdf
  Example: /ZM-LSK-0001/documents/attendance-certs/CERT-ZM-LSK-0001-000001.pdf
  Generated when: Admin or student requests on demand
  Signed URL expiry: 30 days
  Alumni access: Yes — graduated students can request signed URLs for their own certificates

Student photos (if uploaded):
/{school_id}/students/{student_id}/photo.{ext}
  Example: /ZM-LSK-0001/students/550e-uuid/photo.jpg
  Signed URL expiry: 1 hour (short — photos are PII)

Font files (shared across all schools):
/fonts/inter/Inter-Regular.ttf
/fonts/inter/Inter-Bold.ttf
  Access: Service role only — loaded by Edge Functions at generation time
  Never exposed to browsers
```

### Private Bucket — `zsms-private-zm`

```
Payment proof uploads:
/{school_id}/payment-proofs/{payment_id}.{ext}
  Example: /ZM-LSK-0001/payment-proofs/a3f8-uuid.jpg
  Uploaded when: Parent submits a payment with proof
  Signed URL expiry: 1 hour (accountant verification only)
  Access: Accountant, admin, principal, AfriTech super admin

Loan payslips:
/{school_id}/loan-payslips/{application_id}.{ext}
  Example: /ZM-LSK-0001/loan-payslips/b4c9-uuid.pdf
  Uploaded when: Parent submits loan application
  Signed URL expiry: 15 minutes (extreme sensitivity)
  Access: AfriTech loan officer, AfriTech super admin only

Loan confirmation letters:
/{school_id}/loan-letters/{application_id}.pdf
  Example: /ZM-LSK-0001/loan-letters/b4c9-uuid.pdf
  Generated when: Loan application is submitted to lender
  Signed URL expiry: 1 hour
  Access: School principal, AfriTech loan officer
```

---

## Signed URL Generation

Signed URLs are generated by the `generate-upload-url` Edge Function (for uploads) and inline within API routes and other Edge Functions (for downloads). The bucket's credentials never leave the Edge Function environment.

### Download URL Generation

```typescript
// packages/utils/storage.ts
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const r2PublicClient = new S3Client({
  region: 'auto',
  endpoint: Deno.env.get('R2_PUBLIC_ENDPOINT'),
  credentials: {
    accessKeyId: Deno.env.get('R2_PUBLIC_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_PUBLIC_SECRET_ACCESS_KEY')!,
  },
})

const r2PrivateClient = new S3Client({
  region: 'auto',
  endpoint: Deno.env.get('R2_PRIVATE_ENDPOINT'),
  credentials: {
    accessKeyId: Deno.env.get('R2_PRIVATE_ACCESS_KEY_ID')!,
    secretAccessKey: Deno.env.get('R2_PRIVATE_SECRET_ACCESS_KEY')!,
  },
})

export async function generateDownloadUrl(
  bucket: 'public' | 'private',
  key: string,
  expirySeconds: number
): Promise<string> {
  const client = bucket === 'public' ? r2PublicClient : r2PrivateClient
  const bucketName = bucket === 'public'
    ? Deno.env.get('R2_PUBLIC_BUCKET_NAME')!
    : Deno.env.get('R2_PRIVATE_BUCKET_NAME')!

  const command = new GetObjectCommand({ Bucket: bucketName, Key: key })
  return getSignedUrl(client, command, { expiresIn: expirySeconds })
}
```

### Upload URL Generation (Client-Side Upload)

The browser never receives R2 credentials. Instead:

```
1. Browser → POST /api/storage/upload-url
   Body: { file_type: 'payment_proof', content_type: 'image/jpeg', file_size: 245000 }

2. Edge Function validates request, generates pre-signed PUT URL:
   → R2 key generated: /{school_id}/payment-proofs/{payment_id}.jpg
   → Signed PUT URL generated (5 minute expiry)
   → Returns: { upload_url, key, expires_at }

3. Browser uploads directly to R2 using the signed PUT URL:
   PUT {upload_url}
   Content-Type: image/jpeg
   [file bytes]

4. Browser → POST /api/fees/payments
   Body: { ..., proof_of_payment_url: key }
   (The key, not the signed URL — the key is permanent, the URL is not)
```

This pattern means R2 credentials never appear in the browser's network requests, developer tools, or logs.

---

## Signed URL Expiry Reference

| Document Type | Bucket | Expiry | Reasoning |
|---|---|---|---|
| Report card | Public | 30 days | Parents need time to download, share with family, file physically |
| Payment receipt | Public | 7 days | Can regenerate from portal — short enough to limit exposure |
| Fee statement | Public | 7 days | On-demand generation — regenerate when needed |
| Transfer letter | Public | 30 days | Parent needs to present to new school — may take time |
| Attendance certificate | Public | 30 days | Used for formal applications — process may take weeks |
| Student photo | Public | 1 hour | PII — short window, regenerated per page load |
| School logo | Public | 1 hour | Frequently displayed — cached in browser |
| Payment proof | Private | 1 hour | Accountant verification only |
| Loan payslip | Private | 15 minutes | Extreme sensitivity — minimum viable window |
| Loan confirmation letter | Private | 1 hour | Lender submission context |
| Custom template component | Public | N/A | Never exposed — service role access only |
| Font files | Public | N/A | Never exposed — service role access only |

---

## Alumni Access to Historical Documents

Graduated students and parents of graduated students retain permanent access to their historical documents. When an alumni user requests a document:

```typescript
// Alumni document access — verified against student's historical records
async function generateAlumniDocumentUrl(
  alumniUserId: string,
  documentKey: string
): Promise<string | null> {
  // Verify the alumni user has a historical link to this document
  const hasAccess = await verifyAlumniDocumentAccess(alumniUserId, documentKey)

  if (!hasAccess) return null

  // Generate a 30-day signed URL — alumni need time to download for applications
  return generateDownloadUrl('public', documentKey, 30 * 24 * 60 * 60)
}
```

Historical documents (report cards, attendance certificates, receipts) are never deleted from R2 as long as the school account exists. Alumni can request fresh signed URLs from their alumni portal at any time, even years after graduation.

---

## R2 Lifecycle Policy

### Infrequent Access Tier (After 3 Years)

Files older than 3 years are automatically moved to R2's Infrequent Access storage class. The access pattern is identical — signed URLs work the same way. Cost reduces by approximately 60%. Applied to:
- Report cards older than 3 years
- Receipts older than 3 years
- All other generated documents

### Data Retention by Category

| File Category | Retention Period | After Retention |
|---|---|---|
| Report cards | Indefinite | Never deleted while school account active |
| Payment receipts | Indefinite | Never deleted — financial record |
| Payment proofs | 7 years | Deleted after 7 years (financial compliance) |
| Loan payslips | 7 years | Deleted after 7 years (financial compliance) |
| Student photos | Active enrolment + 1 year | Deleted 1 year after student graduates/leaves |
| Transfer letters | Indefinite | Never deleted — official record |
| Attendance certificates | Indefinite | Never deleted — official record |
| Fee statements | Indefinite | Never deleted — financial record |
| School logos | While school active | Deleted on account termination |

---

## School Account Termination

When a school's account is terminated (status becomes `terminated` in the database):

```
Day 1:   Termination notice sent to school owner
          All write access revoked immediately
          All read access (including R2) remains for 30 days

Days 1-30: Data export window
          School owner can download all their data:
          - CSV exports of all database tables
          - ZIP of all report cards
          - ZIP of all receipts
          - ZIP of all certificates and letters

Day 30:  Final warning notification

Day 31:  All R2 files permanently deleted
          All database records soft-deleted
          Clerk organisation archived
          School no longer appears in any directory
```

**Alumni exception:** Graduated students who have alumni accounts retain access to their own historical documents even after school termination. Their personal report cards and certificates are copied to an AfriTech alumni storage path before school deletion:

```
Alumni document preservation path:
/alumni/{parent_or_student_clerk_id}/historical/{school_id}/{original_key}
```

This ensures a student who graduated in 2024 from a school that closed in 2026 can still access their Form 4 report card in 2028 when applying to university.

---

## Cross-Country Storage

Each country has its own two R2 buckets:

| Country | Public Bucket | Private Bucket |
|---|---|---|
| Zambia (ZM) | `zsms-public-zm` | `zsms-private-zm` |
| Botswana (BW, future) | `zsms-public-bw` | `zsms-private-bw` |
| Zimbabwe (ZW, future) | `zsms-public-zw` | `zsms-private-zw` |

The country bucket is determined by `NEXT_PUBLIC_COUNTRY_CODE` — the environment variable for each Vercel deployment. All files for Zambian schools go into the Zambia buckets. Files never cross country bucket boundaries.

For countries requiring strict data residency where R2's global network is a concern: Cloudflare R2 supports data location hints that keep data within specified regions. The `jurisdiction` parameter on the R2 bucket can be set to `eu` (European Union) or `fedramp` (US). For African data residency, R2 does not yet have an Africa-specific jurisdiction — this is a limitation to monitor as Cloudflare expands its regional offering. In the interim, Supabase's af-south-1 region for the database combined with R2's global network (with no storage in specified jurisdictions) is the current architecture.

---

## Business Rules

1. Every R2 object key stored in the database is the permanent key — not a signed URL. Signed URLs are generated on demand and expire. Keys are permanent.
2. The private bucket credentials are never used outside Edge Functions. No Next.js API route accesses the private bucket directly — only Edge Functions via the service role pattern.
3. Student photos are stored in the public bucket but with 1-hour signed URL expiry. They are PII and should not be long-lived in URLs shared via messaging apps.
4. Loan payslips use 15-minute signed URLs — the shortest expiry in the system. This reflects their extreme sensitivity. Accountants and loan officers open them immediately or request a fresh URL.
5. Alumni retain access to their historical documents permanently, even after school account termination. Their documents are preserved in the alumni storage path before school deletion.
6. Payment proofs and loan payslips are retained for 7 years to satisfy financial record-keeping requirements under Zambian law, then permanently deleted.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-10-05 | **R2 verified working, and the download chain joined** | The eight `R2_*` variables were present in `.env.local` but every one was commented out, so `envFor()` threw and nothing had ever been stored — the report-card counts had only ever been zero for that reason rather than any of their own. `npm run r2:smoke` now exercises both buckets for real: put, exists, get the same bytes, issue a signed URL, FETCH that URL and compare the body, delete, confirm gone. Fourteen checks. Separately verified that an unsigned fetch of a private object returns 400, because if the private bucket had a public development URL enabled the signed URL would be decoration. **New:** `GET /api/documents` lists the documents a caller is entitled to, filtered by payment, pupil, type, year or term, with the pupil name embedded through the existing foreign key. It deliberately signs nothing: a list of twenty receipts would mean nineteen signed URLs expiring unused, each one a live link to a child and an amount. `components/ui/document-download.tsx` is one button for all three consuming screens, and the state that matters is the one a naive version omits — a receipt is rendered by a worker AFTER verification, so "still being produced" keeps the button live rather than reporting a failure. `npm run docs:smoke` proves the chain end to end: store, record the row as the worker does, sign the RECORDED path rather than the local variable, follow it, compare bytes. |
| 2026-04-26 | Initial complete draft | Stage 13 documents module documentation |
| 2026-04-26 | Added attendance certificate storage path | Confirmed sixth document type |
| 2026-04-26 | Added alumni document preservation on school termination | Graduated account model — alumni need lifelong access |
| 2026-04-26 | Added cross-country bucket reference | Multi-country architecture |
| 2026-04-26 | Added 7-year retention for financial documents | Zambian financial compliance requirement |
