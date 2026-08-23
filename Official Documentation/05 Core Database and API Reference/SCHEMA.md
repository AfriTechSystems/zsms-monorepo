# SCHEMA.md — Database Schema Quick Reference

## Related Documents

- `docs/DATABASE.md` — full SQL definitions for every table
- `docs/RLS.md` — Row Level Security policies per table
- `docs/CONVENTIONS.md` — naming conventions for tables and columns
- `docs/modules/auth/ROLES.md` — roles that map to table access
- `docs/api/ENDPOINTS.md` — API routes that read and write each table

---

## Purpose

This document is the quick-reference companion to `DATABASE.md`. Where DATABASE.md contains full SQL CREATE TABLE statements, this document describes every table in plain English — what it is for, its most important columns, and how it relates to other tables. Claude Code reads this document when it needs to understand table relationships quickly without parsing SQL. Every table in the system is listed here.

---

## Schema Map

```
public schema         — All standard application tables
private schema        — Loan PII tables (loan_applications, loan_consent_log)
afritech schema       — AfriTech internal team tables
```

---

## Public Schema Tables

---

### `schools`
**What it is:** The root tenant table. One row per school on the ZSMS platform. Every other table in the system links back to this through `school_id`.

**Key columns:** `school_id` (e.g. ZM-LSK-0001), `clerk_org_id` (links to Clerk Organisation), `status` (pending_verification / trial / active / suspended / terminated), `subscription_tier`, `finance_module_enabled`, `trial_ends_at`.

**Relates to:** Everything. All other tables have a `school_id` foreign key to this table.

---

### `school_branding`
**What it is:** The school's visual identity — two brand colours and two logo variants. One row per school; `school_id` is both the primary key and the tenant column. An absent row, or a NULL column, means the ZSMS default, which is the normal state for a school that has not been through the branding step.

**Key columns:** `school_id` (PK → `schools.id`), `anchor_color` (ink — body text, headings, navigation), `primary_color` (buttons, links, active states), `logo_url` (full wordmark, R2 public bucket), `icon_url` (square mark for favicon and collapsed nav), `updated_by`.

**Constraints worth knowing:** both colours are `#RRGGBB`, and both are contrast-constrained against the **page ground `#F1F3FA`**, not white — `anchor_color` must reach **4.5:1** (it is the ink the interface is written in), `primary_color` must reach **3:1** (it is used unmodified as a button and chip fill). The page is the darker of the two light grounds and therefore the binding one; migration `0094` moved these off white. Enforced by CHECK constraints calling `wcag_contrast_ratio()`, not only by the application. The format constraints are separate and necessary: a CHECK that evaluates to NULL passes, and the contrast function returns NULL for a malformed colour. Logo URLs must be HTTPS. See ADR-043 and `DESIGN_SYSTEM.md`.

**Read scope is wider than most configuration:** every member of the school can SELECT it, because parents, students, and teachers all render the theme. Writing is owner, principal, and admin only. `anon` holds no privilege on the table at all — the unauthenticated parent login screen reads through `school_branding_by_slug()` instead.

**Relates to:** `schools` (one-to-one). Read by `school_branding_by_slug()` (login screens), `worker_school_branding()` (report cards, statements), and `worker_payment_context()` (receipts).

---

### `school_academic_config`
**What it is:** Stores each school's academic structure choices — curriculum type, grading system preferences, report card format, and class naming convention. Created during onboarding, editable in settings.

**Key columns:** `school_id`, `curriculum_type` (ecz_grades / cambridge_forms / hybrid / custom), `structure_type`, `highest_level_offered`, `grading_system` (ecz_percentage / cambridge_o_level / cambridge_a_level / custom), `report_card_format`, `class_naming_convention`, `onboarding_complete`.

**Relates to:** `schools` (one-to-one), `school_grade_levels`, `school_subjects`, `school_grading_scales`.

---

### `school_grade_levels`
**What it is:** The list of grade or form levels offered by a specific school. Replaces the simpler `grade_config`. Each row is one level (e.g. Grade 7, Form 1, Grade 7 / Form 1 for transitioning schools).

**Key columns:** `school_id`, `level_id` (e.g. grade_7, form_1), `display_name` (what appears on report cards and UI), `level_order` (for sorting), `level_type` (primary / junior_secondary / senior_secondary / a_level), `examination_type` (ecz / cambridge / internal / none), `is_active`.

