# EDGE_FUNCTIONS.md — Supabase Edge Functions Reference

## Related Documents

- `docs/api/ENDPOINTS.md` — Next.js API routes (separate from Edge Functions)
- `docs/infra/QSTASH.md` — job queue that triggers most Edge Functions
- `docs/infra/SUPABASE.md` — Edge Function deployment and configuration
- `docs/ENV.md` — secrets used by Edge Functions

---

## Purpose

This document lists every Supabase Edge Function in ZSMS — its trigger, what it does, its inputs and outputs, and which queued jobs invoke it. Every Claude Code session adding a new Edge Function must document it here.

---

## Edge Function Conventions

- All Edge Functions are Deno TypeScript
- All use the Supabase service role key for database operations (bypasses RLS — handle access control at application layer)
- Queue-invoked functions verify the provider signature before processing (QStash signature under the fallback; BullMQ workers call in-process)
- All webhook functions verify provider HMAC signatures before processing
- Functions never write sensitive data (PII, credentials) to logs
- Functions are idempotent where possible — safe to retry

---

## Webhook Processing Functions

### `webhook-whatsapp`

**Trigger:** POST from Meta (delivery status updates and inbound messages)
**Route:** `/api/webhooks/whatsapp`
**What it does:**
- Verifies Meta HMAC signature using META_APP_SECRET
- For delivery status events: updates `message_log.status`, `sent_at`, `delivered_at`, `read_at`
- For inbound messages: routes to chatbot command processor
- For failed deliveries: triggers SMS fallback for critical message types

**Input:** Meta webhook payload
**Output:** 200 OK (must respond within 5 seconds or Meta retries)

---

### `webhook-payment`

**Trigger:** POST from PawaPay or Flutterwave
**Route:** `/api/webhooks/payment/{gateway}`
**What it does:**
- Verifies gateway HMAC signature
- Looks up payment record by gateway reference
- Updates payment status to verified or failed
- If verified: updates fee_record status, generates receipt PDF (via queued job)
- Logs the event in audit_logs

**Input:** Gateway-specific payment status payload
**Output:** 200 OK

---

### `webhook-loan`

**Trigger:** POST from lending partner (Phase 2) or manual trigger (Phase 1)
**Route:** `/api/webhooks/loan`
**What it does:**
- Verifies lender webhook secret
- Processes disbursement confirmation: marks fee as loan_paid, creates payment record, generates receipt
- Processes repayment confirmation: updates repayment_schedule JSONB, checks if fully repaid
- Sends WhatsApp notification to parent via the queue
- Records commission in afritech.loan_commissions

**Input:** Lender webhook payload
**Output:** 200 OK

---

### `webhook-clerk`

**Trigger:** POST from Clerk (user/org events)
**Route:** `/api/webhooks/clerk`
**What it does:**
- Verifies Svix signature
- `user.created`: creates parent or teacher record if applicable
- `organizationMembership.created`: creates staff_members row
- `organizationMembership.deleted`: deactivates staff access, starts grace period if parent

**Input:** Clerk webhook event
**Output:** 200 OK

---

## PDF Generation Functions

### `generate-report-card`

**Trigger:** queued job (enqueued by `POST /api/reports/generate`)
**What it does:**
- Processes one batch of 35 students
- Loads school template config, fonts from R2, school logo as base64 data URL (once per batch)
- For each student: fetches marks, positions, attendance → renders PDF via @react-pdf/renderer → uploads to R2
- Updates report_generation_jobs row with progress
- Catches per-student failures without failing the batch
- On batch complete: Realtime update fires to browser progress bar

**Input:** `{ run_id, school_id, student_ids[], academic_year, term_number }`
**Output:** R2 uploads + progress update in report_generation_jobs

---

### `generate-receipt`

**Trigger:** queued job (enqueued after payment verification)
**What it does:**
- Fetches payment, fee record, student, school data
- Renders receipt PDF via @react-pdf/renderer
- Uploads to R2: `zsms-public-zm/{school_id}/receipts/{year}/term{N}/{payment_id}.pdf`
- Updates payment.receipt_url

**Input:** `{ payment_id, school_id }`
**Output:** R2 upload + payment.receipt_url updated

---

### `generate-template-preview`

**Trigger:** POST /api/templates/preview (synchronous — not queued)
**What it does:**
- Loads real school template config and logo
- Renders PDF with synthetic student data (Tafadzwa Mwale)
- Streams PDF directly to browser — not stored in R2
- Used for template preview before bulk generation

**Input:** `{ school_id, doc_type, template_config? }`
**Output:** PDF stream (application/pdf)

---

## WhatsApp Dispatch Functions

### `send-whatsapp`

**Trigger:** queued job
**What it does:**
- Checks school quota (Redis cache → database fallback)
- Checks parent whatsapp_opted_in
- Reads school WhatsApp credentials (Mode A: env vars, Mode B: decrypt from schools table)
- Calls Meta Cloud API with template and variables
- Updates message_log.provider_message_id, status
- Decrements school quota counter

**Input:** `{ message_log_id, school_id, recipient_phone, template_id, variables[] }`
**Output:** message_log updated

---

### `check-scheduled-announcements`

