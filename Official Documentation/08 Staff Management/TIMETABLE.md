# TIMETABLE.md — Timetable Builder and Management

## Related Documents

- `docs/modules/staff/ASSIGNMENTS.md` — assignments validate timetable slot options
- `docs/modules/staff/STAFF.md` — staff entities assigned to timetable slots
- `docs/modules/students/STUDENTS.md` — students view their class timetable
- `docs/modules/school/SCHOOL_CONFIG.md` — grade levels and subjects used in timetable
- `docs/modules/attendance/ATTENDANCE.md` — timetable informs which class to mark
- `docs/DATABASE.md` — timetables, timetable_slots, timetable_periods tables
- `docs/api/ENDPOINTS.md` — timetable API routes
- `docs/RLS.md` — timetable access policies by role

---

## Purpose

This document defines the complete timetable system — how timetables are structured, how the drag-and-drop builder works, how conflict detection prevents scheduling errors, how timetables are viewed by different user roles, and how the timetable connects to attendance and results modules. Every Claude Code session building any timetable feature must read this document.

---

## Overview

The timetable is one of the most visible features of ZSMS from the perspective of teachers, students, and parents. It answers the daily question: "Who teaches what, when, and to whom?" A well-configured timetable unlocks several downstream benefits — teachers see their schedule in the mobile app, students and parents view the weekly schedule in their portal, and the attendance module can suggest the current class based on the time of day.

The timetable is built by school admins and principals using a drag-and-drop grid interface (built in Lovable). The backend (Claude Code) handles saving, validation, conflict detection, and serving timetable data to different user roles.

---

## Database Structure

### `public.timetables`

One timetable per school per academic year per term. Multiple timetables can exist simultaneously (e.g. a regular timetable and an exam timetable), but only one is active at a time.

```sql
CREATE TABLE public.timetables (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id     UUID NOT NULL REFERENCES public.schools(id),
  academic_year TEXT NOT NULL,
  term_number   INT NOT NULL CHECK (term_number BETWEEN 1 AND 4),
  name          TEXT NOT NULL DEFAULT 'Main Timetable',
  -- E.g. 'Main Timetable', 'Exam Timetable', 'Sports Day Schedule'
  is_active     BOOLEAN DEFAULT TRUE,
  -- Only one timetable per school should be active per term
  published     BOOLEAN DEFAULT FALSE,
  -- Unpublished timetables are not visible to teachers, students, or parents
  published_at  TIMESTAMPTZ,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_timetables_school ON public.timetables(school_id, academic_year, term_number);
CREATE INDEX idx_timetables_active ON public.timetables(school_id, is_active) WHERE is_active = TRUE;
```

### `public.timetable_periods`

Defines the standard time periods for the school day. Set once by the admin and reused across all timetables. These are the row labels in the timetable grid.

```sql
CREATE TABLE public.timetable_periods (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id    UUID NOT NULL REFERENCES public.schools(id),
  period_name  TEXT NOT NULL,
  -- E.g. 'Period 1', 'Morning Break', 'Assembly', 'Lunch', 'Period 5'
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  period_order INT NOT NULL,
  -- Used for sorting rows in the timetable grid
  applies_days INT[] DEFAULT '{1,2,3,4,5}',
  -- Days this period applies: 1=Monday...5=Friday
  -- Assembly might only apply on Monday: {1}
  -- Lunch applies all days: {1,2,3,4,5}
  is_teaching_period BOOLEAN DEFAULT TRUE,
  -- FALSE for breaks, lunch, assembly — these cannot have lessons assigned
  created_at   TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(school_id, period_order)
);
```

### `public.timetable_slots`

One row per lesson slot — the intersection of a class, a period, and a day.