**Relates to:** `schools`, `school_subjects`, `fee_structures`, `students` (grade_id references this).

---

### `school_subjects`
**What it is:** The subjects offered by a specific school. Populated from `reference_subjects_zm` during onboarding, plus any custom subjects the school adds. Each row is one subject at one school.

**Key columns:** `school_id`, `subject_code`, `subject_name`, `level_type` (primary / secondary / a_level), `is_core`, `curriculum_type`, `grading_scale_id` (which grading scale applies to this subject).

**Relates to:** `schools`, `school_grade_levels`, `exam_results` (subject_code field).

---

### `school_grading_scales`
**What it is:** Defines the grading scale(s) used by a school. A school using both ECZ percentage for primary and Cambridge letter grades for secondary has two rows. Each row contains the complete grade band definitions.

**Key columns:** `school_id`, `scale_name`, `scale_type` (percentage / letter / custom), `grade_bands` (JSONB array of grade definitions with letter, min, max, points, descriptor), `pass_mark`, `credit_mark`, `applies_to_levels` (TEXT array of level_types this scale applies to).

**Relates to:** `schools`, `school_subjects`, `exam_results`.

---

### `reference_subjects_zm`
**What it is:** The global read-only reference list of Zambian curriculum subjects. Used as the suggestion list during school onboarding. Never school-specific — one shared table for all Zambian schools.

**Key columns:** `country_code`, `subject_code`, `subject_name`, `level_type`, `is_core`, `curriculum_type` (ecz / cambridge / both), `is_active`.

**Relates to:** `school_subjects` (schools copy their selections from here).

**Note:** This table has no `school_id` column. It is a global reference table not subject to school-level RLS.

---

### `grade_config` (Legacy — Superseded)
**What it is:** The original simple grade configuration table. Superseded by `school_grade_levels` which is richer and supports both the old and new Zambian education system. Retained temporarily for backward compatibility during the migration. Will be removed in a future migration once all schools have migrated to `school_grade_levels`.

---

### `students`
**What it is:** The central entity. Every module references students. One row per student per school. Students who transfer schools get a new row at the new school — historical records at the old school are preserved.

**Key columns:** `student_id` (STU-ZM-LSK-0001-00042), `school_id`, `clerk_user_id` (if student has a portal login), `first_name`, `last_name`, `grade_id` (references `school_grade_levels.level_id`), `class_id`, `is_boarding`, `status`, `is_deleted`.

**Relates to:** `schools`, `student_parent_links`, `fee_records`, `attendance_records`, `exam_results`, `private.loan_applications`.

---

### `parents`
**What it is:** Parent and guardian accounts. Phone number is the primary identity. One Clerk user account per parent regardless of how many children or schools they are linked to.

**Key columns:** `clerk_user_id`, `phone_e164`, `email`, `full_name`, `preferred_contact`, `whatsapp_opted_in`, `last_login_at`.

**Relates to:** `student_parent_links` (links parents to students).

**Note:** No `school_id` column. Parents exist at the platform level, not the school level. Their school context comes from their student links.

---

### `student_parent_links`
**What it is:** The many-to-many link between students and parents. One student can have multiple guardians. One parent can have children at multiple schools.

**Key columns:** `student_id`, `parent_id`, `parent_user_id` (denormalised for RLS), `relationship`, `is_primary`, `is_active`, `grace_period_ends_at` (set to NOW() + 30 days when is_active set to FALSE).

**Relates to:** `students`, `parents`.

---

### `fee_structures`
**What it is:** Defines fee amounts per grade level, term, and student type. Schools configure this at the start of each academic year. Multiple rows per school cover different grades and fee types.

**Key columns:** `school_id`, `academic_year`, `term_number`, `grade_id`, `student_type` (all / day / boarding), `fee_label` (e.g. Tuition Fee, Activity Fee), `amount`, `currency_code`, `is_mandatory`.

**Relates to:** `schools`, `school_grade_levels`, `fee_records`.

---

### `fee_records`
**What it is:** The running ledger — one row per student per fee line per term. Tracks what is owed and what has been paid. Generated from `fee_structures` at term start.

**Key columns:** `school_id`, `student_id`, `fee_structure_id`, `academic_year`, `term_number`, `fee_label`, `amount_due`, `amount_paid`, `discount_amount`, `status` (unpaid / partial / paid / waived / loan_pending / loan_paid / overpaid), `due_date`, `reminder_count`.

