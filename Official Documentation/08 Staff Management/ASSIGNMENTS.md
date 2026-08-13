# ASSIGNMENTS.md — Class and Subject Assignments

## Related Documents

- `docs/modules/staff/STAFF.md` — staff entity reference
- `docs/modules/staff/INVITATIONS.md` — assignment during invitation
- `docs/modules/staff/TIMETABLE.md` — timetable uses assignments for validation
- `docs/modules/attendance/ATTENDANCE.md` — RLS uses assignments to scope teachers
- `docs/modules/results/RESULTS.md` — RLS uses assignments to scope marks entry
- `docs/infra/POWERSYNC.md` — sync rules use assignments to scope offline data
- `docs/DATABASE.md` — staff_assignments table
- `docs/RLS.md` — teacher RLS policies based on assignments

---

## Purpose

This document defines the staff assignment system — how teachers are assigned to classes and subjects, the assignment matrix UI, how assignments scope what teachers can see and do across attendance, results, and the mobile app. Every Claude Code session building any feature that reads `staff_assignments` must read this document.

---

## Overview

Staff assignments are the mechanism that scopes a teacher's access to the correct data. They answer the question: "Which classes and subjects does this teacher own?" The answer drives four critical system behaviours:

1. **RLS policies** — teachers can only mark attendance for their assigned classes and enter marks for their assigned subjects
2. **PowerSync sync rules** — only the teacher's assigned students and their data sync to their mobile device
3. **Timetable validation** — subjects can only be placed in timetable slots for teachers assigned to teach them
4. **Mobile app views** — the attendance and marks entry screens show only the teacher's assigned classes and subjects

---

## The `staff_assignments` Table

```sql
CREATE TABLE public.staff_assignments (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID NOT NULL REFERENCES public.schools(id),
  staff_user_id   TEXT NOT NULL,       -- Clerk user ID of the teacher
  class_id        TEXT NOT NULL,       -- Class this assignment applies to
                                       -- Special value: 'ALL' = all classes in the school
  subject_code    TEXT NOT NULL,       -- Subject from school_subjects
                                       -- Special value: 'ALL' = all subjects
  is_class_teacher BOOLEAN DEFAULT FALSE,
  -- Class teacher (form teacher) has additional responsibilities for this class.
  -- Only one staff member should be class teacher per class_id per academic year.

  academic_year   TEXT NOT NULL,       -- '2026'
  term_number     INT,                 -- NULL = applies to all terms
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(school_id, staff_user_id, class_id, subject_code, academic_year)
);
```

### Special Values

**`class_id = 'ALL'`:** The teacher teaches this subject across all classes. Used for specialist teachers (e.g. a music teacher or ICT teacher who rotates through all classes).

**`subject_code = 'ALL'`:** The teacher is assigned to all subjects for this class. Used for primary school class teachers who teach all subjects to one class.

### Assignment Examples

**Primary school class teacher (teaches all subjects to Grade 2B):**
```sql
INSERT INTO staff_assignments (staff_user_id, class_id, subject_code, is_class_teacher, academic_year)
VALUES ('teacher_user_id', 'grade_2b', 'ALL', TRUE, '2026');
```

**Secondary school subject teacher (teaches Mathematics to three classes):**
```sql
INSERT INTO staff_assignments (staff_user_id, class_id, subject_code, academic_year)
VALUES
  ('teacher_user_id', 'grade_9a', 'mathematics', '2026'),
  ('teacher_user_id', 'grade_9b', 'mathematics', '2026'),
  ('teacher_user_id', 'form_1a', 'mathematics', '2026');
```

**Specialist teacher (ICT across all classes):**
```sql
INSERT INTO staff_assignments (staff_user_id, class_id, subject_code, academic_year)
VALUES ('teacher_user_id', 'ALL', 'ict_secondary', '2026');
```

---

## The Assignment Matrix UI

The admin manages assignments through a visual matrix in Staff → [Teacher Name] → Assignments, or from the school-wide view in Staff → Assignments Overview.

### Per-Teacher Matrix

Rows are the school's configured subjects. Columns are the school's configured classes. Each cell is a checkbox — checked means this teacher is assigned to teach this subject to this class.

```
                    Grade 7A  Grade 7B  Grade 8A  Grade 8B  Form 1A
Mathematics           ✅        ✅        ☐         ☐         ✅
English Language      ☐         ☐        ☐         ☐         ☐
Physics               ☐         ☐        ✅         ✅        ☐
[Class Teacher]       ★         ☐        ☐         ☐         ☐
```

The star icon marks the class teacher assignment. Clicking a star deselects any existing class teacher for that column and sets the new one.

**Saving:** Changes are saved incrementally — each checkbox change is immediately saved to the database. No "Save" button required. A loading spinner briefly appears on the cell that was changed. Failed saves show a red indicator with retry option.

### School-Wide Assignments Overview

An alternative view showing the full school timetable of assignments:

```
Class        Subject           Teacher
Grade 7A     Mathematics       Mr. Banda
Grade 7A     English Language  Mrs. Phiri
Grade 7A     Science           Mr. Mwale
Grade 7A     [Class Teacher]   Mr. Banda
Grade 7B     Mathematics       Mr. Banda
...
Unassigned:  Grade 9A · Chemistry  ← highlight classes with no teacher assigned
```

Unassigned subject-class combinations are highlighted to help admins identify gaps before the term starts.

---

## Assignment Validation

### Teacher Conflict Detection

