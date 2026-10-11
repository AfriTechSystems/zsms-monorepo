# INDEXES.md — Database Index Reference

## Related Documents

- `docs/DATABASE.md` — full table definitions including inline index declarations
- `docs/api/SCHEMA.md` — table overview
- `docs/api/MIGRATIONS.md` — migration 0033 creates all indexes
- `docs/infra/SUPABASE.md` — query performance monitoring

---

## Implementation Status (2026-10-11)

**289 indexes exist in `public`; this document specifies 79.** The excess is mostly
primary keys and unique constraints, which create indexes without being listed here, plus
indexes added alongside migrations since this was written. 174 follow the `idx_` naming
convention.

**Five tables carry nothing beyond their primary key:** `ai_credit_caps`,
`school_branding`, `school_credit_settings`, `school_network_roles` and
`school_public_profiles`. Three of those are filtered by `school_id` in their RLS
policies with no index on it.

Left alone deliberately. Each holds roughly one row per school, so a sequential scan over
single-digit rows is faster than an index lookup and will stay so into the thousands. Worth
revisiting when any of them exceeds a few thousand rows — not before, because an index
that is never used still has to be maintained on every write.

---

## Purpose

This document is the complete database index reference. It lists every index in the ZSMS database, the query pattern it serves, and the performance target it is designed to meet. Claude Code reads this before adding new queries to ensure an appropriate index exists, and before creating new indexes to avoid duplicating existing ones.

---

## Index Design Principles

1. Every table has an index on `school_id` — this is the primary tenant filter on every query.
2. Status fields that are commonly filtered use partial indexes covering only the active subset.
3. Full-text search uses GIN indexes with `to_tsvector`.
4. Foreign keys are always indexed — PostgreSQL does not do this automatically.
5. Columns used in JOIN conditions are indexed.
6. Never create an index without a documented query pattern that justifies it.

---

## Performance Targets

| Query Type | Target Latency | Index Strategy |
|---|---|---|
| Student name search (school-scoped) | < 200ms for 100,000 students | GIN full-text on name |
| Fee balance lookup (single student) | < 50ms | school_id + student_id composite |
| Outstanding fees list (school-wide) | < 500ms for 1,000 students | school_id + status partial index |
| Attendance by class and date | < 100ms | school_id + class_id + date composite |
| Audit log by school (recent 100) | < 200ms | school_id + created_at DESC |
| API key lookup by hash | < 20ms | key_hash unique index |
| Message log by provider ID | < 50ms | provider_message_id partial index |

---

## Indexes by Table

---

### `public.schools`

```sql
-- Primary key (auto-created)
-- school_id unique (auto-created from UNIQUE constraint)
-- clerk_org_id unique (auto-created from UNIQUE constraint)

CREATE INDEX idx_schools_status
  ON public.schools(status);
-- Serves: AfriTech admin panel filtering schools by status (active/trial/suspended)

CREATE INDEX idx_schools_country
  ON public.schools(country_code);
-- Serves: Multi-country reporting and country-level queries

CREATE INDEX idx_schools_clerk_org
  ON public.schools(clerk_org_id);
-- Serves: get_school_id() RLS helper lookups — called on every authenticated request
```

---

### `public.school_grade_levels`

```sql
CREATE INDEX idx_grade_levels_school
  ON public.school_grade_levels(school_id);
-- Serves: Loading grade structure during onboarding and subject configuration

CREATE INDEX idx_grade_levels_active
  ON public.school_grade_levels(school_id, is_active)
  WHERE is_active = TRUE;
-- Serves: Active grade level selectors in forms and dropdowns
```

---

### `public.school_subjects`

```sql
CREATE INDEX idx_subjects_school
  ON public.school_subjects(school_id);

CREATE INDEX idx_subjects_level
  ON public.school_subjects(school_id, level_type);
-- Serves: Filtering subjects by level (primary/secondary/a_level) during marks entry
```

---

### `public.students`

