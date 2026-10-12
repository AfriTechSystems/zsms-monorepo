# PERFORMANCE_CHECKLIST.md — Performance Validation Checklist

## Related Documents

- `docs/testing/LAUNCH_CHECKLIST.md` — performance checks referenced in go/no-go
- `docs/testing/TEST_DATA.md` — test data used for performance validation
- `docs/api/INDEXES.md` — indexes that enable performance targets
- `docs/infra/SUPABASE.md` — query performance monitoring
- `docs/infra/VERCEL.md` — edge caching configuration
- `docs/infra/POWERSYNC.md` — mobile sync performance targets
- `docs/modules/results/BULK_GENERATION.md` — report card generation performance

---

## Implementation Status (2026-10-11)

**Partially verifiable today; the rest needs a staging environment.**

What holds now:

- **Indexes exist** for the access paths that matter — `idx_teacher_assignments_*`,
  `idx_document_templates_school`, the partial `idx_one_class_teacher_per_class` (`0250`),
  and `INDEXES.md`'s set applied from `0001` onward.
- **`npm run build` passes** and the bundle is produced on every CI run.
- **PostHog is configured with autocapture, input capture and session recording all OFF**,
  which is both a compliance requirement and a performance one: the DOM of a ZSMS screen
  is a class register with children's names on it.

**Known and unaddressed**, carried from `LOAD_TESTING.md`: the per-feature RPC fan-out on
the school detail screen.

**Not measurable without staging:** cold-start latency, p95 response times, and anything
about real Zambian network conditions — which is the number that actually matters for a
school on a 3G connection, and which no amount of local benchmarking will produce.

---

## Purpose

This document defines the performance targets for every critical ZSMS operation and the steps to verify they are met before launch. Every target here is tied to a real user experience — a slow operation causes a specific user to wait or abandon. Every Claude Code session that introduces a new database query should consider whether it hits an indexed path and whether it meets the target for its category.

---

## Performance Targets Summary

| Operation | Target | User Impact if Missed |
|---|---|---|
| Student name search (school-scoped) | < 200ms | Admin search bar feels sluggish |
| Single student fee balance | < 50ms | Parent portal fee page slow to load |
| Outstanding fees list (school-wide) | < 500ms | Accountant dashboard delayed |
| Class attendance sheet (single day) | < 100ms | Teacher daily view feels slow |
| Attendance by student (90 days) | < 200ms | Parent portal attendance tab slow |
| API key authentication | < 20ms | Adds latency to every external API call |
| School-wide results (one term) | < 300ms | Principal results view delayed |
| WhatsApp quota check | < 20ms | Adds latency to every message dispatch |
| Parent portal home screen | < 2s total | First impression — critical |
| Report card bulk generation (400 students) | < 90 seconds | Principal waits, session times out |
| PowerSync initial teacher sync (3 classes) | < 30 seconds on 3G | Teacher frustrated during setup |
| Public school directory search | < 300ms (cached) | Parent login flow delayed |

---

## Section 1 — Database Query Performance

All queries below are run against the `zsms-zm` production database (or a replica with production-equivalent data volume). Use the Supabase Dashboard → Database → Query Performance section to identify slow queries.

### Test Data Requirements

Performance tests require realistic data volumes:
- Minimum 1,000 active students across 5 schools
- Minimum 3,000 fee records
- Minimum 50,000 attendance records (approximately one term for 500 students)
- Minimum 15,000 exam_results rows

If production does not yet have this volume, use the `zsms-staging` project with seed data amplified to these volumes.

---

### 1.1 Student Name Search

```sql
EXPLAIN ANALYZE
SELECT id, first_name, last_name, student_id, grade_id, class_id
FROM students
WHERE school_id = 'test_school_uuid'
  AND is_deleted = FALSE
  AND to_tsvector('english', first_name || ' ' || last_name) @@ plainto_tsquery('english', 'Chanda')
ORDER BY last_name, first_name
LIMIT 20;
```

**Expected:** Planning time < 5ms, Execution time < 200ms
**Index used:** `idx_students_fulltext` (GIN index)

If slow: check GIN index exists with `\d students` in psql.

**Status:** ☐ Target met — actual: ___ms

---

### 1.2 Single Student Fee Balance

```sql
EXPLAIN ANALYZE
SELECT fr.*, fs.fee_label, fs.amount as structure_amount
FROM fee_records fr
JOIN fee_structures fs ON fs.id = fr.fee_structure_id
WHERE fr.student_id = 'test_student_uuid'
  AND fr.academic_year = '2026'
  AND fr.is_deleted = FALSE
ORDER BY fr.term_number, fs.fee_label;
```

**Expected:** Execution time < 50ms
**Index used:** `idx_fee_records_student`

**Status:** ☐ Target met — actual: ___ms

---

### 1.3 Outstanding Fees List (School-Wide)

