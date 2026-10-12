# TEMPLATE_SYSTEM.md — Document Template Configuration System

## Related Documents

- `docs/modules/documents/PDF_GENERATION.md` — rendering engine that reads template config
- `docs/modules/documents/CUSTOMISATION.md` — school-facing guide to template setup
- `docs/modules/documents/STORAGE.md` — custom template file storage in R2
- `docs/modules/school/SUBSCRIPTION.md` — tier determines template level access
- `docs/DATABASE.md` — document_templates table

---

## Implementation Status (2026-10-11)

**`document_templates` is built as specified (`0258`)** — it had never been created, so a
layout variant, the content switches, the principal's comment and the acknowledgement
section were all unrepresentable.

JSONB for `template_config` follows the shape below, and is right here for a reason worth
stating since it would be wrong on a financial table: the switches differ per document
type and will grow — a report card has a principal's comment and an acknowledgement slip,
a receipt has neither — so modelling them as columns means a migration every time a
document gains an option. **Nothing in this config is ever summed, compared or joined on.**

**The principal's comment is keyed `"YEAR-TERM"`, which this document is specific about
and which matters more than it looks.** A single field would mean last term's words
silently printing on this term's cards. `set_principal_comment()` is also separate from
`set_document_template()`: the switches are set once a year and the comment every term, so
making the head resend the whole config to add a paragraph is how a switch gets clobbered.

**A bug found by this migration's own assertion, worth recording.** The first version
merged the comment with `jsonb_set(config, ARRAY['principal_comments', key], …, TRUE)`.
`create_missing` creates only the **last** element of a path, so while
`principal_comments` did not yet exist the call returned the target unchanged and **every
comment write silently did nothing** — a head would have typed a paragraph, seen no error,
and found the cards blank. It now merges with `||` at each level.

**Not built:** the template preview system. A school sees its changes on the next card it
generates. Worth building, and it needs a sample-data path rather than a real pupil.

---

## Purpose

This document is the technical reference for the document template configuration system — how template settings are stored, loaded at generation time, and applied to each PDF component. Every Claude Code session building template configuration UI or reading template config in a PDF renderer must read this document.

---

## Overview

The template system gives schools control over how their documents look without requiring design skills. Configuration is stored once in the database. Every subsequent PDF generation reads that configuration and applies it automatically — the principal never touches template settings during term-end generation.

---

## Database Schema

```sql
CREATE TABLE public.document_templates (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID NOT NULL REFERENCES public.schools(id),
  doc_type        TEXT NOT NULL
                  CHECK (doc_type IN (
                    'report_card',
                    'payment_receipt',
                    'fee_statement',
                    'transfer_letter',
                    'attendance_certificate',
                    'loan_confirmation'
                  )),

  template_level  TEXT NOT NULL DEFAULT 'branding'
                  CHECK (template_level IN ('branding', 'layout_variant', 'custom')),

  layout_variant  TEXT
                  CHECK (layout_variant IN ('classic', 'modern', 'compact', 'formal')),
  -- NULL when template_level = 'branding' or 'custom'

  custom_template_r2_key TEXT,
  -- R2 path to compiled custom template — NULL unless template_level = 'custom'

  template_config JSONB NOT NULL DEFAULT '{}',
  -- All customisation values — see structure below

  is_active       BOOLEAN DEFAULT TRUE,
  approved_by     TEXT,
  -- AfriTech staff Clerk ID — required for custom templates, NULL for others
  approved_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(school_id, doc_type)
  -- One active template per school per document type
);

CREATE INDEX idx_doc_templates_school ON public.document_templates(school_id, doc_type);
```

---

## Template Config JSONB Structure

The `template_config` JSONB column stores all customisation values. Structure varies slightly by `doc_type` but shares a common base:

### Common Fields (All Document Types)

```typescript
interface BaseTemplateConfig {
  // Branding
  primaryColor: string          // Hex: '#1A3C5E' — applied to headers, borders, dividers
  secondaryColor: string        // Hex: '#F5F5F5' — background shading
  logoPosition: 'left' | 'center' | 'right'
  showLogo: boolean

  // School identity
  showSchoolMotto: boolean
  showMinistryRegNumber: boolean  // Ministry of Education registration number
  schoolMotto?: string           // Cached from school profile at template save time

  // Footer
  footerText?: string            // Optional custom footer line
  showPoweredByZsms: boolean    // Default true — can be disabled for Enterprise
}
```