**Relates to:** `schools`, `students`, `fee_structures`, `payments`, `private.loan_applications`.

---

### `payments`
**What it is:** Immutable record of every payment event. Never updated or deleted — corrections use reversal rows. Includes both manually recorded payments and gateway-confirmed payments.

**Key columns:** `school_id`, `fee_record_id`, `student_id`, `recorded_by_user_id`, `amount`, `payment_method` (cash / bank_deposit / online_gateway / loan_disbursement / reversal / waiver), `gateway_name`, `transaction_reference`, `receipt_number`, `receipt_url`, `proof_of_payment_url`, `confirmation_checkbox_at`, `status` (pending_verification / verified / rejected / queried), `verified_by`, `verified_at`, `rejection_reason`, `reversal_of_payment_id`, `is_voided`.

**Relates to:** `schools`, `fee_records`, `students`.

**Note:** No UPDATE or DELETE RLS policy for standard users. AfriTech super admin can UPDATE for corrections only, always logged in audit trail.

---

### `payment_gateways`
**What it is:** Payment gateway configuration per school. Multiple active gateways simultaneously supported. Gateway credentials stored encrypted.

**Key columns:** `school_id`, `gateway_name` (flutterwave / pawapay / dpo / pesapal / airtel_money / mtn_momo / zanaco_zpay / other), `display_name`, `is_active`, `is_primary`, `api_key_encrypted`, `api_secret_encrypted`, `webhook_secret`, `gateway_config` (JSONB for gateway-specific settings), `supported_currencies`, `test_mode`.

**Relates to:** `schools`, `payments`.

---

### `school_message_quotas`
**What it is:** Tracks WhatsApp message usage per school per billing period. Checked before every WhatsApp message is enqueued.

**Key columns:** `school_id`, `billing_period` (e.g. 2026-09), `quota_limit`, `messages_used`, `overage_credits`, `last_updated_at`.

**Relates to:** `schools`, `message_log`.

---

### `attendance_records`
**What it is:** Daily attendance per student. One row per student per day maximum (unique constraint). Created by teachers via web or mobile (offline-capable).

**Key columns:** `school_id`, `student_id`, `class_id`, `recorded_by_user_id`, `attendance_date`, `academic_year`, `term_number`, `status` (present / absent / late / excused / holiday), `arrival_time`, `excuse_reason`, `parent_notified`, `notification_sent_at`, `sync_source` (web / mobile_online / mobile_offline), `local_created_at`.

**Relates to:** `schools`, `students`.

---

### `exam_results`
**What it is:** Marks per student per subject per term. Entered by teachers, locked after principal publishes results.

**Key columns:** `school_id`, `student_id`, `class_id`, `academic_year`, `term_number`, `subject_code`, `subject_name`, `entered_by_user_id`, `marks_obtained`, `marks_total`, `grade_letter`, `grade_points`, `class_position`, `class_size`, `results_published`, `published_at`, `comments`.

**Relates to:** `schools`, `students`, `school_subjects`, `school_grading_scales`.

---

### `report_generation_jobs`
**What it is:** Progress tracking for bulk PDF report card generation. One row per class batch within a generation run. Supabase Realtime broadcasts updates from this table to show live progress in the UI.

**Key columns:** `school_id`, `run_id` (groups all batches for one generation action), `class_id`, `academic_year`, `term_number`, `total_students`, `completed_students`, `status` (queued / processing / complete / failed), `error_message`.

**Relates to:** `schools`.

---

### `document_templates`
**What it is:** PDF template configuration per document type per school. Schools configure once during onboarding; all subsequent generation uses the stored template.

**Key columns:** `school_id`, `doc_type` (report_card / payment_receipt / fee_statement / loan_confirmation / attendance_certificate / transfer_letter), `template_level` (branding / layout_variant / custom), `layout_variant`, `template_config` (JSONB with all customisation values), `preview_url`, `is_active`, `approved_by`.

**Relates to:** `schools`.

---

### `staff_members`
**What it is:** Staff profiles for all school personnel. One row per person per school. A teacher at two schools has two rows but one Clerk account.

**Key columns:** `school_id`, `clerk_user_id`, `first_name`, `last_name`, `phone_e164`, `email`, `department`, `employment_type`, `is_active`.

**Relates to:** `schools`, `teacher_assignments`.

---

