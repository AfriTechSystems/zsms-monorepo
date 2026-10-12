# Schema Inventory

> **This file is generated. Do not edit it.**
> Run `npm run db:inventory` to refresh it from the live `zsms-dev` schema.

## Related Documents

- `DATABASE.md` — hand-written DDL and the reasoning behind the core tables
- `RLS.md` — the tenant-isolation model these policies implement
- `../05 Core Database and API Reference/MIGRATIONS.md` — the applied sequence

## Purpose

To answer "what exists in the database right now" without anybody having to keep a list up to date by hand.

`DATABASE.md` documents the core tables with their DDL and, more importantly, *why they are shaped that way* — which is worth writing and worth reading. It does not cover every table, and an audit on 2026-10-06 found it describing 49 of 93.

Hand-writing the other 52 would have produced a document that was accurate for about a week. This one cannot go stale, because it is read from the schema each time it is generated.

## Overview

Generated from `zsms-dev` on 2026-10-10.

| Schema | Tables | Reachable from a route |
|---|---:|---|
| `afritech` | 18 | No |
| `private` | 3 | No |
| `public` | 72 | Yes |
| **Total** | **93** | |

## `afritech`

AfriTech's own books — pricing, tiers, feature flags, invoices, commissions. **Unreachable from any API route**, by design: these tables are touched from SQL, a migration, or a `public` wrapper function.

| Table | Cols | RLS | Policies | Purpose |
|---|---:|---|---:|---|
| `ai_credit_packs` | 10 | forced | 2 | — |
| `ai_credit_prices` | 6 | forced | 2 | Credits per action, per AI feature. Priced in ACTIONS, never tokens: teachers do not think in tokens and token pricing would weld the price list to one provider's rate card. |
| `ai_models` | 13 | forced | 2 | The failover chain, in priority order, with per-million-token rates. Data rather than code so a third provider is a row, reordering is a row, and cost_usd stays accurate when a provider reprices. |
| `ai_prompt_templates` | 10 | forced | 2 | Versioned prompts. Immutable once written; editing publishes a new version. Every artefact records the version that produced it — ADR-041 applied to prompts. |
| `feature_flags` | 11 | forced | 2 | Every toggleable feature. Adding a feature to ZSMS means adding a row here (PRICING.md). |
| `invoice_lines` | 10 | forced | 1 | — |
| `invoice_payments` | 16 | forced | 1 | — |
| `invoices` | 26 | forced | 1 | — |
| `loan_commissions` | 13 | forced | 0 | What AfriTech earns per disbursed loan. In `afritech` because a school has no business reading what AfriTech earns on its parents' loans (0224). |
| `onboarding_checklist_items` | 11 | forced | 2 | The onboarding checklist definition. Weights transcribed from ONBOARDING.md. Adding an item is an INSERT here plus a backfill into public.onboarding_checklists for existing schools. |
| `platform_settings` | 5 | forced | 0 | — |
| `school_credit_plans` | 10 | forced | 1 | What a school may buy, per teacher seat. Prices are configuration editable without a deployment — PRICING.md prohibition: never hardcode a price, tier or feature inclusion. |
| `school_feature_overrides` | 13 | forced | 2 | Per-school exceptions. Every row carries a reason and an actor — this is the table a support decision is audited from. |
| `subscription_tiers` | 14 | forced | 2 | Database-driven tier configuration. Prices and quotas are edited here by a super admin, never hardcoded (ADR-031). |
| `teacher_hub_plans` | 12 | forced | 2 | Teacher Hub plans, including the free trial. Prices and the trial allowance are rows because a price is never hardcoded. included_resources NULL = unlimited. |
| `tier_ai_allowances` | 3 | forced | 2 | Included AI credits per month, per school tier. An included allowance exists so the feature gets USED — a school that must buy credits before trying it mostly never tries. |
| `tier_features` | 5 | forced | 2 | Which features each tier includes. A super admin toggling a cell affects every school on that tier immediately. |
| `tier_student_price_bands` | 8 | forced | 1 | — |