```sql
CREATE INDEX idx_students_school_id
  ON public.students(school_id);
-- Serves: Every student query — always filtered by school first

CREATE INDEX idx_students_school_status
  ON public.students(school_id, status)
  WHERE is_deleted = FALSE;
-- Serves: Active student lists — the most common student query pattern

CREATE INDEX idx_students_school_grade
  ON public.students(school_id, grade_id)
  WHERE is_deleted = FALSE;
-- Serves: Grade-level attendance sheets, fee generation by grade

CREATE INDEX idx_students_school_class
  ON public.students(school_id, class_id)
  WHERE is_deleted = FALSE;
-- Serves: Class-level marks entry, attendance by class

CREATE INDEX idx_students_student_id
  ON public.students(student_id);
-- Serves: Student ID lookup (parent login path, student search)

CREATE INDEX idx_students_clerk_user
  ON public.students(clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;
-- Serves: Student portal session — finding student record from Clerk JWT

CREATE INDEX idx_students_fulltext
  ON public.students
  USING GIN(to_tsvector('english', first_name || ' ' || last_name));
-- Serves: Admin search bar — partial name search under 200ms for 100,000 students
-- Note: GIN index with English tokenisation. Sufficient for English names.
-- Non-English names (Bemba, Nyanja etc.) may tokenise suboptimally — acceptable for now.
```

---

### `public.parents`

```sql
CREATE INDEX idx_parents_phone
  ON public.parents(phone_e164)
  WHERE phone_e164 IS NOT NULL;
-- Serves: Parent login — phone number lookup to find existing account
-- Partial index because some parents may not have phone registered

CREATE INDEX idx_parents_email
  ON public.parents(email)
  WHERE email IS NOT NULL;
-- Serves: Email OTP login path, parent lookup by email

CREATE INDEX idx_parents_clerk
  ON public.parents(clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;
-- Serves: RLS policy subqueries — finding parent record from JWT sub claim
```

---

### `public.student_parent_links`

```sql
CREATE INDEX idx_spl_student
  ON public.student_parent_links(student_id);
-- Serves: Finding all guardians for a student

CREATE INDEX idx_spl_parent
  ON public.student_parent_links(parent_id);
-- Serves: Finding all children for a parent (parent portal home screen)

CREATE INDEX idx_spl_parent_user
  ON public.student_parent_links(parent_user_id);
-- Serves: RLS policy — the most frequently called parent access check

CREATE INDEX idx_spl_active
  ON public.student_parent_links(student_id, is_active);
-- Serves: Active link checks — filters out unlinked parents quickly

CREATE INDEX idx_spl_grace_period
  ON public.student_parent_links(grace_period_ends_at)
  WHERE is_active = FALSE AND grace_period_ends_at IS NOT NULL;
-- Serves: Daily job that checks for expired grace periods
```

---

### `public.fee_structures`

```sql
CREATE INDEX idx_fee_structures_school
  ON public.fee_structures(school_id);

CREATE INDEX idx_fee_structures_year_term
  ON public.fee_structures(school_id, academic_year, term_number);
-- Serves: Loading fee structures for a specific term — used in fee record generation

CREATE INDEX idx_fee_structures_grade
  ON public.fee_structures(school_id, grade_id);
-- Serves: Grade-specific fee lookup during student enrolment
```

---

### `public.fee_records`

```sql
CREATE INDEX idx_fee_records_school
  ON public.fee_records(school_id);

CREATE INDEX idx_fee_records_student
  ON public.fee_records(student_id);
-- Serves: Student fee history — parent portal and accountant lookup

CREATE INDEX idx_fee_records_status
  ON public.fee_records(school_id, status)
  WHERE is_deleted = FALSE;
-- Serves: Outstanding fees dashboard — filters for unpaid/partial records

CREATE INDEX idx_fee_records_year_term
  ON public.fee_records(school_id, academic_year, term_number);
-- Serves: Term-level financial reports

CREATE INDEX idx_fee_records_due_date
  ON public.fee_records(due_date)
  WHERE status IN ('unpaid', 'partial') AND is_deleted = FALSE;
-- Serves: Daily reminder scheduler — finds records due in 7/14/30 days
-- Partial index significantly reduces scan size for the cron job
```

---

### `public.payments`

```sql
CREATE INDEX idx_payments_school
  ON public.payments(school_id);

CREATE INDEX idx_payments_fee_record
  ON public.payments(fee_record_id);
-- Serves: Loading payment history for a specific fee record

CREATE INDEX idx_payments_student
  ON public.payments(student_id);
-- Serves: Student payment history — parent portal and accountant view

CREATE INDEX idx_payments_gateway_ref
  ON public.payments(gateway_reference)
  WHERE gateway_reference IS NOT NULL;
-- Serves: Webhook reconciliation — matching incoming gateway webhooks to existing payments

CREATE INDEX idx_payments_receipt
  ON public.payments(receipt_number);
-- Serves: Receipt lookup by number (unique, fast)

CREATE INDEX idx_payments_paid_at
  ON public.payments(school_id, paid_at);
-- Serves: Date-range financial reports

CREATE INDEX idx_payments_verification_status
  ON public.payments(school_id, status)
  WHERE status = 'pending_verification';
-- Serves: Accountant verification queue — shows only pending items
-- Partial index — the verified/rejected set grows large over time, should not be scanned
```

