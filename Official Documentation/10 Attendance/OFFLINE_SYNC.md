# OFFLINE_SYNC.md — Offline Attendance Sync

## Related Documents

- `docs/modules/attendance/ATTENDANCE.md` — attendance recording overview
- `docs/modules/attendance/TRIGGERS.md` — database triggers on synced records
- `docs/modules/attendance/NOTIFICATIONS.md` — notifications triggered after sync
- `docs/infra/POWERSYNC.md` — PowerSync infrastructure configuration
- `docs/modules/staff/ASSIGNMENTS.md` — assignments that scope what syncs to device
- `docs/DATABASE.md` — attendance_records table fields for offline tracking

---

## Implementation Status (2026-10-11)

**Deferred by decision.** PowerSync is not licensed, so attendance is online-only. This is
a commercial decision rather than a technical obstacle, and ADR-004's offline-first
commitment stands for when it is.

**The schema is already shaped for it**, which is why this can be added without a
migration against live attendance data: `attendance_records.sync_source` (defaulting to
`'web'`) and `.local_created_at` both exist, and last-write-wins with server authority is
the documented conflict rule.

**What will need building when PowerSync is licensed:** the mobile screens (none exist),
the sync rules, and the conflict surface a teacher sees when their offline mark loses to a
server one. Nothing here is blocked on a decision that has not been made.

---

## Purpose

This document is the deep reference for offline attendance sync — how PowerSync enables marking attendance without internet, what data lives on the teacher's device, how sync works when connectivity returns, how conflicts are resolved, and the edge cases that arise from offline-first design. Every Claude Code session building the mobile attendance feature must read this document alongside `docs/infra/POWERSYNC.md`.

---

## Overview

Offline capability is not a nice-to-have for ZSMS — it is a core requirement. Zambian schools, especially in secondary cities and rural areas, have unreliable internet. A teacher who cannot mark attendance because the WiFi is down will abandon the system. The offline design must be invisible — the teacher marks attendance the same way whether they have internet or not. The system handles synchronisation transparently.

---

## What Syncs to the Teacher's Device

PowerSync downloads a scoped subset of data to the teacher's device based on their staff assignments. Not the entire school database — only what this teacher needs to do their job offline.

### Data Synced to Teacher Device

| Table | Rows Synced | Scope Rule |
|---|---|---|
| `students` | Students in classes the teacher reaches | Via `teacher_assignments.class_id` = `students.class_id`, at either scope (ADR-037) |
| `attendance_records` | Current and previous term | Last 6 months of records for assigned students |
| `teacher_assignments` | Own assignments only | Where `teacher_user_id` = teacher's Clerk user ID. **Replaces `staff_assignments`, dropped in `0069`** |
| `school_grade_levels` | All active levels | School-wide — small table, sync all |
| `school_subjects` | All active subjects | School-wide — small table, sync all |
| `timetable_slots` | Own slots only | Where staff_user_id = teacher's Clerk user ID |

### Data NOT Synced to Teacher Device

