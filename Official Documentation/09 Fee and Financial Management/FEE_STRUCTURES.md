# FEE_STRUCTURES.md — Fee Structure Configuration

## Related Documents

- `docs/modules/fees/PAYMENTS.md` — payment recording against fee records
- `docs/modules/fees/RECEIPTS.md` — receipt generation on payment verification
- `docs/modules/fees/REMINDERS.md` — automated reminder scheduling
- `docs/modules/fees/AUDIT.md` — financial audit trail
- `docs/modules/school/SCHOOL_CONFIG.md` — grade levels referenced in fee structures
- `docs/modules/students/STUDENTS.md` — is_boarding field used in fee selection
- `docs/DATABASE.md` — fee_structures and fee_records tables
- `docs/RLS.md` — fee structure access policies

---

## Purpose

This document defines how schools configure their fee structures — the template that determines what each student owes each term. It covers fee line configuration, day vs boarding fees, mandatory vs optional fees, and how fee records are generated from the structure at term start. Every Claude Code session building the fee configuration UI or fee record generation must read this document.

---

## Overview

The fee structure is the foundation of all financial management in ZSMS. It defines what the school charges, to whom, and for which term. Once configured, the fee structure generates individual `fee_records` for each enrolled student at the start of each term — creating the ledger that the accountant works from throughout the term.

Fee structures are configured per academic year. A school can have different fee amounts for each term, for different grade levels, and for day vs boarding students.

---

## Fee Structure Concepts

### Fee Lines

A single fee structure entry is called a fee line. Multiple fee lines can exist for the same grade and term — each line represents a separate fee component.

**Example fee lines for Grade 9, Term 1, Day Students:**
```
Tuition Fee:     K2,500.00  (mandatory)
Activity Fee:    K  300.00  (mandatory)
Exam Fee:        K  150.00  (mandatory — exam term only)
Computer Lab:    K  100.00  (optional)
```

Each fee line generates a separate `fee_records` row per student. This means a student's total bill is the sum of all applicable fee lines. The accountant can see the breakdown clearly, and parents see itemised fee statements.

### Student Types

Fee structures support three student type configurations:

| Value | Applies To |
|---|---|
| `all` | Both day and boarding students — same amount |
| `day` | Day students only |
| `boarding` | Boarding students only |

A school with boarding fees configures separate fee lines:
```
Tuition Fee:     K2,500 (student_type: all)
Boarding Fee:    K1,800 (student_type: boarding)
Activity Fee:    K  300 (student_type: all)
```

A day student at this school owes K2,800 (tuition + activity). A boarding student owes K4,600 (tuition + boarding + activity). The `students.is_boarding` field determines which fee lines apply.

### Mandatory vs Optional

`is_mandatory = TRUE` — the fee is automatically included in every student's fee record and cannot be waived without admin action.

`is_mandatory = FALSE` — the fee is optional. The school admin can include or exclude it per student when generating fee records. A computer lab fee, for example, might only apply to students who use the computer lab.

---

## Fee Structure Builder UI

**Location:** Fees → Fee Structures → [Academic Year] → [Term]

### Grid Layout

The fee structure screen shows a grid — rows are fee lines, columns show the fee amounts per grade level if they vary.

For schools with the same fees for all grades:
```
Fee Line        Amount      Type        Mandatory
Tuition Fee     K2,500      All         ✅
Activity Fee    K  300      All         ✅
Boarding Fee    K1,800      Boarding    ✅
```

For schools with grade-based fees:
```
Fee Line        Grade 7   Grade 8   Grade 9   Form 4    Form 5
Tuition Fee     K1,800    K2,000    K2,200    K2,500    K3,000
Activity Fee    K  200    K  250    K  300    K  300    K  400
```

The special value `grade_id = 'ALL'` applies the same amount to every grade. Schools with tiered fees create separate rows per grade.

### Adding a Fee Line

```
Fee label:      [text — e.g. "Tuition Fee", "Computer Lab Fee"]
Grade:          [dropdown — All Grades / specific grade]
Student type:   [radio — All Students / Day Students / Boarding Students]
Amount:         [number field — ZMW]
Term:           [checkboxes — Term 1 ✅  Term 2 ✅  Term 3 ✅]
Mandatory:      [toggle — Yes / No]
```

The term checkboxes allow fees that only apply in certain terms — exam fees in Term 3, for example.

