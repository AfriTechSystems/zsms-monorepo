# GLOSSARY.md — ZSMS Terms and Definitions

## Purpose

This document defines every term, acronym, and concept used across ZSMS documentation. When a term appears in any document, its meaning can be looked up here. Claude Code sessions use this to ensure consistent language across all documentation and code.

---

## A

**Academic Year**
The 12-month period covering a school's full set of terms. In Zambia: January to December. Format: `'2026'`.

**Add-on**
A purchasable feature module that extends a school's base subscription tier. Add-ons are enabled/disabled per school without changing their tier. Examples: Timetable Builder (K100/month), Loan Module (K275/month), Integrations (K200/month). Managed via `public.module_subscriptions` and `afritech.feature_flags`.

**AfriTech Systems Limited**
The company that owns, operates, and develops ZSMS. Registered in Zambia under PACRA. Co-founders: Mwando Hamwenda (CTO) and Julius Masiwa (CFO).

**Alumni**
A student or parent whose active school relationship has ended due to graduation, transfer, or withdrawal. Alumni retain permanent read-only access to historical records. Managed via `public.alumni_profiles`. See also: Graduated Account Model.

**Alumni Status**
A field on the students table (`students.alumni_status`) tracking whether a student is active, graduated, or transferred. Set during the graduation or transfer flow.

**Announcement**
A broadcast message sent by a school to parents, students, or staff. Stored in `public.announcements`. Read tracking in `public.announcement_reads`. Important announcements are sent via WhatsApp and consume school quota.

**API Key**
A school-generated key for external system access to the ZSMS API. Stored as SHA-256 hash in `school_api_keys`. Never stored in plaintext. Used by the integrations framework and third-party tools.

**At-Risk Student**
A student flagged by the ZSMS early warning system as likely to fail or disengage based on configurable thresholds for marks, attendance, or both. Identified by System 1 (Smart Analytics). Risk levels: critical, high, medium.

---

## B

**Behaviour Score**
A proprietary payment reliability indicator calculated by ZSMS for each parent. Scale: 300 (Very Poor) to 850 (Excellent). Four weighted categories: Payment History (35%), Payment Capacity (25%), Account Behaviour (20%), Risk Indicators (20%). Calculated fresh at loan application time — never a continuously updated attribute. ZSMS is not a credit bureau.

**Boarding Student**
A student who lives at the school. `students.is_boarding = TRUE`. Associated with higher fee structures (boarding fees) and serves as a payment capacity proxy in the behaviour score.

**Bulk Import**
The process of importing multiple students at once from a CSV or Excel file with column mapping. Handled by the import jobs system via the job queue. Up to 1,000 students per batch.

**BullMQ**
A Redis-backed job queue library. **The default job queue implementation for ZSMS (ADR-035)**, running as persistent workers on Railway. Chosen over QStash for job priorities, per-worker concurrency control, cost at volume, and parity with self-hosted deployments. Application code never imports it directly — see Queue Abstraction.

---

## C

**Chatbot**
The WhatsApp inbound message handler that allows parents to query ZSMS data using text commands (FEES, RESULTS, ATTENDANCE, HELP). Phase 2 enhancement: natural language via Claude API.

**Clerk**
The third-party authentication provider used by ZSMS. Handles multi-tenant organisations (schools), email OTP, JWT generation, and session management. US-based — covered by a Data Processing Agreement for ZDPA compliance.

**Collection Account**
The payment details (mobile money number, bank account) that a lender provides for parents to make loan repayments directly to them. Stored in `lenders.collection_account` JSONB. Displayed prominently in the parent's loan repayment dashboard.

**Column Mapping**
The process during bulk student import where the admin maps columns from their existing spreadsheet to ZSMS field names. Mappings can be saved and reused for future imports.

**Conflict Detection**
The timetable builder's server-side check that prevents a teacher from being assigned to two classes at the same time. Implemented as a database UNIQUE constraint on (timetable_id, staff_user_id, day_of_week, period_id) and a pre-save query check.

