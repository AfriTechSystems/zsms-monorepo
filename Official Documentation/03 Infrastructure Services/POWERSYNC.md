# POWERSYNC.md — Offline Sync Infrastructure

## Related Documents

- `docs/ARCHITECTURE.md` — offline-first mobile architecture
- `docs/DATABASE.md` — tables synced to devices and their schema
- `docs/modules/attendance/OFFLINE_SYNC.md` — attendance-specific sync rules
- `docs/modules/results/RESULTS.md` — marks entry offline capability
- `docs/infra/SUPABASE.md` — Supabase as the sync source
- `docs/ENV.md` — PowerSync environment variables

---

## Implementation Status (2026-10-11)

**Not built, by decision, and not a gap.** PowerSync is a paid service and has not been
purchased. ZSMS is built online-first; ADR-004's offline-first attendance is deferred
until the service exists.

There are zero PowerSync references in the tree. Nothing half-built is waiting — the
mobile app reads and writes over the network like the web app, and a teacher with no
signal cannot mark a register. That is the accepted consequence and it should be stated
to a school before they rely on it in a rural setting.

---

## Purpose

This document covers how PowerSync is configured to enable offline capability in the ZSMS React Native mobile app. It defines the sync rules, conflict resolution strategy, first-time sync experience, and how the PowerSync token lifecycle relates to Clerk sessions. Every Claude Code session building mobile offline features must read this document.

---

## Overview

PowerSync is a synchronisation engine that maintains a local SQLite database on the teacher's or parent's mobile device. Data syncs bidirectionally with Supabase when internet is available. When offline, reads and writes happen against local SQLite. When connectivity returns, changes sync automatically without user interaction.

PowerSync is used exclusively in the React Native mobile app. The Next.js web app does not use PowerSync — web users require internet for data access, which is an acceptable constraint for the primarily office-based admin and accountant roles.

---

## What Syncs to Each Device

PowerSync sync rules are defined in `apps/mobile/lib/powersync/schema.ts`. Rules determine which tables and which rows sync to each user's device. The principle is minimum necessary data — a teacher never has another teacher's class data on their device, and a parent never has another parent's child data.

### Teacher Device Sync Rules

```typescript
// apps/mobile/lib/powersync/schema.ts
import { Schema, Table, column } from '@powersync/react-native'

export const AppSchema = new Schema([
  new Table({
    name: 'students',
    columns: [
      column.text('student_id'),
      column.text('first_name'),
      column.text('last_name'),
      column.text('grade_id'),
      column.text('class_id'),
      column.integer('is_boarding'),
      column.text('photo_url'),
      column.text('status'),
    ],
  }),
  new Table({
    name: 'attendance_records',
    columns: [
      column.text('student_id'),
      column.text('class_id'),
      column.text('attendance_date'),
      column.text('status'),
      column.integer('parent_notified'),
      column.text('excuse_reason'),
      column.text('sync_source'),
      column.text('local_created_at'),
    ],
  }),
  new Table({
    name: 'exam_results',
    columns: [
      column.text('student_id'),
      column.text('subject_code'),
      column.text('academic_year'),
      column.integer('term_number'),
      column.real('marks_obtained'),
      column.real('marks_total'),
      column.text('grade_letter'),
      column.integer('results_published'),
      column.text('comments'),
    ],
  }),
  new Table({
    name: 'teacher_assignments',
    columns: [
      column.text('class_id'),
      column.text('scope'),
      column.text('subject_id'),
      column.text('academic_year'),
      column.integer('is_class_teacher'),
    ],
  }),
  new Table({
    name: 'school_grade_levels',
    columns: [
      column.text('level_id'),
      column.text('display_name'),
      column.integer('level_order'),
      column.text('level_type'),
    ],
  }),
])
```

**Sync scope for teachers:** Only students in the teacher's assigned classes sync. Specifically:

> **CORRECTED 2026-08-15.** These rules previously joined `class_enrolments` and `staff_assignments`. **Neither table exists** — `class_enrolments` never did, and `staff_assignments` was dropped in migration `0069`. Both are replaced by `teacher_assignments` (ADR-037), which reaches a class at either `scope='class'` or `scope='subject'`, and by `students.class_id` for the student's own class.

