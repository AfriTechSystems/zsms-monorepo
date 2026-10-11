# STUDENT_ID.md — Student ID System

## Related Documents

- `docs/modules/students/STUDENTS.md` — student entity reference
- `docs/modules/students/BULK_IMPORT.md` — student ID in import template
- `docs/modules/auth/AUTH.md` — student ID as parent/student login discovery
- `docs/modules/school/PUBLIC_DIRECTORY.md` — student ID lookup without exposing personal data
- `docs/modules/results/REPORT_CARDS.md` — student ID on report cards
- `docs/DATABASE.md` — students table student_id column
- `docs/CONVENTIONS.md` — ID format conventions

---

## Implementation Status (2026-10-11)

**The format is now enforced. Until `0247` it was not.**

`students.student_id` has always been NOT NULL and UNIQUE. The **format** was specified
here and in `CONVENTIONS.md` and enforced nowhere, so `STU-ZM-LSK-1-42` would have stored
cleanly — and then failed every lookup built on the documented shape. A pupil who exists
and cannot be found is a worse failure than a refused insert at the moment of the typo.

`0247` adds a CHECK matching the regex below, and `public.is_valid_student_id()` so a
route, an import and a policy all ask the same question of the same expression.

All 254 pupils on `zsms-dev` already matched — checked before writing, because a CHECK
added to a table with one non-conforming row fails the migration outright.

**`packages/validators/student.ts` does not exist**, and the validator lives beside the
data instead. Creating a package for one regex would be two places for it to drift.

---

## Purpose

This document is the focused reference for the student ID system — its format, how it is generated, how it is used across every module that references it, and what happens to it when a student transfers schools. Every Claude Code session that generates, displays, or validates student IDs must read this document.

---

## ID Format

```
STU-ZM-LSK-0001-00042
│   │   │   │    │
│   │   │   │    └── 5-digit zero-padded sequence (per school)
│   │   │   └─────── School sequence number
│   │   └─────────── City code
│   └─────────────── Country code
└─────────────────── Fixed prefix
```

**Examples:**
- `STU-ZM-LSK-0001-00001` — first student at the first Lusaka school
- `STU-ZM-LSK-0001-00400` — four-hundredth student at that school
- `STU-ZM-CBE-0003-00042` — forty-second student at the third Copperbelt school
- `STU-BW-GAB-0001-00001` — first student at the first Gaborone school

**Key properties:**
- The student ID encodes which school and city the student was enrolled at
- The sequence is per-school — two different schools can both have `00042`
- The full ID is globally unique across all schools and all countries
- Maximum 10,000 students per school (5-digit sequence supports 00001–99999 in practice)

---

## Generation

Student IDs are generated atomically by the student creation API route and the bulk import Edge Function. They are never manually assigned and never reused.

```typescript
// packages/utils/studentId.ts
export async function generateStudentId(
  schoolId: string,
  schoolRecord: { school_id: string }
): Promise<string> {
  const { data } = await supabaseAdmin.rpc('get_next_student_sequence', {
    p_school_id: schoolId,
  })

  const sequence = data.toString().padStart(5, '0')
  return `STU-${schoolRecord.school_id}-${sequence}`
  // Result: STU-ZM-LSK-0001-00042
}
```

```sql
-- Atomic sequence generation — prevents duplicates under concurrent inserts
CREATE OR REPLACE FUNCTION get_next_student_sequence(p_school_id UUID)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE v_next INT;
BEGIN
  SELECT COALESCE(MAX(
    CAST(SPLIT_PART(student_id, '-', 5) AS INT)
  ), 0) + 1
  INTO v_next
  FROM public.students
  WHERE school_id = p_school_id;
  RETURN v_next;
END;
$$;
```

The function uses `MAX() + 1` rather than a PostgreSQL sequence per school to avoid needing to create and manage thousands of sequences as schools scale. At current school sizes (under 2,000 students per school) this approach is reliable. The `get_next_student_sequence` function runs within the student INSERT transaction — concurrent inserts for the same school are serialised by the transaction lock.

---

## Where the Student ID Appears

### In the Parent Portal and Student Portal

The student ID is shown on every student card in the parent portal. Parents can copy it for future reference (e.g. when contacting the school, when logging into a new device).