**Consent Log**
The permanently immutable record of every loan application consent event. Stored in `private.loan_consent_log`. Contains the SHA-256 hash of the exact consent text shown, the timestamp, the lender name, IP address, device fingerprint, and Clerk session ID. Cannot be modified or deleted by any user.

**Country Config**
The per-country configuration file in `packages/config/countries/{code}.ts` containing currency, timezone, subscription pricing, WhatsApp quota defaults, and other country-specific settings.

**Credit Bureau**
A licensed organisation that collects and reports credit history. ZSMS is NOT a credit bureau. The ZSMS behaviour score is an internal indicator — it does not constitute a formal credit assessment and cannot be used as one until ZSMS registers as a credit bureau.

**Custom Role**
A school-defined staff role beyond the standard Clerk roles. Custom role holders use `org:staff` as their Clerk base role (zero default access). All permissions are defined in `public.school_custom_roles`. Tier limits: Starter 3, Growth 10, Professional/Enterprise unlimited.

---

## D

**Data Completeness Score**
A composite score (0-100) measuring how consistently a school enters data into ZSMS. Weighted from attendance completeness (40%), marks completeness (40%), and parent link completeness (20%). AI insights require >= 70%. Below 50% locks AI insights entirely. Calculated fresh on every AI feature page load.

**Data Processing Agreement (DPA)**
A contractual agreement between AfriTech and third-party data processors (Clerk, Supabase) governing how personal data is handled in compliance with the ZDPA 2021.

**Data Residency**
Where personal data is physically stored. ZSMS stores substantive personal data (academic records, financial records) in Supabase af-south-1 (South Africa). Authentication credentials are in Clerk (US). Both are covered by appropriate agreements under ZDPA.

**Dead Letter Queue (DLQ)**
The queue where jobs that have failed all retry attempts are stored for manual inspection and retry. Monitored by AfriTech developers via the admin panel.

**Document Template**
The configuration controlling how a school's generated PDFs look — logo placement, primary colour, layout variant, principal comment. Stored in `public.document_templates` as JSONB.

---

## E

**ECZ**
Examinations Council of Zambia. The government body that administers national examinations (Grade 6, Grade 9, Grade 12 / Form 4, Form 6) and publishes the official syllabuses used in Zambian schools.

**Edge Function**
A Supabase serverless function running in Deno. Used for webhook processing, PDF generation, WhatsApp dispatch, and other background operations that require server-side logic.

**Embedding**
A vector representation of text produced by an embedding model (e.g. OpenAI text-embedding-3-small). Used in the lesson planner knowledge base — each curriculum chunk is embedded so that semantically similar content can be retrieved via vector similarity search.

**Examination Number**
The ECZ or Cambridge candidate registration number assigned to a student for national examinations. Stored in `students.examination_number`. Optional — relevant only for Grade 6, Form 4, and Form 6 students.

---

## F

**Feature Flag**
A toggleable feature in ZSMS whose availability is controlled by the subscription tier, add-on purchases, or AfriTech overrides. Defined in `afritech.feature_flags`. Access resolved via `schoolHasFeature()` with Redis cache.

**Fee Finance**
The general term for the school fee loan product — parents apply through ZSMS to get a loan from a partner MFI to pay their child's school fees. Distinct from personal loans or other loan products.

**Fee Record**
A per-student record of a specific fee obligation for a term. Generated from fee structures. Tracks amount due, amount paid, status, and due date. Stored in `public.fee_records`.

**Fee Statement**
A PDF document showing all fees charged and payments made for a student for a selected period, with a running balance. Generated on demand by accountants or parents.

**Fee Structure**
The template defining what fees are charged for a specific grade level and term (e.g. Grade 9, Term 2 — Tuition K2,500, Activity K300). Used to generate fee records for all students in a grade.

---

## G

**Grace Period**
The 30-day window after a student leaves a school during which the parent's link remains active. Allows the parent to access historical records before the link expires. Controlled by `student_parent_links.grace_period_ends_at`.