- Fee records and payments (financial data — not the teacher's concern)
- Other teachers' class data
- Student NRC numbers or sensitive fields
- Exam results for subjects not assigned to this teacher
- Parent contact details (privacy — not needed for offline attendance)
- Private schema tables (loan data — never syncs to any device)

### Initial Sync Size

For a teacher with 3 classes of 40 students each:
- Student records: ~120 rows (compact — no photos in SQLite)
- Attendance records (6 months): ~120 students × 120 school days = ~14,400 rows
- Staff assignments: ~10 rows
- Timetable slots: ~30 rows

Total initial sync: approximately 500KB of data. Downloads in under 5 seconds on a 3G connection. After initial sync, incremental updates are small and fast.

---

## The Offline Marking Experience

From the teacher's perspective, offline attendance is identical to online attendance. The distinction is invisible.

### What the Teacher Sees (Online)

```
Grade 9A — Thursday 15 Sep · Period 2
📶 Connected

[38 student cards — all green/present by default]
[Teacher taps 2 students absent]
[Taps SAVE]
"Saved ✓"
```

### What the Teacher Sees (Offline)

```
Grade 9A — Thursday 15 Sep · Period 2
📵 Offline — changes will sync automatically

[38 student cards — all green/present by default]
[Teacher taps 2 students absent]
[Taps SAVE]
"Saved locally ✓ — will sync when connected"
```

The only difference is the status indicator at the top and the save confirmation message. The marking experience is identical.

### Sync Status Indicators

The mobile app shows a persistent sync status indicator in the corner of the attendance screen:

| Indicator | Meaning |
|---|---|
| 🟢 Synced | All records are up to date with the server |
| 🟡 Pending (N) | N records saved locally, waiting to sync |
| 🔴 Sync failed | One or more records failed to upload — tap for details |

The pending count updates in real time as the teacher marks attendance. When connectivity returns, the count counts down as records sync.

---

## How Sync Works

### Write Path (Device → Server)

```
1. Teacher taps student absent (offline)
   → attendance_records row written to local SQLite immediately
   → local_created_at = device timestamp (e.g. 08:47:23)
   → status = 'absent'
   → sync_source = 'mobile_offline'
   → pending count increments to 1 (yellow indicator)

2. Teacher's phone connects to WiFi in staffroom
   → PowerSync detects connectivity
   → Begins uploading pending changes to Supabase
   → Calls uploadData() in the connector:
     - For each pending row: supabase.from('attendance_records').upsert(row)
   → Row is INSERT'd into Supabase via the anon client with teacher's JWT
   → RLS policy validates: teacher is assigned to this class

3. Supabase receives the INSERT
   → Row written to public.attendance_records
   → Database trigger fires: trigger_queue_absence_notification
   → queued job queued: send WhatsApp to parent

4. PowerSync confirms upload success
   → Local SQLite row marked as synced
   → Pending count decrements (eventually back to 0 / green)
   → UI shows: "Synced ✓"
```

### Read Path (Server → Device)

When another user updates data the teacher is subscribed to (e.g. admin corrects an attendance record for the teacher's class):

```
1. Admin edits attendance in web dashboard
   → Supabase row updated
2. PowerSync detects change via replication
   → Downloads updated row to teacher's device
   → Local SQLite updated
   → If teacher has the attendance screen open: UI refreshes automatically
```

---

## The `local_created_at` Field

This field is critical for offline integrity and audit purposes.

```typescript
// When the teacher taps "Save" offline
const attendanceRow = {
  school_id: schoolId,
  student_id: studentId,
  class_id: classId,
  recorded_by_user_id: teacherUserId,
  attendance_date: today,
  status: 'absent',
  local_created_at: new Date().toISOString(),  // Device timestamp — captured NOW
  sync_source: 'mobile_offline',
  created_at: null,  // Will be set by Supabase on INSERT
}
```

`local_created_at` captures when the teacher actually made the mark on their device. `created_at` captures when the record reached the Supabase server. For online marks these are nearly identical. For offline marks, `created_at` may be hours or days later.

**Why this matters:**
- Audit trail: the audit log can show "Teacher marked absent at 08:47 (device time), synced at 14:23 (server time)"
- Conflict resolution: `local_created_at` is used to determine which record wins when conflicts occur
- Evidence: a teacher can prove they marked attendance during class even if sync was delayed

---

## Conflict Resolution

A conflict occurs when the same attendance record is modified both offline (by the teacher) and online (by an admin) before sync completes.

**Most common scenario:**
- Teacher marks student A absent at 08:47 offline
- Admin marks student A present online at 09:15 (student arrived very late and the admin was informed)
- Teacher's phone syncs at 10:30

**Resolution: Last `local_created_at` wins**

When PowerSync attempts to upload the teacher's offline record and finds a newer server record, it compares `local_created_at` timestamps:

```typescript
// In the uploadData() connector
async function resolveConflict(
  localRow: AttendanceRecord,
  serverRow: AttendanceRecord
): Promise<AttendanceRecord> {
  const localTime = new Date(localRow.local_created_at)
  const serverTime = new Date(serverRow.local_created_at || serverRow.created_at)

  if (localTime > serverTime) {
    // Teacher's mark is more recent — use teacher's version
    return localRow
  } else {
    // Admin's online mark is more recent — keep server version
    return serverRow
  }
}
```

**Both events are logged in audit_logs.** The losing write appears as a "superseded" entry. The school admin can always see the full history of a student's attendance status changes including conflicts.

**Why this resolution approach works:**
The teacher is physically in the classroom. Their device timestamp represents when they observed the student's absence. An admin updating online typically has more information (e.g. the student called in late). The later timestamp generally represents the more accurate current reality.

---

## The Bulk Offline Sync Edge Case

A teacher's phone has been offline for 5 days (school trip, personal leave). When they reconnect, PowerSync uploads all 5 days of offline attendance records simultaneously. This triggers the `trigger_queue_absence_notification` for every absent record — potentially dozens of parent notifications at once.

**Rate limiting prevents notification flooding:**

The absence notification trigger checks the rate limit before queuing each WhatsApp job:

```sql
-- In trigger_queue_absence_notification
-- Only queue notification if fewer than 10 WhatsApp messages
-- have been sent to this parent in the last hour
IF (
  SELECT COUNT(*) FROM public.message_log
  WHERE recipient_user_id = parent_user_id
    AND created_at > NOW() - INTERVAL '1 hour'
    AND channel = 'whatsapp'
) < 10 THEN
  -- Queue the notification
  PERFORM net.http_post(...)
END IF;
```

If more than 10 WhatsApp messages would be sent to the same parent within an hour (e.g. 5 days of absence notifications arriving at once), the excess are converted to email or in-app notifications only. The parent receives a consolidated message:

```
📅 Attendance Update — Chanda Bwalya
Multiple attendance records have been synced from offline marking.
View full attendance history: zsms.co.zm/portal/attendance
```

---

## Sync Failure Handling

If a sync fails (server error, RLS rejection, network timeout):

```
1. PowerSync retries automatically:
   Attempt 1: Immediately
   Attempt 2: After 30 seconds
   Attempt 3: After 2 minutes

2. If all 3 attempts fail:
   → Record remains in local SQLite as pending
   → Red sync indicator shown: 🔴 Sync failed (3)
   → Teacher sees: "Some records failed to sync — tap to see details"

3. Details screen shows:
   "Grade 9A · 15 Sep · Chanda Bwalya
    Could not sync: Permission denied
    [Retry]   [Delete local record]"

4. Most common failure cause: RLS rejection
   (teacher's class assignment was changed while they were offline)
   Teacher contacts admin to restore assignment or the admin
   marks the attendance manually in the web dashboard
```

---

## First-Time Sync (App Installation)

When a teacher installs the ZSMS mobile app and logs in for the first time:

```
1. Teacher logs in with email OTP
2. PowerSync initialises — downloads sync rules from server
3. Initial data download begins:
   "Setting up your offline data..."
   [Progress bar: Downloading 120 students · 14,400 attendance records]
4. Download completes (typically 10-30 seconds on 3G)
5. Success screen: "You're ready! Attendance works even without internet."
6. Teacher can now use the app offline immediately
```

The loading screen explains what is happening — teachers need to understand this is a one-time process and why it takes a moment.

---

## Business Rules

1. All attendance records written offline are marked `sync_source = 'mobile_offline'` and carry a `local_created_at` device timestamp. These fields are immutable after sync — they preserve the evidence of when and how the record was created.
2. Conflict resolution uses `local_created_at` comparison. The more recent mark wins. Both the winning and losing records are preserved in the audit log.
3. The rate limit of 10 WhatsApp notifications per parent per hour applies specifically to bulk offline syncs. Normal online attendance marking (one record at a time) is not affected.
4. Sync failures display a clear error to the teacher with a retry option. Failed records are never silently dropped — they remain in local SQLite until successfully uploaded or manually deleted by the teacher.
5. Private schema data (loan applications) never syncs to any mobile device. Financial data (fee records) only syncs to the parent app, not the teacher app.
6. The teacher app never syncs another teacher's class data. PowerSync sync rules enforce this — only students in the teacher's assigned classes appear on their device.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 10 attendance documentation |
| 2026-04-26 | Added bulk sync rate limiting detail | Prevents WhatsApp flooding from 5-day offline sync |
| 2026-04-26 | Added local_created_at explanation | Important for audit trail and conflict resolution |
