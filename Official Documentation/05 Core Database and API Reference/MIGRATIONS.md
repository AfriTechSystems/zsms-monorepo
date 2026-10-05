# MIGRATIONS.md — Database Migration Reference

## Related Documents

- `docs/DATABASE.md` — full SQL definitions for every table
- `docs/api/SCHEMA.md` — human-readable schema reference
- `docs/RLS.md` — RLS policies applied in migrations
- `docs/CONVENTIONS.md` — migration file naming conventions
- `docs/infra/SUPABASE.md` — migration commands and application process
- `docs/CHANGELOG.md` — record of when migrations were applied

---

## Purpose

This document is the master migration reference. It lists every planned migration file in sequence, what it creates or modifies, and which documents it relates to. Claude Code reads this before creating any new migration to ensure correct sequence numbering and to avoid duplicating or conflicting with existing migrations. Every time a new migration is added, this document is updated.

---

## Migration Rules (Must Read Before Creating Any Migration)

1. Never modify an existing migration file after it has been applied to any environment.
2. Always create a new forward-only migration for any change.
3. Check this document for the next available sequence number before naming a new file.
4. Test every migration on `zsms-dev` before applying to `zsms-staging`, and on `zsms-staging` before applying to `zsms-zm` (production).
5. After applying a migration, regenerate TypeScript types: `supabase gen types typescript --linked > packages/types/database.ts`.
6. Add a CHANGELOG.md entry after every production migration.
7. Migrations that affect RLS policies must be reviewed alongside `01 Foundation Layer/RLS.md`.
8. Apply migrations with the Supabase CLI (`npm run db:push`), never with `supabase migration new` and never with the MCP on staging or production. See *Migration Versioning and Application Procedure* below — the four-digit version must always match the filename.

---

## Migration File Location

All migration files live in: `supabase/migrations/`

File naming convention: `NNNN_description_of_change.sql`

---

## Migration Versioning and Application Procedure

**The Supabase CLI is the only supported way to apply a migration.** This is not a preference — it is the mechanism that keeps the remote migration history aligned with the filenames in `supabase/migrations/`.

### Why the convention is strict

Supabase records applied migrations in `supabase_migrations.schema_migrations`, keyed by a **version string** taken from the leading digits of the filename. ZSMS uses four-digit versions (`0001`, `0002`, …) per `CONVENTIONS.md`.

Two things break that alignment:

| Hazard | Effect |
|---|---|
| `supabase migration new <name>` | Generates a **timestamp-prefixed** filename (`20260813143727_name.sql`), not `NNNN_`. |
| Applying via the Supabase MCP `apply_migration` tool | Records a **timestamp version** in history regardless of the filename, so history and file no longer correspond. |

Either produces a history row with no matching file, and `supabase db push` can then re-apply or skip migrations incorrectly.

**The ordering hazard is the serious one.** Versions sort as strings. A timestamp version (`20260813143727`) sorts *after* every four-digit version, so once one exists, all subsequent `NNNN_` migrations sort before it. Migration order is the one property the whole sequence depends on — `0003` creates `schools`, `0017` creates `staff_permission_grants`, and `0001`'s helpers assume both arrive in order.

### Procedure — creating and applying a migration

1. **Read the next available number** from *Next Available Sequence Number* below. Never guess it.
2. **Create the file by hand** at `supabase/migrations/NNNN_description.sql`, four-digit zero-padded, snake_case description.
   **Do not run `supabase migration new`** — it generates a timestamp name.
3. **Link the project once per machine** (dev only):
   ```bash
   npx supabase link --project-ref tevblmcebsqqjgzjptgw
   ```
4. **Apply to `zsms-dev`:**
   ```bash
   npm run db:push
   ```
5. **Verify local and remote versions match** — the two columns must show the same four-digit numbers, with no timestamp rows:
   ```bash
   npm run db:list
   ```
6. **Confirm no schema drift:**
   ```bash
   npm run db:diff      # expected: no differences
   ```
7. **Regenerate types** (never hand-write them — prohibition 3 in `CONVENTIONS.md`):
   ```bash
   npm run db:types
   ```
8. **Update this document** — mark the migration applied, add a Change Log row, and advance *Next Available Sequence Number*.

The CLI is pinned as a root `devDependency`, so `npm run db:*` uses the same version for every developer and in CI. Do not rely on a globally installed `supabase` binary.

### If the MCP is used instead

The MCP `apply_migration` tool is acceptable for **exploration on `zsms-dev` only**. It is never used on `zsms-staging` or `zsms-zm`. When it is used, the history row must be corrected **in the same session**, before any further migration is applied:

```sql
-- Replace the MCP's timestamp version with the four-digit filename version
UPDATE supabase_migrations.schema_migrations
SET    version = 'NNNN'
WHERE  version = '<timestamp the MCP recorded>';
```

Then re-run `npm run db:list` and confirm no timestamp versions remain. This correction was required for `0001` (see below).

### Staging and production

`supabase db push` against `zsms-staging` or `zsms-zm` is a **release action, not a development action**. It follows prohibition 10 in `CONVENTIONS.md` — dev verified, then staging verified, then production — and requires explicit human approval each time. Automated tooling and AI assistants apply migrations to `zsms-dev` only.

---

## Complete Migration Sequence

### Foundation (Must Run First)

**`0001_rls_helper_functions.sql`** — ✅ **APPLIED to `zsms-dev` 2026-08-13**
Enables required extensions and creates the seven PostgreSQL helper functions that all RLS policies depend on. Must run before any other migration.
- Enables: `vector`, `pgtap` — both `WITH SCHEMA extensions`, never `public`
- Creates: `get_school_id()`, `get_user_role()`, `get_user_id()`, `is_afritech_admin()`, `is_impersonation_session()`, `get_actor_id()`, `has_permission_grant()`
- Grants: EXECUTE to `authenticated` and `anon` (`has_permission_grant` to `authenticated` only)
- Related: `01 Foundation Layer/RLS.md` — authoritative for all seven bodies, implemented verbatim

**Helper naming — reconciled to one set.** Phase 0 scaffolding proposed two additional helpers, `is_afritech_staff()` and `is_school_admin()`. Neither was created: both duplicate capability that already exists, and competing near-synonyms in a security layer are how the wrong check ends up in a policy. The mapping is:

| Proposed | Resolution |
|---|---|
| `is_afritech_staff()` | **Dropped** — use `is_afritech_admin()`. Broader AfriTech-role scoping is handled by `afritech.staff_scope_assignments` (migration `0032`), not a JWT predicate. |
| `is_school_admin()` | **Dropped** — use `get_user_role() IN ('org:owner','org:principal','org:admin')`, the pattern `RLS.md` already uses throughout. |

**`SET LOCAL check_function_bodies = off`.** `has_permission_grant()` reads `public.schools` (migration `0003`) and `public.staff_permission_grants` (`0017`), neither of which exists at `0001`. `LANGUAGE SQL` bodies are validated at CREATE time, so body checking is disabled for this transaction only. The function is never called before those tables exist.

**Migration history version.** `0001` was applied via the Supabase MCP, which recorded the timestamp version `20260813143727`. The history row was corrected to `0001` so it matches the `NNNN_` filename convention in `CONVENTIONS.md` and `supabase db push` reconciles cleanly. This is why the CLI is now mandatory for every subsequent migration — see *Migration Versioning and Application Procedure* above.

---

**`0019_revoke_delete_privileges.sql`** — ✅ **APPLIED to `zsms-dev` 2026-08-15**
Removes the `DELETE`/`TRUNCATE` privileges Supabase's default grants hand to `authenticated` on every new `public` table.
- Found by the pgTAP isolation suite, not by review — `0003`–`0018` revoked those for `anon` but only *added* grants for `authenticated`, which does not remove what it already held
- Policies written `FOR ALL` cover DELETE, so on those paths the privilege was live: a super admin could hard-delete a student, contradicting prohibition 8
- Also sets `ALTER DEFAULT PRIVILEGES` so later tables inherit the correction, and verifies itself inline — raises at apply time if any grant survives

**`0020_create_teaching_assignment_tables.sql`** — ✅ **APPLIED to `zsms-dev` 2026-08-15**
The scope-based teaching-assignment model (ADR-037).
- Creates: `public.class_subjects`, `public.teacher_assignments`
- Creates: `teacher_reaches_class()` — the single `SECURITY DEFINER` predicate behind all teacher scoping
- Replaces the never-defined `class_enrolments` referenced by four documents
- Related: `01 Foundation Layer/RLS.md`, `01 Foundation Layer/DECISIONS.md` — ADR-037

**`0021_update_teacher_student_policy.sql`** — ✅ **APPLIED to `zsms-dev` 2026-08-15**
Repoints `teacher_read_assigned_students` at `teacher_reaches_class()`.
- Drops `teacher_assigned_to_class()`, the `0016` interim helper — two predicates answering "which students may this teacher see" is how the wrong one ends up in a future policy
- Marks `staff_assignments` superseded via `COMMENT`; the table is retained, not dropped

---

**`0070_create_fee_tables.sql`** — ✅ **APPLIED to `zsms-dev` 2026-08-15**
Fee structures, the per-student ledger, payments with the submission/verification workflow, and gateway configuration.
- Creates: `public.fee_structures`, `public.fee_records`, `public.payments`, `public.payment_gateways`
- **Resolves a document conflict:** `SCHEMA.md` and the 2026-04-26 `CHANGELOG.md` entry specify the payment verification columns; `DATABASE.md`'s DDL omitted them. SCHEMA.md governs; `DATABASE.md` corrected alongside.

**`0071_create_fee_rls.sql`** — ✅ **APPLIED 2026-08-15**
RLS for the fee tables, plus `parent_has_child_at_school()`, `parent_can_access_fee_record()`, and `is_own_student_record()`.
- Adds `parent_submit_payment`: a parent may submit against their own child's record, pinned to `pending_verification` and to themselves as recorder.
- Teachers get no fee policy at all — teaching scope and financial scope are separate.

**`0072_create_attendance_table.sql`** — ✅ **APPLIED 2026-08-15**
- Creates: `public.attendance_records`

**`0073_create_exam_results_table.sql`** — ✅ **APPLIED 2026-08-15**
- Creates: `public.exam_results`, `public.report_generation_jobs`

**`0074_create_academic_rls.sql`** — ✅ **APPLIED 2026-08-15**
RLS for attendance and results, plus `teacher_teaches_subject()` (ADR-037).
- Attendance uses `teacher_reaches_class()`; marks use the narrower `teacher_teaches_subject()`.
- **The publication lock moved into the policy.** `RLS.md` left it to the application layer, which would let any direct PostgREST call edit a published mark.

**`0075_fee_lifecycle_functions.sql`** — ✅ **APPLIED 2026-08-15**
- Creates: `generate_fee_records()`, `assign_receipt_number()` trigger, `recalculate_fee_record_balance()` trigger, `verify_payment()`, `publish_results()`
- Receipt numbering locks the school row — two concurrent payments computing `count + 1` would otherwise collide.
- `fee_records.amount_paid` is derived from **verified** payments only, by trigger, so it cannot drift.

**`0076_revoke_payment_update_privilege.sql`** — ✅ **APPLIED 2026-08-15**
Revokes the inherited `UPDATE` on `public.payments`.
- Found by the Phase 2 suite. Same root cause as `0019`: Supabase's default grant, never revoked. `afritech_admin_all_payments` is `FOR ALL`, so a super admin could have edited a payment in place, bypassing `verify_payment()`.
- Verifies itself inline.

---

**`0077_create_fee_balance_views.sql`** — ✅ **APPLIED to `zsms-dev` 2026-08-15**
Derived arrears (ADR-038).
- Creates: `public.fee_record_status`, `public.student_fee_balance` (both `security_invoker = true`), `public.fee_statement()`
- Spans every year and term, and does **not** filter on `students.status` — a graduated or transferred student keeps a visible balance
- **Computes and exposes only. Nothing gates on these.**

**`0078_create_payment_allocation.sql`** — ✅ **APPLIED 2026-08-15**
- Creates: `suggest_payment_allocation()`, `allocate_payment()` — oldest-first by default, bursar-overridable

**`0079_create_fee_revision.sql`** — ✅ **APPLIED 2026-08-15**
- Creates: `public.fee_record_revisions`, `revise_fee_records()`
- Closes the gap `generate_fee_records()`'s idempotency left: an already-issued term fee could not be corrected
- Refuses to drop a fee below verified payments; audits every change