```sql
-- PowerSync sync rule (defined in Supabase PowerSync configuration)
-- Students: only those in classes this teacher reaches, at either scope
SELECT s.* FROM students s
JOIN teacher_assignments ta
  ON ta.class_id = s.class_id
 AND ta.school_id = s.school_id
WHERE ta.teacher_user_id = token_parameters.user_id
  AND ta.is_active = TRUE
  AND ta.academic_year = current_setting('app.current_academic_year')
  AND s.school_id = token_parameters.school_id
  AND s.is_deleted = FALSE;

-- Attendance: current and previous term only.
-- Joined on attendance_records.class_id, which is denormalised at marking time
-- and therefore still correct if the student later changes class.
SELECT ar.* FROM attendance_records ar
JOIN teacher_assignments ta
  ON ta.class_id = ar.class_id
 AND ta.school_id = ar.school_id
WHERE ta.teacher_user_id = token_parameters.user_id
  AND ta.is_active = TRUE
  AND ar.attendance_date >= current_date - interval '6 months';

-- Exam results: teacher's assigned subjects only.
-- A scope='class' assignment covers every subject in that class; a
-- scope='subject' assignment covers only its own subject.
SELECT er.* FROM exam_results er
JOIN teacher_assignments ta
  ON ta.class_id = er.class_id
 AND ta.school_id = er.school_id
LEFT JOIN school_subjects ss ON ss.id = ta.subject_id
WHERE ta.teacher_user_id = token_parameters.user_id
  AND ta.is_active = TRUE
  AND (ta.scope = 'class' OR ss.subject_code = er.subject_code);
```

### Parent Device Sync Rules

Parents sync a lightweight subset — enough for the home screen to show current information without internet:

```sql
-- Students: parent's linked children only
SELECT s.id, s.student_id, s.first_name, s.last_name,
       s.grade_id, s.class_id, s.status
FROM students s
JOIN student_parent_links spl ON spl.student_id = s.id
WHERE spl.parent_user_id = token_parameters.user_id
  AND (spl.is_active = TRUE
       OR spl.grace_period_ends_at > NOW());

-- Fee records: current academic year only
SELECT fr.* FROM fee_records fr
JOIN student_parent_links spl ON spl.student_id = fr.student_id
WHERE spl.parent_user_id = token_parameters.user_id
  AND fr.academic_year = extract(year from current_date)::text;

-- Attendance: last 30 days only
SELECT ar.* FROM attendance_records ar
JOIN student_parent_links spl ON spl.student_id = ar.student_id
WHERE spl.parent_user_id = token_parameters.user_id
  AND ar.attendance_date >= current_date - interval '30 days';
```

---

## PowerSync Connector Configuration

The connector links PowerSync to the Supabase database. It handles authentication using the user's Clerk JWT.

```typescript
// apps/mobile/lib/powersync/connector.ts
import { AbstractPowerSyncDatabase, PowerSyncBackendConnector } from '@powersync/react-native'
import { createClient } from '@supabase/supabase-js'

export class SupabasePowerSyncConnector implements PowerSyncBackendConnector {
  private supabase = createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL!,
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!
  )

  async fetchCredentials() {
    const { data: { session } } = await this.supabase.auth.getSession()

    if (!session) {
      throw new Error('No active session')
    }

    return {
      endpoint: process.env.EXPO_PUBLIC_POWERSYNC_URL!,
      token: session.access_token,
    }
  }

  async uploadData(database: AbstractPowerSyncDatabase) {
    // Upload local changes to Supabase
    const transaction = await database.getNextCrudTransaction()
    if (!transaction) return

    for (const operation of transaction.crud) {
      const { op, table, opData } = operation
      const { error } = op === 'PUT'
        ? await this.supabase.from(table).upsert(opData)
        : op === 'PATCH'
        ? await this.supabase.from(table).update(opData).eq('id', opData.id)
        : await this.supabase.from(table).delete().eq('id', opData.id)

      if (error) throw error
    }

    await transaction.complete()
  }
}
```

---

## First-Time Sync Experience

When a teacher installs the ZSMS app and logs in for the first time, PowerSync performs an initial sync:

```
1. Teacher logs in with Clerk email OTP
2. PowerSync connector initialises with the Clerk JWT
3. PowerSync downloads the sync rules from the Supabase PowerSync service
4. Initial data download begins:
   - Teacher's assigned students: ~200-400 records typically
   - Recent attendance records: ~3-6 months
   - Exam results: current and previous term
   - Staff assignments: current academic year
5. Download progress shown: "Setting up offline data... 45%"
6. Once complete (typically 10-30 seconds on a 3G connection): "Ready — you can now mark attendance offline"
7. Teacher can now use the app with or without internet
```

