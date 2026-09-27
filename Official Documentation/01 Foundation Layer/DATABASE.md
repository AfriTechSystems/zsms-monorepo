# DATABASE.md — Complete Database Architecture

## Related Documents

- `docs/ARCHITECTURE.md` — system architecture, multi-tenancy model, service boundaries
- `docs/RLS.md` — all Row Level Security policies for every table defined here
- `docs/CONVENTIONS.md` — naming conventions for tables, columns, indexes, migrations
- `docs/ENV.md` — Supabase connection strings and environment variable reference
- `docs/modules/auth/AUTH.md` — how Clerk JWT claims map to database identity
- `docs/modules/auth/ROLES.md` — role definitions that RLS policies enforce
- `docs/modules/auth/PERMISSIONS.md` — staff_permission_grants table design
- `docs/modules/fees/PAYMENTS.md` — payment gateway integration and webhook flows
- `docs/modules/loans/LOANS.md` — private schema tables and loan lifecycle
- `docs/infra/SUPABASE.md` — project setup, migration commands, Edge Function deploy
- `docs/countries/ZM.md` — Zambia-specific configuration values referenced in schema

---

## Purpose

This document is the authoritative reference for the complete ZSMS database architecture. It defines every table, every column with its type and purpose, all relationships between tables, every index, the migration strategy, and the reasoning behind key design decisions. Every Claude Code session that touches the database — creating tables, writing migrations, building Edge Functions, or writing API routes — must read this document before writing any SQL or TypeScript that interacts with the database.

This document is the single source of truth for the database. If there is a conflict between this document and the code, this document takes precedence and the code must be corrected.

---

## Overview

### Database Technology

ZSMS uses **PostgreSQL** hosted on **Supabase**. Supabase provides:

- Managed PostgreSQL with automatic backups and point-in-time recovery
- Row Level Security enforced at the database engine level
- PostgREST auto-generated REST API (used selectively — not for all tables)
- Edge Functions for serverless backend logic co-located with the database
- Realtime subscriptions for live progress updates in the UI
- Built-in authentication integration with Clerk via JWT verification

A **Railway PostgreSQL** instance runs as a hot standby replica. Automatic failover occurs within 60 seconds if the primary Supabase instance becomes unavailable. The standby is read-only and is never used for writes during normal operation.

### Schemas

ZSMS uses **three** PostgreSQL schemas totalling 66 tables:

**`public` schema** (46 tables) — all standard application tables. Subject to RLS policies. Accessible via Supabase client with the anon key when a valid Clerk JWT is present.

**`private` schema** (4 tables) — loan-related tables containing personally identifiable financial information. Not accessible via the auto-generated PostgREST API. Accessible only through Edge Functions using the service role key, with strict application-layer authorisation checks before any query is issued. No school-level role can access the private schema regardless of permission grants.

**`afritech` schema** (16 tables) — AfriTech platform tables: subscription tiers, feature flags, the tier feature matrix, per-school overrides, loan commissions, platform metrics, and internal staff scope assignments. Not exposed via PostgREST. Accessible only through AfriTech admin panel Edge Functions. This schema holds the dynamic configuration registry described in `DYNAMIC_CONFIG.md` — no school-level role has write access to any table in it.

### Multi-Tenancy Model

Every table in the `public` schema contains a `school_id` column (UUID, foreign key to `public.schools`). This is the tenant isolation key. RLS policies scope every query to the current user's school using the `get_school_id()` helper function, which reads the Clerk organisation ID from the JWT. A query from School A returns zero rows from School B's data — enforced at the PostgreSQL engine level, not the application level.

### Design Principles

1. Every table has `id UUID DEFAULT gen_random_uuid() PRIMARY KEY`.
2. Every table has `created_at TIMESTAMPTZ DEFAULT NOW()`.
3. Every table that can be updated has `updated_at TIMESTAMPTZ DEFAULT NOW()` with an automatic trigger to keep it current.
4. Financial data and academic records use soft delete only. The `is_deleted BOOLEAN DEFAULT FALSE` flag and `deleted_at TIMESTAMPTZ` column are used. Hard deletes are never performed on these tables.
5. All monetary values are stored as `NUMERIC(12,2)` — never FLOAT or REAL, which introduce floating-point rounding errors in financial calculations.
6. All timestamps are `TIMESTAMPTZ` (timestamp with time zone) — never `TIMESTAMP` (without time zone).
7. Phone numbers are stored in E.164 format (`+260977123456`) — normalised at the application layer before any write.
8. Country codes follow ISO 3166-1 alpha-2 (`ZM`, `BW`, `ZW`).
9. Currency codes follow ISO 4217 (`ZMW`, `BWP`, `USD`).
10. Enum-like fields use `TEXT` with a `CHECK` constraint rather than PostgreSQL `ENUM` types. This allows adding new valid values via a migration without recreating the column.

---

## Migration Strategy

### File Naming Convention

All migrations live in `supabase/migrations/` and follow this naming pattern:

```
NNNN_description_of_change.sql
```

Examples:
```
0001_rls_helper_functions.sql
0002_create_schools_table.sql
0003_create_students_table.sql
0004_create_parents_and_links.sql
0005_create_fee_tables.sql
0006_create_attendance_tables.sql
0007_create_results_tables.sql
0008_create_communication_tables.sql
0009_create_staff_tables.sql
0010_create_audit_and_permission_tables.sql
0011_create_private_schema_loan_tables.sql
0012_create_payment_gateway_tables.sql
0013_create_document_template_tables.sql
0014_add_indexes.sql
0015_add_triggers.sql
```

### Migration Rules

- Every migration is **forward-only**. There are no rollback scripts. Rollbacks in production are handled by writing a new forward migration that reverses the change.
- Migrations must be **idempotent** where possible — use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP COLUMN IF EXISTS`.
- Never modify an existing migration file after it has been applied to any environment. Write a new migration instead.
- The first migration (`0001`) always creates the RLS helper functions. No other migration may run before this one.
- Apply migrations with `supabase db push` for the development environment. Staging and production migrations are applied through the Vercel deployment pipeline via `supabase db push --linked`.

### Applying Migrations

```bash
# Link to a specific Supabase project
supabase link --project-ref your-project-ref

# Apply all pending migrations
supabase db push

