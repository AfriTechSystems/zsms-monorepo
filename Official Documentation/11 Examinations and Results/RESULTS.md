# RESULTS.md — Marks Entry and Results Management

## Related Documents

- `docs/modules/results/GRADING.md` — grade calculation from marks
- `docs/modules/results/REPORT_CARDS.md` — report card design and configuration
- `docs/modules/results/BULK_GENERATION.md` — bulk PDF generation
- `docs/modules/results/PUBLISHING.md` — results publication workflow
- `docs/modules/staff/ASSIGNMENTS.md` — assignments that scope marks entry access
- `docs/modules/students/STUDENTS.md` — examination_number field on students
- `docs/modules/school/SCHOOL_CONFIG.md` — grading scales configured per school
- `docs/infra/POWERSYNC.md` — offline marks entry on mobile
- `docs/DATABASE.md` — exam_results table
- `docs/RLS.md` — results RLS policies

---

## Implementation Status (2026-10-11)

**Built end to end.** `save_exam_marks()`, the mark entry screen, publication, and the
parent view.

**Marks are entered; grades are never typed.** The screen shows the grade the school's
scale produces and has no field for it — a boundary implemented twice is two answers to
"is 79.5 a B", and the copy on the screen says so. The one exception is a deliberate
override (`0256`), which is marked with an asterisk and carries a reason.

**An empty box is not a zero**, and the screen enforces the distinction: a zero is a
pupil who sat the paper and scored nothing, an empty box is a pupil who was not examined,
and the two mean opposite things on a report card.

---

## Purpose

This document defines the complete marks entry and results management system — how teachers enter marks, how grades are calculated in real time, how class positions are ranked, how the principal reviews results, and what rules govern editing and locking. Every Claude Code session building any results feature must read this document.

---

## Overview

Marks entry is the academic counterpart to attendance marking. Teachers enter raw marks for each student in their assigned subjects. ZSMS calculates grade letters, grade points, and class positions automatically using the school's configured grading scale. The principal reviews and publishes when ready.

Marks entry supports offline entry on the mobile app via PowerSync — teachers can enter marks at home without internet and sync when connectivity returns. The same offline-first design as attendance applies here.

---

## Marks Entry Interfaces

### Primary — Mobile App (Teacher, Offline-Capable)

```
1. Teacher opens ZSMS mobile app → Results tab
2. Selects: Academic Year 2026 · Term 2
3. Sees their assigned subjects and classes:
   Mathematics — Grade 9A   [Enter marks]
   Mathematics — Grade 9B   [Enter marks]
   Mathematics — Form 1A    [Enter marks]
4. Taps "Enter marks" for Grade 9A Mathematics
5. Marks entry screen loads:
   - All students in Grade 9A listed alphabetically
   - Marks column: empty fields (or previously saved marks)
   - Maximum: 100 (or configured marks_total for this assessment)
6. Teacher enters marks for each student:
   Chanda Bwalya:    [78]  → Grade: B  (shown in real time)
   Mwamba Phiri:     [45]  → Grade: D
   Kunda Zulu:       [92]  → Grade: A
7. Teacher taps SAVE
8. If offline: "Saved locally — will sync when connected"
9. If online: "Saved ✓"
```

**Real-time grade display:**
As the teacher types a mark, the grade letter updates instantly next to the field using the school's configured grading scale. This immediate feedback helps teachers spot data entry errors (e.g. typing 88 instead of 8 — the grade jumps to A which the teacher notices).

### Secondary — Web Dashboard (Teacher/Admin)

**Location:** Results → [Academic Year] → [Term] → [Class] → [Subject]

Same marks entry form in a web table layout. All students in one scrollable table. More efficient for entering marks for large classes on a desktop. Supports copy-paste from Excel into the marks column.

---

## Marks Entry Scoping

Teachers can only enter marks for their assigned subjects and classes. This is enforced at two levels:

**Application layer:** The marks entry screen only shows the teacher's assigned subjects and classes. The subject and class selectors are pre-filtered by `teacher_assignments` (ADR-037).

**RLS layer:** The INSERT and UPDATE policies on `exam_results` call `teacher_teaches_subject(class_id, subject_code)`, which is TRUE when the teacher holds a `scope='class'` assignment for that class or a `scope='subject'` assignment for that subject.

The school's admin, principal, and owner can enter marks for any class and subject — or can use the permission grant system to give a teacher temporary access to another teacher's class (e.g. when a teacher is ill and a substitute needs to enter marks).

---

## Marks Validation Rules

Validated on every save (both mobile and web):

| Rule | Error Shown |
|---|---|
| Mark above `marks_total` | "Mark cannot exceed [marks_total]" |
| Negative mark | "Mark cannot be negative" |
| Non-numeric entry | "Please enter a number" |
| Mark entered after results published | "Results have been published — contact your principal to make corrections" (403 error) |
| Decimal marks | Accepted — stored as NUMERIC(6,2) |

**`marks_total`:** Defaults to 100 but is configurable per subject and term. For end-of-year exams marked out of 150, the teacher sets `marks_total = 150` before entering marks. The grading percentage is calculated as `(marks_obtained / marks_total) × 100`.

---

## Examination Number on Marks Entry Screen