**`0080_fix_allocate_payment_ambiguity.sql`** — ✅ **APPLIED 2026-08-15**
- `RETURNS TABLE` columns became PL/pgSQL variables that collided with the internal temp table's, so `allocate_payment()` aborted on every call. OUT columns prefixed `out_`.

**`0081_fix_fee_statement_ordering.sql`** — ✅ **APPLIED 2026-08-15**
- `fee_statement()` dated charges by `created_at`, so a term's records shared a timestamp and the closing balance was **non-deterministic**. Charges now date by `due_date` and order on a complete key.

---

**`0082`-`0089`** - APPLIED to `zsms-dev` 2026-08-15 (Phase 3)
- `0082` `afritech.subscription_tiers` - the empty `afritech` schema finally gets its first table, because per-tier WhatsApp quotas cannot be "admin controlled, never hardcoded" while the ceilings live only in a markdown table
- `0083`/`0084` `message_log`, `school_message_quotas`, `notification_templates` + RLS, `consume_message_quota()`, `resolve_notification_template()`, `record_message_dispatch()`
- `0085` platform-default message wording for every Phase 3 notification
- `0086` `announcements`, `announcement_reads` + RLS
- `0087` `generated_documents`, `job_runs` + RLS and their writer functions
- `0088` fixes an ambiguous column reference in `consume_message_quota()` - the same `RETURNS TABLE` collision as `0080`, which made quota enforcement fail on every call
- `0089` closes the default-privilege class. Third instance of one mechanism (after `0019` and `0076`): Supabase grants `ALL` on new objects, so a migration that only adds grants leaves the rest switched on. Sets `ALTER DEFAULT PRIVILEGES` so new tables arrive with nothing, and verifies inline.

---

**`0090`** - APPLIED to `zsms-dev` 2026-08-15 (Phase 3)
- `0090_create_worker_access_functions.sql` — the read surface for Railway background workers, under ADR-042.

  Seven `SECURITY DEFINER` functions: `worker_payment_context()`, `worker_due_fee_reminders()`, `worker_mark_reminder_sent()`, `worker_claim_scheduled_announcements()`, `worker_announcement_recipients()`, `worker_complete_announcement()`, `worker_report_card_batch()`. Each is `REVOKE ALL ... FROM PUBLIC, authenticated, anon` and `GRANT EXECUTE ... TO service_role`.

  **Why these exist at all.** ADR-042 permits a worker to hold the service role key, so its connection bypasses RLS entirely. Rather than let the worker issue arbitrary table queries against an unpoliced connection, every read it needs is expressed as a function that anchors its own joins to one school internally. `worker_announcement_recipients()` deliberately takes no `school_id` argument — recipients derive from the announcement's own school, which makes cross-school fan-out unexpressible rather than merely unauthorised.

  `worker_claim_scheduled_announcements()` uses `FOR UPDATE SKIP LOCKED`, so two cron runners cannot claim the same announcement and send it twice.

---

**`0091`** - APPLIED to `zsms-dev` 2026-08-15 (Phase 3)
- `0091_close_worker_direct_table_access.sql` — `worker_update_dispatch()` and `worker_school_branding()`.

  `0090` built the worker's read surface, but three statements in `apps/workers/src` still went straight at tables: an UPDATE of `message_log` by id, and two reads of `schools`. None was exploitable — every id came from a `worker_*` call earlier in the same chain — but the `message_log` UPDATE was an **unanchored write on a connection that bypasses RLS**, which is the exact statement ADR-042 exists to make unavailable.

  Kept absolute rather than qualified: `.from(` appearing anywhere in `apps/workers` is now a defect, with no exceptions to weigh. A rule reading "no direct table access except reads of `schools` by primary key" would need re-litigating by every reviewer and would not have covered the write.

  `worker_update_dispatch()` sets the terminal timestamps from the status internally, so a worker cannot stamp `delivered_at` on a message the provider refused. It deliberately carries **no status whitelist** — `message_log` already has a CHECK listing the nine valid statuses, and a second copy would be one more thing to keep in step (the first draft of the function already omitted four of them).

  Covered by `supabase/tests/rls/worker_boundary_test.sql` (26 assertions, both migrations).

**`0092`** - APPLIED to `zsms-dev` 2026-08-16 (Phase 4)
- `0092_create_school_branding.sql` — per-school theming, with the accessibility guardrail in the database.

  Creates `public.school_branding` (one row per school, `school_id` as both primary key and tenant column), `srgb_relative_luminance()` and `wcag_contrast_ratio()`, and `school_branding_by_slug()`.

  **The WCAG maths is in SQL because the guardrail has to hold for writers that are not the API.** `validateTheme()` in `packages/design-tokens` gives a school a readable error; the CHECK constraints hold for an admin tool, a support script, or a bulk import. Anchor ≥4.5:1 against white (white nav text sits on it), primary ≥3:1 (used unmodified as a button fill). ADR-043.

  **The format constraints are not redundant with the contrast constraints.** A CHECK that evaluates to NULL *passes*, and `wcag_contrast_ratio()` returns NULL for a malformed colour — without `~ '^#[0-9A-Fa-f]{6}$'`, `'#GGGGGG'` would be stored.

  `school_branding_by_slug()` is granted to `anon` and is the only anon-reachable path: the parent login screen must be branded before a session exists, so RLS has nothing to resolve. It returns one school by `lower(school_id)` — the same value used as the Clerk organisation slug — with exactly five keys, pinned by test so a new `schools` column cannot widen an unauthenticated surface by accident.

  Also replaces `worker_school_branding()` (0091) additively, adding the brand colours so report cards and statements are themed.

  Covered by `supabase/tests/rls/school_branding_test.sql` (36 assertions).

**`0093`** - APPLIED to `zsms-dev` 2026-08-16 (Phase 4)
- `0093_theme_worker_payment_context.sql` — brand colours in the receipt job's context.

  `0092` themed the branding function, which covers report cards and statements. Receipts take a different route: `worker_payment_context()` assembles the whole receipt from a payment id in one call, and its embedded `school` object predates `school_branding`. Left alone, a maroon school would send maroon report cards and ZSMS-blue receipts — and the receipt is the document a parent is most likely to keep and to question.

  Only the `school` object changes; every join stays anchored to the payment's own `school_id`, and `school_branding` joins on `s.id` so it cannot introduce a second school.

**`0094`** - APPLIED to `zsms-dev` 2026-08-17 (Phase 4)
- `0094_retune_branding_contrast_ground.sql` — the guardrail is re-measured against the page, not white.

  The design foundation moved the page to a soft lavender-grey (`#F1F3FA`) with white cards. That ground is **darker than white**, so `0092`'s thresholds were measuring against the easier of the two surfaces a colour is drawn on. The gap is one-directional: a palette could pass `0092` and still be unreadable in place. `#6E7690` is the worked example — 4.51:1 on white, 4.07:1 on the page.

  Measuring against the page subsumes the white case rather than trading one for it: for a dark anchor, contrast against white is always higher, so clearing the page clears white too.

  `PAGE_GROUND` in `packages/design-tokens/src/theme.ts` holds the same literal and `validateTheme()` uses it. **These two move together** or the database and the API begin disagreeing about which palettes a school may save.

**`0095`** - APPLIED to `zsms-dev` 2026-08-17 (Phase 4)
- `0095_create_feature_access_tables.sql` — the three feature-access tables that were documented but absent.

  `CLAUDE.md` and ADR-014 both state that four `afritech` tables drive pricing and feature access. **Three of them did not exist**; the schema held `subscription_tiers` alone. Created here to the DDL `PRICING.md` already specified, adopted as written including the seed matrix, plus RLS on all three.

  Also adds `public.school_has_feature(school_id, feature_key)` — the resolution order as a function rather than a query each caller assembles, because `DYNAMIC_CONFIG.md` is explicit that the order is fixed logic and not configuration. **Revoke wins outright**: a revoke exists because someone decided a school must NOT have something, and a later grant that silently overturns it is how a suspended school keeps a feature it was cut off from.

  The documented fifth step, module subscription, has no table. It is omitted and named in the function's comment rather than approximated.

**`0096`** - APPLIED to `zsms-dev` 2026-08-17 (Phase 4)
- `0096_create_platform_metrics.sql` — `platform_metrics()` and `school_health_scores()`.

  **Both are `SECURITY INVOKER`, and that is the design.** Every table they read already carries an `afritech_admin_all_*` policy, so RLS already answers "who may see across schools". The obvious `SECURITY DEFINER` shape would put a second copy of that authorisation rule somewhere no test covers. The migration fails if either function is ever changed to definer.

  Health follows `SCHOOL_HEALTH_SCORES.md`'s 40/30/30 weights and 80/65/45 bands. Four of the six documented inputs are computable from this schema; the two that are not need per-user login telemetry and mobile session data. Each dimension is rescaled over the inputs that exist, so a missing one does not read as a zero, and `inputs_available` is returned so a dashboard can mark the score provisional.

**`0097`** - APPLIED to `zsms-dev` 2026-08-17 (Phase 4)
- `0097_expose_feature_access_to_api.sql` — `security_invoker` views and named write functions over the 0095 tables.

  PostgREST exposes a configured schema list and `afritech` is not on it, deliberately. Rather than widen that — which would put every future `afritech` table one URL away from the internet, opted *out* rather than in — the three relations the admin dashboard needs are surfaced through `public`.

  Writes go through `admin_set_tier_feature()`, `admin_create_override()`, and `admin_revoke_override()` so the API never issues a free-form UPDATE against a pricing table. All invoker-rights: authorisation stays in the 0095 policies and nowhere else. Revoking an override is an UPDATE, not a DELETE — the row is the only record that a support decision was made.

**`0098`** - APPLIED to `zsms-dev` 2026-08-17 (Phase 4)
- `0098_expose_subscription_tiers.sql` — pricing view, `admin_update_tier()`, and **RLS on `subscription_tiers`, which had none**.

  A view is not a security boundary. Exposing an unpoliced base table through a public view makes it readable by anyone, so the policy was added in the same migration as the view rather than left for later.

---

### Core Schemas

**`0002_create_schemas.sql`**
Creates the `private` and `afritech` schemas. Must run before any table in those schemas is created.
- Creates: `private` schema, `afritech` schema
- Grants: `USAGE ON SCHEMA private TO authenticated`, `USAGE ON SCHEMA afritech TO service_role`
- Related: `docs/DATABASE.md`, `docs/RLS.md`

---

### School and Configuration Tables

**`0003_create_schools_table.sql`**
Creates the root tenant table. All other tables depend on this.
- Creates: `public.schools`
- Related: `docs/DATABASE.md` — schools table

**`0004_create_schools_rls.sql`**
Applies all RLS policies to the schools table.
- Creates: RLS policies for `public.schools`
- Related: `docs/RLS.md` — schools table policies

**`0005_create_school_academic_config.sql`**
Creates the school academic structure configuration table.
- Creates: `public.school_academic_config`
- Related: `docs/DATABASE.md`, `docs/modules/school/SCHOOL_CONFIG.md`

**`0006_create_school_grade_levels.sql`**
Creates the flexible grade level configuration table. Replaces the simpler grade_config approach.
- Creates: `public.school_grade_levels`
- Related: `docs/DATABASE.md`, `docs/countries/ZM.md`

**`0007_create_school_subjects.sql`**
Creates the per-school subject registry.
- Creates: `public.school_subjects`
- Related: `docs/DATABASE.md`, `docs/countries/ZM.md`

**`0008_create_school_grading_scales.sql`**
Creates the grading scale configuration per school.
- Creates: `public.school_grading_scales`
- Related: `docs/DATABASE.md`, `docs/modules/results/GRADING.md`

**`0009_create_reference_subjects_zm.sql`**
Creates the global Zambia subject reference table and seeds it with all standard subjects.
- Creates: `public.reference_subjects_zm`
- Inserts: All subjects defined in `docs/countries/ZM.md`
- Related: `docs/countries/ZM.md`, `docs/modules/school/ONBOARDING.md`

**`0010_create_onboarding_checklists.sql`**
Creates the onboarding progress tracking table.
- Creates: `public.onboarding_checklists`
- Related: `docs/modules/school/ONBOARDING.md`

---

### Student and Parent Tables