```sql
EXPLAIN ANALYZE
SELECT
  fr.id, fr.student_id, fr.fee_label, fr.amount_due, fr.amount_paid,
  fr.status, fr.due_date,
  s.first_name, s.last_name, s.grade_id, s.class_id
FROM fee_records fr
JOIN students s ON s.id = fr.student_id
WHERE fr.school_id = 'test_school_uuid'
  AND fr.status IN ('unpaid', 'partial')
  AND fr.is_deleted = FALSE
  AND fr.academic_year = '2026'
  AND fr.term_number = 2
ORDER BY fr.due_date, s.last_name;
```

**Expected:** Execution time < 500ms for 500 outstanding records
**Index used:** `idx_fee_records_status` (partial index on unpaid/partial)

**Status:** ☐ Target met — actual: ___ms

---

### 1.4 Class Attendance Sheet (Single Day)

```sql
EXPLAIN ANALYZE
SELECT ar.*, s.first_name, s.last_name, s.student_id
FROM attendance_records ar
JOIN students s ON s.id = ar.student_id
WHERE ar.school_id = 'test_school_uuid'
  AND ar.class_id = 'grade_9a'
  AND ar.attendance_date = '2026-09-15'
ORDER BY s.last_name;
```

**Expected:** Execution time < 100ms
**Index used:** `idx_attendance_class_date`

**Status:** ☐ Target met — actual: ___ms

---

### 1.5 API Key Authentication Lookup

```sql
EXPLAIN ANALYZE
SELECT school_id, scopes, is_active, expires_at, rate_limit_rpm
FROM school_api_keys
WHERE key_hash = 'sha256_hash_of_test_key'
  AND is_active = TRUE;
```

**Expected:** Execution time < 20ms
**Index used:** `idx_api_keys_hash` (UNIQUE index — index scan guaranteed)

**Status:** ☐ Target met — actual: ___ms

---

### 1.6 WhatsApp Quota Check

```sql
EXPLAIN ANALYZE
SELECT quota_limit, messages_used
FROM school_message_quotas
WHERE school_id = 'test_school_uuid'
  AND billing_period = '2026-09';
```

**Expected:** Execution time < 20ms
**Index used:** Primary key or unique index on (school_id, billing_period)

**Status:** ☐ Target met — actual: ___ms

---

### 1.7 Parent Portal Home — Child Attendance Badge

```sql
-- All linked children's attendance for today
EXPLAIN ANALYZE
SELECT ar.student_id, ar.status, ar.attendance_date
FROM attendance_records ar
JOIN student_parent_links spl ON spl.student_id = ar.student_id
WHERE spl.parent_user_id = 'test_parent_clerk_id'
  AND spl.is_active = TRUE
  AND ar.attendance_date = CURRENT_DATE;
```

**Expected:** Execution time < 50ms
**Index used:** `idx_spl_parent_user`, `idx_attendance_class_date`

**Status:** ☐ Target met — actual: ___ms

---

## Section 2 — API Response Times

Test using `curl` with timing against the staging environment with realistic data:

```bash
# Student search API response time
time curl -s -o /dev/null \
  "https://staging.zsms.co.zm/api/students?search=Chanda&grade_id=grade_9" \
  -H "Authorization: Bearer valid_jwt"
# Expected: < 300ms total (including network)

# Fee balance for single student
time curl -s -o /dev/null \
  "https://staging.zsms.co.zm/api/fees/records/student-uuid" \
  -H "Authorization: Bearer valid_parent_jwt"
# Expected: < 200ms total

# School directory search (cached)
time curl -s -o /dev/null \
  "https://staging.zsms.co.zm/api/schools/search?q=Academy&city=LSK"
# Expected: < 300ms (first request), < 100ms (cached at Vercel edge)
```

**Status:** ☐ All API targets met

---

## Section 3 — Report Card Bulk Generation

**Test setup:** School with exactly 400 active students, all with marks entered for Term 2. Template configured at Level 1 (branding only).

```bash
# Trigger generation and time it
time curl -X POST https://staging.zsms.co.zm/api/reports/generate \
  -H "Authorization: Bearer valid_principal_jwt" \
  -d '{"academic_year": "2026", "term_number": 2}'
# Expected: 202 response immediately (jobs queued)

# Monitor progress via Realtime — time until run_id shows all jobs 'complete'
# Target: All 400 students generated within 90 seconds
```

**Batch validation:**
- 400 students ÷ 35 per batch = 12 batches
- All 12 batches run in parallel
- Slowest batch determines total time
- Each batch: ~35 PDFs × ~1.5 seconds = ~52 seconds
- Expected wall-clock time: 55-75 seconds (accounting for startup overhead)
- Target: < 90 seconds

**If over 90 seconds:** Check Edge Function invocation time in Supabase dashboard. Look for:
- Logo fetch adding latency (should be < 2s per batch — loaded once)
- Font loading adding latency (should be < 1s per batch)
- R2 upload latency (should be < 500ms per PDF)

**Status:** ☐ Target met — actual: ___s for 400 students

---