### Report Card Additional Config

```typescript
interface ReportCardTemplateConfig extends BaseTemplateConfig {
  // Student info section
  showDateOfBirth: boolean
  showExaminationNumber: boolean  // Auto-shown for exam classes when set
  showStudentPhoto: boolean

  // Results table
  showPercentage: boolean
  showMaxMarks: boolean
  showTeacherComments: boolean
  showAttendanceSummary: boolean
  showCreditCount: boolean      // Auto-shown for ECZ O-Level only

  // Position display
  positionFormat: 'Position X of Y' | 'Xth of Y' | 'X/Y'

  // Principal comment
  principalComment?: string     // Single comment for all students in this term
  principalName: string         // From staff_members — cached at template save

  // Parent acknowledgement
  showParentAcknowledgement: boolean
  tearOffFormat: boolean        // Perforation line between report and acknowledgement
  acknowledgeReturnDeadline?: string   // e.g. "20 September 2026"
}
```

### Payment Receipt Additional Config

```typescript
interface PaymentReceiptTemplateConfig extends BaseTemplateConfig {
  receiptSize: 'A4' | 'A5_landscape'
  showAccountantName: boolean
  showDuplicateCopy: boolean    // Print two copies per page (school + parent)
  showSchoolBankDetails: boolean
  bankDetails?: string          // School's bank account info for the footer
}
```

### Fee Statement Additional Config

```typescript
interface FeeStatementTemplateConfig extends BaseTemplateConfig {
  showRunningBalance: boolean   // Show balance column after each transaction
  showPaymentMethod: boolean
  statementTitle: string        // Default: "Fee Statement" — schools can customise
}
```

### Attendance Certificate Additional Config

```typescript
interface AttendanceCertificateTemplateConfig extends BaseTemplateConfig {
  certificateTitle: string      // Default: "Attendance Certificate"
  showPurposeLine: boolean      // "Issued for: University Application"
  showPrincipalSignatureLine: boolean
  showSchoolStampBox: boolean
  formalDeclaration: string
  // Default: "This is to certify that the above-named student attended {schoolName}
  //   and maintained the attendance record as stated herein."
}
```

---

## Template Levels in Detail

### Level 1 — Branding Only

The school sets their logo and primary colour. All structural layout decisions use ZSMS defaults.

**What the PDF component reads:**
```typescript
// In SchoolHeader sub-component
const headerStyle = StyleSheet.create({
  header: {
    borderBottomWidth: 2,
    borderBottomColor: template.primaryColor,  // School's colour
    paddingBottom: 8,
  }
})

// Logo
{template.showLogo && logoDataUrl && (
  <Image src={logoDataUrl} style={styles.logo} />
)}
```

**Available to:** All tiers.

### Level 2 — Layout Variant

The school selects from four professionally designed layouts. Each variant is a different React component structure — not just CSS changes.

```typescript
// In the PDF generation Edge Function
function selectReportCardComponent(variant: string) {
  switch (variant) {
    case 'modern':   return ReportCardModern
    case 'compact':  return ReportCardCompact
    case 'formal':   return ReportCardFormal
    default:         return ReportCardClassic  // 'classic' is the default
  }
}

const Component = selectReportCardComponent(template.layout_variant)
const pdfBuffer = await renderToBuffer(<Component {...props} />)
```

**Variant descriptions:**
- `classic` — Traditional layout. Serif-style fonts. Formal borders around each section. Suitable for ECZ-style schools.
- `modern` — Clean sans-serif. Colour accent bars rather than full borders. Suitable for Cambridge-style schools.
- `compact` — Denser line spacing, smaller fonts. Fits more information per page — useful for schools with 10+ subjects.
- `formal` — Minimalist. Black and white. Thin borders. Suitable for government-affiliated schools or those needing a conservative presentation.

**Available to:** Growth tier and above. Starter tier schools see a lock icon on variants with an upgrade prompt.

### Level 3 — Custom Template

The school or AfriTech designs a bespoke layout. The custom template is stored as a compiled React component in R2.

**Process:**
```
1. School contacts AfriTech to request custom template
2. AfriTech designs the template or accepts the school's design (HTML/CSS specification)
3. AfriTech converts to @react-pdf/renderer compatible React component
4. Component is compiled and uploaded to R2:
   zsms-private-zm/templates/{school_id}/report_card_custom.js
5. AfriTech sets document_templates.custom_template_r2_key and approved_by in the database
6. PDF Edge Function loads the custom component from R2 at generation time
7. Component is validated before execution — must export a valid React component
```