**Graduated Account Model**
The ZSMS architecture for handling students who complete their schooling. Graduates retain permanent read-only access to their historical data. AfriTech can send promotional content to graduates who opt in. See: Alumni.

---

## H

**HMAC**
Hash-based Message Authentication Code. Used to sign webhook payloads so receiving systems can verify the message came from ZSMS. All outbound webhooks include an `X-ZSMS-Signature` header with `sha256={HMAC of payload body}`.

---

## I

**Impersonation**
The mechanism allowing AfriTech team members to view and act as a school user for support purposes. Every session requires a mandatory reason and is logged permanently. School owners can see the AfriTech access log in Settings → Security.

**Integration Connector**
A pre-built ZSMS adapter for a specific third-party system (Sage Business Cloud, QuickBooks, Xero, Google Sheets, HubSpot). Translates ZSMS events into the target system's API format and handles OAuth authentication. Phase 2 feature.

**Integration Log**
The append-only record of every integration event dispatch attempt. Stored in `public.integration_log`. Shows delivery status, response codes, and retry history. Never contains PII — only record IDs and response summaries.

---

## J

**JWT**
JSON Web Token. Issued by Clerk for every authenticated session. Contains: `sub` (Clerk user ID), `org_id` (school's Clerk org ID), `org_role` (user's role), `school_id` (ZSMS school UUID from metadata). Used by Supabase RLS helper functions to enforce data isolation.

---

## K

**Knowledge Base**
The AfriTech-maintained collection of Zambian curriculum documents (ECZ syllabuses, Cambridge syllabuses, MESVTEE frameworks) chunked and embedded as vectors in the `public.knowledge_base` table. Powers the lesson planner RAG pipeline. Maintained by AfriTech — schools and teachers do not upload to it.

---

## L

**Lender**
A financial institution (MFI, bank) onboarded as a partner in the ZSMS loan marketplace. Defined in `public.lenders`. Each lender has products, eligibility criteria, commission rates, and collection account details. Managed by AfriTech loan officers.

**Lesson Plan**
A structured teaching document generated by the ZSMS AI lesson planner using the RAG pipeline. Contains learning objectives, lesson outline, activities, assessment questions, and homework. Stored in `public.lesson_plans`. Available to school-linked teachers and standalone teacher account holders.

**Loan Product**
A specific lending product offered by a lender. Defined in `lenders.loan_products` JSONB. Types: school_fees, personal, emergency, device, uniform, university. Each product has its own amount limits, tenure, and eligibility criteria.

---

## M

**Marketing Opt-In**
An explicit consent from a parent or alumni for AfriTech to send promotional content (scholarships, marketplace promotions, study abroad opportunities). Stored in `parents.marketing_opt_in` and `alumni_profiles.marketing_opt_in`. Defaults to FALSE — never pre-checked. Separate from `whatsapp_opted_in` (school notifications).

**MESVTEE**
Ministry of Education, Science, Vocational Training and Early Education. The Zambian government ministry responsible for education policy and the national curriculum framework.

**MFI**
Microfinance Institution. A licensed lender that provides small loans. ZSMS partners with MFIs for the school fee loan product. ZSMS itself plans to register as an MFI in Phase 3 to lend directly.

**Module Subscription**
A school's purchase of a feature add-on. Tracked in `public.module_subscriptions`. Works alongside the tier features matrix — a school accesses a feature either because it's in their tier OR because they have an active module subscription.

**Multi-Tenant**
The architecture where multiple schools share the same ZSMS infrastructure but are completely isolated from each other. Isolation enforced by Supabase RLS using `school_id` as the tenant identifier on every query.

---

## O

**Onboarding Checklist**
The per-school progress tracker showing which setup steps have been completed. Items have weights contributing to a completion percentage. Used by AfriTech to monitor new school engagement. A school with low completion is at risk of trial expiry.