```sql
CREATE TABLE public.timetable_slots (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timetable_id  UUID NOT NULL REFERENCES public.timetables(id),
  school_id     UUID NOT NULL REFERENCES public.schools(id),
  class_id      TEXT NOT NULL,
  -- Which class this slot is for
  period_id     UUID NOT NULL REFERENCES public.timetable_periods(id),
  -- Which time period
  day_of_week   INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
  -- 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday
  subject_code  TEXT,
  -- NULL for free periods, assembly, or unassigned slots
  staff_user_id TEXT,
  -- Clerk user ID of the teacher — NULL if no teacher assigned yet
  slot_type     TEXT NOT NULL DEFAULT 'lesson'
                CHECK (slot_type IN ('lesson','break','assembly','free','exam')),
  room          TEXT,
  -- Optional room or venue label (e.g. 'Lab 1', 'Hall', 'Room 5')
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(timetable_id, class_id, period_id, day_of_week)
  -- One slot per class per period per day
);

CREATE INDEX idx_timetable_slots_timetable ON public.timetable_slots(timetable_id);
CREATE INDEX idx_timetable_slots_class ON public.timetable_slots(timetable_id, class_id);
CREATE INDEX idx_timetable_slots_teacher ON public.timetable_slots(timetable_id, staff_user_id);
CREATE INDEX idx_timetable_slots_day ON public.timetable_slots(timetable_id, day_of_week);
```

---

## Timetable Builder UI (Lovable)

The timetable builder is a grid interface built in Lovable for the web dashboard. Claude Code provides the API that saves and validates each change.

### Grid Layout

```
              Monday      Tuesday     Wednesday   Thursday    Friday
08:00–08:45   [7A: Maths] [7A: Eng]   [7A: Sci]   [7A: Maths] [7A: PE]
              Mr. Banda   Mrs. Phiri  Mr. Mwale   Mr. Banda   Coach K

08:45–09:30   [7A: Eng]   [7A: Maths] [7A: RE]    [7A: Sci]   [7A: Eng]
              Mrs. Phiri  Mr. Banda   Mrs. Zulu   Mr. Mwale   Mrs. Phiri

09:30–09:45   BREAK       BREAK       BREAK       BREAK       BREAK
...
```

Rows = time periods (from `timetable_periods`)
Columns = days of the week (Monday to Friday)
Each cell = one timetable slot for the selected class

The admin selects which class to view/edit using a class dropdown above the grid. Each class has its own view.

### Drag-and-Drop Behaviour

**Moving a slot:**
- Drag a filled slot cell to an empty cell
- The subject and teacher move to the new day/period combination
- Conflict check runs immediately on drop
- If conflict detected: slot snaps back to original position, conflict error shown
- If no conflict: slot saved in new position, visual update confirmed

**Swapping two slots:**
- Drag a filled slot onto another filled slot
- Both slots swap positions
- Double conflict check (both teachers validated in both new positions)
- Confirmed with a brief animation

**Adding a new slot:**
- Click an empty cell
- A side panel opens:
  ```
  Add lesson for [Class] · [Day] · [Period]

  Subject: [dropdown — school's configured subjects for this grade level]
  Teacher: [dropdown — teachers assigned to this subject for this class
            via teacher_assignments]
  Room: [text — optional]
  Notes: [text — optional]

  [Add Lesson]   [Cancel]
  ```
- Teacher dropdown only shows teachers with a matching assignment — cannot assign an unrelated teacher

**Clearing a slot:**
- Click a filled slot → side panel opens with current details
- Click "Clear slot" → slot becomes empty (slot_type = 'free')

---

## Conflict Detection

Conflict detection runs on every slot save (insert or update). The check is simple: can this teacher be in two places at the same time?

```typescript
// API route: PATCH /api/timetable/slots/[slotId]
async function checkTeacherConflict(
  timetableId: string,
  staffUserId: string,
  dayOfWeek: number,
  periodId: string,
  excludeSlotId: string   // The slot being updated — exclude from conflict check
): Promise<boolean> {
  const { data: conflict } = await supabase
    .from('timetable_slots')
    .select('id, class_id')
    .eq('timetable_id', timetableId)
    .eq('staff_user_id', staffUserId)
    .eq('day_of_week', dayOfWeek)
    .eq('period_id', periodId)
    .neq('id', excludeSlotId)
    .single()

  return !!conflict
}
```