### Copying from Previous Year

At the start of each academic year, the admin can copy the previous year's fee structure with an optional percentage increase:

```
Copy fee structure from 2025?
Apply percentage increase: [+0% / +5% / +10% / Custom]

Preview:
  Tuition Fee:  K2,500 → K2,625 (+5%)
  Activity Fee: K  300 → K  315 (+5%)

[Copy with increase]   [Copy without change]   [Start fresh]
```

---

## Generating Fee Records

At the start of each term, the admin generates fee records from the fee structure. This creates one `fee_records` row per student per applicable fee line.

**Location:** Fees → Generate Term Fees → [Academic Year] → [Term Number]

```
Generate fee records for Term 2, 2026?

This will create fee records for:
- 412 active students
- 3 fee lines × 412 students = 1,236 fee records
- Boarding students (47): additional Boarding Fee records

Already generated records will be skipped (safe to run again).

[Generate Fee Records]
```

**Generation logic:**
```typescript
for (const student of activeStudents) {
  const applicableFeeLines = feeStructures.filter(fs =>
    (fs.grade_id === student.grade_id || fs.grade_id === 'ALL') &&
    (fs.student_type === 'all' ||
     (fs.student_type === 'boarding' && student.is_boarding) ||
     (fs.student_type === 'day' && !student.is_boarding))
  )

  for (const feeLine of applicableFeeLines) {
    await supabase
      .from('fee_records')
      .insert({
        school_id: student.school_id,
        student_id: student.id,
        fee_structure_id: feeLine.id,
        academic_year: year,
        term_number: term,
        fee_label: feeLine.fee_label,
        amount_due: feeLine.amount,
        currency_code: feeLine.currency_code,
        status: 'unpaid',
        due_date: termDueDate,
      })
      .onConflict(['school_id', 'student_id', 'fee_structure_id', 'academic_year', 'term_number'])
      .ignore()
    // ON CONFLICT DO NOTHING — safe to run multiple times
  }
}
```

---

## Fee Discounts and Waivers

Individual student discounts are managed at the `fee_records` level, not the fee structure level. This allows per-student adjustments without changing the school-wide structure.

### Discount / Scholarship

The accountant opens a student's fee record → Edit → Apply Discount:

```
Discount amount: K500.00
Reason: Scholarship — Academic Merit 2026
```

This sets `fee_records.discount_amount = 500` and `fee_records.discount_reason`. The student's effective amount due becomes `amount_due - discount_amount`. The discount is shown on the receipt and fee statement.

**Partial scholarship:** Set `discount_amount` to the scholarship value — the student owes the remainder.
**Full scholarship:** Set `discount_amount = amount_due` — status automatically becomes `waived`.

### Waiving a Fee

Full fee waiver is a one-step action — accountant opens fee record → Waive Fee → enter reason. Sets `status = 'waived'` and `discount_amount = amount_due`. No payment is expected.

---

## Fee Structure Grade Level Integration

Fee structures reference `school_grade_levels.level_id` for this school. This means:

- A school using "Form 1" instead of "Grade 7" sees "Form 1" in their fee builder dropdown
- Fee structures are tied to the school's own grade terminology
- When viewing a student's fee record, the grade display shows the school's terminology

This is enforced at the API layer — `grade_id` in a fee structure is validated against the school's `school_grade_levels` table before saving.

---

## Business Rules

1. Fee structures must exist before fee records can be generated. If no fee structure is configured for a grade or term, no fee records are created for students in that grade for that term.
2. `fee_records` generation is idempotent — `ON CONFLICT DO NOTHING` means running generation multiple times does not create duplicates.
3. Fee structure changes after fee records have been generated do not retroactively update existing records. The `fee_records.amount_due` is copied from the fee structure at the time of generation and is preserved.
4. A fee line with `grade_id = 'ALL'` creates fee records for every active student regardless of their grade. Use this for fees that apply school-wide.
5. The minimum fee amount is K0.00 (used for tracking optional items that have no cost). Negative amounts are not permitted.
6. Fee structures are per school and per academic year. A school cannot share fee structures with another school.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 9 fee module documentation |
| 2026-04-26 | Grade references use school_grade_levels.level_id | Schools see their own grade terminology |
| 2026-04-26 | Discount/scholarship model — single discount_amount field | Phase 1 simplicity — full scholarship tracking in Phase 2 |