The assignment system does not prevent a teacher from being assigned to two classes for the same subject — that is normal and expected. However, the **timetable** system will detect conflicts if the same teacher is scheduled for two simultaneous slots. Assignments define possibility; the timetable defines actuality.

### Subject Must Exist

A teacher can only be assigned to subjects in the school's configured `school_subjects` list. Assigning to a subject not in the school's list returns a `VALIDATION_ERROR`.

### Class Must Exist

A teacher can only be assigned to classes in the school's configured `school_grade_levels`. Assigning to a class not configured returns a `VALIDATION_ERROR`.

### Only One Class Teacher Per Class

The system enforces a single class teacher per class per academic year. Attempting to set a second class teacher for a class that already has one shows a confirmation:

```
⚠️ Grade 7A already has a class teacher: Mr. Banda
   Do you want to replace Mr. Banda as class teacher with Mrs. Phiri?
   [Yes, replace]   [Cancel]
```

---

## How Assignments Drive RLS Policies

The `staff_assignments` table is the foundation for teacher-scoped RLS policies on attendance and results:

```sql
-- Teacher can only mark attendance for their assigned classes
CREATE POLICY "teacher_read_own_class_attendance"
ON public.attendance_records FOR SELECT
USING (
  get_user_role() = 'org:teacher'
  AND class_id IN (
    SELECT class_id FROM public.staff_assignments
    WHERE staff_user_id = get_user_id()
      AND (class_id = attendance_records.class_id OR class_id = 'ALL')
      AND academic_year = attendance_records.academic_year
      AND is_active = TRUE
  )
);

-- Teacher can only enter marks for their assigned subjects
CREATE POLICY "teacher_insert_results"
ON public.exam_results FOR INSERT
WITH CHECK (
  get_user_role() = 'org:teacher'
  AND (
    subject_code IN (
      SELECT subject_code FROM public.staff_assignments
      WHERE staff_user_id = get_user_id()
        AND (class_id = exam_results.class_id OR class_id = 'ALL')
        AND (subject_code = exam_results.subject_code OR subject_code = 'ALL')
        AND academic_year = exam_results.academic_year
        AND is_active = TRUE
    )
    OR has_permission_grant('results', 'write')
  )
);
```

---

## How Assignments Drive PowerSync Sync Rules

PowerSync uses the assignments table to determine what data syncs to each teacher's mobile device. Only the teacher's assigned students and their records sync:

```sql
-- Students sync rule: only students in assigned classes
SELECT s.* FROM students s
JOIN class_enrolments ce ON ce.student_id = s.id
JOIN staff_assignments sa ON sa.class_id = ce.class_id
  OR sa.class_id = 'ALL'
WHERE sa.staff_user_id = token_parameters.user_id
  AND sa.academic_year = extract(year from current_date)::text
  AND sa.is_active = TRUE
  AND s.school_id = token_parameters.school_id;
```

This means a teacher's device only has data for their students — not the entire school. Privacy by design, and also practical — a school with 800 students should not sync all 800 to every teacher's device.

---

## Mid-Year Assignment Changes

When a teacher's assignments change mid-year (e.g. a teacher leaves and another takes over their class):

```
1. Admin opens old teacher's assignments → unchecks the class/subject
2. Admin opens new teacher's assignments → checks the class/subject
3. Changes take effect immediately for web access (RLS reads live)
4. PowerSync: next sync removes old data from old teacher's device,
   adds new class data to new teacher's device
5. Historical records (attendance and marks already entered) retain the
   original teacher's user_id — they are not reassigned
6. New teacher can enter marks going forward for that subject/class
7. Audit log entries written for both the unassignment and new assignment
```

**Impact on marks already entered:**
Marks entered by the previous teacher are preserved and attributed to that teacher. The new teacher can see these marks (they are in the same `exam_results` rows for the class) and can enter new marks. There is no merge or transfer of authorship.

---

## Academic Year Rollover

At the start of each academic year, assignments need to be recreated or rolled over. The system provides a rollover option:

```
Admin opens Staff → Assignments → Year-End Rollover
"Copy all current assignments to 2027?"
[Copy Assignments]   [Start Fresh]
```

Copying assignments creates identical rows with the new academic year. The admin then adjusts for any staff changes (new teachers, departing teachers, subject changes). Starting fresh clears all assignments and the admin builds from scratch.

---

## Business Rules

1. A teacher with no assignments can log in but sees an empty dashboard with the message "No classes assigned. Contact your school admin to set up your assignments."
2. The `class_id = 'ALL'` and `subject_code = 'ALL'` special values expand to all currently active classes and subjects at the school. Deactivating a class or subject does not retroactively remove assignment rows — the expansion simply excludes deactivated items.
3. Assignments are per academic year. Marking `is_active = FALSE` deactivates an assignment without deleting it, preserving the assignment history.
4. The class teacher flag (`is_class_teacher = TRUE`) gives no additional system permissions by default. It is used only for display purposes (the class teacher's name appears on report cards) and for the class teacher notification list.
5. Changes to assignments take effect immediately for web-based access. Mobile app PowerSync sync may take up to 60 seconds to reflect assignment changes.
6. Only one class teacher per class per academic year is enforced by the application layer. The database does not have a unique constraint on this because `is_active` changes make a unique constraint impractical.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 8 staff module documentation |
| 2026-04-26 | Added special values ALL for class_id and subject_code | Primary school teachers and specialist teachers |
| 2026-04-26 | Added PowerSync sync rule connection | Confirmed offline data scoping via assignments |
| 2026-04-26 | Added timetable validation connection | Confirmed assignments gate timetable slot options |
