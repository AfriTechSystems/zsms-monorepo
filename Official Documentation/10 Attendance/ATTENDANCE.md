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

**The mobile app, which this document calls the *primary* interface, does not exist.**
`apps/mobile` type-checks and has no screens. That is the largest single gap in the tree
and a Phase 2 commitment.

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
