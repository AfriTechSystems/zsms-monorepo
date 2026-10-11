# PDF_GENERATION.md — PDF Rendering Engine

## Related Documents

- `docs/modules/documents/TEMPLATE_SYSTEM.md` — template config loaded before rendering
- `docs/modules/documents/STORAGE.md` — R2 upload after rendering
- `docs/modules/documents/CUSTOMISATION.md` — school-facing configuration
- `docs/modules/results/BULK_GENERATION.md` — bulk report card generation using this engine
- `docs/modules/fees/RECEIPTS.md` — receipt generation using this engine
- `docs/api/EDGE_FUNCTIONS.md` — generate-report-card and generate-receipt functions
- `docs/infra/R2.md` — upload destination for all generated PDFs

---

## Implementation Status (2026-10-11)

**Built and proven end to end.** `npm run docs:smoke` runs the whole chain against the
real service: the worker stores a file, `generated_documents` records it, the route signs
the recorded path, and the bytes served are **byte-identical** to the ones stored.

`packages/documents` renders report cards, receipts, transfer letters and teaching
resources from one content model, synchronously in the worker.

**Individual failure isolation works as this document specifies**: a pupil with no
published marks is skipped rather than given an empty card, a render failure is recorded
against that pupil and the batch continues, and the result reports `generated`, `failed`
and `skippedNoMarks` separately. An empty report card would put a document in a parent's
hands implying their child sat nothing.

**As of `0258` the renderer honours the school's configuration** — position, class
average, attendance, comments and the acknowledgement slip. Every switch defaults to
**shown** when absent, because absent means "this school has never opened that screen",
and defaulting to hidden would have silently stripped information from every report card
in the system on deploy.

**Not built:** visual regression testing. The approach this document describes needs a
rendered-image baseline, and there is no harness for it.

---

## Purpose

This document is the technical reference for the PDF rendering engine — how `@react-pdf/renderer` is configured in the Deno Edge Function environment, how each document type is structured as a React component, how fonts and images are loaded efficiently across batch jobs, and how failures are isolated. Every Claude Code session building any PDF generation feature must read this document before writing any rendering code.

---

## Overview

ZSMS generates six types of PDF documents: report cards, payment receipts, fee statements, transfer letters, loan confirmation letters, and attendance certificates. All are rendered using `@react-pdf/renderer` inside Supabase Edge Functions. The rendered PDF buffer is uploaded directly to Cloudflare R2 without touching disk storage.

The rendering pipeline is: **fetch data → load assets → render React PDF component → upload buffer to R2 → return R2 key**.

---

## Environment Setup

### Deno-Compatible Import

```typescript
// supabase/functions/_shared/pdf.ts
import { renderToBuffer, Document, Page, Text, View, Image, StyleSheet, Font }
  from 'https://esm.sh/@react-pdf/renderer@3.1.12?target=deno'
```

The `?target=deno` parameter ensures esm.sh serves a Deno-compatible ESM build. Always pin the version — breaking changes in `@react-pdf/renderer` can silently corrupt output layouts.

### Font Loading

Custom fonts are stored in R2 and loaded once per Edge Function invocation — not per PDF in a batch:

```typescript
// Load at the top of the Edge Function — before the batch loop
async function loadFonts(): Promise<void> {
  const [regularBuffer, boldBuffer] = await Promise.all([
    fetchFromR2('zsms-public-zm', 'fonts/inter/Inter-Regular.ttf'),
    fetchFromR2('zsms-public-zm', 'fonts/inter/Inter-Bold.ttf'),
  ])

  Font.register({
    family: 'Inter',
    fonts: [
      { src: arrayBufferToBase64(regularBuffer), fontWeight: 'normal' },
      { src: arrayBufferToBase64(boldBuffer), fontWeight: 'bold' },
    ],
  })
}

// Call once — subsequent PDFs in the same batch reuse the registered font
await loadFonts()
```

**Why load from R2 not a URL:** `@react-pdf/renderer` cannot fetch external HTTPS URLs at render time in the Edge Function environment. All assets must be embedded as base64 data URLs or ArrayBuffers before the `renderToBuffer()` call.

### Logo Loading

The school logo is loaded once per batch and reused:

```typescript
async function loadLogoAsDataUrl(logoR2Key: string | null): Promise<string | null> {
  if (!logoR2Key) return null

  const buffer = await fetchFromR2('zsms-public-zm', logoR2Key)
  const base64 = arrayBufferToBase64(buffer)
  const mimeType = detectMimeType(logoR2Key)  // 'image/png' or 'image/jpeg'

  return `data:${mimeType};base64,${base64}`
  // Result: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
}

// Load once before the batch loop
const logoDataUrl = await loadLogoAsDataUrl(school.logo_url)
```

The `logoDataUrl` string is passed as a prop to every PDF component in the batch. Loading it once saves 35 R2 fetches per batch.

---

## Document Type Components

Each document type is a self-contained React component that receives typed props and returns a `@react-pdf/renderer` `<Document>` element.

### Component Interface Pattern

```typescript
// Every PDF component follows this interface pattern
interface ReportCardProps {
  school: SchoolData
  student: StudentData
  results: ExamResult[]
  attendance: AttendanceSummary
  classPosition: { position: number; classSize: number }
  gradingScale: GradeBand[]
  template: DocumentTemplateConfig
  logoDataUrl: string | null
  academicYear: string
  termNumber: number
}

// Usage in Edge Function
const pdfBuffer = await renderToBuffer(
  <ReportCardDocument {...props} />
)
```

---

### 1. Report Card Component

```typescript
// supabase/functions/_shared/pdf-components/ReportCardDocument.tsx

const ReportCardDocument = (props: ReportCardProps) => (
  <Document>
    <Page size="A4" style={styles.page}>
      <SchoolHeader school={props.school} logoDataUrl={props.logoDataUrl} template={props.template} />
      <StudentInfoSection student={props.student} academicYear={props.academicYear} termNumber={props.termNumber} />
      <ResultsTable results={props.results} gradingScale={props.gradingScale} classPosition={props.classPosition} template={props.template} />
      <AttendanceSummarySection attendance={props.attendance} />
      <PrincipalCommentSection comment={props.template.principalComment} schoolName={props.school.name} />
      <ParentAcknowledgementSection template={props.template} />
    </Page>
  </Document>
)
```

Sub-components are in separate files under `_shared/pdf-components/`. Each sub-component is pure — no async operations, no side effects.

---

### 2. Payment Receipt Component

```typescript
interface PaymentReceiptProps {
  school: SchoolData
  student: StudentData
  payment: PaymentData
  feeRecord: FeeRecord
  receiptNumber: string
  logoDataUrl: string | null
  template: DocumentTemplateConfig
}
```

Receipt is A5 landscape or A4 portrait depending on the template's `receipt_size` config. A5 landscape is more suitable for filing by accountants.

---

### 3. Fee Statement Component

```typescript
interface FeeStatementProps {
  school: SchoolData
  student: StudentData
  feeRecords: FeeRecord[]         // All fee lines for the selected period
  payments: PaymentData[]          // All verified payments for the period
  logoDataUrl: string | null
  periodLabel: string              // "Term 2, 2026" or "Academic Year 2026"
  generatedAt: string
  generatedBy: string              // Staff member who requested the statement
}
```

The fee statement shows a running balance — each row is either a fee charged (debit) or a payment made (credit) with the running outstanding balance.

**Source: `public.fee_statement()`** (ADR-038). The generator must not recompute the balance itself — the function already returns `running_balance` per row, deterministically ordered by due date. The first row is a **Balance brought forward** entry whenever the selected period has prior activity, which is what makes the statement read like a bursar's ledger even though arrears are derived rather than stored.

---

### 4. Transfer Letter Component

```typescript
interface TransferLetterProps {
  school: SchoolData
  student: StudentData
  transferDate: string
  transferReference: string
  destinationSchoolName: string | null
  reason: string
  logoDataUrl: string | null
  principalName: string
}
```

Formal A4 letter format. Includes the school's Ministry of Education registration number if configured.

---

### 5. Loan Confirmation Letter Component

```typescript
interface LoanConfirmationProps {
  school: SchoolData
  student: StudentData
  parent: ParentData
  application: LoanApplication
  lenderName: string
  logoDataUrl: string | null
}
```

Generated when a loan application is submitted to a lender. Contains the student's fee obligation and the school's confirmation that the stated fees are accurate.

---

### 6. Attendance Certificate Component

