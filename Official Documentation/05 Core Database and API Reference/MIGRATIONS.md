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

**`0019_create_fee_tables.sql`**
Creates all fee-related tables.
- Creates: `public.fee_structures`, `public.fee_records`, `public.payments`, `public.payment_gateways`
- Related: `docs/DATABASE.md` — fee tables

**`0020_create_fee_rls.sql`**
Applies RLS policies to all fee and payment tables.
- Creates: RLS policies for fee tables
- Related: `docs/RLS.md` — fee table policies

**`0021_create_message_quota_table.sql`**
Creates the WhatsApp message quota tracking table.
- Creates: `public.school_message_quotas`
- Related: `docs/infra/META_API.md`, `docs/modules/communication/WHATSAPP.md`

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

**`0066`** — available for the next migration.

When creating a new migration, use `0066` and update this document with the new entry before committing.

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

**NEXT AVAILABLE: `0056`**

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

**NEXT AVAILABLE: `0066`**