The loading screen during initial sync must be clearly explained — not just a spinner. Teachers need to understand why they are waiting and that this is a one-time process.

---

## Conflict Resolution

Conflicts occur when the same record is modified both offline and online before sync completes. The most common scenario: a teacher marks a student absent offline, and a school admin marks the same student present online on the same day (e.g. the student arrived late and the admin updated attendance).

**Resolution strategy: Last-write-wins with timestamp comparison**

The `local_created_at` field on `attendance_records` captures the exact moment the teacher made the mark on their device (even if offline). When syncing, PowerSync compares timestamps:

- If the online write happened after `local_created_at`: the online write wins
- If the offline write has a later `local_created_at`: the offline write wins

Both events are written to `audit_logs` so the conflict history is preserved. The losing write does not disappear — it is recorded as a superseded entry.

**Why this works for attendance:** The teacher is in the classroom at a specific time. Their offline mark with its local timestamp is the most accurate record of what they observed at that moment. An admin override with a later timestamp represents a deliberate correction.

**Exam results conflicts:** Results have an additional protection — once `results_published = TRUE`, the Supabase RLS UPDATE policy rejects offline writes for that record. PowerSync uploads are also rejected. The teacher sees an error: "Results have been published — contact your principal to make corrections."

---

## Offline Write Indicators

The mobile app shows the sync status of offline writes so teachers know what has and has not reached the server:

- **Green checkmark:** Synced to server
- **Yellow clock:** Pending sync (written locally, waiting for connection)
- **Red warning:** Sync failed — requires attention

Teachers do not need to take any action for pending or synced records. The red warning state requires investigation — the record failed to upload even after retries.

---

## Sync Token Lifecycle

PowerSync uses its own authentication token derived from the Clerk JWT. This token is:

- Obtained by the PowerSync connector calling `fetchCredentials()` which reads the current Clerk session
- Short-lived (PowerSync refreshes it automatically using the Clerk session)
- Independent from the Clerk web session — the teacher can be logged out of the web portal but the mobile app's PowerSync sync continues as long as the Clerk mobile session is active

When the teacher's Clerk mobile session expires (after 90 days for teachers), PowerSync loses the ability to refresh its token. The teacher sees a "Re-authentication required" prompt. After logging in again, PowerSync resumes syncing all pending offline writes.

---

## Network Conditions and Sync Frequency

PowerSync syncs continuously when internet is available and pauses when offline. No manual sync trigger is needed or provided — the sync is entirely automatic.

**Sync priority order when connectivity returns:**

1. Uploads first (local writes to server) — ensures teacher's offline work reaches the database
2. Downloads (server updates to device) — refreshes the local cache with any changes made online

**On slow connections (2G / edge):** PowerSync detects connection quality and adjusts sync behaviour. On very slow connections, uploads (teacher's offline marks) are prioritised over downloads. The teacher's attendance data reaches the server even if downloading fresh data is slow.

---

## Business Rules

1. PowerSync is used only in the React Native mobile app. The web app has no offline capability.
2. Sync rules enforce the same access boundaries as RLS policies. A teacher cannot have another teacher's class data on their device.
3. The `private` schema (loan applications, consent logs) is never synced to any device. Loan data is always fetched live from the server.
4. Financial data (fee records, payments) syncs to the parent app for the current academic year only — not full history, which is available online.
5. Conflict resolution uses last-write-wins with timestamp comparison. Both the winning and losing writes are logged in `audit_logs`.
6. Published exam results cannot be overwritten by offline writes. The RLS UPDATE policy rejects these writes and PowerSync receives an error, which surfaces to the teacher as a sync failure requiring principal intervention.

---

## Known Limitations and Future Work

- PowerSync does not currently support selective column sync — if a table is synced, all columns defined in the schema sync. Sensitive columns (e.g. `nrc_or_birth_cert`) are excluded from the sync schema definition to prevent them appearing on devices.
- The initial sync for schools with very large student populations (2,000+ students) may take several minutes on slow connections. A future improvement would pre-warm the device cache during school setup rather than on first teacher login.
- PowerSync pricing scales with the number of syncing clients. Monitor monthly active syncing devices as the teacher base grows.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 3 infrastructure documentation |