> **ORDERING CORRECTION (2026-08-14) — `0014`–`0018` differ from the original plan.**
>
> The sequence below originally read: `0014` student RLS · `0015` staff tables · `0016` staff RLS · `0017` permission tables · `0018` permission RLS.
>
> That order cannot execute. The student policies (`management_write_students`, `management_update_students`) and the staff policy (`management_write_assignments`) all call `has_permission_grant()`, which reads `public.staff_permission_grants` — created at `0017`. A policy evaluated before its table exists raises `relation does not exist`, so every query against `students` would error rather than filter.
>
> The student policies also resolve a teacher's classes through `public.staff_assignments`, created at `0015`. The `SECURITY DEFINER` helper encoding that lookup is `LANGUAGE SQL`, whose body is validated at `CREATE` time — so the staff tables must precede the student policies too.
>
> **Corrected order, as implemented:**
>
> | Version | Contents |
> |---|---|
> | `0014` | Permission tables — `school_permissions`, `staff_permission_grants` (moved up from `0017`) |
> | `0015` | Staff tables — `staff_members`, `staff_assignments`, `staff_requests` |
> | `0016` | Student, parent, and link RLS |
> | `0017` | Staff RLS |
> | `0018` | Permission RLS |
>
> `0014` and `0015` enable RLS on their tables immediately and defer only the policies. A table with RLS enabled and no policies denies everything, so each gap fails closed rather than leaving the permission-grant table readable.

**`0011_create_students_table.sql`**
Creates the central student entity table.
- Creates: `public.students`
- Related: `docs/DATABASE.md` — students table

**`0012_create_parents_table.sql`**
Creates the parent account table.
- Creates: `public.parents`
- Related: `docs/DATABASE.md` — parents table

**`0013_create_student_parent_links.sql`**
Creates the many-to-many link between students and parents with grace period support.
- Creates: `public.student_parent_links`
- Related: `docs/DATABASE.md` — student_parent_links table

**`0014_create_student_rls.sql`**
Applies all RLS policies to student, parent, and link tables.
- Creates: RLS policies for `public.students`, `public.parents`, `public.student_parent_links`
- Related: `docs/RLS.md` — student and parent policies

---

### Staff Tables

**`0015_create_staff_tables.sql`**
Creates all staff-related tables in one migration.
- Creates: `public.staff_members`, `public.staff_assignments`, `public.staff_requests`
- Related: `docs/DATABASE.md` — staff tables

**`0016_create_staff_rls.sql`**
Applies RLS policies to all staff tables.
- Creates: RLS policies for staff tables
- Related: `docs/RLS.md` — staff table policies

---

### Permission System Tables

**`0017_create_permission_tables.sql`**
Creates the school-level permission configuration and individual grant tables.
- Creates: `public.school_permissions`, `public.staff_permission_grants`
- Related: `docs/DATABASE.md`, `docs/modules/auth/PERMISSIONS.md`

**`0018_create_permission_rls.sql`**
Applies RLS policies to permission tables.
- Creates: RLS policies for `public.school_permissions`, `public.staff_permission_grants`
- Related: `docs/RLS.md` — permission table policies

---

### Fee and Financial Tables

> **RENUMBERED (2026-08-15) — these were `0019`–`0021`.**
>
> Phase 1 consumed `0019`, `0020`, and `0021` for the DELETE-privilege revocation and the ADR-037 teaching-assignment model. Those three are **applied to `zsms-dev`**, and an applied migration cannot be renumbered — its version is recorded in `supabase_migrations.schema_migrations` and is the identity `supabase db push` reconciles against.
>
> The planned-but-unwritten migrations below therefore move to the end of the sequence. Nothing about their content changes; only their version does.
>
> **This collision was avoidable.** Rule 3 says to read *Next Available Sequence Number* before naming a file. That pointer read `0066` at the time — correct, because `0022`–`0065` were already claimed by plan — and it was not consulted. Read it, not the last number on disk.

**`0066_create_fee_tables.sql`** *(was `0019`)*
Creates all fee-related tables.
- Creates: `public.fee_structures`, `public.fee_records`, `public.payments`, `public.payment_gateways`
- Related: `01 Foundation Layer/DATABASE.md` — fee tables

**`0067_create_fee_rls.sql`** *(was `0020`)*
Applies RLS policies to all fee and payment tables.
- Creates: RLS policies for fee tables
- Related: `01 Foundation Layer/RLS.md` — fee table policies

**`0068_create_message_quota_table.sql`** *(was `0021`)*
Creates the WhatsApp message quota tracking table.
- Creates: `public.school_message_quotas`
- Related: `03 Infrastructure Services/META_API.md`, `12 Communication/WHATSAPP.md`

---

### Attendance and Academic Tables

**`0022_create_attendance_table.sql`**
Creates the attendance records table.
- Creates: `public.attendance_records`
- Related: `docs/DATABASE.md` — attendance table

**`0023_create_exam_results_table.sql`**
Creates the exam results and report generation tables.
- Creates: `public.exam_results`, `public.report_generation_jobs`
- Related: `docs/DATABASE.md` — results tables

**`0024_create_academic_rls.sql`**
Applies RLS policies to attendance and exam results tables.
- Creates: RLS policies for `public.attendance_records`, `public.exam_results`
- Related: `docs/RLS.md` — attendance and results policies

---

### Communication Tables

**`0025_create_communication_tables.sql`**
Creates the message log table.
- Creates: `public.message_log`
- Related: `docs/DATABASE.md` — message_log table

**`0026_create_communication_rls.sql`**
Applies RLS policies to the message log.
- Creates: RLS policies for `public.message_log`
- Related: `docs/RLS.md`

---

### Document and Template Tables

**`0027_create_document_tables.sql`**
Creates the document template configuration table.
- Creates: `public.document_templates`
- Related: `docs/DATABASE.md`, `docs/modules/documents/TEMPLATE_SYSTEM.md`

---

### API Integration Tables

**`0028_create_api_integration_tables.sql`**
Creates the tables supporting external API access and webhook registration.
- Creates: `public.school_api_keys`, `public.school_webhooks`
- Related: `docs/api/API_INTEGRATION.md`

**`0029_create_api_rls.sql`**
Applies RLS policies to API key and webhook tables.
- Creates: RLS policies for `public.school_api_keys`, `public.school_webhooks`
- Related: `docs/RLS.md`

---

### Private Schema — Loan Tables

**`0030_create_loan_tables.sql`**
Creates all loan-related tables in the private schema.
- Creates: `private.loan_applications`, `private.loan_consent_log`
- Related: `docs/DATABASE.md` — private schema tables, `docs/modules/loans/LOANS.md`

**`0031_create_loan_rls.sql`**
Applies RLS policies to all private schema loan tables.
- Creates: RLS policies for `private.loan_applications`, `private.loan_consent_log`
- Related: `docs/RLS.md` — private schema policies

---

### AfriTech Internal Schema

**`0032_create_afritech_schema_tables.sql`**
Creates the AfriTech internal scope assignment table.
- Creates: `afritech.staff_scope_assignments`
- Related: `docs/modules/auth/ROLES.md`, `docs/modules/admin/SUPERADMIN.md`

---

### Indexes

**`0033_add_indexes.sql`**
Creates all database indexes. Applied after all tables exist to ensure no missing table errors.
- Creates: All indexes defined in `docs/api/INDEXES.md`
- Related: `docs/api/INDEXES.md`

---

### Triggers

**`0034_add_triggers.sql`**
Creates all database triggers.
- Creates:
  - `set_updated_at_on_[table]` — for every table with `updated_at` column
  - `queue_absence_notification_on_attendance` — fires on INSERT where status = 'absent'
  - `set_grace_period_on_student_parent_links` — fires on UPDATE when is_active changes to FALSE
- Related: `docs/DATABASE.md` — triggers section, `docs/infra/QSTASH.md`

---

### Audit Log Table (Last — Applied After Everything Else)

**`0035_create_audit_logs.sql`**
Creates the audit log table last because it references all other tables conceptually. Applied after all other tables exist.
- Creates: `public.audit_logs`
- Creates: RLS policies for `public.audit_logs` (no INSERT policy for users — service role only)
- Related: `docs/DATABASE.md` — audit_logs table, `docs/RLS.md`

---

## Next Available Sequence Number

**`0208`** — available for the next migration.

`0001`–`0021` and `0069`–`0207` are written and applied to `zsms-dev`, and the whole sequence is verified by CI to apply to an empty database. **`0022`–`0068` are void as numbers.**

### Why the middle block is void

Reserving a block of numbers for planned-but-unwritten migrations does not work, and this document tried to do it. Writing reached `0021`, then `0069`. Everything reserved in between now sorts **below the applied high-water mark**, and `supabase db push` skips a migration older than the last applied one unless `--include-all` is passed — a flag that exists to override a safety check, not to be part of a normal workflow.

So a migration written today as `0030_create_timetables.sql` would simply never apply. The number is not merely taken; it is unreachable.

**The rule going forward: numbers are assigned when a migration is written, never in advance.** The planned entries throughout this document describe *what* is still to be built and in what dependency order — they no longer dictate a number. Each takes the next free number at the time it is authored, and this pointer is updated in the same commit.

The `0022`–`0068` labels are retained in the sequence below only so the descriptions stay findable; read them as ordering, not as filenames.

When creating a new migration, use the number in the pointer above and update this document with the new entry before committing. Read this pointer rather than the highest number in `supabase/migrations/` — most of the sequence is planned here before it exists on disk, which is exactly how the `0019`–`0021` collision happened.

---

## Migration Application Commands

Use the npm scripts rather than a global binary — they resolve the CLI version pinned in the root `devDependencies`, so every developer and CI runner applies migrations with the same tool.

```bash
# Development — the only environment automated tooling may apply to
npx supabase link --project-ref tevblmcebsqqjgzjptgw   # zsms-dev, once per machine
npm run db:push

# Verify: local and remote versions match, no timestamp rows
npm run db:list

# Verify: no schema drift
npm run db:diff

# After any migration, regenerate TypeScript types
npm run db:types

# Run the pgTAP suite
npm run db:test
```