## `private`

Data that must never be reachable from a client at all, even through a policy. `CONVENTIONS.md` prohibition 9 forbids referencing this schema in client-side code; access goes through `public` SECURITY DEFINER functions.

| Table | Cols | RLS | Policies | Purpose |
|---|---:|---|---:|---|
| `consent_templates` | 7 | forced | 0 | Versioned consent wording. A log row stores the version AND the hash, so the exact text a parent agreed to is provable years later (0224). |
| `loan_applications` | 29 | forced | 1 | Loan applications. In `private` because they hold an income declaration, an employer and a payslip — PostgREST cannot see this schema, so nothing reaches it by constructing a URL (0224). |
| `loan_consent_log` | 11 | forced | 0 | IMMUTABLE record of a parent consenting to one lender seeing their data. No UPDATE, no DELETE — it is the evidence that the disclosure was lawful (0224). |

## `public`

Everything a route can reach. `supabase/config.toml` sets `schemas = ["public"]`, so PostgREST resolves `from()` and `rpc()` here and nowhere else.

| Table | Cols | RLS | Policies | Purpose |
|---|---:|---|---:|---|
| `ai_conversations` | 8 | forced | 1 | One assistant conversation. Scoped to the USER, not the school — a parent spans schools and a teacher may also hold a Hub account (0220). |
| `ai_credit_accounts` | 5 | forced | 1 | — |
| `ai_credit_caps` | 5 | forced | 2 | — |
| `ai_credit_ledger` | 18 | forced | 1 | Append-only AI credit movements. Balance is DERIVED from this table and never stored, the same reasoning as ADR-038's derived arrears: a cached balance must be kept in step with every top-up, spend and refund, and the first bug makes someone's credits wrong in a way nobody can reconstruct. |
| `ai_messages` | 13 | forced | 1 | Turns in an assistant conversation. `citations` records what the answer was built from, because a narrated figure nobody can trace is one nobody can act on (0220). |
| `announcement_reads` | 6 | forced | 8 | — |
| `announcement_starters` | 12 | forced | 3 | — |
| `announcements` | 17 | forced | 7 | — |
| `attendance_records` | 17 | forced | 7 | — |
| `audit_logs` | 13 | forced | 1 | Immutable append-only audit trail. Written by AFTER triggers (what changed) and by log_audit_event() (intent). UPDATE and DELETE are refused by trigger for EVERY role, including the table owner and service_role, because RLS does not constrain service_role. |
| `class_subjects` | 8 | forced | 3 | Which subjects are taught to which class in a given academic year. The curriculum side of the teaching model; teacher_assignments is the staffing side. |
| `curriculum_topics` | 17 | forced | 1 | Syllabus topics and learning outcomes as structured data. Deliberately relational rather than embedded: subject + grade + topic are exact keys, and similarity search can return the wrong grade, which is a wrong answer that reads like a right one. |
| `data_erasure_requests` | 11 | forced | 2 | — |
| `exam_results` | 26 | forced | 7 | — |
| `fee_record_revisions` | 8 | forced | 3 | — |
| `fee_records` | 20 | forced | 7 | — |
| `fee_structures` | 13 | forced | 5 | — |
| `generated_documents` | 14 | forced | 3 | — |
| `integration_log` | 12 | forced | 1 | ADR-023. Append-only record of every dispatch attempt. Payloads are school data and are never readable by AfriTech (0230). |
| `job_runs` | 14 | forced | 2 | Tenant-visible job audit trail. Carries reference IDs only — never PII, never amounts. The worker fetches full data by ID. |
| `lenders` | 29 | forced | 2 | Partner MFIs and banks. ZSMS is a facilitator in Phase 1; `zsms_internal` exists for when it becomes a licensed MFI (0224). |
| `message_log` | 22 | forced | 3 | Append-only dispatch record. Never updated except by delivery-status callbacks; never deleted. |
| `notification_templates` | 13 | forced | 4 | — |
| `onboarding_checklists` | 13 | forced | 3 | — |
| `parent_link_claims` | 11 | forced | 3 | — |
| `parent_push_tokens` | 10 | forced | 2 | Expo push tokens for the parent app. Keyed on the token, not (parent, platform) as NOTIFICATIONS.md specified — two parents sharing an account on two Android phones is a normal case and that key silently dropped one of them. No school_id: a token belongs to a phone. |
| `parents` | 13 | forced | 5 | — |
| `payment_gateways` | 15 | forced | 3 | — |
| `payments` | 29 | forced | 5 | Immutable payment events. Corrections are reversal rows, never edits. Only status=verified counts toward fee_records.amount_paid. |
| `platform_incidents` | 22 | forced | 1 | — |
| `reference_subjects_zm` | 9 | forced | 2 | — |
| `report_generation_jobs` | 12 | forced | 3 | — |
| `school_academic_config` | 11 | forced | 3 | — |
| `school_branding` | 8 | forced | 4 | Per-school theme: two brand colours and two logo variants. Colours are constrained to WCAG AA (ADR-043). Absent row or NULL column = ZSMS default. |
| `school_credit_assignments` | 11 | forced | 3 | — |
| `school_credit_purchases` | 18 | forced | 2 | — |
| `school_credit_settings` | 5 | forced | 2 | — |
| `school_custom_fields` | 14 | forced | 3 | School-defined extra fields on a pupil record. `sensitivity` drives RLS on the values: standard is staff-readable, sensitive is management only. See migration 0110. |
| `school_custom_roles` | 9 | forced | 3 | School-defined staff roles (ADR-012). Holders carry org:staff in Clerk with zero default access; everything they may do comes from `permissions` here (0228). |
| `school_grade_levels` | 10 | forced | 3 | — |
| `school_grading_scale_versions` | 12 | forced | 4 | Immutable snapshots of a grading scale. A revision creates a new row; rows that have graded anything can never be edited. exam_results.grading_scale_version_id points here so a historical grade stays explainable. See ADR-041. |
| `school_grading_scales` | 11 | forced | 3 | — |
| `school_integrations` | 16 | forced | 2 | ADR-023 tier 1. Per-school accounting and CRM connections (0230). |
| `school_join_requests` | 13 | forced | 3 | A standalone teacher asking to be linked to a school. Approval issues the ordinary server-side Clerk invitation; this table never grants access itself. |
| `school_message_quotas` | 9 | forced | 2 | — |
| `school_network_members` | 10 | forced | 3 | — |
| `school_network_roles` | 9 | forced | 2 | — |
| `school_network_schools` | 11 | forced | 2 | — |
| `school_networks` | 9 | forced | 2 | An owner running several separately-onboarded schools. Read-only aggregate surface; working inside a school still means switching into it. See 0119/0120. |
| `school_onboarding` | 24 | forced | 1 | Per-school onboarding record. Holds the invited owner before they accept, AfriTech internal notes, and the verification decision. AfriTech-only — internal_notes must never reach a school. |
| `school_onboarding_contacts` | 9 | forced | 1 | Every outreach attempt, append-only in practice. The 24-hour rule is computed from the earliest row here against the school's registration time — no scheduled job writes an "overdue" flag. |
| `school_payment_details` | 19 | forced | 3 | Where a school wants to be paid. Shown to parents alongside the fee balance so a payment claim can be made against a real account (0212). |
| `school_permissions` | 12 | forced | 3 | — |
| `school_public_profiles` | 21 | forced | 3 | What a school chooses to publish in the directory beyond the mandatory listing. Every field defaults to withheld. The fee band is the school's stated range, NOT derived from fee_structures — see 0155. |
| `school_subjects` | 11 | forced | 3 | — |
| `school_term_dates` | 8 | forced | 3 | When each term runs. The product has reasoned in terms since the fee module — fee_structures, exam_results and attendance_records all carry academic_year and term_number — without anything knowing when a term actually starts. |
| `schools` | 24 | forced | 4 | Root tenant table. clerk_org_id is the tenant key that every RLS policy resolves through. |
| `staff_custom_role_assignments` | 6 | forced | 2 | Which staff hold which custom role. Many-to-many, because a small school gives one person several jobs (0228). |
| `staff_members` | 17 | forced | 4 | — |
| `staff_permission_grants` | 13 | forced | 5 | Explicit, audited, time-bounded permission grants. Read by has_permission_grant() from every policy that supports grant overrides. |
| `staff_requests` | 15 | forced | 5 | — |
| `standalone_teacher_accounts` | 18 | forced | 4 | Teacher Hub accounts. OWNER-scoped on get_user_id(), not school-scoped — a standalone teacher has no organisation and current_school_uuid() is NULL for them. |
| `student_custom_values` | 11 | forced | 5 | One row per pupil per custom field, typed. Read access is decided by the field's sensitivity, not by the caller's screen. |
| `student_parent_links` | 12 | forced | 3 | — |
| `students` | 21 | forced | 7 | — |
| `teacher_assignments` | 11 | forced | 4 | Scope-based teaching assignments (ADR-037). scope=class owns a whole class; scope=subject teaches one subject to one class. Supersedes staff_assignments. |
| `teaching_resource_ratings` | 6 | forced | 1 | One rating per teacher per shared resource. Averaged on read rather than kept as a counter, so a teacher can change their mind (0217). |
| `teaching_resource_uses` | 5 | forced | 1 | Who copied which shared resource. Drives "most popular"; the identity is never exposed by a browse function (0217). |
| `teaching_resources` | 23 | forced | 3 | — |
| `timetable_periods` | 11 | forced | 3 | — |
| `timetable_slots` | 13 | forced | 3 | — |
| `timetables` | 11 | forced | 3 | — |