For students in examination classes (Grade 6, Form 4, Form 6), the `examination_number` field appears next to the student's name in the marks entry screen. This helps teachers cross-reference their physical mark sheets (which use candidate numbers) with the ZSMS student list.

```
Grade:  Form 4 · Mathematics · Term 3 (O-Level Year)

Student Name          Candidate No.    Mark    Grade
Chanda Bwalya         2024/001234      [78]    B
Mwamba Phiri          2024/001235      [45]    D
Kunda Zulu            2024/001236      [92]    A*
```

Students without an examination number show a dash in that column.

---

## Class Position Ranking

Positions are calculated per class after all marks are entered for all subjects for a given term. The principal or admin triggers position calculation from the Results dashboard.

### Algorithm — Standard Competition Ranking

```typescript
function calculatePositions(results: StudentAggregate[]): StudentAggregate[] {
  // Sort by aggregate points (ascending for ECZ — lower points = better grade)
  // or by total marks (descending) depending on school's grading config
  const sorted = results.sort((a, b) => a.total_points - b.total_points)

  let position = 1
  let previousPoints = null

  return sorted.map((student, index) => {
    if (student.total_points !== previousPoints) {
      position = index + 1  // Standard competition ranking
    }
    previousPoints = student.total_points

    return { ...student, class_position: position }
  })
}
```

**Tied positions — standard competition ranking:**
If students rank 3rd and 3rd (both have the same aggregate), the next student is ranked **5th** — not 4th. There is no 4th position. This matches ECZ convention.

**Example:**
```
Position 1: Kunda Zulu        — 8 points (A, A, B, A = 1+1+2+1)
Position 2: Grace Mwale       — 10 points
Position 3: Chanda Bwalya     — 12 points  ← Tied
Position 3: Peter Banda       — 12 points  ← Tied
Position 5: Mary Phiri        — 14 points  ← Skips 4
Position 6: John Zulu         — 15 points
```

Class size (38 in this example) is stored alongside the position so the report card shows "Position 3 of 38."

### Recalculation

Positions are recalculated each time a mark is updated (before results are published). After the last mark is entered for a class, the principal clicks "Calculate Positions" to finalise. This triggers a batch calculation for all students in the class.

---

## Subject Completeness Check

Before the principal can calculate positions or publish results, a completeness check runs:

```
Results Completeness — Grade 9A · Term 2 2026

✅ Mathematics:       38 of 38 students marked
✅ English Language:  38 of 38 students marked
✅ Biology:           38 of 38 students marked
⚠️ Chemistry:         35 of 38 students marked (3 missing)
   Missing: Chanda Bwalya, Peter Banda, Mary Phiri
❌ Physics:            0 of 38 students marked (not started)

Cannot publish until all subjects are complete.
[Dismiss — continue entering marks]
```

The principal sees this check on the Results dashboard. They can dismiss it and continue — it is informational, not blocking until they attempt to publish.

---

## Offline Marks Entry on Mobile

Marks entry on the mobile app uses PowerSync offline capability — the same mechanism as attendance. Teachers can enter marks without internet and sync when connectivity returns.

**What syncs to the teacher's device for marks entry:**
- `exam_results` rows for their assigned subjects and classes (current and previous term)
- `students` rows for their assigned classes (same as attendance sync)
- `school_grading_scales` rows for the school (needed for real-time grade display)
- `school_subjects` rows for the school

**Conflict resolution for marks:**
If a teacher enters marks offline and an admin updates the same marks online before sync:
- Standard competition: last `local_created_at` wins (same as attendance)
- If results have been published online while the teacher was offline: the offline marks are rejected with a clear error — "Results have been published for this class. Your offline marks for [N] students could not be saved. Contact your principal."

---

## Historical Results Access

All results — published and unpublished — are accessible to authorised roles based on RLS policies. Parents and students see only published results.

**Results history by academic year:**
Teachers, admins, and principals can view results from all previous terms and years. Useful for tracking student progress and academic trends. The results tab on a student's profile shows their complete marks history across all terms.

---

## Business Rules

1. Teachers can only enter and edit marks for their assigned subjects and classes. RLS enforces this at the database level.
2. Marks cannot be entered or updated after `results_published = TRUE` for that term and class. The RLS UPDATE policy enforces this for teacher-level roles.
3. The `marks_total` field defaults to 100. It can be changed per subject per term before marks are entered. Changing it after marks are entered triggers a recalculation of all grade letters for that subject.
4. Class positions use standard competition ranking — tied students share a position and the next position number skips. This matches ECZ convention.
5. Teacher comments on report cards are optional. Blank comments are acceptable and do not block report card generation.
6. Offline marks entry is supported on mobile via PowerSync. If results are published online while the teacher is offline, their offline marks are rejected on sync with a clear error message.
7. The examination number (`examination_number`) is displayed in the marks entry screen for examination classes (Grade 6, Form 4, Form 6) to help teachers cross-reference physical mark sheets with candidate numbers.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 11 results module documentation |
| 2026-04-26 | Added offline marks entry via PowerSync | Confirmed mobile marks entry with offline capability |
| 2026-04-26 | Confirmed standard competition ranking | Tied positions skip next number — ECZ convention |
| 2026-04-26 | Teacher comments optional | Required comments would delay generation for large schools |
| 2026-04-26 | Added examination_number in marks entry screen | Cross-reference with physical candidate mark sheets |