**Conflict error response:**
```json
{
  "error": "Mr. Banda is already teaching Grade 9B Mathematics at this time",
  "code": "TEACHER_CONFLICT",
  "details": {
    "conflicting_class": "grade_9b",
    "conflicting_subject": "mathematics",
    "teacher_name": "Mr. Banda"
  }
}
```

The UI shows this inline on the cell that triggered the conflict, highlighted in red. The slot is not saved.

---

## Period Configuration

Before building a timetable, the school configures their standard school day periods. This is done once in Settings → Timetable → School Day.

**Example period configuration for a typical Zambian secondary school:**

| Order | Period Name | Start | End | Teaching? | Days |
|---|---|---|---|---|---|
| 1 | Assembly | 07:30 | 07:45 | No | Monday only |
| 2 | Period 1 | 07:45 | 08:30 | Yes | All |
| 3 | Period 2 | 08:30 | 09:15 | Yes | All |
| 4 | Morning Break | 09:15 | 09:30 | No | All |
| 5 | Period 3 | 09:30 | 10:15 | Yes | All |
| 6 | Period 4 | 10:15 | 11:00 | Yes | All |
| 7 | Lunch | 11:00 | 12:00 | No | All |
| 8 | Period 5 | 12:00 | 12:45 | Yes | All |
| 9 | Period 6 | 12:45 | 13:30 | Yes | All |
| 10 | Period 7 | 13:30 | 14:15 | Yes | All |
| 11 | End of Day | 14:15 | 14:30 | No | All |

Non-teaching periods (breaks, assembly, lunch) appear as non-editable shaded rows in the timetable grid.

---

## Publishing a Timetable

Timetables are built in draft mode. Teachers, students, and parents cannot see a draft timetable. When ready, the admin publishes:

```
Admin clicks Publish Timetable

Pre-publish validation:
✅ All classes have at least one lesson per day
⚠️ Grade 9A has no teacher assigned for Chemistry on Wednesday
❌ Mr. Banda appears in two simultaneous slots (conflict not yet resolved)

[Publish anyway]   [Fix issues first]
```

On publish:
- `timetables.published = TRUE`, `published_at = NOW()`
- All teachers whose slots are in this timetable receive notification: "Your timetable for Term 2 is now available"
- Students and parents can view their class timetable in their portal
- The active timetable badge appears on the school dashboard

---

## Timetable Views by Role

### Admin / Principal View
Full timetable management — build, edit, publish, view by class or by teacher.

**By class:** Select a class from dropdown, see that class's full week grid.
**By teacher:** Select a teacher, see all their slots across all classes for the week — their personal schedule.

### Teacher View (Web and Mobile)
Read-only view of their own slots only. Shown as a personal schedule:

```
My Timetable — Week of 15 Sep 2026

Monday:
  07:45–08:30  Grade 9A · Mathematics · Room 3
  08:30–09:15  Grade 7B · Mathematics · Room 3
  09:30–10:15  Grade 8A · Mathematics · Room 3

Tuesday:
  07:45–08:30  Grade 7A · Mathematics · Room 3
  ...
```

On the mobile app, the teacher's current period is highlighted based on device time. When they open Attendance, the system suggests the class for the current period.

### Student View (Web and Mobile)
Read-only view of their class timetable. Shown as a weekly grid or list view. Displays subject name, teacher name, and room.

### Parent View (Web and Mobile)
Same as student view — read-only weekly schedule for their linked child's class. Useful for parents planning pickups, knowing which teacher's class their child is in at any given time.

---

## Timetable Versioning

Each term has its own timetable record. Historical timetables are preserved — a parent can view their child's timetable from Term 1 even after Term 2's timetable is active. Historical timetables are read-only after the term ends.

When copying a timetable to a new term:

```
Admin clicks New Term → Copy from Term 1

All timetable_slots rows are duplicated with the new timetable_id.
Staff assignments are validated — if a teacher's assignment changed,
their slots are flagged for review.
```

---

## Timetable as a Feature Add-On

The timetable module is available as a base feature on Growth tier and above. Starter tier schools see a "Timetable — upgrade to Growth" prompt instead of the builder.

