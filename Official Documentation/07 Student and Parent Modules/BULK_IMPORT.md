# BULK_IMPORT.md — Bulk Student Import

## Related Documents

- `docs/modules/students/STUDENTS.md` — student entity and field definitions
- `docs/modules/students/STUDENT_ID.md` — student ID generation during import
- `docs/modules/students/PARENT_LINKING.md` — parent account creation during import
- `docs/api/EDGE_FUNCTIONS.md` — process-bulk-import Edge Function
- `docs/api/ENDPOINTS.md` — POST /api/students/import route
- `docs/infra/QSTASH.md` — batch processing via job queue
- `docs/infra/R2.md` — error report storage
- `docs/modules/school/ONBOARDING.md` — import as onboarding checklist step

---

## Purpose

This document defines the complete bulk student import system — the flexible template format, column mapping, validation rules, batch processing, error reporting, and duplicate detection. Every Claude Code session building the import UI, the import Edge Function, or the column mapping system must read this document.

---

## Overview

Bulk import is the single most important onboarding step for schools migrating to ZSMS. A school with 400 existing students needs to get them all into the system accurately in one operation rather than entering them one by one. The import system is designed to be forgiving of real-world spreadsheet formats while still validating data integrity before any records are created.

The key design principle: **validate everything, write nothing, show all errors, then let the admin confirm before writing.** No partial imports that leave the database in an inconsistent state.

---

## The Import Template

ZSMS provides a downloadable Excel template from the Students → Import page. The template has two sheets:

**Sheet 1 — Student Data:** The data entry sheet with column headers.
**Sheet 2 — Instructions:** Explains each column, valid values, and examples.

### Required Columns

These columns must be present and populated for every row. A row with any required field missing is flagged as an error and not imported.

| Column Header | Field | Validation |
|---|---|---|
| `first_name` | Student first name | Non-empty string, max 100 characters |
| `last_name` | Student last name | Non-empty string, max 100 characters |
| `grade_id` | Grade level | Must match a configured grade in the school's grade_levels |
| `class_id` | Class within grade | Must match a configured class for that grade |

### Optional Columns

These columns may be left blank. Blank values are treated as NULL — the field is simply not set on the student record.

| Column Header | Field | Validation When Provided |
|---|---|---|
| `date_of_birth` | Date of birth | Accepted formats: DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY |
| `gender` | Gender | Must be: male, female, or not_stated (case-insensitive) |
| `is_boarding` | Boarding status | TRUE, FALSE, YES, NO, 1, 0 (all accepted) |
| `examination_number` | ECZ/Cambridge candidate number | Any string, no format enforced |
| `nrc_or_birth_cert` | NRC or birth certificate number | Any string — encrypted before storage |
| `enrolment_date` | Date enrolled at this school | Date format, defaults to import date if blank |
| `parent_phone` | Primary parent/guardian phone | Normalised to E.164 — leading zero stripped, +260 prepended |
| `parent_email` | Parent email address | Valid email format |
| `parent_name` | Parent full name | String, used when creating parent account |
| `parent_relationship` | Relationship to student | mother, father, guardian, grandparent, sibling, uncle, aunt, other |
| `student_id` | Existing student ID from another system | Must match STU-XX-XXX-XXXX-XXXXX format if provided |

---

## Column Mapping — Flexible Import

Schools whose spreadsheets use different column headers than the ZSMS template can use the column mapping step during import. This eliminates the need for schools to reformat their existing spreadsheets.

### Mapping Flow

```
1. School uploads their spreadsheet (any column header names)
2. ZSMS reads the headers from row 1 of the file
3. Column mapping screen displays:

   Your File Column        →    ZSMS Field
   ─────────────────────────────────────────
   "Pupil Name"            →    [first_name ▼]
   "Surname"               →    [last_name ▼]
   "Class"                 →    [class_id ▼]
   "Form"                  →    [grade_id ▼]
   "Parent Contact"        →    [parent_phone ▼]
   "Unknown column"        →    [Skip this column ▼]

4. Admin adjusts dropdowns to match ZSMS fields
5. Admin clicks "Validate with this mapping"
6. Validation runs using the confirmed mapping
```