**Staging and production — release actions, human-approved each time.** Project refs are assigned when the projects are provisioned (`zsms-staging` in Phase 0's final steps, `zsms-zm` in Phase 6); both are `af-south-1`.

```bash
# Staging — only after dev is verified
npx supabase link --project-ref <zsms-staging-ref>
npm run db:push

# Production — only after staging is verified (CONVENTIONS.md prohibition 10)
npx supabase link --project-ref <zsms-zm-ref>
npm run db:push
```

Re-link back to `zsms-dev` immediately after any staging or production operation. A stale link is how a development migration reaches production by accident.

---

## Post-Migration Checklist

After every migration applied to production:

- [ ] TypeScript types regenerated: `npm run db:types`
- [ ] `npm run db:list` shows matching four-digit versions, no timestamp rows
- [ ] Supabase dashboard — verify table appears correctly in Table Editor
- [ ] RLS policy verified using the RLS testing SQL in `03 Infrastructure Services/SUPABASE.md`
- [ ] Railway standby replication verified — lag under 5 seconds
- [ ] CHANGELOG.md updated with migration entry
- [ ] This document updated if new migration was added

---

## Migrations Applied to Production

This section is updated each time a migration reaches production.

| Migration | Applied Date | Applied By | Notes |
|---|---|---|---|
| (None yet — pre-development) | — | — | — |

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete plan | Stage 5 API reference documentation — pre-development migration planning |
| 2026-08-13 | **Added migrations `0061`–`0065` — dynamic configuration registry tables** | Closes the gap flagged in `DYNAMIC_CONFIG.md`: eight `afritech` tables were specified with no migration |
| 2026-08-13 | Gap scope corrected from five tables to eight | Cross-check found `platform_settings`, `platform_products`, and `commission_rates` also missing |
| 2026-08-13 | Corrected stale "Next Available Sequence Number" from `0036` to `0066` | The mid-document pointer had not tracked migrations `0036`–`0060` |
| 2026-08-13 | Documented `afritech` RLS convention (deny-by-default, service role only) | Consistent with `0032`, `0053`, `0054`, and the `audit_logs` pattern in `0035` |
| 2026-08-13 | **Migration `0001` written and APPLIED to `zsms-dev`** | Phase 0 scaffold — extensions in `extensions` schema, seven RLS helpers in `public`, zero tables |
| 2026-08-13 | Reconciled proposed `is_afritech_staff()` / `is_school_admin()` to the existing set | Competing near-synonyms in a security layer cause the wrong check to be used in a policy |
| 2026-08-13 | Documented the MCP timestamp-version correction to `0001` | Keeps remote history aligned with the `NNNN_` filename convention for `supabase db push` |
| 2026-08-14 | **Added *Migration Versioning and Application Procedure*** | Establishes the Supabase CLI as the only supported application path, after the MCP desynced `0001`'s history version from its filename |
| 2026-08-14 | Pinned the Supabase CLI as a root `devDependency`; added `db:push`, `db:list`, `db:diff` scripts | The existing `db:types` / `db:test` scripts called a bare `supabase` that was not installed anywhere and would have failed on first use |
| 2026-08-14 | Documented the version **ordering** hazard | Timestamp versions sort after every four-digit version, so one stray timestamp silently reorders the whole sequence |
| 2026-08-14 | Corrected placeholder project refs and the generated-types path in *Migration Application Commands* | `zsms-dev-ref` was a placeholder; the types path omitted `src/` and disagreed with `package.json` |
| 2026-08-15 | **Migrations `0002`–`0018` written and APPLIED to `zsms-dev`** | Phase 1 core domain — schools, students, staff, and RLS for all of them |
| 2026-08-15 | Corrected the `0014`–`0018` ordering | The declared order evaluated policies calling `has_permission_grant()` before the table it reads existed |
| 2026-08-15 | **Added `0019` — revoke inherited DELETE/TRUNCATE** | Caught by the isolation suite: Supabase's default grants left `authenticated` holding DELETE, live on every `FOR ALL` policy path |
| 2026-08-15 | **Added `0020`/`0021` — scope-based teaching assignments (ADR-037)** | Closes the `class_enrolments` gap at its root; supports primary, secondary, and mixed schools without branching on school type |
| 2026-08-15 | **Renumbered the planned fee and message-quota migrations `0019`–`0021` → `0066`–`0068`** | Phase 1 consumed those numbers and its migrations are applied; an applied version cannot move, because it is the identity `supabase db push` reconciles against. Next available is `0069`. |
| 2026-08-15 | **Added `0070`–`0076` — Phase 2 fees, attendance, and results** | Fee lifecycle, teaching-scoped attendance and marks, plus the `0076` privilege fix the suite caught |
| 2026-08-15 | **Declared `0022`–`0068` void as numbers** | They sort below the applied high-water mark, so `db push` would skip them. Numbers are now assigned when a migration is written, never reserved in advance. |
| 2026-08-15 | Corrected the `payments` DDL in `DATABASE.md` | It omitted the verification columns that `SCHEMA.md` and the 2026-04-26 CHANGELOG specify |
| 2026-08-15 | Reconciled the three conflicting *next available* pointers | The document carried `0022`, `0056`, and `0066` in different sections; the pointer under *Next Available Sequence Number* is now stated as authoritative |
| 2026-08-15 | **Added `0082`–`0089` — Phase 3 communications, quotas, documents, and job records** | Plus `0088`/`0089`, the two defects the suite caught: an ambiguous column that made quota enforcement fail on every call, and the default-privilege class fix |
| 2026-08-15 | **Added `0090` — worker access functions (ADR-042)** | A worker holding the service role key bypasses RLS, so its entire read surface is expressed as school-anchored `SECURITY DEFINER` functions granted to `service_role` alone. |
| 2026-08-15 | **Added `0091` — closed the last three direct table statements in `apps/workers`** | One was an unanchored UPDATE of `message_log` on an unpoliced connection. Not exploitable, but the exact shape ADR-042 forbids; the rule is now absolute and greppable. Next available advances to `0092`. |

---

## New Migrations — Stages 6–17 (0036–0055)

### Custom Roles and Feature Toggles

**`0036_create_school_custom_roles.sql`**
Creates custom staff roles. Custom role holders use `org:staff` Clerk base role (zero default access).
- Creates: `public.school_custom_roles`
- Related: `docs/modules/school/SCHOOL_CONFIG.md`, `docs/modules/auth/ROLES.md`

**`0037_create_module_subscriptions.sql`**
Creates per-school feature add-on purchase tracking.
- Creates: `public.module_subscriptions`
- Related: `docs/modules/school/SUBSCRIPTION.md`, `docs/modules/admin/PRICING.md`

### Timetable Module

**`0038_create_timetable_tables.sql`**
Creates all three timetable tables in one migration.
- Creates: `public.timetables`, `public.timetable_periods`, `public.timetable_slots`
- Related: `docs/modules/staff/TIMETABLE.md`

**`0039_create_timetable_rls.sql`**
Applies RLS. Teachers read own slots. Parents and students read published timetables only.
- Creates: RLS policies for all three timetable tables
- Related: `docs/RLS.md`

### Communication Module

**`0040_create_announcements_tables.sql`**
Creates announcements and full read-tracking tables.
- Creates: `public.announcements`, `public.announcement_reads`
- Related: `docs/modules/communication/ANNOUNCEMENTS.md`

**`0041_create_parent_push_tokens.sql`**
Creates the Expo push notification token registry.
- Creates: `public.parent_push_tokens`
- Related: `docs/modules/attendance/NOTIFICATIONS.md`

**`0042_create_communication_rls_update.sql`**
Applies RLS for announcements, announcement_reads, and parent_push_tokens.
- Creates: RLS policies for three new communication tables
- Related: `docs/RLS.md`

### Student and Parent Updates

**`0043_add_students_new_fields.sql`**
Adds examination_number and alumni_status to students table.
- Adds: `public.students.examination_number TEXT`
- Adds: `public.students.alumni_status TEXT CHECK (alumni_status IN ('active','graduated','transferred'))`
- Related: `docs/modules/students/STUDENTS.md`

**`0044_add_parents_marketing_opt_in.sql`**
Adds marketing_opt_in — separate from whatsapp_opted_in.
- Adds: `public.parents.marketing_opt_in BOOLEAN DEFAULT FALSE`
- Related: `docs/modules/students/PARENT_LINKING.md`

**`0045_create_alumni_profiles.sql`**
Creates permanent platform-level alumni profiles table.
- Creates: `public.alumni_profiles`
- Related: `docs/modules/students/STUDENTS.md`

### Schools WhatsApp Number Fields

**`0046_add_schools_whatsapp_fields.sql`**
Adds school-specific WhatsApp Business number fields to schools table.
- Adds: `whatsapp_phone_number_id TEXT`, `whatsapp_access_token_enc TEXT`, `whatsapp_business_acct_id TEXT`, `whatsapp_owns_number BOOLEAN DEFAULT FALSE`
- Related: `docs/modules/communication/WHATSAPP.md`, `docs/infra/META_API.md`

### Loan Module — Expanded Schema

**`0047_create_lenders_table.sql`**
Creates the lender registry for the loan marketplace.
- Creates: `public.lenders`
- Related: `docs/modules/loans/LENDER_INTEGRATION.md`

**`0048_expand_loan_applications.sql`**
Expands private.loan_applications for lender marketplace and non-school loans.
- Adds: `lender_id`, `loan_product_id`, `product_type`, `repayment_schedule`, `collection_account`, `collection_instructions`, `zsms_is_lender`, `total_repayable`, `monthly_instalment`
- Alters: `fee_record_id` made nullable
- Related: `docs/modules/loans/LOANS.md`, `docs/modules/loans/REPAYMENT.md`

**`0049_create_loan_repayment_log.sql`**
Creates the loan repayment tracking table in private schema.
- Creates: `private.loan_repayment_log`
- Related: `docs/modules/loans/REPAYMENT.md`

**`0050_create_consent_templates.sql`**
Creates versioned consent text table. Seeds v1.0 template.
- Creates: `private.consent_templates`
- Inserts: Consent template v1.0
- Related: `docs/modules/loans/CONSENT.md`

### Integrations Module

**`0051_create_integration_tables.sql`**
Creates accounting and CRM integration tables.
- Creates: `public.school_integrations`, `public.integration_log`
- Related: `docs/modules/integrations/INTEGRATIONS.md`

**`0052_create_integration_rls.sql`**
Applies RLS — school_id scoped for both tables.
- Creates: RLS policies for `public.school_integrations`, `public.integration_log`
- Related: `docs/RLS.md`

### AfriTech Dynamic Pricing System

**`0053_create_afritech_pricing_tables.sql`**
Creates the complete database-driven pricing and feature flag system.
- Creates: `afritech.subscription_tiers`, `afritech.feature_flags`, `afritech.tier_features`, `afritech.school_feature_overrides`
- Inserts: Default tier pricing, all feature flags, default tier-to-feature matrix
- Related: `docs/modules/admin/PRICING.md`

**`0054_create_afritech_finance_metrics_tables.sql`**
Creates AfriTech financial tracking and nightly metrics cache tables.
- Creates: `afritech.loan_commissions`, `afritech.platform_metrics`
- Related: `docs/modules/admin/PLATFORM_METRICS.md`

### New Indexes

**`0055_add_new_table_indexes.sql`**
Creates all indexes for tables added in migrations 0036-0054.
- Indexes for: `timetable_slots`, `announcements`, `announcement_reads`, `parent_push_tokens`, `alumni_profiles`, `lenders`, `school_integrations`, `integration_log`, `afritech.school_feature_overrides`, `afritech.loan_commissions`, `afritech.platform_metrics`
- Related: `docs/api/INDEXES.md`
**NEXT AVAILABLE: see *Next Available Sequence Number* near the top of this document — `0092`.**

---

## AI Module Migrations (0056–0060)

**`0056_enable_pgvector_extension.sql`**
Enables the pgvector extension in the Supabase project. Must be run before creating any vector columns. Run once per Supabase project.
- Runs: `CREATE EXTENSION IF NOT EXISTS vector;`
- Related: `docs/modules/ai/LESSON_PLANNER.md`, `docs/infra/SUPABASE.md`

**`0057_create_knowledge_base.sql`**
Creates the curriculum knowledge base table with pgvector embedding column and indexes.
- Creates: `public.knowledge_base`
- Creates: `idx_knowledge_base_embedding` (IVFFlat index — created AFTER data is loaded, not before)
- Creates: `idx_knowledge_base_curriculum`
- Creates: `match_knowledge_chunks()` Postgres function for vector similarity search
- Note: IVFFlat index requires data to be present before creation. Create table first, load content, then create the index.
- Related: `docs/modules/ai/LESSON_PLANNER.md`

**`0058_create_lesson_plans.sql`**
Creates lesson plans table for generated content from both school-linked and standalone teachers.
- Creates: `public.lesson_plans`
- Creates: All lesson_plans indexes
- Related: `docs/modules/ai/LESSON_PLANNER.md`

**`0059_create_ai_conversations.sql`**
Creates AI assistant conversation history table.
- Creates: `public.ai_conversations`
- Creates: All ai_conversations indexes
- Related: `docs/modules/ai/AI_ASSISTANT.md`

**`0060_create_standalone_teacher_accounts.sql`**
Creates standalone teacher account table for B2C lesson planner product.
- Creates: `public.standalone_teacher_accounts`
- Creates: All standalone_teacher_accounts indexes
- Related: `docs/modules/ai/LESSON_PLANNER.md`

---

## Dynamic Configuration Registry Migrations (0061–0065)

These migrations close the gap flagged in `01 Foundation Layer/DYNAMIC_CONFIG.md`: that document specifies eight `afritech` tables that had no corresponding migration. All eight are defined below.

**Scope note.** The gap was originally recorded as five tables (`promo_codes`, `exchange_rates`, `tax_rates`, `score_config`, `rate_limit_config`). Cross-checking every `afritech.*` reference in `DYNAMIC_CONFIG.md` against this document found three more with no migration: `platform_settings`, `platform_products`, and `commission_rates`. `platform_settings` is the most heavily referenced table in the entire registry, so all eight are included here.

**Status: documentation only.** These are specified but **not applied to any database**. They are applied during Phase 0 of `01 Foundation Layer/BUILD_SEQUENCE.md`.

### Conventions applied to every table below

Consistent with the existing `afritech` tables (`0032`, `0053`, `0054`):

- The `afritech` schema is **never exposed via PostgREST**. Verify under Supabase Dashboard → Project Settings → API → Exposed schemas.
- RLS is enabled on every table with **no policy granted to `anon` or `authenticated`**. Access is service-role only, through AfriTech admin panel Edge Functions. This is the same deny-by-default pattern used for `public.audit_logs` in `0035`.
- No school-level role has read or write access to any `afritech` table under any permission grant.
- Monetary values are `NUMERIC(12,2)`; percentages `NUMERIC(5,2)`; timestamps `TIMESTAMPTZ` (`CONVENTIONS.md` prohibitions 5 and 6).
- Every table carries `updated_by TEXT NOT NULL` (Clerk user ID) so `public.audit_logs` entries can be correlated to a person.
- Every write invalidates its Redis cache keys per `03 Infrastructure Services/CACHING_CDN.md`.

---

**`0061_create_afritech_platform_settings.sql`**
Creates the scoped key-value store backing most of the dynamic configuration registry — trial length, notification schedules, grace periods, data-completeness thresholds, AI rate limits, session durations, fee reminder escalation days, health score weights, tax registration number, and enabled payment gateways per country.

```sql
CREATE TABLE afritech.platform_settings (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key    TEXT NOT NULL,
  country_code   TEXT,
  -- NULL = platform default; 'ZM' etc. = country override
  value          JSONB NOT NULL,
  value_type     TEXT NOT NULL
                 CHECK (value_type IN ('number','string','boolean','array','object')),
  description    TEXT NOT NULL,
  min_value      NUMERIC(12,2),
  max_value      NUMERIC(12,2),
  -- Invariant bounds enforced at the API layer (DYNAMIC_CONFIG.md).
  -- session_duration_days carries max_value = 30 and may never be raised.
  is_active      BOOLEAN DEFAULT TRUE,
  updated_by     TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (setting_key, country_code)
);

ALTER TABLE afritech.platform_settings ENABLE ROW LEVEL SECURITY;
-- No policies: service role only.
```

- Creates: `afritech.platform_settings`
- Inserts: platform defaults for every key in the `DYNAMIC_CONFIG.md` registry, plus `ZM` country overrides where they differ
- Resolution order: school override → country default → platform default → code fallback constant
- Related: `01 Foundation Layer/DYNAMIC_CONFIG.md`, `02 Authentication and Identity/SESSIONS.md`, `18 AI Module/AI_DATA_REQUIREMENTS.md`, `15 Super Admin and Platform/SCHOOL_HEALTH_SCORES.md`

---

**`0062_create_afritech_commercial_tables.sql`**
Creates the commercial configuration tables — promotional codes, standalone platform products, and per-lender commission rates.

```sql
CREATE TABLE afritech.promo_codes (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  display_name      TEXT NOT NULL,
  discount_type     TEXT NOT NULL CHECK (discount_type IN ('percentage','fixed')),
  discount_value    NUMERIC(12,2) NOT NULL CHECK (discount_value > 0),
  currency_code     TEXT,
  -- Required when discount_type = 'fixed'; NULL for percentage
  applies_to        TEXT NOT NULL DEFAULT 'subscription'
                    CHECK (applies_to IN ('subscription','addon','platform_product')),
  tier_restriction  TEXT,
  -- NULL = any tier
  country_code      TEXT,
  -- NULL = all countries
  valid_from        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until       TIMESTAMPTZ,
  max_redemptions   INT,
  -- NULL = unlimited
  times_redeemed    INT NOT NULL DEFAULT 0,
  reason            TEXT NOT NULL,
  is_active         BOOLEAN DEFAULT TRUE,
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  CHECK (discount_type <> 'percentage' OR discount_value <= 100)
);

CREATE TABLE afritech.platform_products (
  product_key           TEXT PRIMARY KEY,
  -- 'standalone_teacher' etc.
  display_name          TEXT NOT NULL,
  description           TEXT,
  monthly_price_zmw     NUMERIC(12,2) NOT NULL,
  monthly_price_usd     NUMERIC(12,2) NOT NULL,
  annual_price_zmw      NUMERIC(12,2) NOT NULL,
  annual_price_usd      NUMERIC(12,2) NOT NULL,
  trial_quantity        INT,
  -- Standalone teacher: 5 free lesson plans, no time limit
  trial_unit            TEXT,
  -- 'lesson_plans' | 'days'
  is_active             BOOLEAN DEFAULT TRUE,
  is_publicly_listed    BOOLEAN DEFAULT TRUE,
  display_order         INT NOT NULL,
  updated_by            TEXT NOT NULL,
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE afritech.commission_rates (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lender_id       UUID NOT NULL REFERENCES public.lenders(id),
  product_type    TEXT NOT NULL,
  -- 'school_fees' | 'personal' | 'emergency' | 'device'
  rate_type       TEXT NOT NULL CHECK (rate_type IN ('percentage','fixed')),
  rate_value      NUMERIC(12,2) NOT NULL CHECK (rate_value >= 0),
  currency_code   TEXT,
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_to    TIMESTAMPTZ,
  reason          TEXT NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  updated_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CHECK (rate_type <> 'percentage' OR rate_value <= 100)
);

ALTER TABLE afritech.promo_codes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.platform_products  ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.commission_rates   ENABLE ROW LEVEL SECURITY;
-- No policies: service role only.
```

- Creates: `afritech.promo_codes`, `afritech.platform_products`, `afritech.commission_rates`
- Inserts: `standalone_teacher` product (K300/month, K3,000/year, 5 free lesson plans)
- Owner: `super_admin`; `commission_rates` additionally writable by `finance_officer`
- Commission rates are effective-dated — a disbursed loan records the rate in force at disbursement, never the current rate
- Related: `01 Foundation Layer/DYNAMIC_CONFIG.md`, `17 Integration and Pricing/PRICING.md`, `06 School and Tenant Management/TEACHER_PORTAL.md`, `14 Loan and Finance Module/LENDER_INTEGRATION.md`

---

**`0063_create_afritech_financial_rates.sql`**
Creates the effective-dated currency and tax rate tables.

```sql
CREATE TABLE afritech.exchange_rates (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  base_currency   TEXT NOT NULL,      -- 'ZMW'
  quote_currency  TEXT NOT NULL,      -- 'USD'
  rate            NUMERIC(12,6) NOT NULL CHECK (rate > 0),
  source          TEXT NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual','api')),
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active       BOOLEAN DEFAULT TRUE,
  updated_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (base_currency, quote_currency, effective_from)
);

CREATE TABLE afritech.tax_rates (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  country_code          TEXT NOT NULL,
  tax_name              TEXT NOT NULL,          -- 'VAT'
  rate_percent          NUMERIC(5,2) NOT NULL
                        CHECK (rate_percent >= 0 AND rate_percent <= 100),
  registration_number   TEXT,
  effective_from        TIMESTAMPTZ NOT NULL,
  effective_to          TIMESTAMPTZ,
  is_active             BOOLEAN DEFAULT TRUE,
  updated_by            TEXT NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

ALTER TABLE afritech.exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.tax_rates      ENABLE ROW LEVEL SECURITY;
-- No policies: service role only.
```

- Creates: `afritech.exchange_rates`, `afritech.tax_rates`
- Inserts: ZMW/USD at 27.50 (per `04 Country and Configuration/ZM.md`); Zambia VAT row
- Owner: `super_admin` and `finance_officer`
- **Invoices use the tax rate in force at issue**, resolved by `effective_from`/`effective_to` — never the current rate. Historical invoices must never change when a rate changes.
- Exchange rate is manually maintained; the admin dashboard warns when `updated_at` exceeds 30 days. USD is secondary display only — no billing decision depends on a live rate.
- Related: `01 Foundation Layer/DYNAMIC_CONFIG.md`, `04 Country and Configuration/ZM.md`, `17 Integration and Pricing/PRICING.md`

---

**`0064_create_afritech_scoring_and_limits.sql`**
Creates the behaviour score configuration and rate limit configuration tables.

```sql
CREATE TABLE afritech.score_config (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_version    INT NOT NULL,
  category          TEXT NOT NULL
                    CHECK (category IN ('payment_history','payment_capacity',
                                        'account_behaviour','risk_indicators')),
  weight_percent    NUMERIC(5,2) NOT NULL
                    CHECK (weight_percent >= 0 AND weight_percent <= 100),
  factors           JSONB NOT NULL,
  -- Sub-factor definitions and their weights within the category
  band_thresholds   JSONB,
  -- Band boundaries on the 300-850 scale; populated once per version
  effective_from    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active         BOOLEAN DEFAULT TRUE,
  updated_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (config_version, category)
);
-- API-layer invariant: the four active weight_percent values must sum to 100.
-- A partially updated weight set silently distorts every score that follows.
-- ADR-020 prohibited inputs (gender, ethnicity, religion, location) are NOT
-- configurable here or anywhere else.

CREATE TABLE afritech.rate_limit_config (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scope           TEXT NOT NULL
                  CHECK (scope IN ('ip','session','api_key','school','user')),
  resource        TEXT NOT NULL,
  -- 'api_read' | 'api_write' | 'whatsapp' | 'ai_assistant' | 'login' | ...
  tier_name       TEXT,
  -- NULL = applies to all tiers
  limit_count     INT NOT NULL CHECK (limit_count > 0),
  window_seconds  INT NOT NULL CHECK (window_seconds > 0),
  is_active       BOOLEAN DEFAULT TRUE,
  updated_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (scope, resource, tier_name)
);

ALTER TABLE afritech.score_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.rate_limit_config ENABLE ROW LEVEL SECURITY;
-- No policies: service role only.
```

- Creates: `afritech.score_config`, `afritech.rate_limit_config`
- Inserts: score config version 1 — Payment History 35, Payment Capacity 25, Account Behaviour 20, Risk Indicators 20 (ADR-020); all limits from `05 Core Database and API Reference/RATE_LIMITS.md`, including AI assistant 100/school/day and 20/user/day
- Score config is **versioned, not edited in place** — a loan application records the `config_version` used, so a historical score remains explainable after weights change
- Related: `01 Foundation Layer/DYNAMIC_CONFIG.md`, `14 Loan and Finance Module/BEHAVIOUR_SCORE.md`, `05 Core Database and API Reference/RATE_LIMITS.md`, `18 AI Module/AI_ASSISTANT.md`

---

**`0065_add_afritech_config_indexes.sql`**
Creates indexes for the tables added in `0061`–`0064`, following the `idx_[table]_[columns]` convention.

```sql
CREATE INDEX idx_platform_settings_key_country
  ON afritech.platform_settings(setting_key, country_code) WHERE is_active = TRUE;
CREATE INDEX idx_promo_codes_code_active
  ON afritech.promo_codes(code) WHERE is_active = TRUE;
CREATE INDEX idx_promo_codes_validity
  ON afritech.promo_codes(valid_from, valid_until) WHERE is_active = TRUE;
CREATE INDEX idx_commission_rates_lender_effective
  ON afritech.commission_rates(lender_id, product_type, effective_from) WHERE is_active = TRUE;
CREATE INDEX idx_exchange_rates_pair_effective
  ON afritech.exchange_rates(base_currency, quote_currency, effective_from DESC) WHERE is_active = TRUE;
CREATE INDEX idx_tax_rates_country_effective
  ON afritech.tax_rates(country_code, effective_from DESC) WHERE is_active = TRUE;
CREATE INDEX idx_score_config_version
  ON afritech.score_config(config_version) WHERE is_active = TRUE;
CREATE INDEX idx_rate_limit_config_lookup
  ON afritech.rate_limit_config(scope, resource, tier_name) WHERE is_active = TRUE;
```

- Creates: eight partial indexes on the `is_active` hot path
- Related: `05 Core Database and API Reference/INDEXES.md` — add these entries when the migration is written

---

**NEXT AVAILABLE: `0092`** — see *Next Available Sequence Number* above, which is authoritative.
| 2026-08-16 | **Added `0092` — `school_branding`, with the WCAG AA guardrail as a CHECK constraint** | `validateTheme()` alone would leave the rule absent from every writer that is not the API. Implementing the luminance formula a second time in SQL is real duplication, paid because a guardrail present in one of two writers is one that will eventually be walked past. ADR-043. |
| 2026-08-16 | **Added `0093` — brand colours in `worker_payment_context()`** | Receipts assemble from a single call whose `school` object predates `school_branding`; without this a themed school would send themed report cards and unthemed receipts. Next available advances to `0094`. |
| 2026-08-17 | **Added `0094` — branding contrast re-measured against the page ground** | The page stopped being white, so thresholds measured against white were measuring the wrong surface. Next available advances to `0095`. |
| 2026-08-17 | **Added `0095` — the three missing `afritech` feature-access tables** | Documented as existing since Phase 0 and never created. Built to PRICING.md's DDL rather than an invented shape. |
| 2026-08-17 | **Added `0096` — platform metrics and health scores as SECURITY INVOKER** | RLS already decides who sees across schools; a DEFINER function would duplicate that rule where nothing tests it. |
| 2026-08-17 | **Added `0097`/`0098` — public views and named write functions over `afritech`** | Keeps the schema off PostgREST while giving the admin dashboard exactly four relations. `0098` also closed the missing RLS on `subscription_tiers`. Next available advances to `0099`. |
| 2026-08-18 | **Added `0100` — backfilled the tier prices, which were never seeded; price columns set NOT NULL** | `0082` created the four tiers with quotas and ceilings and omitted the price columns entirely. Nothing read a price until the pricing screen existed, which then rendered four free tiers — as the public pricing page would have. Figures are PRICING.md's. The student-ceiling divergence is left open deliberately: a ceiling is enforced, a price is not. Next available advances to `0101`. |
| 2026-08-18 | **Added `0099` — deduplicated feature overrides, partial unique index on `is_active`** | The seed's `ON CONFLICT DO NOTHING` was unreachable with no unique constraint to conflict with, so re-running it duplicated every override. Duplicates resolve identically through `EXISTS` but are revoked *by id*, so revoking one would leave access in force — the dashboard would have lied to the operator. Partial on `is_active` so grant→revoke→grant history stays legal. Next available advances to `0100`. |
| 2026-08-23 | **Added `0101` — the student ceiling became a resolved configuration value** | `subscription_tiers.student_limit` had existed since `0082` and was already admin-editable, but nothing enforced it, no per-school exception existed, and the seeded figures disagreed with both PRICING.md and DYNAMIC_CONFIG.md (Starter 150 vs 200, Professional unlimited vs 1,000). Adds the `student_limit_override` override type, `school_student_limit()` (override → tier override → tier), `school_student_capacity()`, and a trigger on `students` that fires on INSERT *and* on the UPDATE that puts a pupil back on the roll — a ceiling watching only INSERT is one you get around by withdrawing and re-activating. The seed realignment is guarded to rows still holding `0082`'s exact values, because tightening Professional from unlimited is the one direction that could stop a real school enrolling. |
| 2026-08-23 | **Added `0102` — `school_capacity` view; `schools.max_students` deprecated** | The list screens want the resolved ceiling for every school on the page, and one RPC per row is the same N+1 already tracked against `/api/admin/schools/[id]`. `LATERAL` over the function keeps one definition of the resolution order and the counting rule. `schools.max_students` is a per-school copy that nothing has ever read to make a decision, yet it was *displayed* as the cap on two admin screens — an operator editing it believed they had changed a limit. Left in place, not dropped: dropping is destructive and needs approval. Next available advances to `0103`. |
| 2026-08-23 | **Added `0103` — the ceiling trigger moved from BEFORE to AFTER** | A BEFORE ROW trigger runs *ahead of* the RLS `WITH CHECK`, so `0101`'s guard evaluated the ceiling before anyone had established the caller could write into that school. School B attempting to enrol into a full School A was answered `ZS001: This school has reached its plan limit of 3 enrolled pupils` — three facts about another tenant to a caller entitled to none of them. Found by the new adversarial suite. AFTER puts RLS first; the comparison moves `>=` → `>` because the new row is already counted. |
| 2026-08-23 | **Added `0104` — `school_health_scores()` rewritten to grouped aggregates** | `/api/admin/overview` began timing out (`57014`) on six schools and 240 fee records. Measured: 105 ms as superuser, 3,289 ms as `authenticated` — a 30× gap on identical data is predicate evaluation, not volume. The `financial` CTE alone referenced `fee_records` in five correlated subqueries, re-run per school; `attendance_records` carries seven policies including two function calls evaluated per row. One pass per table instead. `SECURITY INVOKER` kept deliberately — `0096`'s argument still holds, and the cost was the query shape, not the security model. Every score verified identical to the old output, per school. 3,289 ms → 151 ms. |
| 2026-09-27 | **Added `0109` — academic-year matching in teaching scope; a live lockout fixed** | `teacher_reaches_class()` and `teacher_teaches_subject()` both compared `teacher_assignments.academic_year` to `EXTRACT(YEAR FROM NOW())::TEXT`. The column is TEXT so a school can write its year its own way, and a school writing `2026/2027` matched nothing — so **no teacher could enter a mark or mark a register**, all year. Now a containment test: a label is current when it contains the current calendar year. Deliberately not a parser — a parser needs a format contract the column has not got, and one that guesses wrong fails closed, which is how this behaved. Next available advances to `0110`. |
| 2026-09-29 | **Added `0141` — two documented columns that never existed, and term dates** | `SCHOOL_CONFIG.md`'s School Profile table lists nine fields against their database columns; **`display_name` and `ministry_reg_number` were never among them**, stated as fact under a `DB Column` heading. Found by building the form the document describes — the same way `class_enrolments` and the missing payment-verification columns were found.

The larger gap: **nothing stored term dates.** `fee_structures`, `exam_results` and `attendance_records` have all carried `academic_year` and `term_number` since the fee module, while nothing knew when a term started — so nothing could answer *what term is it today*. `school_term_dates` plus `current_term()`, which returns the **next** term during the holidays with `is_between` set, so callers do not each special-case a third of the year. Overlap is rejected by a trigger that names the term it collides with. `term_number` is **not** capped at three: Zambia runs three terms, but ADR-040 already tracks five hardcoded CHECKs needing a migration per country and this would have been a sixth.

**The profile grant was widened, and the suite asserts that widening it did not reopen `0140`.** `GRANT UPDATE (cols)` is additive per column so it cannot happen by accident — asserted because the next person may not know that, and re-issuing the list with `subscription_tier` left in would restore the escalation silently. `school_settings_test.sql` — 16 assertions. Next available advances to `0142`. |
| 2026-09-29 | **Added `0140` — SECURITY FIX: a school owner could price their own school** | `authenticated` held a **table-level** UPDATE grant on `public.schools`, covering every column, and `owner_update_own_school` checked only that the caller owned that school. Nothing checked WHICH columns were written. Demonstrated against `zsms-dev` as an ordinary owner: tier `starter` → `enterprise`, trial extended from 2026-10-02 to 2036-09-29, `whatsapp_enabled` on, `max_students` 999999. Every priced dimension of the product was self-serve.

**RLS could not have fixed this.** A policy decides which ROWS a statement may touch; `WITH CHECK` sees the finished row and cannot distinguish a changed `subscription_tier` from one that was already there. The grant is the right tool — the same one `0130` used for the Teacher Hub's trial counter. **The general rule: a table holding both user-editable and commercially-significant columns needs a column-level grant, not a row policy.** Commercial terms now move through `admin_update_school_commercial()`, and `PATCH /api/admin/schools/[id]` was rewritten to call it. `school_commercial_columns_test.sql` — 14 assertions, five asserting the grant itself, because a later migration widening it carelessly would restore the hole. |
| 2026-09-29 | **Added `0138`–`0139` — per-student pricing could never be switched on, and three functions were unreachable** | `0124` built per-student pricing completely: the model flag, `tier_student_price_bands`, an overlap trigger, and a charge function returning NULL with a reason rather than a misleading zero. It never got a way to turn on — `admin_update_tier()` does not take `pricing_model` — so every tier sat on `flat` and the model intended for most schools was settable only by hand-written SQL. There was also **no band writer at all**: `0128` granted SELECT and `0129` added deletion, and nothing could ever create one, which is why the table was empty.

**The larger finding is a rule the repository already had and had drifted from.** `supabase/config.toml` sets `schemas = ["public"]`, so PostgREST resolves `rpc()` and `from()` against `public` alone — **a function in `afritech` is callable from SQL and never by a route**. Three had drifted there: `delete_tier_price_band` (`0129`), `publish_prompt_template` (`0134`, which CLAUDE.md told readers to use), and `set_tier_pricing_model` — written in `0138`, one migration after documenting this same class of problem. None fails at build time; each is a 404 the first time a person clicks the button. `0139` adds `public.admin_*` wrappers and a `tier_price_bands` view (the catalogue's `price_bands` is an aggregate with no per-row ids, which an editor needs). **The rule: a function the application must call belongs in `public` with an `admin_` prefix.** `price_bands_test.sql` — 17 assertions, four of which assert reachability by name. Next available advances to `0140`. |
| 2026-09-28 | **Added `0136`–`0137` — the curriculum store, and version 1 of the prompts** | `LESSON_PLANNER.md` specifies a `knowledge_base` table with pgvector and a RAG pipeline. It is right that the knowledge base is the moat and **wrong about the tool for this part of it**: the retrieval has to answer *what does the ECZ Grade 9 Mathematics syllabus say about X*, where subject, grade and topic are EXACT keys. Similarity search is slower, fuzzier, needs chunking and tuning, and can return Grade 7 content for a Grade 9 request — a wrong answer that reads like a right one. A syllabus is a structured outline, so it is a table with a unique key. pgvector still earns its place when the corpus is genuinely prose: textbooks under a publisher agreement, past papers.

**`curriculum_slice()` returns the WHOLE slice for a subject and grade, not a matched topic.** Ten to thirty rows, a few hundred tokens. No fuzzy matching to tune and no `pg_trgm`; a lesson spanning two topics keeps both; and — the reason that matters — **the model cannot invent a topic code, because the complete valid set is in front of it.** A fabricated ECZ reference is the worst output this product can produce: the teacher repeats it to a head of department in good faith and is blamed for it.

**Nothing is seeded, deliberately.** Inventing topic codes to make a demo look complete would commit exactly the failure the design prevents. Real content comes from the publicly available ECZ PDFs via `import_curriculum_topics()` and `/admin/curriculum`. The import is non-atomic — the opposite of `import_students()` — because a syllabus is hundreds of hand-transcribed rows and aborting on row 214 means one typo fixed per round trip; a partial syllabus is visible in `curriculum_coverage()` and simply re-imported. `country_code` is a column, not a table-name suffix, so ZIMSEC is rows rather than the ADR-040 problem again. `0137` seeds version 1 of the three prompts. `curriculum_test.sql` — 16 assertions. Next available advances to `0138`. |
| 2026-09-28 | **Added `0134`–`0135` — the model chain as data, versioned prompts, and platform-wide incidents** | **Nothing in this repository captured an error before this.** `CLAUDE.md` lists Sentry under Phase 0 observability and `ENV.md` has a section for its DSN, but there is no `@sentry/*` dependency, no config file, no `captureException` and no `global-error.tsx` — the only matches are inside Next's own `node_modules`. A teacher hitting a 500 produced no record anywhere, ever.

`platform_incidents` is deliberately generic — `source` admits notification, gateway, worker, route and integration failures, not just AI — because four tables doing this is the mistake `ai_credit_ledger` exists to avoid repeating. **Deduplication is the design, not a refinement:** a dead key fails on every request, so `record_platform_incident()` is an UPSERT on `dedupe_key` and 200 failures become one incident with a count of 200. A resolved incident re-opens on recurrence and its stale resolution is cleared; severity escalates and never silently drops.

`afritech.ai_models` makes the failover chain data — a third provider is a row, reordering is a row, and `cost_usd` stays accurate when a provider reprices. Seeded OpenAI-first because that is the key with credit. `ai_prompt_templates` is **immutable**: there is no UPDATE grant, editing publishes a new version, and `teaching_resources.prompt_template_version` records which one produced each artefact — ADR-041 for the fourth time. `0135` exists because `0134` added that column and left nothing able to write it, which would have kept it NULL forever while the header claimed provenance was recorded.

Model chain, prompts and token rates are readable by **AfriTech alone**: they reveal which provider ZSMS depends on, what its margin is, and the accumulated prompt work a competitor could copy verbatim. `platform_incidents_test.sql` — 18 assertions. Next available advances to `0136`. |
| 2026-09-27 | **Added `0132`–`0133` — platform-wide AI credits, and the Teacher Hub's second meter retired** | `AI_CAPTURE.md` already specified a credit system in detail, for ONE feature, under the names `capture_credit_*`. Meanwhile the Hub shipped with `trial_resources_used`, and the assistant and analytics would each have needed the same thing — three or four implementations of one rule about money. `0132` generalises it to `ai_credit_accounts` / `ai_credit_ledger` / `ai_credit_caps` plus `afritech.ai_credit_prices`, `ai_credit_packs` and `tier_ai_allowances`, **deliberately before AI capture exists**, because afterwards the generalisation never happens. `0133` points `create_teaching_resource()` and `teacher_hub_entitlement()` at the ledger and stops writing the old counter, which `0132` backfilled.

**The design problem worth remembering:** an included monthly allowance and purchased credits expiring after 12 months look incompatible — an unused allowance must not roll over, purchased credits must not vanish early. Resolved by **never depositing the allowance**: consumption rows record `funded_from`, so purchased balance is a sum over unexpired lots and allowance use is a sum over the current window. **Neither expiry nor reset needs a scheduled job**, which matters because a cron that fails silently leaves somebody holding credits they should not have. Lots drain soonest-expiry-first, spending what was about to be lost rather than letting it die.

Also: priced in ACTIONS not tokens (token pricing welds the price list to one provider's rate card); `model_name`/`input_tokens`/`output_tokens`/`cost_usd` on every row so margin is measured; append-only against `service_role` too; and the Hub's paid plans gained a 60-credit monthly allowance because **unlimited generation for K300 was safe only while the generator was a free template** — with a model behind it, it is the flat-price-over-metered-cost trap `AI_CAPTURE.md` warns about. `ai_credits_test.sql` — 29 assertions. Next available advances to `0134`. |
| 2026-09-27 | **Added `0131` — `audit_logs`, specified since the first day and never built** | `BUILD_SEQUENCE.md` sets two gates that could not pass: Phase 0's *"`audit_logs` not updatable"* and Phase 3's *"every financial event writes an immutable `audit_logs` row"*. The table did not exist — not under another name, not in `private` — so payments were being recorded and verified with no immutable record of who decided what. **Three departures from the documented design, each deliberate:** it is written by AFTER triggers rather than by Edge Functions (there are none, and more importantly a trigger *cannot forget* — auditing that depends on each function remembering to log has a silent gap the day one does not); immutability is a trigger rather than a policy, because **`service_role` bypasses RLS** and a worker holds that key, so a policy-only design would let a worker rewrite history — the suite proves `service_role`, the table owner, and TRUNCATE are all refused; and UPDATE records **only the columns that changed**, redacted by `mask_audit_values()`, so the trail does not become a second less-protected copy of `students.nrc_or_birth_cert`. Read access is the owner and principal only: an accountant generates most of the financial rows and can read none of them, which is separation of duties rather than an oversight. `audit_logs_test.sql` — 22 assertions. Next available advances to `0132`. |
| 2026-09-30 | **Added `0153`–`0156` — logged late, which is the drift this document warns about** | Four migrations were written and applied while *Next Available Sequence Number* still read `0153`. Nothing broke, because `check-migrations.mjs` reads the filesystem and CI applies every file — but the ledger disagreed with the tree for four commits, which is precisely the condition that made `0022`–`0068` void. Recorded here together rather than pretended to have been recorded at the time. **`0153`** resolves the `pending_verification` contradiction between `SCHOOL_SETUP.md` and `ONBOARDING.md` in favour of the stricter reading: an unverified school may configure itself but may not create pupil records, because accepting several hundred children's names from a party nobody has checked makes AfriTech their ZDPA processor before anybody has established the school exists. `ONBOARDING.md`'s pilot sequence was amended to activate before importing. **`0154`** fixes a defect `0153` introduced: `students` then carried two AFTER guards, PostgreSQL fires same-event triggers in NAME order, `can_enrol` sorts before `writable`, and so a **suspended** school was told it was awaiting a verification call that would never come. The enrolment message now raises for `pending_verification` alone and firing order stops mattering. **`0155`** is the public directory — `school_public_profiles`, `school_verified_metrics()`, and two SECURITY DEFINER functions granted to `anon`. Ratios are published and the counts behind them are not, because a count beside a ratio reconstructs the roll `PUBLIC_DIRECTORY.md` withholds; teachers are counted from `teacher_assignments`, not `staff_members`, or hiring a bursar improves a school's listing. No ranking: the only score ZSMS could publish measures software usage, not school quality. **`0156`** re-does `0151`'s revoke and, unlike it, verifies the outcome — measured against dev, `register_school` was denied and `admin_create_school` executed, from the same loop. `0151` asserted a count of statements issued, which says nothing about the privilege afterwards. Next available advances to `0157`. |
| 2026-09-30 | **Added `0152` — the 24-hour rule, derived rather than scheduled** | `ONBOARDING.md` calls the 24-hour outreach rule the most important operational rule at AfriTech and hangs an escalation table off it; no table recorded a contact attempt, so nothing could say which schools had been called. That document implements it as a queued job firing 24 hours after registration, and there is no Redis — so `public.onboarding_queue` **computes** `outreach_overdue` and `outreach_escalated` from the first recorded contact against registration time. A better decomposition rather than a workaround: a derived flag cannot drift, there is no row a failed job forgot to write, and changing 24 hours to 12 needs no backfill. Only the escalation *push* waits for Redis, and `platform_incidents` already exists for it to land in. Of the nine documented task states, four are facts about the world and are computed (New, Converted, Expired, and the percentage behind Complete); five are human judgements and are stored — business rule 2 says a task is never closed automatically, so a self-closing state machine would contradict it. `school_onboarding_contacts` has **no UPDATE and no DELETE grant for anybody**: a super admin escalates on the strength of these rows, and a note that can be rewritten afterwards is not a record. A note is required except for `no_answer` and `wrong_number`, by CHECK rather than by route, so a direct RPC cannot skip it. The window applies to self-registration only — an AfriTech-created school was created by somebody already talking to it. Next available advances to `0153`. |
| 2026-09-30 | **Added `0151` — a REVOKE that revoked nothing** | `0150` ended with `REVOKE ALL ON FUNCTION public.register_school(...) FROM anon` and a comment calling it the security boundary. It is neither: **PostgreSQL grants EXECUTE on every new function to PUBLIC**, and `anon` inherits it from there, so revoking from the role removes a grant it never held. An unauthenticated PostgREST call could reach `register_school()` — achieving nothing, because its first statement raises on a NULL `get_user_id()`, but with the in-function guard doing all the work and nothing behind it. **The same was true of all eleven `admin_` functions.** Each is safe only because each remembered `is_afritech_admin()`; the twelfth, written by somebody who forgot, would have been wide open. Surgical rather than a blanket revoke across `public`: `school_branding_by_slug()` themes the sign-in page for `anon` on purpose, and a sweeping revoke would break it in a way that looks like a CDN problem. Found by an assertion in `self_registration_test` before it shipped. Next available advances to `0152`. |
| 2026-09-30 | **Added `0150` — self-registration, with the documented flow deliberately reversed** | `SCHOOL_SETUP.md` Path 2 describes a fully public form that creates the school and *then* the account. Built in that order the endpoint mints a school identifier and a Clerk organisation for anybody with `curl`, and there is no rate limiter to put in front of it — Upstash Redis does not exist (`CREDENTIALS_CHECKLIST.md`). So the halves are swapped: the visitor signs up with Clerk first, and `register_school()` is granted to `authenticated` only. The end state is the document's, and the verification that was going to happen anyway now happens before anything is created. It also removes a step — the registrant **becomes** the owner rather than being emailed an invitation to a school they made ten seconds earlier. Abuse is further bounded to **one open trial per person** against `school_onboarding.created_by`; deliberately narrow, since a genuine multi-school owner converts the first trial or has AfriTech create the second. `attach_own_registered_school()` lets them finish their own provisioning, scoped to a school they registered AND still holding a placeholder, so the window closes after one use and is never open for somebody else's school — that one column is the entire tenancy boundary. Terms and privacy acceptance become timestamped columns, because a checkbox that leaves no row behind is not consent anybody could evidence, and the school is about to become a data controller for several hundred children. Trial length is 30 days, hardcoded, with the reason stated: a promotional 14- or 60-day trial wants a platform-settings row and no such table exists. Next available advances to `0151`. |
| 2026-09-29 | **Added `0149` — the lifecycle table finally binds** | `SCHOOL_SETUP.md` has said since April that a `trial_expired` or `suspended` school reads and does not write. Nothing honoured it: a school whose subscription had lapsed enrolled pupils, recorded payments and published results exactly as freely as one that paid. **A trigger, not a RESTRICTIVE policy**, and the reason decides the design: on Supabase the `postgres` role carries BYPASSRLS, and every SECURITY DEFINER function here is owned by it — `save_exam_marks()`, `import_students()`, `verify_payment()` would each sail past a policy, as would every worker, since `service_role` bypasses RLS by design. A trigger fires from every seat. **AFTER, per `0103`**: the message names another tenant's commercial standing, so RLS must decide entitlement before the trigger speaks. **Statement-level with transition tables**, so a four-hundred-pupil import resolves the status once rather than four hundred times. Attached by catalogue discovery to every `public` table with a UUID `school_id`, with five named exclusions: `schools` (the status lives there), `audit_logs` (a trail that stops recording a suspended school is not a trail), `platform_incidents`, `job_runs` and `message_log` (the lapse notice must still be sent and logged). NULL `school_id` is writable — a standalone Teacher Hub user has no school, and FALSE there would lock every one of them out. `pending_verification` is treated as fully writable: the documents contradict each other about what "limited" means, and a rule built from that would be unpredictable. Raises `ZS002`, rendered as CONFLICT. Next available advances to `0150`. |
| 2026-09-29 | **Added `0148` — the audit trail made a feature impossible, so the feature changed** | `admin_discard_unprovisioned_school()` from `0144` could never run. Creating a school calls `log_audit_event()`, `audit_logs.school_id` is a foreign key to `schools(id)`, and `0131` puts a BEFORE UPDATE OR DELETE trigger on that table which raises unconditionally. So the DELETE is refused by the FK, the FK cannot be `ON DELETE SET NULL` because the cascade's own UPDATE is blocked, and removing the audit rows first is the single thing an audit trail exists to prevent. **A school that was created cannot be erased, because its creation was recorded** — three independent routes closed, all deliberately. Replaced by `admin_abandon_unprovisioned_school()`, which marks the attempt `terminated` and leaves it in place; the row is still invisible to everyone but AfriTech, since `clerk_org_id` remains a placeholder matching no JWT. This also reverses `0144`'s claim that the identifier is reused: the row survives, so MAX+1 counts past it and the next school in that city takes the following number — which is what business rule 1 wanted, arrived at as a consequence rather than as a rule anybody had to enforce. The old function is dropped rather than aliased: it promised removal and never removed anything. Next available advances to `0149`. |
| 2026-09-29 | **Added `0147` — the same class as `0146`, and the rule it leaves behind** | `admin_activate_school()` raised *column reference id is ambiguous*: `UPDATE public.schools SET ... WHERE id = p_school_id`, where `id` is also an output column of its `RETURNS TABLE`. `admin_update_school_commercial()` in `0140` has the identical return shape and has always worked, because it happens to alias its UPDATE target. **The rule, stated once: in a PL/pgSQL function with `RETURNS TABLE`, alias the target of every UPDATE and DELETE and qualify every column.** The error arrives on first call rather than at `CREATE FUNCTION`, because a body is parsed lazily — so no migration, type-check, lint or plan count can see it, and each instance costs a CI round trip to find. Next available advances to `0148`. |
| 2026-09-29 | **Added `0146` — an ON CONFLICT target is not a place a column can be qualified** | `admin_create_school()` raised *column reference school_id is ambiguous* on every call. It declares `RETURNS TABLE (id, school_id, ...)`, and each of those is a PL/pgSQL variable for the whole body — normally harmless, since `admin_update_school_commercial()` in `0140` returns the same shape and qualifies every column it touches. **`ON CONFLICT (school_id, item_key)` cannot be qualified**: the conflict target is parsed as index expressions, so the OUT parameter and the column both match. Nothing catches it before execution — a PL/pgSQL body is parsed on first call, so the migration applies, `db push` reports success, and the failure arrives at the first pgTAP assertion that creates a school. Rewritten as `NOT EXISTS`, where every reference is qualified. Renaming the OUT parameters to the `out_` prefix would have worked and changed the shape every caller reads; `#variable_conflict use_column` would have fixed one line by changing name resolution for the entire body. Next available advances to `0147`. |
| 2026-09-29 | **Added `0145` — the province `0142` made mandatory and unsuppliable** | `0142` added `province_code` as NOT NULL, backfilled the rows that existed, and stopped. Every INSERT into `public.schools` written before it supplies no province — **twenty-two pgTAP suites and `dev_seed.sql`**, all failing on their first statement. CI found it; the plan counter could not, because it counts assertions without executing them. The same shape `CLAUDE.md` already names: reasoning about one migration without re-running the suites that covered the ground it touched. The fix is not to edit twenty-two fixtures. **The province is a function of the city** — `ZM-LSK-0001` is in Lusaka Province because `LSK` is Lusaka — so asking every caller to state both invites a row where the two contradict, and the database would store it. `province_for_city()` becomes the single authority and a BEFORE trigger fills the column when a caller omits it; an explicit value is still honoured, because `SCHOOL_SETUP.md` describes correcting a school registered under the wrong details and the city code cannot be corrected. Not a generated column: the city list will grow to real towns, and a town added before its province is decided should fail loudly on one row rather than require a schema change. Next available advances to `0146`. |
| 2026-09-29 | **Added `0142`–`0144` — the path that creates a school, which did not exist** | Until `0144`, no code in this repository could create a school; every school in `zsms-dev` came from `dev_seed.sql`. `0142` adds `province_code`, required by both registration forms in `SCHOOL_SETUP.md` and absent from the schema, taking ZM.md's ten codes verbatim and backfilling from `city_code` — city codes are deliberately untouched because they sit inside every school identifier. It also adds the sixth status, `trial_expired`, which the lifecycle table has always named; **the status is recordable, not yet binding** — nothing in this schema blocks a write by status, for any status. `0143` turns the onboarding checklist into data: `0010`'s CHECK admitted ten keys while `ONBOARDING.md` names fourteen, and business rule 4 asked for a backfill migration that was never written. Items and weights now live in `afritech.onboarding_checklist_items` behind a `public` view, referenced by foreign key, with a DO block asserting the documented 60/30/10 balance so a future edit fails here rather than producing percentages that cannot reach 100. Nothing had ever read or written `onboarding_checklists` in the thirteen months it existed. `0144` is provisioning: `get_next_school_sequence()` as documented but **taken under an advisory lock**, because the documented MAX+1 read outside one lets two concurrent creations mint the same identifier; `school_onboarding` to hold the invited owner, since `staff_members.clerk_user_id` is NOT NULL and relaxing it would weaken every policy that joins through staff; and the create / attach / activate / discard functions. The Clerk call cannot be in the transaction, so the school is inserted with a `pending_` placeholder for `clerk_org_id` — which, being the tenant key every policy resolves through, makes a half-provisioned school reachable by nobody rather than half-open. `admin_attach_clerk_org()` refuses a second attach: that one column IS the tenancy boundary. Writing the suite corrected a claim in `0144`'s own header — the sequence number **is** reused after a discard, because MAX+1 reads the rows that exist and the discard deletes one; acceptable, since the identifier was never issued to anybody. `school_provisioning_test.sql` — 42 assertions. Next available advances to `0145`. |
| 2026-09-27 | **Added `0130` — the Teacher Hub, the first OWNER-scoped table set in the schema** | `afritech.teacher_hub_plans`, `public.standalone_teacher_accounts`, `public.teaching_resources`, plus `teacher_hub_entitlement()`, `create_teaching_resource()`, `teacher_hub_activate_subscription()`, `teacher_hub_cancel_subscription()` and `my_teacher_hub()`. **Supersedes the planned `0058` and `0060`, both void.** Every other `public` table is school-scoped through `current_school_uuid()`; a standalone teacher has no organisation, so these filter on `get_user_id()` and the unit of isolation is a person. Four deliberate deviations from the documented DDL, each in the migration header: one `teaching_resources` table rather than a `lesson_plans` table that would have to hold quizzes; no `linked_school_id`, because the documented single UUID contradicts the documented rule that a teacher may be in several schools and `my_schools()` already answers it; prices and the trial cap as rows; and **column-level grants** so the teacher cannot write the counter that meters their own free trial. `teacher_hub_test.sql` — 23 assertions, all passing. Next available advances to `0131`. |
| 2026-09-27 | **Added `0129` — three regressions CI found on its first complete run** | `0114` added `target_audience`/`target_scope` as NOT NULL with no default, which broke **every existing writer** of `announcements` — including `/api/announcements`, live code, broken since 0114 was applied. Fixed by making the derivation bidirectional rather than editing the callers to match; editing the two failing suites would have turned CI green and left the route broken. Also revokes two DELETE grants that violated tested repository-wide invariants — `student_custom_values` (0110) and `tier_student_price_bands` (0128) — replacing both with named SECURITY DEFINER functions. `tenant_isolation_test` asserts no DELETE exists anywhere in `public` for end-user roles and `communications_test` asserts the same for `afritech` configuration; both grants were added without checking whether a rule already covered the operation. Next available advances to `0130`. |
| 2026-09-27 | **Added `0124`–`0128` — per-student pricing, invoicing, and tiers that are finally data** | `0124` makes a tier chargeable per pupil in admin-set bands, with no enrolment ceiling (charging for growth then blocking it would refuse a child a place), and a resolver that returns NULL with a reason rather than billing zero when no band covers a roll. `0125` fixes a contradiction two documents had claimed away: `tier_name` was a hardcoded CHECK in **both** `afritech.subscription_tiers` and `public.schools`, so AfriTech could not add a plan without a migration — replaced with a foreign key, which also closes the typo hole dropping the CHECK alone would have opened, and a mistyped `tier_override` used to resolve to 'no tier' which reads as UNLIMITED. `0126` is the invoicing module: an invoice stores the tier, pupil count, unit price and tax rate it was issued on, because bands get repriced and VAT moves (ADR-041's lesson applied to money). `0127` adds the `security_invoker` views the admin screens read, since `afritech` is off PostgREST and `/api/admin/billing` would have failed at runtime. `0128` is the **same trap as `0122`, twice**: a security_invoker view runs as the caller, so the caller needs SELECT on the table beneath — privileges say what a role may attempt, RLS says which rows. Next available advances to `0129`. |
| 2026-09-27 | **Added `0123` — network billing intent and the deliberate school-access grant** | `billing_mode` on a network records `per_school` (default, current behaviour) or `consolidated`, and **nothing reads it** — ZSMS has no invoicing at all, so there is nothing to consolidate. It exists so billing, when built, needs no migration; the pricing question itself is now written up in PRICING.md rather than left as a note. Also records the deliberate act of giving a network member entry to one of its schools: the permission lives in Clerk, but without `owner_access_granted_at` an operator cannot tell which schools a network's owner can actually open, and the answer would live in another system behind another login. Guard uses `IS NOT TRUE`, applying 0121's NULL-vs-FALSE lesson at the point of writing rather than rediscovering it. Next available advances to `0124`. |
| 2026-09-27 | **Added `0119`–`0122` — School Networks, and a guard that was not a guard** | A network is an owner running several separately-onboarded schools. Read-only aggregates through SECURITY DEFINER functions gated on membership — the shape `is_afritech_admin()` already uses for 40 policies — so **none of the 75 tenant policies is touched**; working inside a school still means switching into it. Schools attach one at a time through a join table with a partial unique index (one network per school, history kept), not a column on `schools`. Role permissions are a TABLE, per ADR-040's lesson; `data_scope` is a CHECK because each value gates a code path. Built for 100 schools: five grouped scans total, not one per school. **`0121` fixes a real defect `0120` introduced.** `is_afritech_admin()` returned NULL, not FALSE, for a session with no `o` claim; harmless in policies (`USING (NULL)` filters like FALSE) but in PL/pgSQL `IF NOT NULL THEN` skips its branch — so the attach guard was bypassed for exactly the callers with no school org, i.e. network members. Not exploitable only by accident (RLS then hid the school). Caught by an assertion pinning 42501 that saw P0002; a test asserting merely "it throws" would have passed. Helper now COALESCEs to FALSE. `0122` adds the table grants the SECURITY INVOKER attach function needs. Next available advances to `0123`. |
| 2026-09-27 | **Added `0117`/`0118` — multi-school access; a finding that inverted the plan** | `my_schools()` and `my_children()` answer "where am I connected" and "who are my children", self-scoped on `get_user_id()` so they cross schools without widening anything. Building them surfaced that **not one of the twelve parent policies is school-scoped** — all resolve through `is_linked_parent_of()` and never `current_school_uuid()` — so a parent already read children, fees, attendance and results across schools from one session. The switcher was only ever needed for STAFF, whose policies do scope on the active school. `0118` closes the one inconsistency this exposed: announcements were school-scoped, so a parent saw children from both schools and notices from one. Now keyed on `parent_has_child_at_school()`, matching every other parent policy. Next available advances to `0119`. |
| 2026-09-27 | **Added `0114`–`0116` — announcement audience vs scope, individual recipients, and a worker that delivered to nobody** | `target_type` conflated WHO a notice was for with WHICH PART of the school it covered, so "Grade 7 pupils" was not expressible — `grade` meant parents by accident of implementation. Split into `target_audience` + `target_scope`, with `target_type` kept as a trigger-derived mirror (same treatment as `grade_bands` in 0106) because six readers still use it and dropping a column is destructive. `0115` fixes the real bug: `worker_announcement_recipients()` joined only to `parents`, so a staff or pupil notice resolved **zero** recipients, queued nothing, and still reported as sent. `0116` repoints the policies at the two-dimension resolver — without it a pupil-scoped notice was readable by parents and invisible to pupils, which the suite caught in both directions. Next available advances to `0117`. |
| 2026-09-27 | **Added `0113` — announcement audience policies; closed a real disclosure** | `school_members_read_sent_announcements` filtered on school and `status='sent'` and consulted `target_type` not at all. Parents and pupils are members of the school's Clerk org (`org:parent`, `org:student`), so `current_school_uuid()` resolves for them — which meant **every parent could read every notice addressed to `all_staff`**, where a school writes about disciplinary processes, salaries and safeguarding. Replaced with `announcement_addressed_to_me()`: parents see `all_parents` plus their own children's grade/class, pupils see `all_students` plus their own, staff see `all_staff` plus operational grade/class notices, and nobody outside management sees a draft. Also adds parent-side read receipts, without which the unread-escalation rule that gives `importance` its meaning never fires for the audience it protects. Found while building the parent portal. Next available advances to `0114`. |
| 2026-09-27 | **Added `0110`–`0112` — school-defined pupil fields, and bulk import** | Definitions + typed values rather than a JSONB blob, because a blob cannot be access-controlled per field: a house colour and a medical condition would share one policy. `sensitivity` on the definition drives RLS on the values, so a teacher reads house and not medical notes. `0111` corrected two things the `0110` suite caught — a SECURITY INVOKER integrity check that was doing authorisation by accident and reporting it as a data error, and a policy granting `org:registrar` a pupil write the rest of ZSMS does not give it. `0112` adds `import_students()`, atomic so a failed import leaves no partial roll, and `next_student_sequence()` which takes MAX of the identifier suffix — the application's `count(*)` reuses a withdrawn pupil's number. Next available advances to `0113`. |
| 2026-09-26 | **Added `0108` — `save_exam_marks()`, the write path ADR-041 needs** | 0106 made a grade explainable by storing the scale version beside it; that only holds if the letter and the version are written *together*. An application that computes a grade, writes it, then writes the version has three chances to produce a row whose letter contradicts its stated explanation, and the row would look valid. Grading now happens in one statement over one version resolved once per sheet, so a revision landing mid-save cannot grade half a class under each scale. Also adds a one-argument `current_subject_scale_version()` that resolves the school from the session. Next available advances to `0109`. |
| 2026-09-26 | **Added `0106`/`0107` — grading-scale versioning; ADR-041 closed** | `exam_results` stored a grade letter with no record of the scale that produced it, so moving a distinction boundary from 80 to 75 made every earlier grade unexplainable. Bands now live in immutable per-version snapshots; a revision creates a version and requires a reason; results keep pointing at the version that graded them. `0107` exists because `0106` backfilled existing scales but left a *newly created* scale with no version at all — it resolved to no current version and could silently grade nothing. Found by inserting a scale and counting the versions it produced, not by re-reading the migration. Next available advances to `0108`. |
| 2026-08-23 | **Added `0105` — `get_user_role()` accepts Clerk's bare `o.rol`** | Clerk's v2 session token carries `admin`, not `org:admin`. The app read `auth().orgRole` (qualified) and rendered an administrator's portal; the policies read `o.rol` (bare) and refused every write. Neither layer looked wrong alone. Fixed in the helper rather than by a session-token template, because a template is undocumented per-environment configuration that fails silently as an empty school when a new environment misses it. Both forms accepted; a claim already carrying a namespace is passed through untouched. |