**Origination Commission**
The fee AfriTech earns from a lender when a loan is disbursed. Typically 1-3% of the disbursed amount. Tracked in `afritech.loan_commissions`. AfriTech earns commission from lenders, not from parents or schools.

**Override**
A super admin action that grants or restricts a school's access independently of their subscription tier. Types: grant_feature, revoke_feature, extend_subscription, extend_trial, tier_override. All require a mandatory reason and are logged. Managed in `afritech.school_feature_overrides`.

---

## P

**Parent Portal**
The web and mobile interface used by parents and guardians to view their child's results, attendance, fee balance, and announcements. Accessed at zsms.co.zm/portal.

**Pilot School**
One of the 10 schools selected for the September 2026 pilot launch. Pilot schools receive white-glove onboarding (guided setup sessions) and free or discounted access during the pilot period.

**Platform Metrics**
AfriTech's internal business metrics — MRR, trial conversion rate, churn, loan commission, and more. Calculated nightly and cached in `afritech.platform_metrics`. Visible only to AfriTech staff.

**PowerSync**
The offline sync service used by the teacher mobile app. Enables teachers to mark attendance and enter marks without internet connectivity. Data syncs automatically when connectivity is restored. See: `docs/infra/POWERSYNC.md`.

**Primary Contact**
The parent or guardian designated as the primary contact for a student. Identified by `student_parent_links.is_primary = TRUE`. Receives fee reminders, results notifications, and absence alerts.

**Private Schema**
The `private` PostgreSQL schema containing sensitive loan application data. Not accessible via Supabase's PostgREST layer — only accessible through Edge Functions using the service role key after application-layer authorisation.

**Promotional Content Opt-In**
See: Marketing Opt-In.

---

## Q

**QStash**
Upstash's serverless message queue service. **The swappable fallback implementation of the ZSMS job queue, not the default** — see BullMQ and ADR-035. Activated by setting `JOB_QUEUE_PROVIDER=qstash`.

**Queue Abstraction**
The `JobQueue` interface in `packages/utils/queue` that all background job dispatch goes through. Application code calls `getQueue().enqueue(...)` and never imports BullMQ or QStash directly, so the underlying implementation is a configuration choice. See `BULLMQ.md` and ADR-035.

**Quota**
The monthly limit on WhatsApp messages a school can send. Varies by subscription tier (Starter: 500, Growth: 1,500, Professional: 4,000, Enterprise: unlimited). Tracked in `public.school_message_quotas` with a 24-hour Redis cache.

---

## R

**RAG (Retrieval-Augmented Generation)**
The lesson planner's AI architecture. When a teacher requests a lesson plan, the system retrieves relevant curriculum content from the knowledge base (Retrieval), combines it with the teacher's request (Augmentation), and passes it to Claude to generate the lesson plan (Generation). This grounds the AI response in actual Zambian curriculum content rather than generic knowledge.

**Receipt**
A PDF document confirming a verified payment. Generated automatically when an accountant verifies a payment. Stored in R2 and linked from the fee record. Receipt numbers follow the format REC-ZM-LSK-0001-000042.

**Role Selector**
The UI shown to users with multiple ZSMS roles (e.g. a person who is both a parent and a teacher at different schools). Allows them to choose which context to enter after login.

**RLS (Row Level Security)**
The PostgreSQL security mechanism that filters database results based on the authenticated user's identity and role. The primary data isolation mechanism in ZSMS — enforced at the database layer, not the application layer.

---

## S

**School ID**
A unique human-readable identifier for each school. Format: `ZM-LSK-0001` (country code — city code — sequence). Used in receipt numbers, student IDs, and URL paths.

**School-Specific WhatsApp Number**
When a school uses their own Meta-registered WhatsApp Business number instead of the AfriTech shared number. Indicated by `schools.whatsapp_owns_number = TRUE`. Messages appear from the school's own number rather than "ZSMS Zambia."

**Soft Delete**
Marking a record as deleted (`is_deleted = TRUE`) rather than removing it from the database. Used for students, fee records, and payments to preserve history for audit and compliance.