**Auto-mapping:** The system attempts to auto-match column headers using fuzzy matching. Common variations are pre-mapped:
- "Pupil Name", "Student Name", "Full Name", "Name" → split into first_name and last_name
- "DoB", "Birth Date", "DOB", "Date of Birth" → date_of_birth
- "Class", "Form", "Grade", "Year", "Stream" → grade_id or class_id
- "Contact", "Phone", "Mobile", "Parent Phone" → parent_phone

Auto-mapped columns are highlighted in green. Unmatched columns are highlighted in yellow with a dropdown for manual mapping. The admin reviews and confirms before validation runs.

**Saved column mappings:** After the first successful import with a custom mapping, the mapping is saved for this school as a named profile (e.g. "Our Excel Format"). Future imports from the same spreadsheet format automatically apply the saved mapping — the admin just clicks "Use saved mapping" and skips the mapping step.

### Splitting Full Name Columns

When a school has a single "Full Name" column instead of separate first and last name:

```typescript
function splitFullName(fullName: string): { first_name: string; last_name: string } {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) {
    return { first_name: parts[0], last_name: '' }
  }
  const first_name = parts[0]
  const last_name = parts.slice(1).join(' ')
  return { first_name, last_name }
}
```

The admin is shown the result of the split in the preview and can correct any rows where the split produced unexpected results (e.g. "Dr. Chanda Bwalya" splits as first_name="Dr.", last_name="Chanda Bwalya").

---

## Validation Rules

Validation runs on every row after column mapping is confirmed. All validation happens before any rows are written to the database.

### Row-Level Validations

| Check | Error Message Shown to Admin |
|---|---|
| first_name is blank | Row [N]: First name is required |
| last_name is blank | Row [N]: Last name is required |
| grade_id not in school's configured grades | Row [N]: Grade "[value]" is not configured at your school. Your grades are: [list]. Check Settings → Grade Structure. |
| class_id not valid for the given grade | Row [N]: Class "[value]" is not valid for [grade]. Valid classes: [list] |
| date_of_birth unrecognisable format | Row [N]: Date of birth "[value]" could not be parsed. Use format DD/MM/YYYY |
| date_of_birth in the future | Row [N]: Date of birth is in the future |
| gender not a valid value | Row [N]: Gender must be "male", "female", or "not_stated" |
| parent_phone fails E.164 normalisation | Row [N]: Phone number "[value]" is not valid. Example: 0977123456 or +260977123456 |
| parent_email fails format check | Row [N]: Email "[value]" is not a valid email address |
| student_id provided but wrong format | Row [N]: Student ID "[value]" does not match the required format STU-XX-XXX-XXXX-XXXXX |

### Duplicate Detection

| Check | How Handled |
|---|---|
| Same student_id already exists in the database | Row flagged as "Existing student" — admin chooses: Skip (do not reimport) or Update (overwrite fields) |
| Same first_name + last_name + date_of_birth already exists at this school | Row flagged as "Possible duplicate" with existing student details shown — admin confirms to proceed or skip |
| Same parent_phone already registered at this school | Parent account is reused — new student linked to existing parent account, no duplicate parent created |
| Same parent_phone registered at a different school | Parent account is reused — parent will have children at multiple schools in their portal |

---

## Import Preview

After validation completes, the admin sees a preview screen before any data is written:

```
Import Preview — 400 rows processed

✅ 385 rows ready to import
⚠️  12 rows are possible duplicates — review required
❌  3 rows have errors — will be skipped

[Download Error Report]   [Review Duplicates]   [Confirm Import →]
```

**Error rows:** Shown in a table with the row number, the specific error, and the original data. Admin can fix errors in the preview (inline editing for simple corrections like date format) or go back and fix the spreadsheet.

**Duplicate rows:** Shown with a side-by-side comparison — the incoming row vs the existing student record. For each duplicate, admin selects:
- Skip — do not import this row
- Import as new — create a new student record anyway
- Update existing — overwrite the existing student's fields with the imported data

**After resolving all issues:** The admin clicks "Confirm Import." At this point, all data is written. The import cannot be paused or cancelled after this point.

---

## Batch Processing

Large imports run as queued batch jobs to prevent API timeouts. The import is split into batches of 50 rows.

