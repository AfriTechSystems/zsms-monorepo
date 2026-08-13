# REPORT_CARDS.md — Report Card Design and Configuration

## Related Documents

- `docs/modules/results/RESULTS.md` — marks that populate the report card
- `docs/modules/results/GRADING.md` — grade calculation shown on report card
- `docs/modules/results/BULK_GENERATION.md` — bulk PDF generation process
- `docs/modules/results/PUBLISHING.md` — when report cards become visible
- `docs/modules/documents/TEMPLATE_SYSTEM.md` — template customisation
- `docs/modules/documents/PDF_GENERATION.md` — PDF rendering engine
- `docs/modules/attendance/ATTENDANCE.md` — attendance summary on report card
- `docs/modules/students/STUDENTS.md` — examination_number on report card
- `docs/infra/R2.md` — report card storage and signed URLs

---

## Purpose

This document defines what a report card contains, how the template system controls its layout, how customisation works at each tier, and how report cards are accessed by different users. Every Claude Code session building report card generation or the template configuration UI must read this document.

---

## Overview

The report card is the most important document ZSMS generates. It is the formal academic record that parents keep, that students need for future school applications, and that reflects the school's brand and professionalism. Getting the report card right — both content and presentation — is critical to ZSMS adoption.

Report cards are generated as PDFs using `@react-pdf/renderer` in a Supabase Edge Function. Each school configures their template once. All subsequent generation uses the stored configuration without the teacher or principal doing any design work.

---

## Report Card Sections

Every ZSMS report card contains these sections regardless of template choice. The template controls visual presentation — not content.

### Section 1 — School Header

```
[SCHOOL LOGO]          SUNRISE ACADEMY
                       Private School — Lusaka, Zambia
                       Tel: +260977123456 · info@sunriseacademy.edu.zm
                       
                       ACADEMIC REPORT CARD
                       Term 2 · Academic Year 2026
```

- School logo (if uploaded — centred or left-aligned based on template)
- School full name
- School type and city
- School contact details (if configured)
- Report card title
- Term and academic year

### Section 2 — Student Information

```
Student Name:    Chanda Bwalya
Student ID:      STU-ZM-LSK-0001-00042
Grade / Form:    Grade 9A  (using school's terminology)
Class Teacher:   Mr. Banda
Date of Birth:   12 March 2011
Examination No.: 2024/001234  ← only shown for examination classes
```

- Student full name
- Student ID
- Grade and class using the school's configured display name
- Class teacher name (from staff_assignments where is_class_teacher = TRUE)
- Date of birth (optional — configurable in template settings)
- Examination number (only shown for Grade 6, Form 4, Form 6 — when `examination_number` is set)

### Section 3 — Academic Results Table

The core of the report card. Shows marks, grades, and teacher comments for each subject.

```
SUBJECT              MARKS    MAX    %       GRADE    COMMENT
English Language      72      100   72.0%    B        Good effort this term
Mathematics           88      100   88.0%    A        Excellent performance
Biology               61      100   61.0%    C        Improving steadily
Chemistry             54      100   54.0%    C        Needs more practice
Physics               45      100   45.0%    D        See me for extra help
Geography             78      100   78.0%    B        Strong analytical skills
─────────────────────────────────────────────────────────────────────
AGGREGATE                                    22 points
POSITION:  3 of 38                CREDITS: 4 of 6 subjects  ← ECZ only
```