**Standalone Teacher Account**
A ZSMS account type (`platform:teacher`) for teachers not affiliated with any registered school. Created independently to access the lesson planner B2C product. Cannot access school data. Managed in `public.standalone_teacher_accounts`.

**Student ID**
A unique human-readable identifier for each student. Format: `STU-ZM-LSK-0001-00042` (country — city — school sequence — student sequence). Used in reports, receipts, and API references.

**Subscription Tier**
One of four base pricing levels for school subscriptions: Starter, Growth, Professional, Enterprise. Prices and feature inclusions are database-driven in `afritech.subscription_tiers` and `afritech.tier_features`.

---

## T

**Tier Features**
The matrix mapping which features are included in each subscription tier. Stored in `afritech.tier_features`. Modified by AfriTech super admins via the pricing admin panel. Changes take effect immediately for new schools and at next billing cycle for existing schools.

**Timetable Slot**
A single lesson assignment in the timetable — the intersection of a class, a period, and a day of the week. Stored in `public.timetable_slots`. Subject to conflict detection: a teacher cannot be assigned to two slots at the same time.

**Trial**
The 30-day free access period for newly registered schools. No payment required. All features available based on the default trial tier (typically Growth). Trial expiry can be extended by AfriTech super admins via the override system.

**Turborepo**
The monorepo build tool used to manage the ZSMS codebase. Organises the web app, mobile app, shared packages, and Supabase functions into a single repository with efficient caching and parallel builds.

---

## V

**Vector Embedding**
See: Embedding.

**Vector Search**
The process of finding similar content by comparing vector embeddings using cosine similarity. Used in the lesson planner to retrieve relevant curriculum chunks from the knowledge base. Implemented via Supabase's pgvector extension with an IVFFlat index.

---

## W

**WhatsApp Opted-In**
Whether a parent consents to receiving WhatsApp messages from ZSMS for school notifications (attendance alerts, fee reminders, results). Stored in `parents.whatsapp_opted_in`. Distinct from `marketing_opt_in` — school notifications and promotional content are governed separately.

---

## Z

**ZDPA**
Zambia Data Protection Act 2021. The primary data protection legislation governing how ZSMS handles personal data. Key requirements: Data Controller registration with ZICTA, adequate protection for cross-border transfers, explicit consent, 72-hour breach notification. AfriTech must register as a Data Controller.

**ZICTA**
Zambia Information and Communications Technology Authority. The government regulatory body responsible for enforcing the ZDPA. AfriTech registers as a Data Controller with ZICTA.

**ZSMS**
Zambia School Management System. AfriTech's flagship SaaS product for private school management.

**ZSMS MFI**
The planned Phase 3 evolution where ZSMS registers as a licensed Microfinance Institution with the Bank of Zambia and provides school fee loans directly rather than referring to partner lenders.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Pre-development terminology reference |
| 2026-04-26 | Added Add-on, Feature Flag, Tier Features, Override | Dynamic pricing and feature toggle system |
| 2026-04-26 | Added Alumni, Graduated Account Model, Alumni Status | Permanent account model for graduates |
| 2026-04-26 | Added School-Specific WhatsApp Number | Per-school Meta number support |
| 2026-04-26 | Added Examination Number, Custom Role, Column Mapping | Student and staff management additions |
| 2026-04-26 | Added Behaviour Score, Origination Commission, Collection Account, Lender, Loan Product | Loan marketplace and MFI evolution |
| 2026-04-26 | Added Integration Connector, Integration Log, Data Residency | Integrations module and compliance |
| 2026-04-26 | Added RAG, Embedding, Vector Search, Knowledge Base, Data Completeness Score, At-Risk Student, Lesson Plan, Standalone Teacher Account | AI module additions |
| 2026-04-26 | Added Marketing Opt-In, Promotional Content Opt-In | Alumni marketing system |
| 2026-04-26 | Added Conflict Detection, Timetable Slot | Timetable module |