```
Admin confirms import (385 valid rows)
→ API route creates import_job record with status 'processing'
→ 385 ÷ 50 = 8 batches queued
→ Admin sees progress: "Importing 385 students... 150 done"
→ Supabase Realtime updates the counter as each batch completes
→ On completion: status = 'complete', summary shown
→ PostHog event: student_bulk_import_completed
```

**Import job tracking table:**

```sql
CREATE TABLE public.import_jobs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID NOT NULL REFERENCES public.schools(id),
  status          TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','complete','failed')),
  total_rows      INT NOT NULL,
  processed_rows  INT DEFAULT 0,
  success_count   INT DEFAULT 0,
  error_count     INT DEFAULT 0,
  duplicate_count INT DEFAULT 0,
  error_report_url TEXT,        -- R2 path to downloadable error report
  column_mapping  JSONB,        -- Saved mapping used for this import
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
```

---

## Parent Account Creation During Import

When `parent_phone` is provided in the import file, the system automatically creates or updates a parent account:

```typescript
async function processParentFromImport(
  parentPhone: string,
  parentEmail: string | null,
  parentName: string | null,
  studentId: string,
  schoolId: string
): Promise<void> {
  // Normalise phone to E.164
  const phone = normalisePhone(parentPhone, 'ZM')

  // Check if parent account already exists
  const existing = await findParentByPhone(phone)

  if (existing) {
    // Link existing parent to new student
    await linkParentToStudent(existing.id, studentId, schoolId)
  } else {
    // Create new parent account
    const parent = await createParentAccount({ phone, email: parentEmail, name: parentName })
    await linkParentToStudent(parent.id, studentId, schoolId)
  }

  // Queue welcome notification to parent
  await enqueueJob('send-email', {
    template: 'parent_welcome',
    parent_phone: phone,
    school_id: schoolId,
    student_id: studentId,
  })
}
```

The first parent provided in the import file for a student is automatically set as `is_primary = TRUE`. If a student has multiple parents in the import (e.g. separate rows for mother and father), only the first encountered is set as primary. The school admin can change the primary contact from the student profile after import.

---

## Error Report

After a completed import, a downloadable error report is available listing every row that was skipped due to errors. The report is an Excel file with columns:

| Column | Content |
|---|---|
| Row Number | Original row number in the uploaded file |
| First Name | As provided |
| Last Name | As provided |
| Error Type | Validation / Duplicate / System Error |
| Error Detail | Specific error message explaining what was wrong |
| Suggestion | What to fix before re-importing this row |

The error report is stored in R2 and accessible for 48 hours after the import. After 48 hours it is automatically deleted.

---

## Re-importing After Corrections

Schools often need to fix errors and re-import. The system handles this safely:

- Previously successfully imported students are detected as duplicates in the re-import
- Admin sees the "Existing student" flag and selects Skip or Update
- Only the corrected rows (previously errored) need to be processed
- The school can re-import the entire original file — the duplicate detection prevents double-creation

---

## Onboarding Checklist Integration

Successfully importing at least one student marks the `first_student` onboarding checklist item as complete. This happens automatically when the first import job with `success_count > 0` completes.

---

## Business Rules

1. No rows are written to the database until the admin clicks "Confirm Import." The validation and preview step is entirely non-destructive.
2. Error rows are always skipped — they are never partially imported. The admin must fix errors and re-import those rows separately.
3. The column mapping step is optional when the school uses the standard ZSMS template. It is shown automatically when unrecognised column headers are detected.
4. Saved column mappings belong to the school and are stored in the database. They persist across sessions and can be named and managed in the import settings.
5. Parent accounts created during import are created with phone number only. If the parent's name is provided in the import, it is stored. No email OTP is sent automatically — the parent receives a welcome notification explaining how to access the portal.
6. The `nrc_or_birth_cert` field from the import is encrypted before storage. It is never written in plain text to any database column, log, or error report.
7. Student ID provided in the import file overrides automatic generation only if the format is valid. Invalid student IDs in the import are treated as an error on that row.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 7 student module documentation |
| 2026-04-26 | Added flexible column mapping system | Schools should not need to reformat their existing spreadsheets |
| 2026-04-26 | Added examination_number as optional import column | Confirmed examination number requirement |
| 2026-04-26 | Added saved column mapping profiles | Reduces friction for recurring imports from same source |