**Trigger:** queue cron every 15 minutes
**What it does:**
- Queries announcements WHERE status = 'scheduled' AND scheduled_at <= NOW()
- For each due announcement: enqueues send-whatsapp jobs for all recipients
- Updates announcement.status = 'sending' then 'sent'

**Input:** None (cron trigger)
**Output:** WhatsApp jobs enqueued

---

## Loan Functions

### `submit-to-lender`

**Trigger:** queued job (enqueued on loan application submission)
**What it does:**
- Phase 1 (email integration): generates PDF loan package → emails to lender intake address
- Phase 2 (API integration): POSTs application JSON to lender API endpoint
- Phase 3 (zsms_internal): routes to in-house underwriting engine
- Updates loan_applications.status = 'submitted'

**Input:** `{ application_id, lender_integration_type }`
**Output:** Application submitted to lender, status updated

---

## Integration Dispatch Functions

### `dispatch-integration-event`

**Trigger:** queued job (enqueued on ZSMS events like payment.verified)
**What it does:**
- Reads integration config and decrypts credentials
- Fetches full ZSMS record by ID
- Transforms data to target system format
- Calls target system API (Sage, QuickBooks, Xero, Google Sheets, HubSpot, or custom webhook)
- Updates integration_log: status, response_code, response_summary
- On failure: queue retry (30s, 5m, 30m backoff)

**Input:** `{ integration_id, event_type, zsms_record_id }`
**Output:** integration_log updated

---

## AI Functions

### `ai-assistant`

**Trigger:** POST /api/ai/assistant (synchronous)
**What it does:**
- Validates user role and school context from JWT
- Classifies intent and extracts query parameters (Claude API — call 1)
- Executes ZSMS database query through RLS-enforced API layer
- Narrates results (Claude API — call 2)
- Saves conversation to ai_conversations
- Checks and enforces rate limits (Redis: 100/school/day, 20/user/day)

**Input:** `{ message, conversation_id?, school_id, user_role }`
**Output:** `{ response, conversation_id, intent_type }`

---

### `generate-lesson-plan`

**Trigger:** POST /api/ai/lesson-plans (synchronous)
**What it does:**
- Validates platform:teacher or org:teacher role
- Checks standalone_teacher_accounts.trial_plans_used if in trial
- Embeds the teacher's request using OpenAI text-embedding-3-small
- Runs pgvector similarity search on knowledge_base
- Constructs prompt with retrieved curriculum context
- Calls Claude API to generate structured lesson plan JSON
- Saves to lesson_plans table
- Returns generated plan

**Input:** `{ subject, grade_level, topic, curriculum_type, duration_minutes, lesson_type, context? }`
**Output:** `{ lesson_plan_id, content, knowledge_sources_used }`

---

## Admin and Operations Functions

### `calculate-platform-metrics`

**Trigger:** queue cron daily at 02:00 UTC
**What it does:**
- Calculates all platform metrics for each active country
- MRR, ARR, trial count, conversion rate, churn, loan commissions, alumni opted-in
- Upserts results into afritech.platform_metrics
- Sends alert if any metric crosses a warning threshold (e.g. churn > 5%)

**Input:** None (cron trigger)
**Output:** afritech.platform_metrics updated

---

### `check-trial-expiry`

**Trigger:** queue cron daily at 06:00 UTC (Lusaka time 08:00)
**What it does:**
- Finds all schools where trial_ends_at <= TODAY and status = 'trial'
- Checks for active extend_trial overrides
- If no override: updates school.status = 'trial_expired', sends expiry email
- If within 3 days of expiry: sends warning email

**Input:** None (cron trigger)
**Output:** school statuses updated, emails queued

---

### `check-override-expiry`

**Trigger:** queue cron daily at 02:30 UTC
**What it does:**
- Finds all afritech.school_feature_overrides WHERE expires_at <= NOW() AND is_active = TRUE
- Deactivates expired overrides
- Invalidates Redis cache for affected schools
- Sends notification to school owner if subscription or tier override expired

**Input:** None (cron trigger)
**Output:** Overrides deactivated, caches invalidated

---

### `generate-upload-url`

**Trigger:** POST /api/storage/upload-url (synchronous)
**What it does:**
- Validates authenticated user and file type
- Generates pre-signed PUT URL for direct R2 upload
- Returns URL + R2 key + expiry
- Client uploads directly to R2 using the signed URL

**Input:** `{ file_type, content_type, file_size, school_id }`
**Output:** `{ upload_url, r2_key, expires_at }`

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Edge function reference |
| 2026-04-26 | Added check-scheduled-announcements cron | Scheduled announcements confirmed |
| 2026-04-26 | Added submit-to-lender | Loan module Phase 1 email dispatch |
| 2026-04-26 | Added dispatch-integration-event | Accounting/CRM integrations |
| 2026-04-26 | Added ai-assistant and generate-lesson-plan | AI module |
| 2026-04-26 | Added calculate-platform-metrics cron | Nightly metrics calculation |
| 2026-04-26 | Added check-override-expiry cron | Dynamic pricing override system |
| 2026-04-26 | Added webhook-loan | Lender disbursement and repayment webhooks |