### `class_subjects`
**What it is:** Which subjects are taught to which class in an academic year. The curriculum half of the teaching-assignment model (ADR-037).

**Key columns:** `school_id`, `class_id`, `subject_id` (FK to `school_subjects`), `academic_year`, `is_active`.

**Relates to:** `schools`, `school_subjects`, `teacher_assignments`.

---

### `teacher_assignments`
**What it is:** What a teacher teaches, at one of two scopes. Replaces the never-defined `class_enrolments` and supersedes `staff_assignments`. **This is a security table** — it determines which students a teacher may read.

- `scope = 'class'` — the teacher owns the whole class (`class_id` set, `subject_id` NULL). The primary-school and form-teacher case.
- `scope = 'subject'` — the teacher teaches one subject to one class (both set). The secondary-school case.

A teacher may hold any number of rows of either scope, including both at once. Because both scopes carry `class_id`, RLS resolves teacher reach with one predicate — `teacher_reaches_class()` — and never branches on school type.

**Key columns:** `school_id`, `teacher_user_id`, `scope`, `class_id`, `subject_id`, `academic_year`, `term_number`, `is_active`.

**Relates to:** `schools`, `school_subjects`, `students` (via `class_id`), `staff_members`.

**Note:** a `CHECK` constraint keeps `scope` and `subject_id` in agreement. Only the owner and principal may write this table — a teacher who could write it could grant themselves any class's students.

---

### `staff_assignments` (Removed)
**Removed in migration `0069`.** Superseded by `teacher_assignments` (ADR-037): `is_class_teacher = TRUE` maps to `scope = 'class'`, and a class/subject pairing maps to `scope = 'subject'`. Listed here only so that references to it in older documents resolve to an explanation rather than a missing table.

---

### `staff_requests`
**What it is:** Pending self-registration requests from staff waiting for school admin approval. These users have Clerk accounts but are not yet Clerk Organisation members.

**Key columns:** `school_id`, `clerk_user_id`, `first_name`, `last_name`, `role_requested`, `subjects`, `message`, `status` (pending / approved / rejected), `reviewed_by`, `rejection_reason`.

**Relates to:** `schools`.

---

### `staff_permission_grants`
**What it is:** Explicit, audited, time-bounded permission grants. Allows any action to be temporarily granted to any user beyond their base role. The foundation of the "no permanent can-never" permission model.

**Key columns:** `school_id`, `grantee_user_id`, `grantor_user_id`, `module`, `action`, `scope_detail`, `reason`, `is_active`, `expires_at`, `revoked_at`, `revoked_by`.

**Relates to:** `schools`.

---

### `school_permissions`
**What it is:** School-level default permission configuration. Allows a school owner to configure what each role can do by default at their school — overriding ZSMS platform defaults without creating individual grants.

**Key columns:** `school_id`, `role`, `module`, `can_view`, `can_create`, `can_edit`, `can_delete`, `can_export`, `updated_by`.

**Relates to:** `schools`.

---

### `message_log`
**What it is:** Append-only record of every WhatsApp and SMS message dispatched. Used for delivery tracking, quota monitoring, and the communication log in the admin dashboard.

**Key columns:** `school_id`, `recipient_phone`, `recipient_user_id`, `student_id`, `channel` (whatsapp / sms / email), `template_id`, `message_body`, `status` (queued / sent / delivered / read / failed / fallback_sent), `provider_message_id`, `error_code`, `retry_count`.

**Relates to:** `schools`, `students`.

---

### `audit_logs`
**What it is:** Immutable append-only record of every significant action. Written exclusively by Edge Functions using the service role key. No UPDATE or DELETE policy for any user including super admins.

**Key columns:** `school_id`, `actor_user_id`, `impersonated_user_id`, `action`, `table_name`, `record_id`, `old_values` (JSONB — PII masked), `new_values` (JSONB — PII masked), `ip_address`, `metadata`.

**Relates to:** `schools` (loosely — NULL for platform-level actions).

---

### `onboarding_checklists`
**What it is:** Tracks onboarding progress per school. Each row is one checklist item. Used to show the setup completion percentage on the school dashboard and in the AfriTech super admin panel.

**Key columns:** `school_id`, `item_key` (school_profile / grade_structure / grading_system / subjects / fee_structure / first_student / first_staff / payment_gateway / logo / term_dates), `is_complete`, `completed_at`, `completed_by`.

**Relates to:** `schools`.