**Security requirement:** Custom templates run inside the Edge Function. AfriTech reviews every custom template for malicious code before setting `approved_by`. No school can activate a custom template without AfriTech approval.

**Available to:** Professional and Enterprise tiers.

---

## Loading Template Config at Generation Time

The PDF generation Edge Function loads the template config as the first step:

```typescript
async function loadTemplateConfig(
  schoolId: string,
  docType: string
): Promise<DocumentTemplateConfig> {
  const { data: template } = await supabaseAdmin
    .from('document_templates')
    .select('*')
    .eq('school_id', schoolId)
    .eq('doc_type', docType)
    .eq('is_active', true)
    .single()

  if (!template) {
    // No template configured — return system defaults
    return getDefaultTemplateConfig(docType)
  }

  return {
    level: template.template_level,
    variant: template.layout_variant,
    customTemplateKey: template.custom_template_r2_key,
    ...template.template_config,
  }
}
```

**Default template config** is returned when a school has not yet configured a template. The default uses:
- `primaryColor: '#1A3C5E'` (deep blue)
- `secondaryColor: '#F9FAFB'`
- `layout_variant: 'classic'`
- All `show*` toggles: true
- `showPoweredByZsms: true`

---

## Template Preview System

The preview endpoint generates a PDF using real school data (logo, colours, template config) but fictional student data:

```typescript
// Synthetic student for preview — realistic but fictional
const PREVIEW_STUDENT: StudentData = {
  first_name: 'Tafadzwa',
  last_name: 'Mwale',
  student_id: 'STU-ZM-LSK-0001-00001',
  grade_display: 'Grade 9A',
  class_teacher: 'Mr. Banda',
  examination_number: '2024/001234',
}

const PREVIEW_RESULTS: ExamResult[] = [
  { subject_name: 'Mathematics',    marks_obtained: 82, marks_total: 100, grade_letter: 'A', grade_points: 1 },
  { subject_name: 'English Language', marks_obtained: 74, marks_total: 100, grade_letter: 'B', grade_points: 2 },
  { subject_name: 'Biology',        marks_obtained: 61, marks_total: 100, grade_letter: 'C', grade_points: 3 },
  { subject_name: 'Chemistry',      marks_obtained: 55, marks_total: 100, grade_letter: 'C', grade_points: 3 },
  { subject_name: 'Physics',        marks_obtained: 48, marks_total: 100, grade_letter: 'D', grade_points: 4 },
  { subject_name: 'Geography',      marks_obtained: 79, marks_total: 100, grade_letter: 'B', grade_points: 2 },
]
```

The preview uses realistic names, realistic marks, and realistic positions so the school can see exactly how their report cards will look with actual content — not lorem ipsum.

---

## Term-Specific Principal Comment

The principal's comment in the template config is replaced each term. When the principal enters a new comment for Term 3:

```typescript
// PATCH /api/templates/report-card/comment
await supabaseAdmin
  .from('document_templates')
  .update({
    template_config: supabase.rpc('jsonb_set_path', {
      document: 'template_config',
      path: '{principalComment}',
      value: newComment,
    }),
    updated_at: new Date().toISOString(),
  })
  .eq('school_id', schoolId)
  .eq('doc_type', 'report_card')
```

The previous term's comment is overwritten. Historical report cards retain the comment that was set at the time of generation (it is baked into the PDF, not a reference to the current config).

---

## Business Rules

1. Each school has at most one active template per document type. The `UNIQUE(school_id, doc_type)` constraint enforces this.
2. Custom templates require `approved_by` to be set by an AfriTech staff member. The PDF Edge Function checks this before executing a custom component.
3. Template config is loaded fresh at generation time — not cached in the Edge Function. Changes to template config take effect immediately for the next generation.
4. The default template config is always returned if no template is configured. Generation never fails due to missing template — it falls back to defaults.
5. Level 2 (layout variants) is enforced at the API layer — Starter tier schools cannot save a `layout_variant` value other than `null`.
6. The principal's comment in the template config is term-specific. The principal must update it each term before generation.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 13 documents module documentation |
| 2026-04-26 | Added attendance_certificate and fee_statement doc_types | Both confirmed as generated document types |
| 2026-04-26 | Added custom template security requirement | Custom components run in Edge Function — security review mandatory |
| 2026-04-26 | Added principal comment term-specific update | Principals need to update comment each term |