# Generate TypeScript types after schema changes
supabase gen types typescript --linked > packages/types/database.ts
```

The generated `packages/types/database.ts` file must be regenerated after every migration that adds or modifies a table. This file is the single source of TypeScript types for the database — all application code imports from it.

---

## Public Schema — Table Definitions

### `public.schools`

The root tenant table. Every other table in the system references this table via `school_id`. One row represents one school institution on the ZSMS platform.

```sql
CREATE TABLE public.schools (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id               TEXT UNIQUE NOT NULL,
  -- Format: ZM-LSK-0001 (country_code-city_code-sequence)
  -- Generated by the school onboarding Edge Function. Never manually assigned.

  clerk_org_id            TEXT UNIQUE NOT NULL,
  -- The Clerk Organisation ID created for this school.
  -- Used by get_school_id() RLS helper to match JWT claims to this record.

  country_code            TEXT NOT NULL DEFAULT 'ZM'
                          CHECK (country_code ~ '^[A-Z]{2}$'),
  -- ISO 3166-1 alpha-2. Determines which country config applies.

  name                    TEXT NOT NULL,
  type                    TEXT NOT NULL
                          CHECK (type IN ('day', 'boarding', 'both')),
  level                   TEXT NOT NULL
                          CHECK (level IN ('pre', 'primary', 'secondary', 'combined')),
  city_code               TEXT NOT NULL,
  -- Short code matching the country config cities map. E.g. 'LSK', 'CBE', 'NDL'.

  address                 TEXT,
  phone                   TEXT,
  -- E.164 format. E.g. +260977123456.

  email                   TEXT,
  logo_url                TEXT,
  -- Cloudflare R2 path. Format: /school_id/branding/logo.png

  status                  TEXT NOT NULL DEFAULT 'pending_verification'
                          CHECK (status IN (
                            'pending_verification',
                            'trial',
                            'active',
                            'suspended',
                            'terminated'
                          )),

  subscription_tier       TEXT NOT NULL DEFAULT 'starter'
                          CHECK (subscription_tier IN (
                            'starter', 'growth', 'professional', 'enterprise'
                          )),

  trial_ends_at           TIMESTAMPTZ,
  -- Set to NOW() + 30 days when status is set to 'trial'.
  -- NULL when status is not 'trial'.

  subscription_ends_at    TIMESTAMPTZ,
  -- Next billing date. NULL during trial.

  finance_module_enabled  BOOLEAN DEFAULT FALSE,
  -- Controls whether the loan application feature is visible to parents.
  -- Enabled by AfriTech after verifying the school and activating an MFI partnership.

  whatsapp_enabled        BOOLEAN DEFAULT TRUE,
  -- Can be disabled per school if they have not yet registered a WhatsApp Business number.

  max_students            INT,
  -- NULL means unlimited (for Professional and Enterprise tiers).
  -- Set for Starter and Growth to enforce tier limits.

  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_schools_status ON public.schools(status);
CREATE INDEX idx_schools_country ON public.schools(country_code);
CREATE INDEX idx_schools_clerk_org ON public.schools(clerk_org_id);
```

**Key relationships:** All other public schema tables reference `public.schools(id)` via `school_id`.

---

### `public.students`

The central entity of ZSMS. Every module — fees, attendance, results, communication, loans — references a student record. Student IDs are permanent and never change even if the student transfers schools (though their `school_id` foreign key will change on transfer).

```sql
CREATE TABLE public.students (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id            TEXT UNIQUE NOT NULL,
  -- Format: STU-ZM-LSK-0001-00042
  -- Generated by the student creation Edge Function. Never manually assigned.

  school_id             UUID NOT NULL REFERENCES public.schools(id),
  clerk_user_id         TEXT,
  -- Populated when a student creates a ZSMS login account.
  -- NULL for students who have not registered themselves.

  first_name            TEXT NOT NULL,
  last_name             TEXT NOT NULL,
  date_of_birth         DATE,
  gender                TEXT CHECK (gender IN ('male', 'female', 'not_stated')),

  nrc_or_birth_cert     TEXT,
  -- Encrypted at the application layer before storage.
  -- Used for loan application pre-fill only.
  -- Never returned in standard student API responses.

  photo_url             TEXT,
  -- Cloudflare R2 path. Format: /school_id/students/student_id/photo.jpg
  -- Compressed to under 200KB before upload.

  enrolment_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  grade_id              TEXT NOT NULL,
  -- Matches grade identifiers in the school's grade_config.
  -- E.g. 'grade_1', 'grade_7', 'grade_12'.

  class_id              TEXT NOT NULL,
  -- E.g. 'grade_7a', 'grade_7b'.

  is_boarding           BOOLEAN DEFAULT FALSE,
  -- Affects which fee structure applies to this student.

  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN (
                          'active',
                          'on_leave',
                          'transferred',
                          'graduated',
                          'withdrawn'
                        )),

  is_deleted            BOOLEAN DEFAULT FALSE,
  deleted_at            TIMESTAMPTZ,
  deleted_by            TEXT,
  -- Clerk user ID of the person who soft-deleted this record.

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_students_school_id ON public.students(school_id);
CREATE INDEX idx_students_school_status ON public.students(school_id, status);
CREATE INDEX idx_students_school_grade ON public.students(school_id, grade_id);
CREATE INDEX idx_students_school_class ON public.students(school_id, class_id);
CREATE INDEX idx_students_student_id ON public.students(student_id);
CREATE INDEX idx_students_clerk_user ON public.students(clerk_user_id) WHERE clerk_user_id IS NOT NULL;
CREATE INDEX idx_students_fulltext ON public.students
  USING GIN(to_tsvector('english', first_name || ' ' || last_name));
-- Used for the admin search bar. Searches by partial name return results in under 200ms.
```

---

### `public.parents`

Parent and guardian accounts. A parent has one account on ZSMS (one Clerk user) and can be linked to children at multiple schools through `student_parent_links`. Parents do not carry a `school_id` — their school context comes from their student links.

```sql
CREATE TABLE public.parents (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_user_id     TEXT UNIQUE,
  -- Populated when the parent has logged in at least once.
  -- NULL for parents who were imported but have never logged in.

  phone_e164        TEXT,
  -- Primary identifier for OTP login. E.164 format. +260977123456.
  -- This is the "password" in the passwordless auth model.

  email             TEXT,
  -- Secondary identifier. Used for OTP login if preferred.

  full_name         TEXT,
  national_id       TEXT,
  -- Encrypted. Used for loan application pre-fill only.

  preferred_contact TEXT DEFAULT 'phone'
                    CHECK (preferred_contact IN ('phone', 'email', 'whatsapp')),

  whatsapp_opted_in BOOLEAN DEFAULT TRUE,
  -- Set to FALSE if parent has opted out of WhatsApp messages.
  -- System uses SMS fallback for opted-out parents.

  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_parents_phone ON public.parents(phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX idx_parents_email ON public.parents(email) WHERE email IS NOT NULL;
CREATE INDEX idx_parents_clerk ON public.parents(clerk_user_id) WHERE clerk_user_id IS NOT NULL;
```

---

### `public.student_parent_links`

Many-to-many relationship between students and parents. One student can have multiple guardians. One parent can have children at multiple schools. The link record tracks whether the relationship is currently active and manages the grace period on unlink.

```sql
CREATE TABLE public.student_parent_links (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id            UUID NOT NULL REFERENCES public.students(id),
  parent_id             UUID NOT NULL REFERENCES public.parents(id),
  parent_user_id        TEXT,
  -- Denormalised from parents.clerk_user_id for RLS policy performance.
  -- Kept in sync via trigger on parents table.

  relationship          TEXT NOT NULL DEFAULT 'guardian'
                        CHECK (relationship IN (
                          'mother', 'father', 'guardian', 'grandparent',
                          'sibling', 'uncle', 'aunt', 'other'
                        )),

  is_primary            BOOLEAN DEFAULT FALSE,
  -- The primary contact receives all automated notifications.
  -- Only one link per student should have is_primary = TRUE.

  is_active             BOOLEAN DEFAULT TRUE,
  grace_period_ends_at  TIMESTAMPTZ,
  -- Set to NOW() + 30 days when is_active is set to FALSE.
  -- After this date, the parent loses all read access to this student's data.
  -- RLS policies on students, fee_records, attendance_records, and exam_results
  -- all check this field alongside is_active.

  linked_by             TEXT,
  -- Clerk user ID of the school admin who created this link.

  unlinked_at           TIMESTAMPTZ,
  unlinked_by           TEXT,
  -- Clerk user ID of the person who removed the link.

  created_at            TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(student_id, parent_id)
);

CREATE INDEX idx_spl_student ON public.student_parent_links(student_id);
CREATE INDEX idx_spl_parent ON public.student_parent_links(parent_id);
CREATE INDEX idx_spl_parent_user ON public.student_parent_links(parent_user_id);
CREATE INDEX idx_spl_active ON public.student_parent_links(student_id, is_active);
```

---

### `public.grade_config`

School-specific grade and class configuration. Every school defines their own grade structure — not all private schools follow the same naming convention or grade count.

```sql
CREATE TABLE public.grade_config (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id     UUID NOT NULL REFERENCES public.schools(id),
  grade_id      TEXT NOT NULL,
  -- E.g. 'grade_1', 'grade_7', 'grade_10'

  grade_name    TEXT NOT NULL,
  -- Display name. E.g. 'Grade 7', 'Form 3', 'Year 2'

  grade_order   INT NOT NULL,
  -- Used for sorting and promotion logic. Lower = earlier grade.

  classes       TEXT[] NOT NULL DEFAULT '{}',
  -- Array of class IDs within this grade. E.g. {'grade_7a', 'grade_7b'}

  class_names   TEXT[] NOT NULL DEFAULT '{}',
  -- Display names matching the classes array. E.g. {'7A', '7B'}

  is_active     BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(school_id, grade_id)
);

CREATE INDEX idx_grade_config_school ON public.grade_config(school_id);
```

---

### `public.fee_structures`

Defines the fee amounts for each grade, term, and student type. A school sets this up at the start of each academic year. When a student's fee record is generated, it reads from the relevant fee structure row.

```sql
CREATE TABLE public.fee_structures (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID NOT NULL REFERENCES public.schools(id),
  academic_year     TEXT NOT NULL,
  -- Format: '2026'. Matches the school's configured academic year.

  term_number       INT NOT NULL CHECK (term_number BETWEEN 1 AND 4),
  -- Maximum 4 terms to accommodate all country configurations.

  grade_id          TEXT NOT NULL,
  -- References grade_config.grade_id for this school.
  -- Special value 'ALL' applies the same amount to all grades.

  student_type      TEXT NOT NULL DEFAULT 'all'
                    CHECK (student_type IN ('all', 'day', 'boarding')),
  -- Allows different fees for day and boarding students.

  fee_label         TEXT NOT NULL DEFAULT 'Tuition Fee',
  -- Display name shown on receipts and fee statements.
  -- Multiple fee lines per grade/term are supported by having multiple rows.
  -- E.g. 'Tuition Fee', 'Activity Fee', 'Exam Fee', 'Boarding Fee'

  amount            NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  currency_code     TEXT NOT NULL DEFAULT 'ZMW',
  -- ISO 4217. Matches the school's country config currency.

  is_mandatory      BOOLEAN DEFAULT TRUE,
  -- Non-mandatory fees can be waived per student without affecting the total structure.

  is_active         BOOLEAN DEFAULT TRUE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(school_id, academic_year, term_number, grade_id, student_type, fee_label)
);

CREATE INDEX idx_fee_structures_school ON public.fee_structures(school_id);
CREATE INDEX idx_fee_structures_year_term ON public.fee_structures(school_id, academic_year, term_number);
CREATE INDEX idx_fee_structures_grade ON public.fee_structures(school_id, grade_id);
```

---

### `public.fee_records`

One row per student per term per fee line. This is the running ledger of what each student owes and what has been paid. It is generated from `fee_structures` at the start of each term and updated as payments are recorded.

```sql
CREATE TABLE public.fee_records (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id           UUID NOT NULL REFERENCES public.schools(id),
  student_id          UUID NOT NULL REFERENCES public.students(id),
  fee_structure_id    UUID NOT NULL REFERENCES public.fee_structures(id),
  academic_year       TEXT NOT NULL,
  term_number         INT NOT NULL CHECK (term_number BETWEEN 1 AND 4),

  fee_label           TEXT NOT NULL,
  -- Copied from fee_structures.fee_label at record creation time.
  -- Preserved even if the fee structure is later modified.

  amount_due          NUMERIC(12,2) NOT NULL CHECK (amount_due >= 0),
  -- Copied from fee_structures.amount at record creation time.

  amount_paid         NUMERIC(12,2) DEFAULT 0 CHECK (amount_paid >= 0),
  -- Updated each time a payment is recorded against this fee record.

  discount_amount     NUMERIC(12,2) DEFAULT 0,
  -- Scholarship or discount applied. Reduces the effective amount_due.
  -- Set by accountant or owner. Requires reason in discount_reason.

  discount_reason     TEXT,
  currency_code       TEXT NOT NULL DEFAULT 'ZMW',

  status              TEXT NOT NULL DEFAULT 'unpaid'
                      CHECK (status IN (
                        'unpaid',
                        'partial',
                        'paid',
                        'waived',
                        'loan_pending',
                        'loan_paid',
                        'overpaid'
                      )),

  due_date            TIMESTAMPTZ,
  -- Set when the fee record is created. Used for reminder scheduling.

  last_reminder_at    TIMESTAMPTZ,
  -- Timestamp of the most recent automated reminder sent for this record.
  -- Used to prevent duplicate reminders.

  reminder_count      INT DEFAULT 0,
  -- Total number of reminders sent. Used for escalation logic.

  is_deleted          BOOLEAN DEFAULT FALSE,
  deleted_at          TIMESTAMPTZ,

  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fee_records_school ON public.fee_records(school_id);
CREATE INDEX idx_fee_records_student ON public.fee_records(student_id);
CREATE INDEX idx_fee_records_status ON public.fee_records(school_id, status);
CREATE INDEX idx_fee_records_year_term ON public.fee_records(school_id, academic_year, term_number);
CREATE INDEX idx_fee_records_due_date ON public.fee_records(due_date) WHERE status IN ('unpaid', 'partial');
-- The partial index on due_date covers only unpaid records.
-- Reminder scheduling queries only scan this subset, keeping them fast
-- even when there are hundreds of thousands of historical fee records.
```

---

### `public.payments`

An immutable record of every payment event against a fee record. Payments are never deleted or updated after creation. Corrections are made by inserting a reversal payment (negative amount) with a reference to the original payment. The `fee_records.amount_paid` and `fee_records.status` are derived from the sum of all non-voided payment rows for that fee record.

```sql
CREATE TABLE public.payments (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id             UUID NOT NULL REFERENCES public.schools(id),
  fee_record_id         UUID NOT NULL REFERENCES public.fee_records(id),
  student_id            UUID NOT NULL REFERENCES public.students(id),
  -- Denormalised for query performance. Avoids joining fee_records on every payment query.

  recorded_by_user_id   TEXT NOT NULL,
  -- Clerk user ID of the person who recorded this payment.

  amount                NUMERIC(12,2) NOT NULL,
  -- Positive for payments. Negative for reversals.

  currency_code         TEXT NOT NULL DEFAULT 'ZMW',

  payment_method        TEXT NOT NULL
                        CHECK (payment_method IN (
                          'cash',
                          'bank_deposit',
                          'cheque',
                          'online_gateway',
                          'loan_disbursement',
                          'reversal',
                          'waiver'
                        )),

  gateway_name          TEXT,
  -- Populated only when payment_method = 'online_gateway'.
  -- Identifies which gateway processed this payment.
  -- See: public.payment_gateways for supported values.
  -- E.g. 'flutterwave', 'pawapay', 'dpo', 'pesapal', 'airtel_money', 'mtn_momo'

  gateway_reference     TEXT,
  -- Transaction reference returned by the payment gateway.
  -- Null for cash and bank deposit payments.

  gateway_transaction_id TEXT,
  -- The gateway's internal transaction ID. Used for webhook reconciliation.

  bank_name             TEXT,
  -- Populated for bank_deposit payments. Name of the bank branch used.

  cheque_number         TEXT,
  receipt_number        TEXT NOT NULL UNIQUE,
  -- Sequential per school. Format: REC-ZM-LSK-0001-000001
  -- Generated atomically by the payment recording Edge Function.

  receipt_url           TEXT,
  -- Cloudflare R2 path to the generated PDF receipt.
  -- Format: /school_id/receipts/academic_year/term/receipt_number.pdf

  notes                 TEXT,
  -- Optional notes by the accountant. For reversals: mandatory reason.

  -- --- submission / verification workflow ---
  -- ADDED 2026-08-15. SCHEMA.md and the 2026-04-26 CHANGELOG entry
  -- ("Removed OTP for financial submissions — replaced with confirmation
  -- workflow") specified these columns; this DDL was never updated to match.
  -- Implemented in migration 0070.
  status                TEXT NOT NULL DEFAULT 'pending_verification'
                        CHECK (status IN (
                          'pending_verification', 'verified', 'rejected', 'queried'
                        )),
  -- Only 'verified' payments count toward fee_records.amount_paid. A submitted
  -- payment reduces nothing until someone with financial authority confirms it.

  proof_of_payment_url  TEXT,
  confirmation_checkbox_at TIMESTAMPTZ,
  -- When the submitter affirmed the details. Replaces the removed OTP step.

  verified_by           TEXT,
  verified_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  -- CHECK constraints require a reason on rejection, and both verified_by and
  -- verified_at on verification: "verified by nobody at no time" is not a valid
  -- state for a money record.

  reversal_of_payment_id UUID REFERENCES public.payments(id),
  -- Populated when payment_method = 'reversal'.
  -- References the original payment being reversed.

  is_voided             BOOLEAN DEFAULT FALSE,
  -- Set to TRUE when this payment has been reversed.
  -- Voided payments are excluded from balance calculations.

  webhook_verified      BOOLEAN DEFAULT FALSE,
  -- TRUE when this payment was confirmed via a verified gateway webhook.
  -- FALSE for manually recorded cash/bank payments (normal, not a problem).

  paid_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The actual date and time the payment was made.
  -- For cash payments: the date the accountant says it was received.
  -- For gateway payments: the timestamp from the webhook event.

  created_at            TIMESTAMPTZ DEFAULT NOW()
  -- Immutable. Never updated.
);

CREATE INDEX idx_payments_school ON public.payments(school_id);
CREATE INDEX idx_payments_fee_record ON public.payments(fee_record_id);
CREATE INDEX idx_payments_student ON public.payments(student_id);
CREATE INDEX idx_payments_gateway_ref ON public.payments(gateway_reference) WHERE gateway_reference IS NOT NULL;
CREATE INDEX idx_payments_receipt ON public.payments(receipt_number);
CREATE INDEX idx_payments_paid_at ON public.payments(school_id, paid_at);
```

---

### `public.payment_gateways`

Each school configures which payment gateways they accept online payments through. ZSMS supports multiple gateways simultaneously. A school might accept both Airtel Money and Flutterwave card payments at the same time. The gateway credentials are stored encrypted and never returned in standard API responses.

```sql
CREATE TABLE public.payment_gateways (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id             UUID NOT NULL REFERENCES public.schools(id),

  gateway_name          TEXT NOT NULL
                        CHECK (gateway_name IN (
                          'flutterwave',
                          'pawapay',
                          'dpo',
                          'pesapal',
                          'airtel_money',
                          'mtn_momo',
                          'zanaco_zpay',
                          'other'
                        )),
  -- New gateways are added by updating this CHECK constraint in a new migration.
  -- The 'other' value supports schools using a gateway not yet in the list.

  display_name          TEXT NOT NULL,
  -- Human-readable name shown to parents on the payment page.
  -- E.g. 'Pay with Airtel Money', 'Pay by Card (Flutterwave)'

  is_active             BOOLEAN DEFAULT TRUE,
  -- Schools can disable a gateway temporarily without deleting the configuration.

  is_primary            BOOLEAN DEFAULT FALSE,
  -- The primary gateway is shown first on the payment page.
  -- Only one gateway per school should have is_primary = TRUE.

  api_key_encrypted     TEXT,
  -- Gateway API key encrypted with AES-256 before storage.
  -- Decrypted only within the Edge Function that processes payments.
  -- Never returned in any API response.

  api_secret_encrypted  TEXT,
  -- Encrypted. Same handling as api_key_encrypted.

  webhook_secret        TEXT,
  -- Used to verify HMAC signatures on incoming webhook events from this gateway.
  -- Stored as a hash, not plaintext.

  merchant_id           TEXT,
  -- Gateway-specific merchant or account identifier. Not sensitive.

  gateway_config        JSONB DEFAULT '{}',
  -- Gateway-specific configuration not covered by standard fields.
  -- E.g. for PawaPay: { "correspondent": "AIRTEL_ZAMBIA", "country": "ZMB" }
  -- E.g. for DPO: { "company_token": "...", "service_type": "..." }

  supported_currencies  TEXT[] DEFAULT ARRAY['ZMW'],
  -- Some gateways support USD payments in addition to local currency.

  test_mode             BOOLEAN DEFAULT FALSE,
  -- When TRUE, gateway is in sandbox/test mode. No real money moves.
  -- Must be FALSE before a school goes live.

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(school_id, gateway_name)
);

CREATE INDEX idx_gateways_school ON public.payment_gateways(school_id);
CREATE INDEX idx_gateways_active ON public.payment_gateways(school_id, is_active);
```

---

### `public.attendance_records`

One row per student per day. Created by teachers through the mobile app (offline-capable via PowerSync) or the web interface. Database triggers fire on INSERT of absent records to queue WhatsApp notifications.

```sql
CREATE TABLE public.attendance_records (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id             UUID NOT NULL REFERENCES public.schools(id),
  student_id            UUID NOT NULL REFERENCES public.students(id),
  class_id              TEXT NOT NULL,
  -- Denormalised from the student's current class_id.
  -- Preserved even if the student changes class mid-year.

  recorded_by_user_id   TEXT NOT NULL,
  -- Clerk user ID of the teacher who marked attendance.

  attendance_date       DATE NOT NULL,
  academic_year         TEXT NOT NULL,
  term_number           INT NOT NULL CHECK (term_number BETWEEN 1 AND 4),

  status                TEXT NOT NULL
                        CHECK (status IN ('present', 'absent', 'late', 'excused', 'holiday')),

  arrival_time          TIME,
  -- Populated when status = 'late'.

  excuse_reason         TEXT,
  -- Populated when status = 'excused'. Required field when status is excused.

  parent_notified       BOOLEAN DEFAULT FALSE,
  -- Set to TRUE by the send-whatsapp Edge Function after successfully dispatching
  -- the absence alert. FALSE for present/late records (no notification sent).

  notification_sent_at  TIMESTAMPTZ,
  -- Timestamp of the WhatsApp or SMS notification for this absence.

  sync_source           TEXT DEFAULT 'web'
                        CHECK (sync_source IN ('web', 'mobile_online', 'mobile_offline')),
  -- Tracks whether this record was created online or synced from a PowerSync offline session.

  local_created_at      TIMESTAMPTZ,
  -- The timestamp when the teacher tapped the attendance record on their device.
  -- May differ from created_at if the record was created offline and synced later.

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(school_id, student_id, attendance_date)
  -- Prevents duplicate attendance records for the same student on the same day.
);

CREATE INDEX idx_attendance_school ON public.attendance_records(school_id);
CREATE INDEX idx_attendance_student ON public.attendance_records(student_id);
CREATE INDEX idx_attendance_class ON public.attendance_records(school_id, class_id, attendance_date);
CREATE INDEX idx_attendance_date ON public.attendance_records(school_id, attendance_date);
CREATE INDEX idx_attendance_absent ON public.attendance_records(school_id, attendance_date)
  WHERE status = 'absent' AND parent_notified = FALSE;
-- Partial index used by the notification trigger to find un-notified absences efficiently.
```

---

### `public.exam_results`

One row per student per subject per term. Created by subject teachers through the mobile or web interface. Results become read-only after the principal publishes them. Grade letters and positions are calculated by the application layer using the country-specific grading configuration.

```sql
CREATE TABLE public.exam_results (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id             UUID NOT NULL REFERENCES public.schools(id),
  student_id            UUID NOT NULL REFERENCES public.students(id),
  class_id              TEXT NOT NULL,
  academic_year         TEXT NOT NULL,
  term_number           INT NOT NULL CHECK (term_number BETWEEN 1 AND 4),

  subject_code          TEXT NOT NULL,
  -- E.g. 'mathematics', 'english', 'science'.
  -- Must match the subject list configured in the school's subject_config.

  subject_name          TEXT NOT NULL,
  -- Denormalised display name. E.g. 'Mathematics', 'English Language'.

  entered_by_user_id    TEXT NOT NULL,
  -- Clerk user ID of the teacher who entered these marks.

  marks_obtained        NUMERIC(6,2),
  -- NULL if marks have not yet been entered for this student/subject.

  marks_total           NUMERIC(6,2) NOT NULL DEFAULT 100,
  -- Maximum marks for this assessment. Usually 100.

  grade_letter          TEXT,
  -- Calculated by the application using the country grading config.
  -- E.g. 'A', 'B', 'C', 'D', 'E', 'F' for ECZ Zambia.
  -- NULL until marks are entered.

  grade_points          INT,
  -- Numeric grade point corresponding to the grade letter.
  -- ECZ: A=1, B=2, C=3, D=4, E=5, F=6.

  class_position        INT,
  -- Calculated after all marks for the class/subject are entered.
  -- NULL until finalised.

  class_size            INT,
  -- Total students in the class for this subject/term. Used for position display.

  results_published     BOOLEAN DEFAULT FALSE,
  -- Set to TRUE by the principal when they publish results for this term.
  -- Once TRUE, marks_obtained cannot be updated by the teacher.
  -- RLS UPDATE policy checks this field.

  published_at          TIMESTAMPTZ,
  -- Timestamp of when the principal published results.

  comments              TEXT,
  -- Optional teacher comment for the report card.

  sync_source           TEXT DEFAULT 'web'
                        CHECK (sync_source IN ('web', 'mobile_online', 'mobile_offline')),

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(school_id, student_id, academic_year, term_number, subject_code)
);

CREATE INDEX idx_results_school ON public.exam_results(school_id);
CREATE INDEX idx_results_student ON public.exam_results(student_id);
CREATE INDEX idx_results_class_term ON public.exam_results(school_id, class_id, academic_year, term_number);
CREATE INDEX idx_results_published ON public.exam_results(school_id, academic_year, term_number, results_published);
```

---

### `public.staff_members`

Staff profiles for all school personnel — teaching and non-teaching. One row per person per school. A person who works at two schools has two rows (one per school) but the same Clerk user account.

```sql
CREATE TABLE public.staff_members (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id           UUID NOT NULL REFERENCES public.schools(id),
  clerk_user_id       TEXT NOT NULL,
  -- Clerk user ID. Links to the Clerk Organisation membership for this school.

  staff_number        TEXT,
  -- Optional school-assigned staff identifier.

  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  phone_e164          TEXT,
  email               TEXT,
  photo_url           TEXT,
  department          TEXT,
  -- E.g. 'Mathematics', 'Sciences', 'Administration', 'Support'

  employment_type     TEXT NOT NULL DEFAULT 'full_time'
                      CHECK (employment_type IN (
                        'full_time', 'part_time', 'contract', 'volunteer'
                      )),

  join_date           DATE,
  is_active           BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(school_id, clerk_user_id)
);

CREATE INDEX idx_staff_school ON public.staff_members(school_id);
CREATE INDEX idx_staff_clerk ON public.staff_members(clerk_user_id);
CREATE INDEX idx_staff_active ON public.staff_members(school_id, is_active);
```

---

### `public.staff_assignments` — REMOVED (migration `0069`)

> Superseded by `public.teacher_assignments` (ADR-037), defined earlier in this document. The DDL below is retained only so that older references resolve to an explanation. **Do not create this table.**

Links teachers to the classes and subjects they are responsible for. One teacher can have multiple rows — one per class-subject combination. This table drives the RLS policies that scope teachers to their own classes and subjects.

```sql
CREATE TABLE public.staff_assignments (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID NOT NULL REFERENCES public.schools(id),
  staff_user_id     TEXT NOT NULL,
  -- Clerk user ID of the teacher.

  class_id          TEXT NOT NULL,
  subject_code      TEXT NOT NULL,
  -- Subject assignments with class_id = 'ALL' mean the teacher teaches
  -- that subject across all classes (e.g. a specialist music teacher).

  is_class_teacher  BOOLEAN DEFAULT FALSE,
  -- Class teachers have additional responsibilities for their class (form teacher).
  -- Only one staff member should be class teacher per class_id.

  academic_year     TEXT NOT NULL,
  term_number       INT,
  -- NULL means the assignment applies to all terms in the academic year.

  created_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(school_id, staff_user_id, class_id, subject_code, academic_year)
);

CREATE INDEX idx_assignments_school ON public.staff_assignments(school_id);
CREATE INDEX idx_assignments_staff ON public.staff_assignments(staff_user_id);
CREATE INDEX idx_assignments_class ON public.staff_assignments(school_id, class_id);
```

---

### `public.class_subjects`

Which subjects are taught to which class in a given academic year. The curriculum half of the teaching model (ADR-037); `teacher_assignments` is the staffing half.

```sql
CREATE TABLE public.class_subjects (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id      UUID NOT NULL REFERENCES public.schools(id),

  class_id       TEXT NOT NULL,
  -- Same identifier as students.class_id. TEXT and not a foreign key: classes
  -- are a per-school naming convention, not a registry.

  subject_id     UUID NOT NULL REFERENCES public.school_subjects(id),
  academic_year  TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, class_id, subject_id, academic_year)
);

CREATE INDEX idx_class_subjects_school_class
  ON public.class_subjects(school_id, class_id, academic_year);
CREATE INDEX idx_class_subjects_subject ON public.class_subjects(subject_id);
```

---

### `public.teacher_assignments`

What a teacher teaches, at one of two scopes. **This is a security table** — it decides which students a teacher may read, via `teacher_reaches_class()` (see `RLS.md`).

```sql
CREATE TABLE public.teacher_assignments (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id        UUID NOT NULL REFERENCES public.schools(id),

  teacher_user_id  TEXT NOT NULL,
  -- Clerk user ID. Matches staff_members.clerk_user_id at this school.

  scope            TEXT NOT NULL CHECK (scope IN ('class', 'subject')),
  -- 'class'   — owns the whole class (primary model, form teacher)
  -- 'subject' — teaches ONE subject to ONE class (secondary model)
  --
  -- A teacher may hold any number of rows of either scope, including both.

  class_id         TEXT NOT NULL,
  -- Set for BOTH scopes. Every assignment reaches exactly one class, which is
  -- what lets teacher reach be a single lookup rather than a branch.

  subject_id       UUID REFERENCES public.school_subjects(id),
  -- NULL for scope='class'; required for scope='subject'.

  academic_year    TEXT NOT NULL,
  term_number      INT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT teacher_assignment_scope_shape CHECK (
    (scope = 'class'   AND subject_id IS NULL)
    OR
    (scope = 'subject' AND subject_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_teacher_assignments_class_scope
  ON public.teacher_assignments(school_id, teacher_user_id, class_id, academic_year)
  WHERE scope = 'class';
CREATE UNIQUE INDEX idx_teacher_assignments_subject_scope
  ON public.teacher_assignments(school_id, teacher_user_id, class_id, subject_id, academic_year)
  WHERE scope = 'subject';
CREATE INDEX idx_teacher_assignments_teacher
  ON public.teacher_assignments(teacher_user_id, school_id, academic_year) WHERE is_active;
CREATE INDEX idx_teacher_assignments_class
  ON public.teacher_assignments(school_id, class_id, academic_year) WHERE is_active;
```

**The scope constraint is a security control, not tidiness.** A `scope='subject'` row with a NULL `subject_id` would read to `teacher_reaches_class()` as an assignment reaching the whole class.

---

### `public.staff_requests`

Pending self-registration requests from teachers who have requested to join a school before being approved by the admin. These are not Clerk Organisation members yet — they are waiting for approval.

```sql
CREATE TABLE public.staff_requests (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID NOT NULL REFERENCES public.schools(id),
  clerk_user_id   TEXT NOT NULL,
  -- Clerk user ID created when the person signed up on the ZSMS platform.
  -- They are not yet an Organisation member.

  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  phone_e164      TEXT,
  email           TEXT,
  role_requested  TEXT NOT NULL,
  -- The role they are requesting. E.g. 'org:teacher'.

  subjects        TEXT[],
  -- Self-reported subjects they can teach. Admin validates this on approval.

  message         TEXT,
  -- Optional message to the school admin explaining their request.

  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),

  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_staff_requests_school ON public.staff_requests(school_id, status);
```

---

### `public.staff_permission_grants`

Explicit, audited, time-bounded permission grants. Full schema defined in `docs/RLS.md`. Listed here for completeness and relationship mapping.

```sql
-- Full schema in RLS.md. Indexes repeated here for reference.
CREATE INDEX idx_grants_grantee ON public.staff_permission_grants(grantee_user_id, school_id, is_active);
CREATE INDEX idx_grants_expiry ON public.staff_permission_grants(expires_at) WHERE is_active = TRUE;
CREATE INDEX idx_grants_school ON public.staff_permission_grants(school_id);
```

---

### `public.message_log`

Append-only record of every WhatsApp and SMS message dispatched by ZSMS. Used for delivery tracking, audit, and the communication log in the school admin dashboard.

```sql
CREATE TABLE public.message_log (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id           UUID NOT NULL REFERENCES public.schools(id),

  recipient_phone     TEXT NOT NULL,
  -- E.164 format phone number of the message recipient.

  recipient_user_id   TEXT,
  -- Clerk user ID of the recipient if they are a registered user.

  student_id          UUID REFERENCES public.students(id),
  -- The student this message relates to. NULL for school-wide announcements.

  channel             TEXT NOT NULL
                      CHECK (channel IN ('whatsapp', 'sms', 'email')),

  template_id         TEXT NOT NULL,
  -- The WhatsApp template name or internal template identifier.
  -- E.g. 'absence_alert', 'fee_reminder_7day', 'results_published'

  message_body        TEXT,
  -- The rendered message text (with variables filled in).
  -- Stored for audit purposes. Not used for re-sending.

  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN (
                        'queued',
                        'sent',
                        'delivered',
                        'read',
                        'failed',
                        'fallback_sent'
                      )),

  provider_message_id TEXT,
  -- The message ID returned by Meta Cloud API or Twilio.
  -- Used to match delivery webhook callbacks to this log entry.

  error_code          TEXT,
  -- Populated when status = 'failed'. Provider-specific error code.

  error_message       TEXT,
  retry_count         INT DEFAULT 0,
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  read_at             TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_message_log_school ON public.message_log(school_id);
CREATE INDEX idx_message_log_student ON public.message_log(student_id) WHERE student_id IS NOT NULL;
CREATE INDEX idx_message_log_status ON public.message_log(school_id, status);
CREATE INDEX idx_message_log_provider ON public.message_log(provider_message_id) WHERE provider_message_id IS NOT NULL;
```

---

### `public.report_generation_jobs`

Tracks the progress of bulk PDF report card generation for Supabase Realtime progress updates. One row per class batch within a generation run.

```sql
CREATE TABLE public.report_generation_jobs (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id           UUID NOT NULL REFERENCES public.schools(id),
  run_id              UUID NOT NULL,
  -- Groups all batch jobs for a single "Generate All Report Cards" action.
  -- Shared across all class batches in one generation run.

  class_id            TEXT NOT NULL,
  academic_year       TEXT NOT NULL,
  term_number         INT NOT NULL,

  total_students      INT NOT NULL,
  completed_students  INT DEFAULT 0,

  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued', 'processing', 'complete', 'failed')),

  error_message       TEXT,
  -- Populated if this batch failed. Does not affect other batches in the same run.

  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_report_jobs_run ON public.report_generation_jobs(run_id);
CREATE INDEX idx_report_jobs_school ON public.report_generation_jobs(school_id, status);
```

---

### `public.document_templates`

Stores the PDF template configuration for each document type per school. Schools configure this once and all subsequent PDF generation uses the stored template.

```sql
CREATE TABLE public.document_templates (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID NOT NULL REFERENCES public.schools(id),

  doc_type          TEXT NOT NULL
                    CHECK (doc_type IN (
                      'report_card',
                      'payment_receipt',
                      'fee_statement',
                      'loan_confirmation',
                      'attendance_certificate',
                      'transfer_letter'
                    )),

  template_level    TEXT NOT NULL DEFAULT 'branding'
                    CHECK (template_level IN ('branding', 'layout_variant', 'custom')),
  -- branding: school logo, colours, motto applied to ZSMS default layout.
  -- layout_variant: one of several pre-designed layout options selected by school.
  -- custom: school-uploaded custom template (AfriTech review required).

  layout_variant    TEXT,
  -- Populated when template_level = 'layout_variant'.
  -- E.g. 'classic', 'modern', 'compact', 'formal'

  template_config   JSONB NOT NULL DEFAULT '{}',
  -- All customisation values. Schema varies by doc_type.
  -- Common fields: primary_color, secondary_color, font_family, show_logo,
  --                show_motto, show_stamp_area, show_signature_lines,
  --                header_layout, footer_text

  preview_url       TEXT,
  -- Cloudflare R2 path to the last generated preview PDF.
  -- Regenerated when template_config changes.

  is_active         BOOLEAN DEFAULT TRUE,
  approved_by       TEXT,
  -- Clerk user ID of the AfriTech admin who approved a custom template.
  -- NULL for branding and layout_variant templates (no approval needed).

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(school_id, doc_type)
);

CREATE INDEX idx_doc_templates_school ON public.document_templates(school_id);
```

---

### `public.audit_logs`

Immutable append-only record of every significant action in the system. Written exclusively by Edge Functions using the service role key. No user-facing INSERT policy. No UPDATE or DELETE policy for any user including AfriTech super admin.

```sql
CREATE TABLE public.audit_logs (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id               UUID REFERENCES public.schools(id),
  -- NULL for platform-level actions (e.g. creating a school, super admin login).

  actor_user_id           TEXT NOT NULL,
  -- Clerk user ID of the person who performed the action.
  -- During impersonation: this is the REAL actor (the super admin), not the impersonated user.

  impersonated_user_id    TEXT,
  -- Populated when actor_user_id is a super admin acting via impersonation.
  -- The user whose session context was used.

  action                  TEXT NOT NULL,
  -- Verb describing the action. E.g. 'create', 'update', 'delete', 'soft_delete',
  -- 'publish', 'grant_permission', 'revoke_permission', 'impersonate_start',
  -- 'impersonate_end', 'payment_record', 'payment_reverse', 'loan_submit',
  -- 'results_publish', 'bulk_import', 'template_approve'

  table_name              TEXT NOT NULL,
  -- The database table affected. E.g. 'students', 'fee_records', 'payments'.

  record_id               UUID,
  -- The primary key of the affected record. NULL for bulk operations.

  old_values              JSONB,
  -- The state of the record before the change. NULL for INSERT operations.
  -- PII fields (nrc_or_birth_cert, encrypted fields) are masked as '[REDACTED]'.

  new_values              JSONB,
  -- The state of the record after the change. NULL for DELETE operations.
  -- PII fields masked as '[REDACTED]'.

  ip_address              TEXT,
  user_agent              TEXT,

  metadata                JSONB DEFAULT '{}',
  -- Additional context specific to the action type.
  -- E.g. for bulk_import: { "total_rows": 320, "successful": 315, "failed": 5 }
  -- E.g. for grant_permission: { "module": "fees", "action": "write", "expires_at": "..." }

  created_at              TIMESTAMPTZ DEFAULT NOW()
  -- Immutable. No updated_at column — this record never changes.
);

CREATE INDEX idx_audit_school ON public.audit_logs(school_id);
CREATE INDEX idx_audit_actor ON public.audit_logs(actor_user_id);
CREATE INDEX idx_audit_table_record ON public.audit_logs(table_name, record_id);
CREATE INDEX idx_audit_created ON public.audit_logs(school_id, created_at DESC);
-- DESC index supports "show me the most recent actions" queries efficiently.
```

---

### `public.school_permissions`

School-level default permission configuration per role and module. This table defines which modules each role can access by default within a specific school. The `staff_permission_grants` table handles individual user overrides on top of these defaults.

```sql
CREATE TABLE public.school_permissions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id   UUID NOT NULL REFERENCES public.schools(id),
  role        TEXT NOT NULL,
  -- Clerk role identifier. E.g. 'org:teacher', 'org:accountant'.

  module      TEXT NOT NULL,
  -- E.g. 'fees', 'attendance', 'results', 'communication', 'staff', 'reports'

  can_view    BOOLEAN DEFAULT TRUE,
  can_create  BOOLEAN DEFAULT FALSE,
  can_edit    BOOLEAN DEFAULT FALSE,
  can_delete  BOOLEAN DEFAULT FALSE,
  can_export  BOOLEAN DEFAULT FALSE,

  updated_by  TEXT,
  -- Clerk user ID of the last person to modify this permission row.

  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(school_id, role, module)
);

CREATE INDEX idx_school_perms_school ON public.school_permissions(school_id);
CREATE INDEX idx_school_perms_role ON public.school_permissions(school_id, role);
```

---

## Private Schema — Table Definitions

### `private.loan_applications`

Contains all loan application data including personally identifiable financial information. No school-level role has any access to this schema. Access is managed exclusively through Edge Functions with the service role key, after application-layer authorisation validation.

```sql
CREATE TABLE private.loan_applications (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id             UUID NOT NULL,
  -- References public.schools(id). FK constraint not declared across schemas
  -- to avoid cross-schema dependency complications. Validated in Edge Function.

  student_id            UUID NOT NULL,
  parent_id             UUID NOT NULL,
  fee_record_id         UUID NOT NULL,
  parent_user_id        TEXT NOT NULL,
  -- Clerk user ID. Used by RLS policy for parent access.

  amount_requested      NUMERIC(12,2) NOT NULL CHECK (amount_requested > 0),
  currency_code         TEXT NOT NULL DEFAULT 'ZMW',

  lender_name           TEXT,
  -- Populated when the application is submitted to a lender.

  lender_type           TEXT CHECK (lender_type IN ('microfinance', 'bank', 'afritech')),

  employment_type       TEXT CHECK (employment_type IN (
                          'employed', 'self_employed', 'informal', 'unemployed'
                        )),

  employer_name         TEXT,

  monthly_income        NUMERIC(12,2),
  -- Encrypted at field level with AES-256 before storage.

  payslip_url           TEXT,
  -- Cloudflare R2 private bucket path. Encrypted before storage.
  -- Signed URL generated per request with 15-minute expiry.

  behaviour_score       INT CHECK (behaviour_score BETWEEN 0 AND 100),
  -- Calculated by the loan-submit Edge Function before application submission.
  -- Based on historical fee payment patterns for this parent/student combination.

  behaviour_score_breakdown JSONB,
  -- The components of the behaviour score calculation.
  -- E.g. { "on_time_rate": 85, "consistency": 90, "tenure_terms": 6, "multi_child": false }

  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending',
                          'submitted',
                          'under_review',
                          'approved',
                          'declined',
                          'disbursed',
                          'cancelled'
                        )),

  lender_reference      TEXT,
  -- Reference number returned by the lender on submission.

  decline_reason        TEXT,
  -- Provided by the lender on decline. May be generic due to lender privacy policies.

  disbursed_amount      NUMERIC(12,2),
  -- Actual amount disbursed (may differ from amount_requested).

  disbursed_at          TIMESTAMPTZ,
  disbursement_reference TEXT,
  -- Lender's disbursement transaction reference.

  repayment_start_date  DATE,
  repayment_schedule    JSONB,
  -- Array of repayment instalments provided by the lender.
  -- E.g. [{ "due_date": "2026-10-01", "amount": 583.33 }, ...]

  consent_version       TEXT NOT NULL,
  -- Version identifier of the consent document shown to the parent.
  -- Must match a record in private.loan_consent_log.

  consented_at          TIMESTAMPTZ NOT NULL,
  submitted_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_loan_parent ON private.loan_applications(parent_user_id);
CREATE INDEX idx_loan_school ON private.loan_applications(school_id);
CREATE INDEX idx_loan_status ON private.loan_applications(status);
CREATE INDEX idx_loan_fee_record ON private.loan_applications(fee_record_id);
```

---

### `private.loan_consent_log`

Permanently immutable record of every consent event. A consent record is created when a parent views and accepts the loan terms. This record is never modified or deleted under any circumstances.

```sql
CREATE TABLE private.loan_consent_log (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_application_id UUID NOT NULL,
  -- References private.loan_applications(id). Validated in Edge Function.

  parent_user_id      TEXT NOT NULL,
  parent_phone        TEXT,
  -- E.164 format. Recorded at the time of consent.

  consent_version     TEXT NOT NULL,
  -- Version identifier of the consent document. E.g. 'v1.2-ZM-2026'
  -- New versions are created when the consent text changes materially.

  consent_text_hash   TEXT NOT NULL,
  -- SHA-256 hash of the exact consent text shown to the parent.
  -- Allows verification that the parent saw the current version.

  lender_name         TEXT NOT NULL,
  -- The lender named in the consent at the time of agreement.

  ip_address          TEXT,
  device_fingerprint  TEXT,
  user_agent          TEXT,

  consented_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- Immutable. No updated_at. No other fields are ever added after INSERT.
);

CREATE INDEX idx_consent_log_parent ON private.loan_consent_log(parent_user_id);
CREATE INDEX idx_consent_log_application ON private.loan_consent_log(loan_application_id);
```

---

## Database Triggers

### Trigger: `updated_at` auto-update

Applied to every table with an `updated_at` column. Created in migration `0015_add_triggers.sql`.

```sql
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Applied to each table individually:
CREATE TRIGGER set_updated_at_schools
  BEFORE UPDATE ON public.schools
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

-- (Repeat for students, parents, fee_structures, fee_records,
--  staff_members, document_templates, school_permissions,
--  staff_permission_grants, payment_gateways)
```

### Trigger: Absence notification queue

Fires after INSERT on `attendance_records` where status is 'absent'. Enqueues a WhatsApp notification job through the queue abstraction (`BULLMQ.md`).

```sql
CREATE OR REPLACE FUNCTION trigger_queue_absence_notification()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'absent' THEN
    PERFORM net.http_post(
      url := current_setting('app.qstash_endpoint'),
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.qstash_token'),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'student_id', NEW.student_id,
        'school_id', NEW.school_id,
        'attendance_date', NEW.attendance_date,
        'attendance_record_id', NEW.id
      )::TEXT
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER queue_absence_notification
  AFTER INSERT ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION trigger_queue_absence_notification();
```

### Trigger: Grace period on parent unlink

Fires after UPDATE on `student_parent_links` when `is_active` changes from TRUE to FALSE.

```sql
CREATE OR REPLACE FUNCTION trigger_set_grace_period()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_active = TRUE AND NEW.is_active = FALSE THEN
    NEW.grace_period_ends_at = NOW() + INTERVAL '30 days';
    NEW.unlinked_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_grace_period_on_unlink
  BEFORE UPDATE ON public.student_parent_links
  FOR EACH ROW EXECUTE FUNCTION trigger_set_grace_period();
```

---

## Indexes Summary

All indexes are created in migration `0014_add_indexes.sql`. Key index strategies:

| Pattern | Index Type | Reason |
|---|---|---|
| `school_id` on every table | B-tree | Primary tenant isolation filter — used on every single query |
| `status` fields | Partial B-tree | Most queries filter on active/unpaid records only |
| Full-text search on names | GIN (`to_tsvector`) | Admin search bar performance at 100,000+ student records |
| `created_at DESC` on audit_logs | B-tree DESC | "Show recent actions" queries |
| `attendance_date` on attendance | B-tree | Daily and date-range attendance queries |
| `gateway_reference` on payments | Partial B-tree | Webhook reconciliation — only non-null values indexed |
| `parent_user_id` on links | B-tree | Parent portal — "show my children" query |
| `expires_at` on grants | Partial B-tree | Active grant checks — only active records indexed |

---

## Entity Relationship Summary

```
schools
  ├── students (school_id)
  │     ├── student_parent_links (student_id) ── parents (id)
  │     ├── fee_records (student_id)
  │     │     └── payments (fee_record_id)
  │     │           └── payment_gateways [referenced by gateway_name]
  │     ├── attendance_records (student_id)
  │     ├── exam_results (student_id)
  │     └── private.loan_applications (student_id)
  │           └── private.loan_consent_log (loan_application_id)
  ├── fee_structures (school_id)
  ├── grade_config (school_id)
  ├── staff_members (school_id)
  │     └── teacher_assignments (teacher_user_id)
  ├── staff_requests (school_id)
  ├── staff_permission_grants (school_id)
  ├── school_permissions (school_id)
  ├── message_log (school_id)
  ├── report_generation_jobs (school_id)
  ├── document_templates (school_id)
  ├── payment_gateways (school_id)
  └── audit_logs (school_id)
```

---

## Business Rules

1. The `school_id` column must exist on every table in the `public` schema. No exceptions. New tables added by future modules follow this rule without exception.

2. All monetary values use `NUMERIC(12,2)`. FLOAT and REAL are never used for financial data.

3. All timestamps are `TIMESTAMPTZ`. `TIMESTAMP` (without time zone) is never used.

4. Payment records are never updated or hard deleted after creation. Corrections use reversal payment rows with `payment_method = 'reversal'` and `reversal_of_payment_id` referencing the original.

5. Exam results with `results_published = TRUE` cannot be updated by teacher-level users. The RLS UPDATE policy enforces this. Post-publication corrections require an AfriTech super admin action with an audit log entry.

6. `audit_logs` and `private.loan_consent_log` have no UPDATE or DELETE policy for any user including super admin. These tables are permanently immutable.

7. Student records are soft-deleted only. The `is_deleted = TRUE` flag with `deleted_at` timestamp replaces hard deletion. All queries filtering active students must include `WHERE is_deleted = FALSE`.

8. The `private` schema tables are never exposed via the Supabase auto-generated PostgREST API. This is enforced in Supabase project settings by excluding the `private` schema from the API schema list.

9. The service role key is used only in Edge Functions. It is never included in client-side code, mobile app bundles, or committed to version control. The two permitted uses are: writing to `audit_logs`, and updating loan application status via webhooks.

10. Every new migration must regenerate `packages/types/database.ts` using `supabase gen types typescript`. The type file is never manually edited.

11. When adding a new payment gateway to the `gateway_name` CHECK constraint, the change requires a migration that updates the CHECK constraint definition. The `payment_gateways.gateway_config JSONB` field accommodates gateway-specific configuration without schema changes.

12. Phone numbers stored in any table must be in E.164 format. Normalisation occurs at the application layer before any database write. The database does not enforce format — the application and Edge Functions are responsible.

---

## Edge Cases and Error Handling

**Concurrent payment recording.** If two accountants attempt to record payments for the same student simultaneously, both inserts succeed (they create separate payment rows). The `fee_records.amount_paid` is updated via a trigger that sums all non-voided payments. No race condition occurs on the fee record itself because the trigger runs within a transaction.

**Receipt number sequencing.** Receipt numbers must be globally unique per school and sequential. Generated using a PostgreSQL sequence per school (`receipt_seq_ZM_LSK_0001`). Sequences are atomic — concurrent payment recording never produces duplicate receipt numbers.

**Bulk import partial failure.** If 5 of 320 student rows fail validation during import, the 315 valid rows are inserted and the 5 failures are returned as an error report. The import is not atomic — valid rows are not rolled back if some rows fail. This is by design and documented in `docs/modules/students/BULK_IMPORT.md`.

**Fee record generation at term start.** When the admin triggers term fee generation, one `fee_records` row is created per student per fee structure row for that grade/term. If the student count is large (1,000+ students) this runs as a queued batch job. If a student's fee record already exists for that term (e.g. re-triggering generation accidentally), the insert is skipped using `INSERT ... ON CONFLICT DO NOTHING`.

**Deleted student fee records.** When a student is soft-deleted, their fee records and payment history are preserved. The `is_deleted` flag on students does not cascade to fee records. Historical financial data is never lost.

---

## Security Considerations

- NRC numbers and national ID fields are encrypted at the application layer using AES-256 before storage. The encryption key is stored in the Edge Function environment, never in the database.
- Payslip URLs in `private.loan_applications` are encrypted before storage. Cloudflare R2 signed URLs with 15-minute expiry are generated per request — the stored path alone is not sufficient to access the file.
- The `old_values` and `new_values` JSONB fields in `audit_logs` mask all PII-adjacent fields as `[REDACTED]` before storage. This is enforced in the audit-writing Edge Function.
- Gateway API keys and secrets in `payment_gateways` are encrypted before storage. The decrypted values exist only within the Edge Function execution context and are never logged.
- The `private` schema must be explicitly excluded from Supabase's PostgREST API exposure in project settings (`Settings → API → Exposed schemas` — ensure `private` is not listed).

---

## Additional Tables — Confirmed During Stages 6–17

### `public.school_custom_roles`

Stores school-defined staff roles beyond the standard Clerk roles. Custom role holders use `org:staff` as their Clerk base role (zero default access). All their permissions come from this table.

```sql
CREATE TABLE public.school_custom_roles (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID NOT NULL REFERENCES public.schools(id),
  role_name       TEXT NOT NULL,
  description     TEXT,
  permissions     JSONB NOT NULL DEFAULT '{}',
  -- E.g. { "students": {"read": true}, "attendance": {"read": true, "write": true} }
  is_active       BOOLEAN DEFAULT TRUE,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, role_name)
);
```

---

### `public.module_subscriptions`

Tracks which feature add-ons a school has purchased. Used alongside the dynamic pricing system in `afritech.tier_features` and `afritech.school_feature_overrides`.

```sql
CREATE TABLE public.module_subscriptions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID NOT NULL REFERENCES public.schools(id),
  module_name     TEXT NOT NULL,
  -- Matches feature_key in afritech.feature_flags
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'cancelled', 'suspended')),
  billing_amount  NUMERIC(10,2) NOT NULL,
  currency_code   TEXT NOT NULL DEFAULT 'ZMW',
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  ends_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

---

### `public.timetables`

One timetable per school per academic year per term. Multiple timetables can exist (regular and exam) but only one is active at a time.

```sql
CREATE TABLE public.timetables (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id     UUID NOT NULL REFERENCES public.schools(id),
  academic_year TEXT NOT NULL,
  term_number   INT NOT NULL CHECK (term_number BETWEEN 1 AND 4),
  name          TEXT NOT NULL DEFAULT 'Main Timetable',
  is_active     BOOLEAN DEFAULT TRUE,
  published     BOOLEAN DEFAULT FALSE,
  published_at  TIMESTAMPTZ,
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### `public.timetable_periods`

Standard time periods for the school day. Set once and reused across all timetables.

```sql
CREATE TABLE public.timetable_periods (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id           UUID NOT NULL REFERENCES public.schools(id),
  period_name         TEXT NOT NULL,
  start_time          TIME NOT NULL,
  end_time            TIME NOT NULL,
  period_order        INT NOT NULL,
  applies_days        INT[] DEFAULT '{1,2,3,4,5}',
  is_teaching_period  BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, period_order)
);
```

### `public.timetable_slots`

One row per lesson slot — the intersection of a class, a period, and a day.

```sql
CREATE TABLE public.timetable_slots (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  timetable_id  UUID NOT NULL REFERENCES public.timetables(id),
  school_id     UUID NOT NULL REFERENCES public.schools(id),
  class_id      TEXT NOT NULL,
  period_id     UUID NOT NULL REFERENCES public.timetable_periods(id),
  day_of_week   INT NOT NULL CHECK (day_of_week BETWEEN 1 AND 5),
  subject_code  TEXT,
  staff_user_id TEXT,
  slot_type     TEXT NOT NULL DEFAULT 'lesson'
                CHECK (slot_type IN ('lesson','break','assembly','free','exam')),
  room          TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(timetable_id, class_id, period_id, day_of_week)
);
```

---

### `public.announcements`

School broadcast announcements sent to parents, students, or staff.

```sql
CREATE TABLE public.announcements (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id             UUID REFERENCES public.schools(id),
  -- NULL for AfriTech platform-level announcements
  title                 TEXT NOT NULL,
  body                  TEXT NOT NULL,
  importance            TEXT NOT NULL DEFAULT 'regular'
                        CHECK (importance IN ('regular', 'important')),
  target_type           TEXT NOT NULL
                        CHECK (target_type IN (
                          'all_parents','all_students','all_staff',
                          'grade','class','platform'
                        )),
  target_ids            TEXT[],
  created_by            TEXT NOT NULL,
  scheduled_at          TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','scheduled','sending','sent')),
  whatsapp_jobs_queued  INT DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
```

### `public.announcement_reads`

Tracks every user's read status for every announcement. Full tracking across all schools and all announcements.

```sql
CREATE TABLE public.announcement_reads (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id        UUID NOT NULL REFERENCES public.schools(id),
  announcement_id  UUID NOT NULL REFERENCES public.announcements(id),
  reader_user_id   TEXT NOT NULL,
  reader_type      TEXT NOT NULL
                   CHECK (reader_type IN ('parent','student','staff')),
  read_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(announcement_id, reader_user_id)
);
```

---

### `public.parent_push_tokens`

Stores Expo push notification tokens for parent mobile app devices.

```sql
CREATE TABLE public.parent_push_tokens (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_user_id  TEXT NOT NULL,
  push_token      TEXT NOT NULL,
  platform        TEXT NOT NULL CHECK (platform IN ('ios','android')),
  is_active       BOOLEAN DEFAULT TRUE,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(parent_user_id, platform)
);
```

---

### `public.alumni_profiles`

Permanent platform-level accounts for graduated students and their parents. Separate from the school-scoped student records.

```sql
CREATE TABLE public.alumni_profiles (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_user_id         TEXT NOT NULL UNIQUE,
  -- The parent's or student's Clerk account
  original_student_ids  TEXT[] NOT NULL DEFAULT '{}',
  -- All student IDs this alumni was linked to
  original_school_ids   UUID[] NOT NULL DEFAULT '{}',
  -- All schools attended
  graduation_year       INT,
  last_grade_completed  TEXT,
  marketing_opt_in      BOOLEAN DEFAULT FALSE,
  -- Explicit opt-in for AfriTech promotional content
  opted_in_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
```

---

### `public.lenders`

Registry of lending partners available in the loan module. Managed by AfriTech loan officers.

```sql
CREATE TABLE public.lenders (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lender_name           TEXT NOT NULL UNIQUE,
  display_name          TEXT NOT NULL,
  tagline               TEXT,
  logo_url              TEXT,
  description           TEXT,
  country_codes         TEXT[] NOT NULL DEFAULT '{ZM}',
  loan_products         JSONB NOT NULL DEFAULT '[]',
  max_loan_amount       NUMERIC(12,2) NOT NULL,
  min_loan_amount       NUMERIC(12,2) NOT NULL DEFAULT 500,
  min_behaviour_score   INT DEFAULT 450,
  interest_rate_display TEXT NOT NULL,
  turnaround_label      TEXT NOT NULL,
  integration_type      TEXT NOT NULL
                        CHECK (integration_type IN ('email','api','zsms_internal')),
  intake_email          TEXT,
  api_endpoint          TEXT,
  api_key_encrypted     TEXT,
  webhook_secret        TEXT,
  commission_rate       NUMERIC(5,4) NOT NULL,
  commission_terms      TEXT,
  collection_account    JSONB,
  collection_instructions TEXT,
  eligibility_summary   TEXT[],
  required_documents    TEXT[],
  is_active             BOOLEAN DEFAULT TRUE,
  is_featured           BOOLEAN DEFAULT FALSE,
  onboarded_at          TIMESTAMPTZ DEFAULT NOW(),
  onboarded_by          TEXT NOT NULL,
  notes                 TEXT
);
```

---

### `public.school_integrations`

Configuration for accounting and CRM integrations per school.

```sql
CREATE TABLE public.school_integrations (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID NOT NULL REFERENCES public.schools(id),
  integration_type  TEXT NOT NULL
                    CHECK (integration_type IN (
                      'sage_50_export','sage_business_cloud','quickbooks',
                      'xero','google_sheets','hubspot','custom_webhook'
                    )),
  display_name      TEXT NOT NULL,
  is_active         BOOLEAN DEFAULT TRUE,
  is_paused         BOOLEAN DEFAULT FALSE,
  config            JSONB NOT NULL DEFAULT '{}',
  credentials_enc   TEXT,
  events_subscribed TEXT[] NOT NULL DEFAULT '{}',
  last_sync_at      TIMESTAMPTZ,
  last_sync_status  TEXT CHECK (last_sync_status IN ('success','failed','partial')),
  last_error        TEXT,
  sync_count        INT DEFAULT 0,
  error_count       INT DEFAULT 0,
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
```

### `public.integration_log`

Append-only log of every integration event dispatch attempt.

```sql
CREATE TABLE public.integration_log (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID NOT NULL REFERENCES public.schools(id),
  integration_id    UUID NOT NULL REFERENCES public.school_integrations(id),
  event_type        TEXT NOT NULL,
  zsms_record_id    TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','success','failed','retrying','skipped')),
  request_payload   JSONB,
  response_code     INT,
  response_summary  TEXT,
  error_message     TEXT,
  retry_count       INT DEFAULT 0,
  next_retry_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);
```

---

### Updated `public.schools` — New WhatsApp Fields

The following columns are added to the `schools` table to support school-specific WhatsApp Business numbers:

```sql
ALTER TABLE public.schools ADD COLUMN whatsapp_phone_number_id TEXT;
-- NULL = use AfriTech shared number (default)
-- Set = school's own Meta phone number ID

ALTER TABLE public.schools ADD COLUMN whatsapp_access_token_enc TEXT;
-- School's Meta access token, encrypted with GATEWAY_ENCRYPTION_KEY

ALTER TABLE public.schools ADD COLUMN whatsapp_business_acct_id TEXT;
-- School's WhatsApp Business Account ID

ALTER TABLE public.schools ADD COLUMN whatsapp_owns_number BOOLEAN DEFAULT FALSE;
-- TRUE when school uses their own WhatsApp number
```

---

### Updated `public.parents` — New Fields

```sql
ALTER TABLE public.parents ADD COLUMN marketing_opt_in BOOLEAN DEFAULT FALSE;
-- Separate from whatsapp_opted_in — controls AfriTech promotional content
-- Must be explicitly opted in — never defaulted to TRUE
```

---

### Updated `public.students` — New Fields

```sql
ALTER TABLE public.students ADD COLUMN examination_number TEXT;
-- ECZ or Cambridge candidate number — relevant for Grade 6, Form 4, Form 6
-- Optional — blank for non-examination classes

ALTER TABLE public.students ADD COLUMN alumni_status TEXT DEFAULT NULL
  CHECK (alumni_status IN ('active', 'graduated', 'transferred', NULL));
-- Populated on graduation or departure
```

---

### Updated `private.loan_applications` — New Fields

```sql
ALTER TABLE private.loan_applications ADD COLUMN lender_id UUID REFERENCES public.lenders(id);
ALTER TABLE private.loan_applications ADD COLUMN loan_product_id TEXT;
ALTER TABLE private.loan_applications ADD COLUMN product_type TEXT
  CHECK (product_type IN ('school_fees','personal','emergency','device','uniform','university'));
-- fee_record_id already exists but is now nullable for non-school loans
ALTER TABLE private.loan_applications ALTER COLUMN fee_record_id DROP NOT NULL;
ALTER TABLE private.loan_applications ADD COLUMN repayment_schedule JSONB DEFAULT '[]';
ALTER TABLE private.loan_applications ADD COLUMN collection_account JSONB;
ALTER TABLE private.loan_applications ADD COLUMN collection_instructions TEXT;
ALTER TABLE private.loan_applications ADD COLUMN zsms_is_lender BOOLEAN DEFAULT FALSE;
ALTER TABLE private.loan_applications ADD COLUMN total_repayable NUMERIC(12,2);
ALTER TABLE private.loan_applications ADD COLUMN monthly_instalment NUMERIC(12,2);
```

---

### `private.loan_repayment_log`

Tracks every repayment event for ZSMS-facilitated loans.

```sql
CREATE TABLE private.loan_repayment_log (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_application_id  UUID NOT NULL,
  instalment_number    INT NOT NULL,
  amount               NUMERIC(12,2) NOT NULL,
  payment_method       TEXT,
  gateway_reference    TEXT,
  status               TEXT NOT NULL DEFAULT 'initiated'
                       CHECK (status IN ('initiated','confirmed','failed','manual')),
  initiated_by         TEXT,
  initiated_at         TIMESTAMPTZ,
  confirmed_at         TIMESTAMPTZ,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
```

### `private.consent_templates`

Versioned consent text templates for the loan consent flow.

```sql
CREATE TABLE private.consent_templates (
  version         TEXT PRIMARY KEY,
  template_text   TEXT NOT NULL,
  effective_from  TIMESTAMPTZ NOT NULL,
  superseded_at   TIMESTAMPTZ,
  created_by      TEXT NOT NULL
);
```

---

### AfriTech Schema — Dynamic Pricing Tables

```sql
-- afritech.subscription_tiers — database-driven tier pricing
CREATE TABLE afritech.subscription_tiers (
  tier_name           TEXT PRIMARY KEY,
  display_name        TEXT NOT NULL,
  tagline             TEXT,
  monthly_price_zmw   NUMERIC(10,2) NOT NULL,
  monthly_price_usd   NUMERIC(10,2) NOT NULL,
  annual_price_zmw    NUMERIC(10,2) NOT NULL,
  annual_price_usd    NUMERIC(10,2) NOT NULL,
  annual_discount_pct NUMERIC(5,2) DEFAULT 10.00,
  student_limit       INT,
  whatsapp_quota      INT NOT NULL,
  description         TEXT,
  is_active           BOOLEAN DEFAULT TRUE,
  is_publicly_listed  BOOLEAN DEFAULT TRUE,
  display_order       INT NOT NULL,
  updated_by          TEXT NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- afritech.feature_flags — all toggleable features
CREATE TABLE afritech.feature_flags (
  feature_key             TEXT PRIMARY KEY,
  display_name            TEXT NOT NULL,
  description             TEXT,
  category                TEXT NOT NULL,
  monthly_addon_price_zmw NUMERIC(10,2),
  monthly_addon_price_usd NUMERIC(10,2),
  is_available_as_addon   BOOLEAN DEFAULT TRUE,
  is_active               BOOLEAN DEFAULT TRUE,
  display_order           INT,
  updated_by              TEXT NOT NULL,
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- afritech.tier_features — feature matrix: which tier includes which feature
CREATE TABLE afritech.tier_features (
  tier_name   TEXT NOT NULL,
  feature_key TEXT NOT NULL,
  is_included BOOLEAN DEFAULT TRUE,
  updated_by  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tier_name, feature_key)
);

-- afritech.school_feature_overrides — per-school access exceptions
CREATE TABLE afritech.school_feature_overrides (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID NOT NULL REFERENCES public.schools(id),
  override_type   TEXT NOT NULL
                  CHECK (override_type IN (
                    'grant_feature','revoke_feature',
                    'extend_subscription','extend_trial','tier_override'
                  )),
  feature_key     TEXT,
  override_value  TEXT,
  expires_at      TIMESTAMPTZ,
  reason          TEXT NOT NULL,
  ticket_ref      TEXT,
  granted_by      TEXT NOT NULL,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ,
  revoked_by      TEXT
);

-- afritech.loan_commissions — commission tracking on disbursed loans
CREATE TABLE afritech.loan_commissions (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_application_id UUID NOT NULL,
  lender_id           UUID NOT NULL REFERENCES public.lenders(id),
  disbursed_amount    NUMERIC(12,2) NOT NULL,
  commission_rate     NUMERIC(5,4) NOT NULL,
  commission_amount   NUMERIC(12,2) NOT NULL,
  status              TEXT DEFAULT 'pending'
                      CHECK (status IN ('pending','invoiced','received','disputed')),
  invoiced_at         TIMESTAMPTZ,
  received_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- afritech.platform_metrics — nightly platform health and revenue metrics cache
CREATE TABLE afritech.platform_metrics (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  metric_date     DATE NOT NULL,
  country_code    TEXT NOT NULL DEFAULT 'ZM',
  metric_name     TEXT NOT NULL,
  metric_value    NUMERIC NOT NULL,
  metric_metadata JSONB,
  calculated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(metric_date, country_code, metric_name)
);
```

---

## Known Limitations and Future Work

- The current schema supports up to 4 academic terms (`term_number BETWEEN 1 AND 4`). If a country with 5 terms is added in future, a migration to update the CHECK constraint is required.
- The `payment_gateways.gateway_name` CHECK constraint requires a migration to add each new gateway. A future improvement would move this to a `payment_gateway_providers` reference table to allow adding gateways without schema migrations.
- The full-text search index on `students` covers English language tokenisation. For schools in countries with non-English student names that do not tokenise well, a different dictionary may be needed.
- Aggregate analytics across multiple schools (for multi-school owners) currently requires Edge Function queries using the service role key. A future improvement would create school-group views that RLS can scope to owner-level access across their registered schools.
- Report generation job progress tracking currently uses polling via Supabase Realtime on the `report_generation_jobs` table. A future improvement would use a WebSocket-based progress stream for lower latency updates on very large schools.

---

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-04-26 | Initial complete draft | Pre-development documentation covering full schema |
| 2026-04-26 | Added payment_gateways table with multi-gateway support | Requirement to support Flutterwave, PawaPay, DPO, Pesapal, and mobile money gateways simultaneously |
| 2026-04-26 | Added grace period mechanics to student_parent_links | Confirmed 30-day grace period on parent unlink |
| 2026-04-26 | Added private schema loan tables | Isolated from public schema for security and compliance |
| 2026-04-26 | Added school_custom_roles | Custom staff roles confirmed — Starter 3, Growth 10, Professional/Enterprise unlimited |
| 2026-04-26 | Added module_subscriptions | Feature toggle billing model — add-ons purchasable independently |
| 2026-04-26 | Added timetables, timetable_periods, timetable_slots | Timetable module confirmed as core feature |
| 2026-04-26 | Added announcements, announcement_reads | Full read tracking for all announcements confirmed |
| 2026-04-26 | Added parent_push_tokens | Expo push notifications for parent mobile app |
| 2026-04-26 | Added alumni_profiles | Graduated account model — permanent platform-level accounts |
| 2026-04-26 | Added lenders table | Loan marketplace — multiple lenders onboarded as partners |
| 2026-04-26 | Added school_integrations, integration_log | Accounting and CRM integration framework |
| 2026-04-26 | Updated schools table — WhatsApp fields | School-specific WhatsApp Business number support |
| 2026-04-26 | Updated parents table — marketing_opt_in | Alumni promotional content opt-in separate from notifications |
| 2026-04-26 | Updated students table — examination_number, alumni_status | ECZ/Cambridge candidate numbers and alumni lifecycle |
| 2026-04-26 | Updated private.loan_applications — expanded fields | Loan module evolution — non-school loans, repayment schedule |
| 2026-04-26 | Added private.loan_repayment_log, consent_templates | Repayment tracking and consent versioning |
| 2026-04-26 | Added AfriTech schema pricing tables | Dynamic pricing — super admins control pricing without code deploys |

---

## AI Module Tables (Stage — AI)

### `public.knowledge_base`

Stores chunked and embedded curriculum content for the lesson planner RAG pipeline. Each row is one chunk of a curriculum document with its vector embedding. Maintained exclusively by the AfriTech content team — not by schools or teachers.

```sql
CREATE TABLE public.knowledge_base (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_type     TEXT NOT NULL
                  CHECK (source_type IN (
                    'ecz_syllabus', 'cambridge_igcse', 'cambridge_alevel',
                    'curriculum_framework', 'textbook', 'exam_papers'
                  )),
  source_name     TEXT NOT NULL,
  -- E.g. 'ECZ Mathematics Grade 9 Syllabus 2023'
  grade_level     TEXT,
  subject         TEXT,
  topic           TEXT,
  curriculum_type TEXT NOT NULL
                  CHECK (curriculum_type IN ('ecz', 'cambridge_igcse', 'cambridge_alevel', 'mesvtee')),
  country_code    TEXT NOT NULL DEFAULT 'ZM',
  chunk_text      TEXT NOT NULL,
  chunk_index     INT NOT NULL,
  embedding       vector(1536),
  -- pgvector column — populated by the embedding pipeline
  -- NULL until embedding pipeline runs
  is_active       BOOLEAN DEFAULT TRUE,
  -- FALSE for superseded content (old syllabus versions — never hard deleted)
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- IVFFlat index for fast approximate nearest-neighbour vector search
CREATE INDEX idx_knowledge_base_embedding ON public.knowledge_base
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX idx_knowledge_base_curriculum
  ON public.knowledge_base(curriculum_type, subject, grade_level)
  WHERE is_active = TRUE;
```

---

### `public.teaching_resources`

**Implemented in migration `0130`, replacing the `lesson_plans` table this section used to specify.** The Hub has three
generators — lesson planner, quiz generator, homework creator — and they take the same inputs and produce the same shape.
Three near-identical tables would triple the RLS surface for no behavioural difference, and one table named
`lesson_plans` holding quizzes would be a name that lies. One table, with `resource_kind`.

`school_id` is **provenance only and deliberately not an access path**: a school cannot read its own teachers'
resources. `TEACHER_PORTAL.md` business rule 2 says plans belong to the teacher and survive their leaving, which is only
true if the school never had access. `teacher_hub_test.sql` asserts that the principal of the school a plan was created
at reads none of it.

`generator_name` and `generator_version` are NOT NULL. There is no LLM and no knowledge base yet, so the first generator
is a deterministic scaffold; recording it keeps resources made before the model is wired distinguishable from those made
after. ADR-041's rule — a derived artefact carries its basis — in a third place.

```sql
CREATE TABLE public.teaching_resources (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Clerk user id of the owner. The ONLY access path to the row.
  created_by         TEXT NOT NULL,
  resource_kind      TEXT NOT NULL CHECK (resource_kind IN ('lesson_plan', 'quiz', 'homework')),
  -- Provenance only. NOT an access path — see above.
  school_id          UUID REFERENCES public.schools(id),
  title              TEXT NOT NULL,
  subject            TEXT NOT NULL,
  grade_level        TEXT NOT NULL,
  topic              TEXT NOT NULL,
  curriculum_type    TEXT NOT NULL,
  duration_minutes   INT CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  lesson_type        TEXT CHECK (lesson_type IS NULL OR lesson_type IN
                       ('introduction', 'core', 'revision', 'assessment_prep')),
  content            JSONB NOT NULL,
  -- What was asked for, kept beside what came out.
  generation_params  JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- NULL until a knowledge base exists; its absence is how a reader knows this was not RAG.
  knowledge_sources  JSONB,
  generator_name     TEXT NOT NULL,
  generator_version  TEXT NOT NULL,
  is_shared          BOOLEAN NOT NULL DEFAULT FALSE,
  teacher_notes      TEXT,
  -- Soft delete: there is no DELETE grant on this table.
  is_deleted         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_teaching_resources_created_by
  ON public.teaching_resources(created_by, created_at DESC) WHERE is_deleted = FALSE;
CREATE INDEX idx_teaching_resources_kind
  ON public.teaching_resources(created_by, resource_kind) WHERE is_deleted = FALSE;
CREATE INDEX idx_teaching_resources_school
  ON public.teaching_resources(school_id) WHERE school_id IS NOT NULL;

-- Owner-scoped. No school clause, no role clause. There is deliberately NO policy
-- admitting `is_shared = TRUE` rows to other teachers: that would expose `created_by`,
-- and the Community Library must show a first name and a subject, never an identity.
CREATE POLICY teacher_read_own_resources ON public.teaching_resources
  FOR SELECT TO authenticated USING (created_by = public.get_user_id());

-- `content`, `generator_name` and `generator_version` are absent from the UPDATE grant:
-- a generated document is not editable in place, or the provenance becomes a lie.
GRANT SELECT, INSERT ON public.teaching_resources TO authenticated;
GRANT UPDATE (title, teacher_notes, is_shared, is_deleted)
  ON public.teaching_resources TO authenticated;
```

---

### `public.ai_conversations`

Stores AI assistant conversation history. Used for context continuity within a session (last 10 messages loaded). Archived after 30 days.

```sql
CREATE TABLE public.ai_conversations (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID REFERENCES public.schools(id),
  -- NULL for standalone teacher conversations
  user_id         TEXT NOT NULL,
  -- Clerk user ID
  user_role       TEXT NOT NULL,
  -- Role at time of conversation: org:teacher, org:principal, parent, platform:teacher
  messages        JSONB NOT NULL DEFAULT '[]',
  -- Array of { role: 'user'|'assistant', content: string, timestamp: ISO string }
  token_count     INT DEFAULT 0,
  -- Running total for cost monitoring
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_conversations_user ON public.ai_conversations(user_id, created_at DESC);
CREATE INDEX idx_ai_conversations_school ON public.ai_conversations(school_id)
  WHERE school_id IS NOT NULL;
```

---

### `public.standalone_teacher_accounts`

Platform-level accounts for teachers using the lesson planner B2C product independently of any school. **Not
school-scoped — and that is the defining property, not a footnote.** A standalone teacher has no Clerk organisation, so
`current_school_uuid()` returns NULL for them and all 75 school-scoped policies deny. These tables filter on
`public.get_user_id()` instead: the unit of isolation is a person.

**Implemented in `0130`, with three deviations from the DDL below, each deliberate:**

- **No `linked_school_id`.** The column was a single UUID while business rule 4 says a teacher may be linked to several
  schools — the column and the rule contradicted each other. `my_schools()` (`0117`) already answers "which schools is
  this user in", is self-scoped on `get_user_id()`, and supports any number. A second source of truth that can disagree
  with Clerk is worse than none.
- **`plan_code` is a foreign key to `afritech.teacher_hub_plans`**, and the trial is a plan row priced zero with a
  lifetime cap. Prices and the trial allowance are data, never literals; the allowance resolves
  **account override → plan**, exactly as `school_student_limit()` resolves its own ceiling.
- **The counters are not writable by their owner.** `trial_resources_used` decides whether this teacher gets a free
  product, so the grants are **column-level**: profile columns only, with no privilege at all on `subscription_status`,
  `plan_code` or either counter. `create_teaching_resource()` is the only writer, and it re-checks entitlement inside a
  row lock so two simultaneous requests cannot both spend the last free resource.

```sql
CREATE TABLE public.standalone_teacher_accounts (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  clerk_user_id         TEXT NOT NULL UNIQUE,
  full_name             TEXT NOT NULL,
  email                 TEXT NOT NULL,
  phone_e164            TEXT,
  country_code          TEXT NOT NULL DEFAULT 'ZM',
  curriculum_types      TEXT[] NOT NULL DEFAULT '{ecz}',
  -- Curricula this teacher works with: ecz, cambridge_igcse, cambridge_alevel
  subjects              TEXT[] NOT NULL DEFAULT '{}',
  -- Subjects they teach — used to personalise the lesson planner UI
  subscription_status   TEXT NOT NULL DEFAULT 'trial'
                        CHECK (subscription_status IN (
                          'trial', 'active', 'cancelled', 'suspended'
                        )),
  -- Renamed from `trial_plans_used`: it meters resources of all three kinds, not plans.
  -- MONOTONIC. Never decremented, never reset, not writable by the account holder.
  trial_resources_used  INT NOT NULL DEFAULT 0,
  -- Per-account override of the plan's allowance. NULL means "use the plan".
  trial_allowance_override INT CHECK (trial_allowance_override >= 0),
  subscription_started_at TIMESTAMPTZ,
  -- Read access outlives this date; generation does not (business rule 5).
  subscription_ends_at  TIMESTAMPTZ,
  resources_created     INT NOT NULL DEFAULT 0,
  -- NOTE: `linked_school_id` is deliberately absent — see above. Multi-school linkage is
  -- answered by my_schools(), which already supports any number of schools.
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Added in 0130, and the reason the trial cannot be reset by the person it meters.
CREATE TABLE afritech.teacher_hub_plans (
  plan_code           TEXT PRIMARY KEY,
  display_name        TEXT NOT NULL,
  billing_period      TEXT NOT NULL CHECK (billing_period IN ('none', 'monthly', 'annual')),
  price               NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  currency_code       TEXT NOT NULL DEFAULT 'ZMW',
  -- NULL = unlimited. A number is a LIFETIME cap, not a per-period one.
  included_resources  INT CHECK (included_resources >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order          INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Seeded: trial (K0, 5 resources) · monthly (K300) · annual (K3,000).

GRANT SELECT ON public.standalone_teacher_accounts TO authenticated;
-- Identity and profile only. `plan_code`, `subscription_status`, the allowance override and
-- both counters are absent, so an INSERT naming them is refused before RLS is consulted.
GRANT INSERT (clerk_user_id, full_name, email, phone_e164, country_code,
              curriculum_types, subjects, grade_levels)
  ON public.standalone_teacher_accounts TO authenticated;
GRANT UPDATE (full_name, phone_e164, country_code, curriculum_types, subjects, grade_levels)
  ON public.standalone_teacher_accounts TO authenticated;

CREATE INDEX idx_standalone_teachers_clerk ON public.standalone_teacher_accounts(clerk_user_id);
CREATE INDEX idx_standalone_teachers_status ON public.standalone_teacher_accounts(subscription_status)
  WHERE subscription_status = 'active';
CREATE INDEX idx_standalone_teachers_school ON public.standalone_teacher_accounts(linked_school_id)
  WHERE linked_school_id IS NOT NULL;
```

---

## AI Module — Updated Change Log Entry

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Added knowledge_base with pgvector | Lesson planner RAG pipeline — curriculum knowledge base |
| 2026-04-26 | Added lesson_plans | Store generated lesson plans for school and standalone teachers |
| 2026-04-26 | Added ai_conversations | AI assistant conversation history for context continuity |
| 2026-04-26 | Added standalone_teacher_accounts | B2C lesson planner product — teachers independent of schools |
| 2026-09-27 | **`0130` applied: `teaching_resources` replaces `lesson_plans`, `standalone_teacher_accounts` built, `afritech.teacher_hub_plans` added** | Three tools share one shape, so one table with `resource_kind`. `linked_school_id` dropped as self-contradictory. Prices and the trial cap became rows. Counters moved behind column-level grants, because the meter must not be writable by the person it meters. |
| 2026-08-13 | Corrected schema count from two to three (`public` 46, `private` 4, `afritech` 8 = 58 tables) | The document referenced `afritech.` 14 times in its own body while its overview claimed two schemas |
| 2026-08-13 | Attendance trigger description made queue-provider-neutral | ADR-035 — BullMQ is the default, not QStash |