```typescript
interface AttendanceCertificateProps {
  school: SchoolData
  student: StudentData
  attendanceSummary: {
    dateFrom: string
    dateTo: string
    totalDays: number
    presentDays: number
    absentDays: number
    lateDays: number
    attendancePercentage: number
  }
  purpose: string | null          // Optional: "For university application", "For scholarship"
  logoDataUrl: string | null
  principalName: string
  issuedAt: string
  certificateId: string           // CERT-ZM-LSK-0001-000001
}
```

Formal certificate format. Contains a statement: "This is to certify that [Student Name], a student at [School Name], maintained an attendance record of [X]% during the period [date range]."

Generated on demand — not automatically. Available to principals, admins, the student (via student portal), and alumni (via alumni portal for their own historical records).

---

## Render to Buffer and Upload

```typescript
async function renderAndUpload(
  component: React.ReactElement,
  r2Key: string,
  bucket: 'zsms-public-zm' | 'zsms-private-zm'
): Promise<void> {
  // Render PDF to buffer
  const pdfBuffer = await renderToBuffer(component)

  // Upload directly to R2
  await uploadToR2(bucket, r2Key, pdfBuffer, {
    contentType: 'application/pdf',
    cacheControl: 'private, max-age=31536000',  // 1 year cache — files are immutable
  })
}
```

**Memory note:** A single PDF buffer is typically 50–300KB depending on content. A batch of 35 PDFs peaks at approximately 35 × 300KB = 10.5MB in memory simultaneously. The Edge Function memory limit is 512MB — comfortable headroom.

---

## Individual Failure Isolation

Within a batch loop, each student's PDF is wrapped in try-catch:

```typescript
const failedStudents: { studentId: string; error: string }[] = []

for (const studentId of studentIds) {
  try {
    // ... fetch data, render, upload
  } catch (error) {
    console.error(`PDF generation failed for ${studentId}:`, error.message)
    failedStudents.push({ studentId, error: error.message })
    // Continue to next student — do not re-throw
  }
}

// Report failures at the end of the batch
if (failedStudents.length > 0) {
  await supabaseAdmin.from('report_generation_jobs').update({
    error_message: JSON.stringify(failedStudents),
    status: failedStudents.length === studentIds.length ? 'failed' : 'partial',
  }).eq('run_id', runId)
}
```

Common individual failure causes:
- Student has a corrupted photo (renders blank photo, does not fail — caught by pre-render validation)
- Marks data missing for a subject (caught by pre-generation completeness check)
- Unusually long name overflows layout (caught by layout validation in preview)

---

## Visual Testing Approach

Before running bulk generation, the preview endpoint generates a single PDF with synthetic test data and streams it to the browser:

```typescript
// POST /api/templates/preview
// Returns the PDF as a stream — not stored in R2
const previewBuffer = await renderToBuffer(
  <ReportCardDocument
    school={realSchoolData}
    student={SYNTHETIC_STUDENT}  // "Tafadzwa Mwale", Grade 9A, realistic but fictional marks
    logoDataUrl={realLogoDataUrl}
    template={realTemplateConfig}
    // ... other synthetic props
  />
)

return new Response(previewBuffer, {
  headers: {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline; filename="preview.pdf"',
  },
})
```

The synthetic student data uses realistic Zambian names and typical mark distributions. The school owner views this in the browser before committing to bulk generation.

---

## Business Rules

1. Fonts and logos are loaded once per Edge Function invocation, before the batch loop. Never load them inside the per-student loop.
2. All assets (fonts, logos) must be base64-encoded before passing to `@react-pdf/renderer`. No external URL references in PDF components.
3. Individual student PDF failures are caught and logged — they never cause the batch to fail for other students.
4. The `@react-pdf/renderer` version is pinned in the import URL. Never use `@latest`.
5. PDF buffers are never written to disk (Edge Functions have no persistent filesystem). Render → upload to R2 in memory.
6. The preview endpoint streams the PDF without storing it in R2. Preview PDFs are never treated as official documents.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 13 documents module documentation |
| 2026-04-26 | Added attendance certificate component | Confirmed as sixth document type |
| 2026-04-26 | Added fee statement component | Confirmed as generated document type |
| 2026-04-26 | Deno-compatible esm.sh import pattern | Edge Function environment requirement |