---

### `public.payment_gateways`

```sql
CREATE INDEX idx_gateways_school
  ON public.payment_gateways(school_id);

CREATE INDEX idx_gateways_active
  ON public.payment_gateways(school_id, is_active)
  WHERE is_active = TRUE;
-- Serves: Loading active gateways for the payment page
```

---

### `public.attendance_records`

```sql
CREATE INDEX idx_attendance_school
  ON public.attendance_records(school_id);

CREATE INDEX idx_attendance_student
  ON public.attendance_records(student_id);
-- Serves: Student attendance history — parent portal

CREATE INDEX idx_attendance_class_date
  ON public.attendance_records(school_id, class_id, attendance_date);
-- Serves: Class attendance sheet for a specific day — teacher view

CREATE INDEX idx_attendance_date
  ON public.attendance_records(school_id, attendance_date);
-- Serves: School-wide daily attendance report

CREATE INDEX idx_attendance_absent_unnotified
  ON public.attendance_records(school_id, attendance_date)
  WHERE status = 'absent' AND parent_notified = FALSE;
-- Serves: Notification trigger — finding absent records that need parent notification
-- Partial index — the set of un-notified absences is always small
```

---

### `public.exam_results`

```sql
CREATE INDEX idx_results_school
  ON public.exam_results(school_id);

CREATE INDEX idx_results_student
  ON public.exam_results(student_id);
-- Serves: Student results history — parent portal and report card generation

CREATE INDEX idx_results_class_term
  ON public.exam_results(school_id, class_id, academic_year, term_number);
-- Serves: Class results sheet — teacher marks entry view

CREATE INDEX idx_results_published
  ON public.exam_results(school_id, academic_year, term_number, results_published);
-- Serves: Results publication status check — principal dashboard

CREATE INDEX idx_results_subject
  ON public.exam_results(school_id, subject_code, academic_year, term_number);
-- Serves: Subject-level analysis — department head view
```

---

### `public.staff_members`

```sql
CREATE INDEX idx_staff_school
  ON public.staff_members(school_id);

CREATE INDEX idx_staff_clerk
  ON public.staff_members(clerk_user_id);
-- Serves: Finding staff profile from Clerk user ID in webhook events

CREATE INDEX idx_staff_active
  ON public.staff_members(school_id, is_active)
  WHERE is_active = TRUE;
-- Serves: Active staff list — assignment and invite screens
```

---

### `public.staff_assignments` — REMOVED (migration `0069`)

> Superseded by `public.teacher_assignments` (ADR-037), whose indexes are defined in migration `0020`.

```sql
CREATE INDEX idx_assignments_school
  ON public.staff_assignments(school_id);

CREATE INDEX idx_assignments_staff
  ON public.staff_assignments(staff_user_id);
-- Serves: RLS policy — finding which classes a teacher is assigned to
-- This index is critical — called on every teacher attendance/results query

CREATE INDEX idx_assignments_class
  ON public.staff_assignments(school_id, class_id);
-- Serves: Finding which teachers are assigned to a class
```

---

### `public.staff_permission_grants`

```sql
CREATE INDEX idx_grants_grantee
  ON public.staff_permission_grants(grantee_user_id, school_id, is_active);
-- Serves: has_permission_grant() RLS function — called on every permissive RLS check
-- Composite index critical for performance — called very frequently

CREATE INDEX idx_grants_expiry
  ON public.staff_permission_grants(expires_at)
  WHERE is_active = TRUE;
-- Serves: Hourly expiry job — finds grants where expires_at < NOW()

CREATE INDEX idx_grants_school
  ON public.staff_permission_grants(school_id);
-- Serves: School admin permission management screen
```

---

### `public.message_log`

```sql
CREATE INDEX idx_message_log_school
  ON public.message_log(school_id);

CREATE INDEX idx_message_log_student
  ON public.message_log(student_id)
  WHERE student_id IS NOT NULL;
-- Serves: Student communication history

CREATE INDEX idx_message_log_status
  ON public.message_log(school_id, status);
-- Serves: Communication log filtering by delivery status

CREATE INDEX idx_message_log_provider
  ON public.message_log(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
-- Serves: Delivery status webhook matching — finding the log entry for an incoming status update
```