---

### `school_api_keys`
**What it is:** API keys for external integrations. Schools generate keys to allow their existing systems to call ZSMS APIs. Credentials stored as SHA-256 hash — plaintext shown once at creation.

**Key columns:** `school_id`, `name`, `key_hash`, `key_prefix`, `scopes` (TEXT array), `rate_limit_rpm`, `is_active`, `last_used_at`, `expires_at`, `created_by`.

**Relates to:** `schools`.

---

### `school_webhooks`
**What it is:** Registered webhook endpoints for schools using the Tier 1 API integration. ZSMS sends events to these URLs when relevant things happen.

**Key columns:** `school_id`, `url`, `events` (TEXT array of subscribed event types), `secret` (for HMAC signing), `is_active`.

**Relates to:** `schools`.

---

## Private Schema Tables

---

### `private.loan_applications`
**What it is:** All loan application data including PII. Not accessible via PostgREST. Only accessible through Edge Functions with service role key after application-layer authorisation. `fee_record_id` is now nullable — non-school loans (personal, emergency) have no linked fee record.

**Key columns:** `school_id`, `student_id`, `parent_user_id`, `fee_record_id` (nullable), `lender_id` (FK to public.lenders), `loan_product_id`, `product_type` (school_fees / personal / emergency / device / uniform / university), `amount_requested`, `employment_type`, `monthly_income_encrypted`, `payslip_urls_encrypted`, `nrc_encrypted`, `behaviour_score`, `behaviour_score_breakdown` (JSONB), `repayment_schedule` (JSONB array of instalments), `collection_account` (JSONB — lender's payment details), `zsms_is_lender` (TRUE when ZSMS is the MFI), `status`, `total_repayable`, `monthly_instalment`, `confirmation_checkbox_at`.

**Relates to:** `public.schools`, `public.students`, `public.parents`, `public.fee_records` (nullable), `public.lenders`, `private.loan_consent_log`, `private.loan_repayment_log`.

---

### `private.loan_consent_log`
**What it is:** Permanently immutable record of every consent event. Cannot be modified or deleted by any user including super admins. Consent is lender-specific — a parent must consent separately for each lender.

**Key columns:** `loan_application_id`, `parent_user_id`, `parent_phone`, `lender_id`, `consent_version`, `consent_text_hash` (SHA-256 of exact text shown), `scrolled_to_bottom`, `checkbox_checked_at`, `consented_at`, `ip_address`, `device_fingerprint`, `session_id`.

**Relates to:** `private.loan_applications`.

---

### `private.loan_repayment_log`
**What it is:** Tracks every repayment event for ZSMS-facilitated loans. Covers both portal-initiated repayments (Phase 2) and manually confirmed repayments (Phase 1).

**Key columns:** `loan_application_id`, `instalment_number`, `amount`, `payment_method`, `gateway_reference`, `status` (initiated / confirmed / failed / manual), `initiated_by`, `initiated_at`, `confirmed_at`.

**Relates to:** `private.loan_applications`.

---

### `private.consent_templates`
**What it is:** Versioned loan consent text. Stores every version of the consent text shown to parents. Allows exact reproduction of the text a parent saw at any historical consent date.

**Key columns:** `version` (e.g. 'v2.1'), `template_text` (full consent text with {{VARIABLE}} placeholders), `effective_from`, `superseded_at`.

---

## AfriTech Schema Tables

---

### `afritech.staff_scope_assignments`
**What it is:** Defines which schools or regions each AfriTech team member can access. The scope enforcement layer for regional managers and support agents.

**Key columns:** `afritech_user_id`, `scope_type` (school / region / country / global), `school_id`, `region_code`, `country_code`, `granted_by`, `expires_at`, `is_active`.

**Relates to:** `public.schools`.

---

### `afritech.subscription_tiers`
**What it is:** Database-driven pricing for all ZSMS subscription tiers. AfriTech super admins edit this table to change prices without code deployments. One row per tier.

**Key columns:** `tier_name`, `display_name`, `monthly_price_zmw`, `monthly_price_usd`, `annual_price_zmw`, `student_limit`, `whatsapp_quota`, `is_publicly_listed`, `display_order`, `updated_by`.

---

### `afritech.feature_flags`
**What it is:** Registry of every toggleable feature in ZSMS. Adding a new feature to ZSMS means adding a row here with its category and add-on pricing.

**Key columns:** `feature_key` (e.g. 'timetable', 'loan_module', 'integrations'), `display_name`, `category`, `monthly_addon_price_zmw`, `is_available_as_addon`, `is_active`.

---

### `afritech.tier_features`
**What it is:** The feature-to-tier matrix. Controls which features are included in each tier. Super admins toggle cells here to immediately change what all schools on a tier can access.

**Key columns:** `tier_name`, `feature_key`, `is_included`, `updated_by`, `updated_at`.

**Relates to:** `afritech.subscription_tiers` (tier_name FK), `afritech.feature_flags` (feature_key FK).

---

### `afritech.school_feature_overrides`
**What it is:** Per-school access exceptions. Allows super admins to grant a school access to features not in their tier, extend subscriptions past their expiry, or treat a school as a different tier temporarily. Every override has a mandatory reason.

**Key columns:** `school_id`, `override_type` (grant_feature / revoke_feature / extend_subscription / extend_trial / tier_override), `feature_key` (for feature-specific overrides), `override_value`, `expires_at` (NULL = permanent), `reason`, `ticket_ref`, `granted_by`, `is_active`.

**Relates to:** `public.schools`.

---

### `afritech.loan_commissions`
**What it is:** Tracks origination commissions earned by AfriTech on disbursed loans. One row per disbursed loan. Managed by the AfriTech finance officer for invoicing and collection.

**Key columns:** `loan_application_id`, `lender_id`, `disbursed_amount`, `commission_rate`, `commission_amount`, `status` (pending / invoiced / received / disputed), `invoiced_at`, `received_at`.

**Relates to:** `public.lenders`.

---

### `afritech.platform_metrics`
**What it is:** Nightly cache of platform-wide business metrics. Calculated by a queue cron job at 02:00 UTC. Used by the AfriTech metrics dashboard for trend analysis without live queries.

**Key columns:** `metric_date`, `country_code`, `metric_name`, `metric_value`, `metric_metadata` (JSONB for breakdowns), `calculated_at`.

---

## New Public Schema Tables (Stages 6–17)

---

### `public.school_custom_roles`
**What it is:** School-defined staff roles beyond the standard Clerk roles. Custom role holders use `org:staff` as their Clerk base role with zero default access — all permissions defined here.

**Key columns:** `school_id`, `role_name`, `description`, `permissions` (JSONB — module/action matrix), `is_active`, `created_by`.

**Tier limits:** Starter 3, Growth 10, Professional/Enterprise unlimited.

---

### `public.module_subscriptions`
**What it is:** Feature add-ons purchased by schools independently of their tier. Works alongside `afritech.tier_features` — a school can access a feature either because it's in their tier or because they purchased this add-on.

**Key columns:** `school_id`, `module_name` (matches `afritech.feature_flags.feature_key`), `status` (active / cancelled / suspended), `billing_amount`, `currency_code`, `started_at`, `ends_at`.

---

### `public.timetables`
**What it is:** One timetable record per school per academic year per term. Multiple timetables can exist (regular and exam) but only one is active. Timetables must be published before teachers, students, and parents can see them.

**Key columns:** `school_id`, `academic_year`, `term_number`, `name`, `is_active`, `published`, `published_at`, `created_by`.

---

### `public.timetable_periods`
**What it is:** Standard time periods for the school day. Set once per school and reused across all timetables. Periods marked `is_teaching_period = FALSE` (breaks, lunch, assembly) cannot have lessons assigned.

**Key columns:** `school_id`, `period_name`, `start_time`, `end_time`, `period_order`, `applies_days` (INT array — 1=Mon to 5=Fri), `is_teaching_period`.

---

### `public.timetable_slots`
**What it is:** One slot per class per period per day of the week. The intersection of a class, a time period, and a day. Unique constraint prevents double-booking a class at the same time.

**Key columns:** `timetable_id`, `school_id`, `class_id`, `period_id`, `day_of_week`, `subject_code`, `staff_user_id` (teacher), `slot_type` (lesson/break/assembly/free/exam), `room`.

**Conflict detection:** Before saving, the system checks that `staff_user_id` has no other slot with the same `period_id` and `day_of_week` in this timetable.

---

### `public.announcements`
**What it is:** School broadcast messages to parents, students, or staff. Also used for AfriTech platform-level announcements to school owners (`school_id = NULL` for platform announcements).

**Key columns:** `school_id` (nullable), `title`, `body`, `importance` (regular / important), `target_type` (all_parents / all_students / all_staff / grade / class / platform), `target_ids`, `scheduled_at`, `sent_at`, `status`, `whatsapp_jobs_queued`.

---

### `public.announcement_reads`
**What it is:** Tracks every read event for every announcement across all schools. One row per user per announcement. Populated when a user opens the announcement detail view (not just the notification feed).

**Key columns:** `school_id`, `announcement_id`, `reader_user_id`, `reader_type` (parent / student / staff), `read_at`.

**Note:** Unique constraint on `(announcement_id, reader_user_id)` — one read record per user per announcement.

---

### `public.parent_push_tokens`
**What it is:** Expo push notification tokens for the parent mobile app. One row per device platform per parent. Used by the absence alert and notification system.

**Key columns:** `parent_user_id`, `push_token`, `platform` (ios / android), `is_active`, `updated_at`.

---

### `public.alumni_profiles`
**What it is:** Permanent platform-level records for parents and students whose school relationship has ended (graduation, transfer, withdrawal). Links to their original student and school records for historical access.

**Key columns:** `clerk_user_id`, `original_student_ids` (TEXT array), `original_school_ids` (UUID array), `graduation_year`, `last_grade_completed`, `marketing_opt_in` (explicit opt-in for AfriTech promotional content), `opted_in_at`.

---

### `public.lenders`
**What it is:** Registry of lending partners on the ZSMS loan marketplace. Managed by AfriTech loan officers. Each lender defines their loan products, eligibility criteria, and collection details.

**Key columns:** `lender_name`, `display_name`, `integration_type` (email / api / zsms_internal), `loan_products` (JSONB array), `max_loan_amount`, `min_behaviour_score`, `commission_rate`, `collection_account` (JSONB — payment details for parent repayments), `is_active`, `is_featured`.

---

### `public.school_integrations`
**What it is:** Configuration for accounting and CRM integrations per school. One row per connected integration. Stores encrypted OAuth credentials and event subscriptions.

**Key columns:** `school_id`, `integration_type` (sage_50_export / sage_business_cloud / quickbooks / xero / google_sheets / hubspot / custom_webhook), `display_name`, `is_active`, `is_paused`, `config` (JSONB — integration-specific settings), `credentials_enc`, `events_subscribed` (TEXT array), `last_sync_at`, `last_sync_status`.

---

### `public.integration_log`
**What it is:** Append-only log of every integration event dispatch attempt. Used for debugging, retry management, and the school's integration health dashboard. Never contains PII — only ZSMS record IDs and response summaries.

**Key columns:** `school_id`, `integration_id`, `event_type`, `zsms_record_id`, `status` (pending / success / failed / retrying / skipped), `response_code`, `error_message`, `retry_count`, `next_retry_at`.

---

## Updated Table Count Summary

| Schema | Table Count | Notes |
|---|---|---|
| `public` | 42 tables | All standard application tables (27 original + 15 new) |
| `private` | 4 tables | Loan PII — restricted access |
| `afritech` | 8 tables | Internal team management and pricing |
| **Total** | **54 tables** | |

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 5 database reference documentation |
| 2026-04-26 | Added school_academic_config, school_grade_levels, school_subjects, school_grading_scales, reference_subjects_zm | Curriculum flexibility for Zambian education system |
| 2026-04-26 | Added school_api_keys, school_webhooks | Modular API integration tier |
| 2026-04-26 | Added school_message_quotas | Portal-first communication model with tiered quotas |
| 2026-04-26 | Added onboarding_checklists | Progressive onboarding model |
| 2026-04-26 | Updated payments table — added proof_of_payment_url, confirmation_checkbox_at, status fields | Removed OTP for financial submissions — replaced with confirmation workflow |
| 2026-04-26 | Added school_custom_roles | Custom staff roles — org:staff base Clerk role with DB-defined permissions |
| 2026-04-26 | Added module_subscriptions | Feature toggle billing — add-ons purchasable per school |
| 2026-04-26 | Added timetables, timetable_periods, timetable_slots | Timetable module confirmed as core feature |
| 2026-04-26 | Added announcements, announcement_reads | Full read tracking for all announcements |
| 2026-04-26 | Added parent_push_tokens | Expo push notifications for parent mobile app |
| 2026-04-26 | Added alumni_profiles | Graduated account model with permanent historical access |
| 2026-04-26 | Added lenders | Loan marketplace — multiple lending partners |
| 2026-04-26 | Added school_integrations, integration_log | Accounting and CRM integration framework |
| 2026-04-26 | Updated loan_applications — nullable fee_record_id, lender_id, repayment_schedule | Non-school loans, lender marketplace, repayment tracking |
| 2026-04-26 | Added private.loan_repayment_log, private.consent_templates | Repayment tracking and consent versioning |
| 2026-04-26 | Added afritech pricing tables (subscription_tiers, feature_flags, tier_features, school_feature_overrides) | Dynamic pricing — super admins control without code deploys |
| 2026-04-26 | Added afritech.loan_commissions, afritech.platform_metrics | Commission tracking and nightly metrics cache |
| 2026-04-26 | Updated schools, parents, students tables with new fields | WhatsApp own number, marketing opt-in, examination number, alumni status |

---

## AI Module Tables

### `public.knowledge_base`
**What it is:** The AfriTech-maintained curriculum content store powering the lesson planner RAG pipeline. Each row is a single chunk of a curriculum document (ECZ syllabus, Cambridge specification, MESVTEE framework, textbook) with its vector embedding. Content is chunked at 800-1,200 tokens respecting document structure.

**Key columns:** `source_type` (ecz_syllabus / cambridge_igcse / cambridge_alevel / curriculum_framework / textbook / exam_papers), `source_name` (human-readable document name), `grade_level`, `subject`, `topic`, `curriculum_type`, `country_code`, `chunk_text` (the actual content), `embedding` (vector(1536) — pgvector), `is_active` (FALSE for superseded content from old syllabus versions — never hard deleted).

**Access:** AfriTech content team write access only. Teachers and schools read via the RAG pipeline Edge Function — never direct query access.

**Relates to:** `public.lesson_plans` (the output that uses this knowledge).

---

### `public.lesson_plans`
**What it is:** Generated lesson plans created by the AI lesson planner for both school-linked teachers and standalone teacher account holders. `school_id` is NULL for standalone teachers — they own their content regardless of school affiliation.

**Key columns:** `school_id` (nullable), `created_by` (Clerk user ID — org:teacher or platform:teacher), `title`, `grade_level`, `subject`, `topic`, `curriculum_type`, `duration_minutes`, `lesson_type`, `content` (JSONB — full structured lesson plan: objectives, outline, activities, assessment, homework, differentiation), `knowledge_sources` (which knowledge_base chunks were retrieved — for transparency), `is_shared` (teacher can share publicly), `teacher_notes`.

**Relates to:** `public.schools` (nullable), `public.standalone_teacher_accounts`.

---

### `public.ai_conversations`
**What it is:** Conversation history for the role-based AI assistant. Stores the full message thread per user per session. Used to load the last 10 messages for context continuity. Archived after 30 days.

**Key columns:** `school_id` (nullable — NULL for standalone teacher conversations), `user_id` (Clerk user ID), `user_role` (role at time of conversation), `messages` (JSONB array of {role, content, timestamp}), `token_count` (running total for cost monitoring).

**Relates to:** `public.schools` (nullable).

---

### `public.standalone_teacher_accounts`
**What it is:** Platform-level B2C accounts for teachers using the lesson planner independently of any school. Has no access to school operational data. Free trial: 5 lesson plans. After trial, monthly subscription required. Can optionally be linked to a ZSMS school when the school registers — lesson plans carry over on linking.

**Key columns:** `clerk_user_id`, `full_name`, `email`, `curriculum_types` (TEXT array), `subjects` (TEXT array), `subscription_status` (trial / active / cancelled / suspended), `trial_plans_used`, `trial_plans_limit` (default 5), `lesson_plans_count`, `linked_school_id` (nullable — set when teacher links to a registered school).

**Relates to:** `public.schools` (nullable via linked_school_id), `public.lesson_plans`.

---

## Updated Table Count Summary

| Schema | Table Count | Notes |
|---|---|---|
| `public` | 46 tables | Added 4 AI module tables to previous 42 |
| `private` | 4 tables | Loan PII — unchanged |
| `afritech` | 8 tables | Pricing and operations — unchanged |
| **Total** | **58 tables** | |

---

## Change Log Update

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Added knowledge_base, lesson_plans, ai_conversations, standalone_teacher_accounts | AI module — lesson planner and AI assistant |