## Business Rules

- Every `public` table carries `school_id` and is filtered by RLS through `get_school_id()`. A `public` table without a policy is a defect (`CONVENTIONS.md` prohibition 4).
- RLS is **forced**, not merely enabled, so the table owner is subject to it too. "on" rather than "forced" in the table above is worth a look.
- A table with no `COMMENT` is undocumented in the one place that cannot drift. New tables should set one in their migration.

## Edge Cases and Error Handling

**No `public` table is missing RLS.**

46 of 93 tables have no `COMMENT`. That is the backlog this file makes visible:

- `afritech.ai_credit_packs`
- `afritech.invoice_lines`
- `afritech.invoice_payments`
- `afritech.invoices`
- `afritech.platform_settings`
- `afritech.tier_student_price_bands`
- `public.ai_credit_accounts`
- `public.ai_credit_caps`
- `public.announcement_reads`
- `public.announcement_starters`
- `public.announcements`
- `public.attendance_records`
- `public.data_erasure_requests`
- `public.exam_results`
- `public.fee_record_revisions`
- `public.fee_records`
- `public.fee_structures`
- `public.generated_documents`
- `public.notification_templates`
- `public.onboarding_checklists`
- `public.parent_link_claims`
- `public.parents`
- `public.payment_gateways`
- `public.platform_incidents`
- `public.reference_subjects_zm`
- `public.report_generation_jobs`
- `public.school_academic_config`
- `public.school_credit_assignments`
- `public.school_credit_purchases`
- `public.school_credit_settings`
- `public.school_grade_levels`
- `public.school_grading_scales`
- `public.school_message_quotas`
- `public.school_network_members`
- `public.school_network_roles`
- `public.school_network_schools`
- `public.school_permissions`
- `public.school_subjects`
- `public.staff_members`
- `public.staff_requests`
- `public.student_parent_links`
- `public.students`
- `public.teaching_resources`
- `public.timetable_periods`
- `public.timetable_slots`
- `public.timetables`

## Change Log

| Date | Change |
|---|---|
| 2026-10-06 | Generated for the first time, after the Foundation Layer audit scored `DATABASE.md` 55% for documenting 49 of 93 tables. |
