# ATTENDANCE.md — Attendance Recording

## Related Documents

- `docs/modules/attendance/OFFLINE_SYNC.md` — PowerSync offline attendance on mobile
- `docs/modules/attendance/TRIGGERS.md` — database trigger on absent record insert
- `docs/modules/attendance/NOTIFICATIONS.md` — parent notification flow
- `docs/modules/staff/ASSIGNMENTS.md` — class assignments that scope teacher access
- `docs/modules/staff/TIMETABLE.md` — timetable integration with attendance
- `docs/modules/students/STUDENTS.md` — student records linked to attendance
- `docs/DATABASE.md` — attendance_records table
- `docs/RLS.md` — attendance RLS policies
- `docs/infra/POWERSYNC.md` — offline sync for mobile attendance

---

## Implementation Status (2026-10-11)

**The web register is built** — `/school/[code]/attendance`, with the pgTAP suite
`attendance_register_test` behind it. Marking, editing with a reason, and the audit of who
changed what all work through `attendance_records` and RLS; there is no RPC, by design.

**The parent view is built** — `/parent/attendance`.

**The mobile app IS built** — and the first version of this status block said it was not,
having trusted `CLAUDE.md`'s "no mobile screens" line instead of looking. There are 27
screens: a teacher tab group with the class list and the register marking screen
(`register/[classId].tsx`), and a parent tab group with its own attendance view.

A teacher can mark a register on a phone, end to end, today.

**Online only, and the screens say so.** `lib/api.ts` returns an `OFFLINE` code and the
register answers it with "No connection, so nothing was saved. Your marks are still here —
try again when you have signal." That wording is deliberate: implying the marks were
stored is the one failure that loses a register.

**Offline capture is deferred by decision, not oversight.** PowerSync is not licensed, so
the build is online-only until it is — see `OFFLINE_SYNC.md`. The schema is already shaped
for it: `sync_source` and `local_created_at` exist on every row.

---

## Purpose

This document defines the complete attendance system — how attendance is marked, by whom, through which interface, what statuses are available, how the school-wide view works, how historical records are accessed, and what rules govern editing past records. Every Claude Code session building any attendance feature must read this document.

---

## Overview

Attendance in ZSMS follows a deliberate UX philosophy: **default all present, mark exceptions only**. A class of 40 students starts as 100% present. The teacher taps only the students who are absent or late. This reduces the marking time to under 90 seconds for a full class and makes the mobile offline experience practical.

Teachers mark attendance primarily through the mobile app. Admins and principals can view and correct attendance through the web dashboard. Parents see their child's attendance in the portal and receive monthly summaries.

---

## Attendance Statuses

| Status | Code | Meaning | Notification Triggered |
|---|---|---|---|
| Present | `present` | Student attended the full lesson/day | None |
| Absent | `absent` | Student did not attend | Yes — triggers parent notification queue |
| Late | `late` | Student arrived after the start time | Optional — configurable per school |
| Excused | `excused` | Absent with a valid reason | None — excuse recorded |
| Holiday | `holiday` | School holiday or event — no attendance expected | None |

**Excused absences:** The teacher or admin records the excuse reason (e.g. "Medical appointment — note submitted", "Family bereavement"). Excused absences appear in reports but are visually distinguished from unexcused absences.

**Holiday marking:** When a school configures a public holiday or school event, the admin can mark all classes as `holiday` in bulk for that date. This prevents the attendance system from showing unexplained absences on non-school days.

---

## Primary Interface — Mobile App (Teacher)

The mobile app is the primary attendance marking interface. It is designed for speed — a teacher marking attendance for 40 students while standing in front of the class.

### Mobile Attendance Flow

```
1. Teacher opens ZSMS mobile app
2. Taps "Attendance" in the bottom navigation
3. Class selector shows today's classes (from timetable — current period highlighted)
   If no timetable configured: shows all assigned classes
4. Teacher selects the class: "Grade 9A"
5. Attendance screen loads:
   - All 38 students listed alphabetically with photos (if uploaded)
   - All students default to PRESENT (green checkmark)
   - Today's date shown at top
6. Teacher taps students who are ABSENT — status toggles to red X
7. Teacher taps students who are LATE — status toggles to yellow clock
8. For LATE students: arrival time can be entered (optional)
9. For ABSENT students: teacher can add a quick note (optional)
10. Teacher taps SAVE
11. Confirmation: "Attendance saved · 36 present · 2 absent"
12. If offline: "Saved locally — will sync when connected"
```

### Marking Cycle

```
Present (default) → tap once → Absent
Absent → tap once → Late
Late → tap once → Present
```

Three-state toggle. Cycling back to Present clears any absent/late markers. Simple, fast, no dropdown menus.

### Timetable Integration on Mobile

When a timetable is published, the attendance screen suggests the current class based on device time:

```
📅 Thursday 15 Sep 2026 · Period 2 (08:30–09:15)
Grade 9A — Mathematics
[Mark Attendance for this class]
```