It can also be purchased as a standalone add-on by Starter tier schools:
- Monthly add-on: K100/month

This is tracked in the `module_subscriptions` table:
```sql
INSERT INTO module_subscriptions (school_id, module_name, status, billing_amount)
VALUES (school_id, 'timetable', 'active', 100.00);
```

---

## Business Rules

1. A timetable slot can only assign a teacher who has a matching entry in `teacher_assignments` for that subject and class. The teacher dropdown enforces this — unassigned teachers are not shown.
2. A teacher cannot be assigned to two simultaneous slots (same day, same period, same timetable). The conflict check runs on every save.
3. Non-teaching periods (breaks, assembly, lunch) cannot have lessons assigned. The slot_type check enforces this.
4. Only published timetables are visible to teachers, students, and parents. Draft timetables are visible to admins and principals only.
5. Only one timetable per school per term can be marked `is_active = TRUE` at a time. Publishing a new timetable automatically marks the previous one as inactive.
6. Timetable data is read-only on PowerSync for mobile — teachers cannot edit the timetable from their phone, only view it.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 8 staff module — timetable confirmed as core feature |
| 2026-04-26 | Added timetable_periods table | Schools need configurable school day structure |
| 2026-04-26 | Added feature add-on pricing | Timetable is Growth tier base feature or Starter add-on |
| 2026-04-26 | Added conflict detection with error response | Teacher double-booking prevention |

---

## Implementation notes (2026-10-05)

Built across `0197` (tables, clash indexes), `0200` (read and edit) and `0201`
(creating a timetable, defining the school day). Three departures from the DDL above,
each because the schema had already decided otherwise:

| This document | Built | Why |
|---|---|---|
| `timetable_slots.subject_code TEXT` | `subject_id UUID` | Every other table referencing a subject uses the id. A code here would have no referential integrity and would not follow a rename. |
| `checkTeacherConflict()` in TypeScript | Partial unique indexes | A SELECT before writing is a race: two deputies dragging at the same moment both read "clear" and both write. An index cannot be raced and cannot be skipped by a caller that forgets. |
| Teacher conflicts only | Teacher **and room** | A room is as physical as a teacher, and a school with one laboratory needs this more. |

`set_timetable_slot()` catches the unique violation and composes the message — the index
guarantees correctness, the function supplies the explanation a deputy can act on.

**Publishing reports unstaffed lessons rather than refusing one.** A lesson with no
teacher is a normal state in the week before term.

**Deleting a period is refused while lessons sit in it.** The foreign key cascades, so
deleting would silently take every lesson in that period across every timetable.

Surfaces: `/school/[code]/timetable` (builder), `/school/[code]/my-timetable`,
`/parent/timetable`, and both mobile apps.

### Change Log

| Date | Change |
|---|---|
| 2026-10-05 | Implemented. Three departures from the DDL recorded above. |
| 2026-10-05 | **Guided setup, popups, and drag-and-drop.** The builder presented creating a timetable, defining the day and filling the grid as three equal buttons, when the order between them is strict — a period cannot exist without a timetable and a lesson cannot exist without a period. It is now a four-step sequence with each step's state derived from the data rather than stored, so a school that deletes every period correctly returns to step two. Both forms moved into modals (`components/ui/dialog.tsx`): the create form pushed the grid down the page, and the period form opened below a list that was already tall. The school day was one full row per period — twelve periods meant twelve rows of whitespace and a grid off the bottom of the screen — and is now a single horizontal strip of chips in time order, with only the exceptions labelled. **New:** `PATCH /api/school/timetable` takes `move` and `checkMove`, over `move_timetable_slot()` and `timetable_move_conflicts()` (`0208`/`0209`). A lesson can be dragged to an empty cell or onto another to exchange the two; the screen asks what the drop would break and offers Cancel, and says plainly that a teacher or room clash cannot be overridden because a unique index refuses it regardless of what this screen offers. A swap trades the two lessons' payloads rather than their positions, because two rows cannot exchange a unique key without colliding — see the `0209` entry in `MIGRATIONS.md`. |