```
Child: Chanda Bwalya
School: Sunrise Academy · Grade 9A
Student ID: STU-ZM-LSK-0001-00042  [Copy]
```

### On Report Cards

The student ID appears in the header section of every report card alongside the student's name. This is a standard identifier that schools can use for record-keeping and that parents can reference when querying results.

### On Payment Receipts

Every payment receipt includes the student ID to clearly identify which student's fee was paid. This is particularly important when a parent has multiple children at the same school.

### In the Bulk Import Template

The bulk import template includes `student_id` as an optional column. When provided in the import file (e.g. schools migrating from another system that already assigned IDs), ZSMS accepts it and uses it. When not provided, ZSMS generates it automatically. See `docs/modules/students/BULK_IMPORT.md` for full import field details.

### In the Public Directory — Student Lookup

The student ID is used in the unauthenticated parent login discovery flow:

```
Parent enters: STU-ZM-LSK-0001-00042
→ System queries: SELECT school_id FROM students WHERE student_id = $id
→ Returns: school found — Sunrise Academy (ZM-LSK-0001)
→ No personal data returned — only school name and school ID
→ Parent proceeds to login at that school's portal
```

This lookup endpoint (`GET /api/students/lookup`) returns only the school name and school ID — never any student personal data. The student ID is the discovery key, not a data access key.

---

## Student ID on Transfer

When a student transfers from one school to another, their student ID behaviour is as follows:

**At the original school:**
The student's record retains its original student ID (`STU-ZM-LSK-0001-00042`). Status is set to `transferred`. All historical records — attendance, results, fee history — remain permanently linked to this student ID at this school.

**At the new school:**
A completely new student ID is generated for the new school (`STU-ZM-LSK-0007-00180`). The new school's records start fresh. There is no automatic link between the old and new student IDs in the database.

**Why no data transfer between schools:**
School A's fee records, attendance, and results belong to School A's data scope. Transferring them to School B would allow School B to see School A's financial records — a tenant isolation violation. The clean separation also simplifies the data model significantly.

**AfriTech super admin cross-school view:**
Super admins can search by parent phone number and see all student IDs linked to that parent across all schools. This provides a full picture of a student's school history for support purposes without violating school-level data isolation.

**Parent continuity:**
The parent's account links to both student IDs. In the parent portal, both children appear in the child switcher — the "transferred" child shows their historical data at School A with a "Transferred" badge. The new enrolment at School B shows current data. Parents retain access to both records indefinitely.

---

## Validation Rules

When validating a student ID (e.g. in the parent login lookup or bulk import):

```typescript
// packages/validators/student.ts
export const studentIdRegex = /^STU-[A-Z]{2}-[A-Z]{3}-\d{4}-\d{5}$/

export function isValidStudentId(id: string): boolean {
  return studentIdRegex.test(id)
}

// Examples:
// STU-ZM-LSK-0001-00042 → valid
// STU-ZM-LSK-1-42       → invalid (wrong digit padding)
// STU-zm-lsk-0001-00042 → invalid (must be uppercase)
// 00042                  → invalid (missing prefix)
```

The validation is applied at the API layer before any database query. Invalid formats return `VALIDATION_ERROR` without hitting the database.

---

## Display Formatting

The student ID is always displayed in full uppercase with hyphens. It is never abbreviated or truncated in the UI. The copy-to-clipboard function copies the full ID including the `STU-` prefix.

In printed documents (report cards, receipts), the student ID is displayed in a monospace font to distinguish it from other text and make it easy to read and transcribe.

---

## Business Rules

1. Student IDs are generated by the system and never manually assigned, except when provided in a bulk import file from a school migrating from another system.
2. Student IDs are permanent and never reused — a soft-deleted student's ID remains reserved and cannot be assigned to a new student.
3. The student ID lookup endpoint returns only school identification data — never student personal data. No authentication is required for this endpoint.
4. On transfer, a new student ID is generated at the new school. Historical records at the original school remain linked to the original ID.
5. Student IDs must be validated with the regex pattern before any database lookup. Malformed IDs are rejected without querying the database.
6. The student ID is globally unique across all ZSMS deployments in all countries because it includes the school ID (which includes the country and city codes).

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 7 student module documentation |