## Section 4 — PowerSync Mobile Sync Performance

### Initial Teacher Sync (3 Classes, ~120 Students)

Test on a physical Android device with a throttled connection (3G simulation):

```typescript
// Measure time from app launch → sync complete indicator
// Target: < 30 seconds on 3G (< 10 seconds on WiFi)

// Data synced:
// - 120 student rows (~50KB)
// - 14,400 attendance records (6 months, ~800KB)
// - 30 timetable slots (~5KB)
// Total: ~1MB download

// 3G speed: ~1Mbps = 125KB/s
// 1MB ÷ 125KB/s = 8 seconds download
// Plus processing: ~15 seconds total
// Target: < 30 seconds ✓
```

**Measured:** Open the app on a fresh install with connection throttled to 3G speeds.
Monitor the sync progress indicator. Note time from "Setting up your offline data" to "You're ready".

**Status:** ☐ Target met — actual: ___s on 3G

### Offline Attendance Sync (After Network Restored)

```typescript
// Mark 5 students absent while offline
// Restore network
// Time until sync indicator changes from 🟡 Pending (5) to 🟢 Synced
// Target: < 60 seconds after network restoration
```

**Status:** ☐ Target met — actual: ___s

---

## Section 5 — Vercel Edge Caching

### Public School Directory Cache

```bash
# First request — no cache
time curl -s -o /dev/null -w "%{http_code} %{time_total}\n" \
  "https://zsms.co.zm/api/schools/search?q=&city=LSK"
# Expected: 200, time < 500ms (database query)

# Second request — cache hit
time curl -s -o /dev/null -w "%{http_code} %{time_total}\n" \
  "https://zsms.co.zm/api/schools/search?q=&city=LSK"
# Expected: 200, time < 100ms (edge cache hit)

# Verify cache headers
curl -I "https://zsms.co.zm/api/schools/search?q=&city=LSK"
# Expected header: Cache-Control: s-maxage=300, stale-while-revalidate=60
```

**Status:** ☐ Cache working — first: ___ms, cached: ___ms

---

## Section 6 — Parent Portal Home Screen Load Time

The parent portal home screen is the first thing a parent sees after login. It must load in under 2 seconds total.

**Components that load on the home screen:**
1. Parent profile and linked children list
2. Today's attendance badge for each child
3. Outstanding fee balance for each child
4. Unread announcement count
5. Latest results badge (if results published this term)

**Test using Chrome DevTools → Network tab → Throttle to Fast 3G:**

```
Load time target breakdown:
- Authentication (Clerk): < 200ms (client-side, cached after first load)
- API route for home data: < 400ms (server-side, database queries)
- React rendering: < 300ms
- Total: < 2 seconds ✓
```

**If over 2 seconds:** Check if the home screen API route is making sequential database queries instead of parallel Promise.all() calls. Each query should run in parallel.

**Status:** ☐ Target met — actual: ___s on Fast 3G

---

## Performance Issue Resolution Guide

### Slow Query Found

1. Run `EXPLAIN ANALYZE` on the slow query
2. Check if an index exists for the WHERE clause columns
3. If no index: add to `docs/api/INDEXES.md` and create a new migration
4. Re-run `EXPLAIN ANALYZE` and verify improvement
5. Deploy migration to staging and re-test

### Slow Edge Function Found

1. Check Supabase Edge Function logs for the function duration
2. Look for sequential awaits that should be parallel:
   ```typescript
   // SLOW: Sequential
   const student = await getStudent(id)
   const fees = await getFees(id)
   // FAST: Parallel
   const [student, fees] = await Promise.all([getStudent(id), getFees(id)])
   ```
3. Check for N+1 queries (fetching inside a loop — should be a single JOIN query)
4. Check for unnecessary data fetching (selecting * when only 3 columns needed)

### Slow Bulk Generation

1. Verify font loading is outside the student loop (loaded once per batch)
2. Verify logo is loaded as data URL once per batch, not per student
3. Check R2 upload latency — if > 1s per upload, consider parallel uploads within a batch
4. Verify batch size is 35 — larger batches may hit memory limits

---

## Business Rules

1. All performance targets must be met on the `zsms-staging` environment before production deployment. Do not test performance on production.
2. Performance tests use realistic data volumes — at minimum 1,000 students and 50,000 attendance records.
3. If a query misses its target by more than 2×, a new index is required — do not deploy without it.
4. The 90-second report card generation target assumes a school of 400 students. Schools with 800+ students (Professional/Enterprise tier) may need a 120-second target — document if this becomes a real scenario.
5. Mobile sync performance is tested on a physical device with throttled connection — not on a simulator with full WiFi speed.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 16 testing and launch documentation |
| 2026-04-26 | Added parent portal home screen target | Critical first impression for parent users |
| 2026-04-26 | Added PowerSync 3G performance target | Zambian schools have variable connectivity |
| 2026-04-26 | Added Vercel edge cache verification | Public directory is the parent login entry point |