**Columns shown:**
- Subject name (using the school's configured subject name)
- Marks obtained
- Maximum marks
- Percentage
- Grade letter
- Teacher comment (optional — blank if not entered)

**Aggregate row:** Shows total grade points with the direction appropriate to the school's grading system.

**Position:** Class position using standard competition ranking (3 of 38).

**Credits row:** Only shown for ECZ O-Level examination classes (Form 4 or Grade 10 in ECZ schools). Shows how many subjects the student achieved a credit (C or above) in.

### Section 4 — Attendance Summary

```
ATTENDANCE SUMMARY — Term 2 2026
School Days:   45    Present:   40 (88.9%)
Absent:         4    Late:       1
```

- Total school days for the term
- Days present and attendance percentage
- Days absent and days late

This data is pulled from `attendance_records` for this student for this term.

### Section 5 — Principal's Comment

```
PRINCIPAL'S COMMENT:
"Chanda has shown consistent effort this term. We encourage continued
focus on the sciences. Well done on your position in class."

──────────────────────          ──────────────────────
Mrs. A. Phiri                   [SCHOOL STAMP]
Principal                       Sunrise Academy
Date: 15 September 2026
```

- Principal's general comment (entered once per term — applies to all report cards, or the principal can write per-student comments)
- Principal's name and signature line
- Date
- School stamp area (placeholder box for physical stamp)

### Section 6 — Parent Acknowledgement

```
PARENT / GUARDIAN ACKNOWLEDGEMENT

I have received and read this report card.

Signature: _______________________  Date: _______________

Please return the signed acknowledgement slip to the school by [date].
```

Present at the bottom of the report card or on a separate tear-off section (configurable in template).

---

## Template Levels

### Level 1 — Branding Only (All Tiers)

School uploads their logo and sets their primary colour. The rest of the layout uses the ZSMS default template.

**What changes:**
- School logo in header
- Primary colour for section headers and borders
- School motto displayed under school name (if configured)

**Setup time:** Under 5 minutes. No design skill needed.

### Level 2 — Layout Variants (Growth and Above)

School selects from 4 professionally designed layouts. Same content, different visual structure.

| Variant | Description |
|---|---|
| Classic | Traditional formal layout — black borders, serif font, suitable for ECZ-style schools |
| Modern | Clean lines, sans-serif font, colour accents — suitable for Cambridge-style schools |
| Compact | Denser layout fitting more information per page — useful for schools with many subjects |
| Formal | Government-style layout — plain, minimal, suitable for schools with official filing requirements |

Each variant is previewed with the school's actual logo, colour, and a sample student's data before selection.

### Level 3 — Custom Template (Professional and Enterprise)

School uploads a custom HTML/CSS template or works with AfriTech to design a bespoke layout. Requires AfriTech review and approval before activation (typically 2-3 business days). Custom templates must include all required data fields — the review validates this.

---

## Template Configuration Fields

The school configures these options in Settings → Document Templates → Report Card:

```
Layout:          [Classic / Modern / Compact / Formal / Custom]
Primary colour:  [colour picker — #1A3C5E default]
Show logo:       [toggle]
Show school motto: [toggle]
Show DOB:        [toggle]
Show exam number: [toggle — auto-shown for exam classes if enabled]

Results table:
  Show percentage: [toggle]
  Show max marks:  [toggle]
  Show teacher comments: [toggle]
  Show attendance summary: [toggle]

Position display:
  Format: [Position 3 of 38 / 3rd of 38 / 3/38]

Credit count:    [toggle — auto-shown for ECZ O-Level classes if enabled]

Principal's comment:
  Same comment for all students: [text area]
  Or: Per-student comments (entered in results screen)

Parent acknowledgement section:
  Include: [toggle]
  Tear-off format: [toggle]
  Return deadline: [date picker — optional]

Footer text:     [text field — optional school-specific text]
```

---

## Report Card Storage and Access

### Storage Path

```
R2 public bucket:
/{school_id}/reports/{academic_year}/term{N}/{class_id}/{student_id}.pdf

Example:
/ZM-LSK-0001/reports/2026/term2/grade_9a/550e8400-e29b-41d4-a716.pdf
```

### Signed URL Expiry

Report cards use a 30-day signed URL. This is intentionally long — parents need time to download, share with family, and file the report card. Parents who need the URL after 30 days can generate a new one from the portal (the file is permanently stored in R2).

### Access by Role

| Role | Access |
|---|---|
| Parent | Own children's report cards — download via portal or WhatsApp link |
| Student | Own report card — download via student portal |
| Teacher | Own class students' report cards (current term only) |
| Admin, Principal, Owner | All report cards at their school |
| AfriTech super admin | All report cards across all schools |

---

## Report Card Preview

Before bulk generation, the principal can preview a single report card for any student. This lets them verify the template, check that marks and grades look correct, and confirm the layout before generating 400 PDFs.

**Location:** Results → [Term] → Preview Report Card → [Select Student]

A sample PDF is generated on demand and opens in the browser. This preview is not stored in R2 — it is generated and streamed directly. It does not affect the student's actual report card generation.

---

## Report Card Regeneration

If a report card needs to be regenerated after the initial bulk generation (e.g. a marks correction was approved by the principal, or the template was updated):

```
Admin opens Results → [Term] → Report Cards → [Student Name] → Regenerate

Warning: "This will replace the existing report card for [Student Name].
The parent's download link will point to the new version."

[Confirm regeneration]
```

The old PDF is overwritten in R2 (same path). Existing signed URLs continue to work — they point to the same R2 path, which now has the updated file. The parent's WhatsApp link still works and now delivers the corrected report card.

---

## Business Rules

1. Report cards are generated per student and stored individually in R2. They are not merged into a single school-wide PDF.
2. Report cards are only accessible to authenticated users with appropriate RLS-scoped access. The R2 signed URL provides the security boundary — without a valid signed URL, the R2 path cannot be accessed.
3. The examination number is displayed only when `students.examination_number` is set AND the student is in an examination class. It is hidden for non-examination classes regardless of template settings.
4. The credit count is displayed only for ECZ O-Level examination classes. The system determines this from the student's `level_type` in `school_grade_levels` and the school's configured grading system.
5. Teacher comments are optional — blank comments are acceptable and result in an empty comment column on the report card.
6. The principal's comment can be a single comment applied to all students in the school, or per-student comments entered during the results review process.
7. Regenerating a report card overwrites the existing R2 file. Existing signed URLs automatically serve the new version.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 11 results module documentation |
| 2026-04-26 | Added examination number display rule | Only for exam classes when field is set |
| 2026-04-26 | Teacher comments confirmed optional | Required comments would block generation |
| 2026-04-26 | Added 30-day signed URL expiry | Parents need time to download and share |
| 2026-04-26 | Added regeneration overwrites R2 path | Existing links continue working with new content |