The teacher confirms and the attendance screen loads for Grade 9A. If the teacher teaches multiple classes in the same period (unusual but possible), they see all current-period classes and select which one to mark.

---

## Secondary Interface — Web Dashboard (Admin/Principal)

The web dashboard provides a richer attendance view with more management capabilities. Teachers can also access it but see only their own class data (same as mobile).

### Class Attendance Sheet (Admin/Principal)

**Location:** Attendance → Class View → [Select Class] → [Select Date]

A grid showing all students in the class for the selected date with their status. Admins and principals can:
- Edit any student's status directly
- Add an excuse reason
- Mark the entire class as holiday with one click
- Export the day's attendance as CSV or PDF

### School-Wide Daily Overview (Principal)

**Location:** Attendance → Daily Overview → [Select Date]

```
School Attendance Overview — Thursday 15 September 2026

Overall Rate: 94.2% present (387 of 411 active students)

By Grade:
Grade 7:   98% (49/50)  ✅
Grade 8:   95% (57/60)  ✅
Grade 9:   91% (41/45)  ⚠️
Grade 10:  90% (54/60)  ⚠️
Form 1:    96% (48/50)  ✅
...

Classes not yet marked:
⚠️ Grade 8B — Mr. Phiri (pending)
⚠️ Form 2A — Mrs. Mwale (pending)

[Send reminder to unmarked class teachers]
```

The "not yet marked" list is critical — it tells the principal which teachers have not submitted attendance for the day by a configured cutoff time (default: 10:00am). A reminder notification can be sent to those teachers in one click.

### Student Attendance History

**Location:** Attendance → Students → [Search Student] → Attendance Tab

```
Chanda Bwalya — Grade 9A
Attendance Summary: Term 2, 2026

Total school days:    45
Present:              40 (88.9%)
Absent:               4 (8.9%)
Late:                 1 (2.2%)
Excused:              0

Monthly Breakdown:
July:   Present 15/16 · Absent 1
August: Present 18/20 · Absent 2
Sep:    Present 7/9  · Absent 1 · Late 1

Detailed Record: [Show all 45 days]
```

### Term Attendance Report (Printable)

Generated by the principal at end of term. Shows every student's attendance record for the term — suitable for inclusion in report cards or parent-teacher meeting preparation.

---

## Attendance Rules

### Who Can Mark Attendance

| Role | Can Mark | Scope |
|---|---|---|
| Teacher | Yes | Own assigned classes only |
| Admin | Yes | Any class at the school |
| Principal | Yes | Any class at the school |
| Owner | Yes | Any class at the school |
| Custom role with grant | Yes | Within grant scope |
| Parent | No | — |
| Student | No | — |

### Editing Past Attendance

Teachers can edit attendance they recorded on the **same day only** within a configurable cutoff time (default: end of school day, typically 17:00). After the cutoff, only admins and principals can edit.

Admins and principals can edit attendance for any past date. Every edit is logged in the audit trail with:
- Who made the change
- The original status
- The new status
- The reason (required for editing past records)
- The timestamp of the edit

### Duplicate Prevention

The unique constraint `UNIQUE(school_id, student_id, attendance_date)` prevents two records for the same student on the same day. If a teacher attempts to mark attendance for a class that has already been marked (e.g. a substitute teacher marking attendance after the regular teacher already did), the system shows:

```
⚠️ Attendance for Grade 9A on 15 Sep was already recorded by Mr. Banda at 08:47am.
   Do you want to update the existing records?
   [View existing records]   [Update]   [Cancel]
```

Selecting "Update" opens the existing records for review and editing rather than creating new duplicate rows.

---

## Attendance Reports

### Class Attendance Report

Generated per class for a date range. Shows:
- Each student's day-by-day attendance status
- Totals per student
- Class average attendance rate
- Students with below-threshold attendance (configurable — default 85%)

### School Attendance Summary Report

Generated for the full school for a term. Shows:
- Grade-by-grade attendance rates
- Top absentees (students with most absences)
- Day-by-day school attendance rate (trend chart)
- Teacher attendance marking compliance (% of days marked on time)

Both reports are available in PDF and CSV formats from Reports → Attendance.

### Day-by-day trend — BUILT 2026-10-18 (partial)

The *School Attendance Summary* above specifies "day-by-day school attendance rate
(trend chart)". The **data function and the dashboard chart exist**; the PDF/CSV
report around them does not.

**`public.school_attendance_trend(p_days INT DEFAULT 14)`** (migration `0274`) returns
one row per day that has a marked register, within a window clamped to 1–90 days:

| Column | Meaning |
|---|---|
| `out_date` | the register date |
| `out_present` / `out_late` / `out_absent` / `out_excused` / `out_holiday` | one count per status |

Three properties of it are load-bearing:

1. **`SECURITY INVOKER`, with no `school_id` clause of its own.** RLS is the
   authorisation, exactly as for `search_everything()` (ADR-aligned with `0266`). A
   class teacher therefore gets their classes and a head teacher gets the school, and
   **two people at one school legitimately see different numbers**. Flipping it to
   `SECURITY DEFINER` would return every school's attendance to every caller with no
   other symptom, because the rows it reads are the same rows —
   `attendance_register_test` asserts it is INVOKER for that reason.
2. **`holiday` is returned as its own count and never folded into absence.** A closed
   day is not a day of total absence. `/api/school/overview` drops days with no
   non-holiday rows rather than plotting them; plotted, they draw a cliff to 0% across
   every half-term that reads as a register nobody marked.
3. **`excused` is returned separately.** Whether an authorised absence counts against
   an attendance rate is a school's policy, and in some cases a reporting requirement.
   The function returns facts; the consumer decides.

**Surfaced at:** `GET /api/school/overview` → `attendance.trend[]` (14 days, gated on
`attendance:read`), rendered on the school dashboard as a single-series rate line —
`(present + late) ÷ (present + late + absent + excused)`. A late pupil came to school,
so counting them absent would make punctuality and attendance the same measure. The
chart renders only with two or more days behind it; one point is not a trend.

### The register as a PDF — BUILT 2026-10-18

`GET /api/school/attendance/register/export?classId=…&date=YYYY-MM-DD` renders one
class's register for one day and returns it as an attachment.
`renderAttendanceRegister()` in `@zsms/documents` draws it: the roll, each pupil's
status, any note, a summary line, and a signature line — because a register printed
for the office is evidence and is usually countersigned.

**Synchronous, and nothing is stored.** Report cards are queued because it is four
hundred at once; this is one document a teacher is waiting for, and queuing it would
make a download depend on Redis. It writes no `generated_documents` row and puts
nothing in R2 either: a register is reproducible from the attendance rows at any time,
so storing the rendering would keep a second copy of a fact the database already holds
— one that goes stale the moment a mark is corrected.

**An unmarked pupil prints as an em dash and the footer says so.** On screen an
unmarked pupil is a gap a teacher can still fill; on paper it would become a record of
absence that outlives the correction, and this is a document that gets filed.

Reachable from the web attendance screen beside *Print register*. **Not yet reachable
from the phone**: saving a file to the device needs `expo-file-system` and
`expo-sharing`, two dependencies this app does not have, and this repository has a
history of mobile dependency incidents. That is a deliberate pause, not an omission.

**Still outstanding from the specification above:** grade-by-grade rates, top
absentees, teacher marking compliance, and the CSV form of any of it.

---

## Business Rules

1. All students default to `present` when attendance is opened — teachers mark exceptions only. This design choice is intentional and must be preserved in the UI.
2. The unique constraint on `(school_id, student_id, attendance_date)` means only one attendance record per student per day. Multi-period attendance is tracked through the timetable — the daily record summarises the day, not individual periods.
3. Teachers can only edit attendance they recorded within the same school day (before the configured cutoff). Admins and principals can edit any past record.
4. Every attendance edit (as opposed to creation) requires a reason field. The reason is stored in the audit log.
5. The `local_created_at` field captures the device timestamp when the teacher tapped the record on mobile. This is preserved even after sync — it is the evidence of when the teacher actually marked attendance.
6. Holiday records can only be created by admin-level roles and above. Teachers cannot mark their own class as a holiday.
7. Attendance records are never hard deleted — they follow the standard soft-delete pattern (`is_deleted = TRUE`) if they need to be removed.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 10 attendance documentation |
| 2026-04-26 | Added timetable integration for class suggestion | Timetable module confirmed |
| 2026-04-26 | Portal-first model — monthly summaries replace per-absence default | Communication model update |
| 2026-04-26 | Added holiday bulk marking | Schools need to handle non-school days cleanly |
| 2026-10-18 | The register as a PDF — `renderAttendanceRegister()` and `GET /api/school/attendance/register/export` | The *Attendance Reports* section has specified a downloadable register since the initial draft and nothing rendered one. Scoped to ONE DAY, which is narrower than the two reports specified: the button it serves sits on a register a teacher has just marked, and that is what goes to the office. Synchronous and stored nowhere — a register is reproducible from the rows, so a saved rendering is a second copy that goes stale on the first correction. An unmarked pupil prints as an em dash, with the footer stating it is not a record of absence. Reachable from the web screen; the phone needs `expo-file-system` and `expo-sharing`, deliberately not added mid-session. |
| 2026-10-18 | `school_attendance_trend()` (`0274`) and the dashboard trend chart | The day-by-day rate this document has specified since the initial draft had no data function behind it. SECURITY INVOKER so RLS scopes it per role; `holiday` kept as its own count because a closed day is not a day of total absence. Grade-by-grade rates, top absentees, marking compliance and the PDF/CSV export remain unbuilt. |