---

### `public.audit_logs`

```sql
CREATE INDEX idx_audit_school
  ON public.audit_logs(school_id);

CREATE INDEX idx_audit_actor
  ON public.audit_logs(actor_user_id);
-- Serves: "Show me all actions by this user" — AfriTech admin investigation

CREATE INDEX idx_audit_table_record
  ON public.audit_logs(table_name, record_id);
-- Serves: "Show me all changes to this specific record" — record history view

CREATE INDEX idx_audit_created
  ON public.audit_logs(school_id, created_at DESC);
-- Serves: "Show me recent actions at this school" — school audit log view
-- DESC index serves the most common sort direction
```

---

### `public.school_api_keys`

```sql
-- key_hash unique index (auto-created from UNIQUE constraint or explicit)
CREATE UNIQUE INDEX idx_api_keys_hash
  ON public.school_api_keys(key_hash);
-- Serves: API key authentication — the lookup path for every external API request
-- Must be as fast as possible — latency adds to every authenticated request

CREATE INDEX idx_api_keys_school
  ON public.school_api_keys(school_id, is_active)
  WHERE is_active = TRUE;
-- Serves: School API key management screen
```

---

### `public.report_generation_jobs`

```sql
CREATE INDEX idx_report_jobs_run
  ON public.report_generation_jobs(run_id);
-- Serves: Supabase Realtime subscription filter — progress updates grouped by run

CREATE INDEX idx_report_jobs_school
  ON public.report_generation_jobs(school_id, status);
-- Serves: Active generation job status check
```

---

### `public.onboarding_checklists`

```sql
CREATE INDEX idx_onboarding_school
  ON public.onboarding_checklists(school_id);
-- Serves: Loading checklist status for a school — dashboard and AfriTech admin view

CREATE INDEX idx_onboarding_incomplete
  ON public.onboarding_checklists(school_id, is_complete)
  WHERE is_complete = FALSE;
-- Serves: "Schools with incomplete onboarding" — AfriTech admin outreach list
```

---

### `private.loan_applications`

```sql
CREATE INDEX idx_loan_parent
  ON private.loan_applications(parent_user_id);
-- Serves: Parent portal — "show my loan applications"
-- RLS policy SELECT check

CREATE INDEX idx_loan_school
  ON private.loan_applications(school_id);
-- Serves: AfriTech loan officer school-level view

CREATE INDEX idx_loan_status
  ON private.loan_applications(status);
-- Serves: Loan operations dashboard — filtering by application status

CREATE INDEX idx_loan_fee_record
  ON private.loan_applications(fee_record_id);
-- Serves: Linking loan disbursement back to the fee record for automatic payment recording
```

---

### `private.loan_consent_log`

```sql
CREATE INDEX idx_consent_log_parent
  ON private.loan_consent_log(parent_user_id);
-- Serves: Compliance audit — find all consents for a specific parent

CREATE INDEX idx_consent_log_application
  ON private.loan_consent_log(loan_application_id);
-- Serves: Finding the consent record for a specific loan application
```

---

### `afritech.staff_scope_assignments`

```sql
CREATE INDEX idx_scope_afritech_user
  ON afritech.staff_scope_assignments(afritech_user_id, is_active)
  WHERE is_active = TRUE;
-- Serves: Scope enforcement — finding which schools/regions a team member can access
-- Called on every AfriTech team member data access

CREATE INDEX idx_scope_country
  ON afritech.staff_scope_assignments(country_code)
  WHERE scope_type = 'country' AND is_active = TRUE;
-- Serves: Country-level scope assignment lookups
```

---

## When to Add a New Index

Add a new index when:
- A query consistently takes over 200ms in Supabase's query performance dashboard
- A new filter pattern is introduced that is not covered by existing indexes
- A new JOIN condition is added that references an unindexed column
- A new partial index would significantly reduce the scan size for a frequent query

Do not add an index when:
- The table has under 10,000 rows (sequential scan is often faster)
- The column has very low cardinality (boolean fields on small tables — not worth indexing)
- The query runs infrequently (admin reports run once per month — index overhead not justified)

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 5 API reference documentation |
| 2026-04-26 | Added payment verification status partial index | Payment verification queue workflow |
| 2026-04-26 | Added school_api_keys hash index | API key authentication path |
| 2026-04-26 | Added onboarding checklist indexes | Progressive onboarding model |
