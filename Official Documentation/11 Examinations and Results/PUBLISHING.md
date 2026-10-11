# PUBLISHING.md — Results Publication Workflow

## Related Documents

- `docs/modules/results/RESULTS.md` — marks entry before publication
- `docs/modules/results/GRADING.md` — grade calculation finalised on publication
- `docs/modules/results/REPORT_CARDS.md` — report card generation triggered by publication
- `docs/modules/results/BULK_GENERATION.md` — bulk PDF generation process
- `docs/modules/attendance/ATTENDANCE.md` — attendance summary included in report card
- `docs/DATABASE.md` — exam_results results_published field
- `docs/RLS.md` — published status affects teacher UPDATE policy
- `docs/api/ENDPOINTS.md` — POST /api/results/publish route

---

## Implementation Status (2026-10-11)

**Built**, including the correction path, which is the part most likely to be
misunderstood.

`publish_results()` is one-way: a result a parent has seen can be **corrected** but never
withdrawn. Correcting one goes through `unlock_result_for_correction()` (`0124`/`0172`),
which records the reason, and `relock_corrected_result()` closes it again.

**The unlock is granular to a single result on purpose.** Unlocking a whole class
mid-correction would silently withdraw every other mark from the parents already reading
them, so the control is offered per pupil and never per class.

Two defects were found here by walking the screen rather than by any automated check: the
mark input stayed `disabled` after a correction was unlocked, so the correction could not
be typed; and the Save button was hidden whenever any row was published, so the only
control that could save a correction disappeared exactly when one became possible.

---

## Purpose

This document defines the complete results publication workflow — the pre-publication checklist, what happens at the moment of publication, how the marks lock works, how parents and students access published results, and how post-publication corrections are handled. Every Claude Code session building any results publication feature must read this document.

---

## Overview

Publication is the moment when results transition from the school's internal working data to the official academic record visible to parents and students. It is a deliberate, irreversible action initiated by the principal. Once published, marks are locked and the data becomes trusted by parents and students as the school's official position.

Publication and report card generation are **two separate actions** with two separate buttons. The principal decides the order — publish first then generate, or generate then publish, or both simultaneously via the combined action. This gives flexibility: a principal may want to generate a preview report card before making results public, or they may want to publish results immediately and generate report cards separately.

---

## Pre-Publication Checklist

When the principal opens Results → [Term] → Publish Results, a checklist runs automatically:

```
Pre-Publication Checklist — Term 2, 2026

Marks completeness:
✅ Grade 7A: All 38 subjects × students complete
✅ Grade 7B: All 36 subjects × students complete
✅ Grade 8A: All 40 subjects × students complete
⚠️ Grade 9B: Chemistry missing for 3 students
   [View missing marks]

Positions calculated:
✅ Grade 7A: Positions calculated (38 students)
✅ Grade 7B: Positions calculated (36 students)
❌ Grade 8B: Positions not yet calculated
   [Calculate now]

Report cards:
○ Not yet generated — can be generated after publishing

Principal's comment:
○ Not yet entered — results will publish without a principal's comment
  [Add comment now]
```

The checklist distinguishes between **blockers** (missing marks, uncalculated positions) and **warnings** (no principal comment, report cards not generated). Warnings can be dismissed — the principal can publish without a principal's comment or without pre-generating report cards.

---

## The Publication Action

The principal sees two buttons:

```
┌─────────────────────────────────────────────────────────────┐
│  Ready to publish Term 2, 2026 results?                     │
│                                                             │
│  412 students · 12 classes · All marks complete            │
│                                                             │
│  [Publish Results]        [Publish + Generate Report Cards] │
│                                                             │
│  Note: Published results cannot be edited without your     │
│  explicit unlock. Positions will be finalised.             │
└─────────────────────────────────────────────────────────────┘
```

### Button 1 — "Publish Results"

Marks results as published. Does NOT generate report cards.

```
1. Confirmation modal:
   "Publish Term 2, 2026 results for all 412 students?
    Marks will be locked. Parents and students will see results immediately."
   [Confirm]   [Cancel]

2. On confirm — API call: POST /api/results/publish
   Body: { academic_year: '2026', term_number: 2 }

3. Server executes:
   UPDATE exam_results
   SET results_published = TRUE, published_at = NOW()
   WHERE school_id = schoolId
     AND academic_year = '2026'
     AND term_number = 2

4. Response: { published: 2476, students_notified: 412 }

5. In-app notification to all school staff:
   "Term 2 results published by Mrs. Phiri (Principal)"

6. Parents and students: results visible immediately in their portals

7. Audit log entry:
   { action: 'results_publish', academic_year: '2026', term_number: 2,
     records_published: 2476, published_by: principal_clerk_id }
```

### Button 2 — "Publish + Generate Report Cards"

Publishes results AND immediately queues bulk report card generation. The principal sees one confirmation and both actions execute.

```
1. Confirmation modal:
   "This will:
    ✓ Publish Term 2, 2026 results for all 412 students
    ✓ Generate 412 report card PDFs
    ✓ Make results visible to parents and students immediately

    Report card generation takes approximately 60–90 seconds."
   [Confirm]   [Cancel]

2. On confirm — two API calls in sequence:
   a. POST /api/results/publish → results locked
   b. POST /api/reports/generate → generation jobs queued

3. Principal redirected to the generation progress screen
4. Results are published (visible to parents) while generation runs
```

**The most common path in practice** will be Button 2 — principals typically want to do both at the same time at the end of term.

---

## What Happens at the Moment of Publication

### Marks Lock

`exam_results.results_published = TRUE` is set for all results records for this school, academic year, and term. The RLS UPDATE policy immediately prevents any teacher from modifying marks:

```sql
-- Teacher UPDATE policy checks results_published
CREATE POLICY "teacher_update_unpublished_results"
ON public.exam_results FOR UPDATE
USING (
  results_published = FALSE  -- ← Cannot update if TRUE
  AND entered_by_user_id = get_user_id()
  -- ...rest of policy
)
```

Teachers who try to edit marks after publication see:
```
"Results have been published for this term.
 Contact your principal to request a correction."
```

### Immediate Parent and Student Visibility

Published results appear in the parent portal and student portal immediately — no cache delay, no separate notification required to trigger visibility. The RLS SELECT policy for parents already checks `results_published = TRUE`:

```sql
CREATE POLICY "parent_read_published_results"
ON public.exam_results FOR SELECT
USING (
  student_id IN (SELECT student_id FROM student_parent_links
                 WHERE parent_user_id = get_user_id() AND is_active = TRUE)
  AND results_published = TRUE  -- ← Only visible after publication
);
```

Parents who have the portal open at the moment of publication and refresh their page see results immediately.

### In-App Notification to Parents

When results are published, an in-app notification is created for every parent with linked children at this school:

```
📊 Term 2 results are now available
Chanda Bwalya's results are ready to view.
[View results →]
```

This is free — no WhatsApp quota consumed. WhatsApp notification (with report card link) is a separate step triggered when report cards are generated and distributed.

---

## Results Visibility After Publication

### Parent Portal

The parent sees a "Results" tab on their child's profile:

```
Chanda Bwalya · Grade 9A · Term 2, 2026

RESULTS ← new badge showing results are available

Subject          Marks    Grade    Position
English Lang.    72       B        3 of 38
Mathematics      88       A
Biology          61       C
Chemistry        54       C
Physics          45       D
Geography        78       B

Aggregate: 22 points  |  Credits: 4 of 6
Class Position: 3 of 38

[Download Report Card]  ← only shown if report card has been generated
```

### Student Portal

Students see their own results with the same information. Fee balance is hidden unless the school has enabled student fee visibility.

---

## Post-Publication Corrections

After results are published, marks corrections require the principal to explicitly unlock a specific result:

### Correction Workflow

```
1. Principal opens Results → [Term] → [Class] → [Subject] → [Student]
2. Sees: "Results published — marks are locked"
3. Clicks "Request correction"
4. Enters reason: "Data entry error — correct mark is 82 not 28"
5. Confirms unlock for this specific student-subject combination only

6. Unlock is recorded in audit_logs:
   { action: 'results_unlock', student_id, subject_code,
     reason: 'Data entry error', unlocked_by: principal_id }

7. The specific result row: results_published = FALSE (temporarily)

8. Teacher can now update the mark for this student and subject

9. On saving the correction, the result is re-locked: results_published = TRUE
   And a new audit entry: { action: 'results_correction', old_mark: 28, new_mark: 82 }

10. Report card for this student is automatically flagged for regeneration:
    "Report card outdated — regenerate for Chanda Bwalya?"
    [Regenerate]
```

**Scope of unlock:** Unlocking one student's result for one subject does not unlock any other results. The unlock is granular — minimum necessary access.

**Parent notification on correction:**
When a mark is corrected and the report card regenerated, the parent receives an in-app notification:
```
"Chanda's Term 2 results have been updated by the school.
 Please re-download the latest report card."
```

---

## Partial Publication

By default, publication applies to all classes in the school for the selected term. The principal can optionally publish results for specific classes only — useful when some classes finish marking earlier than others.

```
Publish results for:
○ All classes (412 students)
● Selected classes only:
  ☑ Grade 7A (38 students) — all marks complete
  ☑ Grade 7B (36 students) — all marks complete
  ☐ Grade 9B (40 students) — missing marks (3 students)
  ☑ Form 1A (35 students) — all marks complete
  ...

[Publish selected classes]
```

Partially published results: Grade 7A parents can see their child's results while Grade 9B parents still cannot.

---

## Audit Trail

Every publication event is permanently recorded:

| Event | Logged |
|---|---|
| Results published | actor, school, academic_year, term, records_count, timestamp |
| Results unlocked for correction | actor, student_id, subject_code, reason, timestamp |
| Correction made | actor, student_id, subject_code, old_mark, new_mark, timestamp |
| Results re-locked after correction | actor, student_id, subject_code, timestamp |

These records are immutable — they cannot be deleted or modified by any user including AfriTech super admins.

---

## Business Rules

1. Publication is the principal's or owner's action — teachers, admins, and accountants cannot publish results.
2. Publication and report card generation are two separate buttons. The principal chooses whether to do them together or separately.
3. Once published, marks cannot be edited by teachers. Only the principal can unlock specific results for correction, and each unlock is logged.
4. Post-publication corrections unlock the minimum necessary scope — one student, one subject. The unlock does not cascade to other students or subjects.
5. Results are visible to parents and students immediately on publication — no separate notification is required to trigger visibility. The RLS policy uses `results_published = TRUE` as the visibility gate.
6. When a correction is made and a report card regenerated, parents are notified in-app to re-download the updated version.
7. Partial publication (publishing specific classes) is supported. Classes not yet published remain invisible to their parents until published.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 11 results module documentation |
| 2026-04-26 | Two separate buttons — Publish / Publish + Generate | Decision 3 confirmed — give principal the choice |
| 2026-04-26 | Added partial publication option | Schools complete marking at different rates per class |
| 2026-04-26 | Added granular unlock for corrections | Minimum necessary scope for post-publication corrections |
| 2026-04-26 | Immediate parent visibility on publication | RLS policy gates visibility — no separate trigger needed |
