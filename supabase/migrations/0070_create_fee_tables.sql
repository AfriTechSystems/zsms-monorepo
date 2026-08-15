-- Migration: 0070_create_fee_tables.sql
-- Created: 2026-08-15
-- Description: Fee structures, the per-student fee ledger, payments with the
--              submission/verification workflow, and gateway configuration.
-- Related documents: Official Documentation/01 Foundation Layer/DATABASE.md — fee tables
--                    Official Documentation/05 Core Database and API Reference/SCHEMA.md
--
-- NUMBERING: 0070 per MIGRATIONS.md → Next Available Sequence Number. Not 0066:
-- everything from 0022 to 0068 sorts below the applied high-water mark (0069)
-- and would be skipped by `supabase db push`.
--
-- PAYMENTS — RESOLVING A DOCUMENT CONFLICT.
-- SCHEMA.md specifies `status` (pending_verification / verified / rejected /
-- queried), `verified_by`, `verified_at`, `rejection_reason`,
-- `proof_of_payment_url`, and `confirmation_checkbox_at`. DATABASE.md's DDL has
-- none of them. CHANGELOG.md (2026-04-26) records their addition as a
-- deliberate change — "Removed OTP for financial submissions — replaced with
-- confirmation workflow" — so DATABASE.md is simply the document that was not
-- updated. SCHEMA.md governs; DATABASE.md is corrected alongside this migration.
--
-- Without those columns there is no verification step at all, and a submitted
-- payment would count against a balance the moment it was entered.

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- fee_structures — what a grade/term/student-type costs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fee_structures (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID NOT NULL REFERENCES public.schools(id),

  academic_year     TEXT NOT NULL,
  term_number       INT  NOT NULL CHECK (term_number BETWEEN 1 AND 4),

  grade_id          TEXT NOT NULL,
  -- Matches school_grade_levels.level_id. 'ALL' applies to every grade.

  student_type      TEXT NOT NULL DEFAULT 'all'
                    CHECK (student_type IN ('all', 'day', 'boarding')),

  fee_label         TEXT NOT NULL DEFAULT 'Tuition Fee',

  amount            NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  -- NUMERIC, never FLOAT (prohibition 5).

  currency_code     TEXT NOT NULL DEFAULT 'ZMW',

  is_mandatory      BOOLEAN NOT NULL DEFAULT TRUE,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, academic_year, term_number, grade_id, student_type, fee_label)
);

CREATE INDEX IF NOT EXISTS idx_fee_structures_school     ON public.fee_structures(school_id);
CREATE INDEX IF NOT EXISTS idx_fee_structures_year_term  ON public.fee_structures(school_id, academic_year, term_number);
CREATE INDEX IF NOT EXISTS idx_fee_structures_grade      ON public.fee_structures(school_id, grade_id);

DROP TRIGGER IF EXISTS update_timestamp_on_fee_structures ON public.fee_structures;
CREATE TRIGGER update_timestamp_on_fee_structures
  BEFORE UPDATE ON public.fee_structures
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- fee_records — the per-student ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.fee_records (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id           UUID NOT NULL REFERENCES public.schools(id),
  student_id          UUID NOT NULL REFERENCES public.students(id),
  fee_structure_id    UUID NOT NULL REFERENCES public.fee_structures(id),

  academic_year       TEXT NOT NULL,
  term_number         INT  NOT NULL CHECK (term_number BETWEEN 1 AND 4),

  fee_label           TEXT NOT NULL,
  -- Copied at creation. Preserved even if the structure is later edited, so a
  -- historical record still reads the way it did when it was issued.

  amount_due          NUMERIC(12,2) NOT NULL CHECK (amount_due >= 0),
  amount_paid         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  -- Derived from verified payments by trigger (0075). Never set by hand.

  discount_amount     NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  discount_reason     TEXT,

  currency_code       TEXT NOT NULL DEFAULT 'ZMW',

  status              TEXT NOT NULL DEFAULT 'unpaid'
                      CHECK (status IN (
                        'unpaid', 'partial', 'paid', 'waived',
                        'loan_pending', 'loan_paid', 'overpaid'
                      )),

  due_date            TIMESTAMPTZ,
  last_reminder_at    TIMESTAMPTZ,
  reminder_count      INT NOT NULL DEFAULT 0,

  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at          TIMESTAMPTZ,
  -- Soft delete only — fee records are named in prohibition 8.

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One ledger line per student per fee per term. Without this, re-running
  -- generation would silently double every student's balance.
  UNIQUE (school_id, student_id, academic_year, term_number, fee_label)
);

CREATE INDEX IF NOT EXISTS idx_fee_records_school     ON public.fee_records(school_id);
CREATE INDEX IF NOT EXISTS idx_fee_records_student    ON public.fee_records(student_id);
CREATE INDEX IF NOT EXISTS idx_fee_records_status     ON public.fee_records(school_id, status);
CREATE INDEX IF NOT EXISTS idx_fee_records_year_term  ON public.fee_records(school_id, academic_year, term_number);
CREATE INDEX IF NOT EXISTS idx_fee_records_due_date
  ON public.fee_records(due_date) WHERE status IN ('unpaid', 'partial');

DROP TRIGGER IF EXISTS update_timestamp_on_fee_records ON public.fee_records;
CREATE TRIGGER update_timestamp_on_fee_records
  BEFORE UPDATE ON public.fee_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- payments — immutable, with the submission/verification workflow
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payments (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id              UUID NOT NULL REFERENCES public.schools(id),
  fee_record_id          UUID NOT NULL REFERENCES public.fee_records(id),
  student_id             UUID NOT NULL REFERENCES public.students(id),
  -- Denormalised so payment queries need not join fee_records.

  recorded_by_user_id    TEXT NOT NULL,

  amount                 NUMERIC(12,2) NOT NULL,
  -- Positive for payments, negative for reversals. No CHECK on sign.

  currency_code          TEXT NOT NULL DEFAULT 'ZMW',

  payment_method         TEXT NOT NULL
                         CHECK (payment_method IN (
                           'cash', 'bank_deposit', 'cheque', 'online_gateway',
                           'loan_disbursement', 'reversal', 'waiver'
                         )),

  gateway_name           TEXT,
  gateway_reference      TEXT,
  gateway_transaction_id TEXT,
  bank_name              TEXT,
  cheque_number          TEXT,

  receipt_number         TEXT NOT NULL UNIQUE,
  -- REC-ZM-LSK-0001-000001. Generated by trigger in 0075.
  receipt_url            TEXT,

  notes                  TEXT,

  -- --- submission / verification workflow (SCHEMA.md) ---
  status                 TEXT NOT NULL DEFAULT 'pending_verification'
                         CHECK (status IN (
                           'pending_verification', 'verified', 'rejected', 'queried'
                         )),
  -- Only 'verified' payments count toward a balance. A submitted payment does
  -- not reduce what is owed until someone with authority confirms it.

  proof_of_payment_url   TEXT,
  confirmation_checkbox_at TIMESTAMPTZ,
  -- When the submitter affirmed the details. Replaces the removed OTP step.

  verified_by            TEXT,
  verified_at            TIMESTAMPTZ,
  rejection_reason       TEXT,

  reversal_of_payment_id UUID REFERENCES public.payments(id),
  is_voided              BOOLEAN NOT NULL DEFAULT FALSE,
  webhook_verified       BOOLEAN NOT NULL DEFAULT FALSE,

  paid_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A rejection without a reason is not reviewable.
  CONSTRAINT payment_rejection_needs_reason CHECK (
    status <> 'rejected' OR rejection_reason IS NOT NULL
  ),
  -- A verified payment must record who verified it and when. This is the audit
  -- trail for money; "verified by nobody at no time" is not a valid state.
  CONSTRAINT payment_verification_is_attributed CHECK (
    status <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)
  ),
  CONSTRAINT payment_reversal_references_original CHECK (
    payment_method <> 'reversal' OR reversal_of_payment_id IS NOT NULL
  )
);

COMMENT ON TABLE public.payments IS
  'Immutable payment events. Corrections are reversal rows, never edits. Only status=verified counts toward fee_records.amount_paid.';

CREATE INDEX IF NOT EXISTS idx_payments_school       ON public.payments(school_id);
CREATE INDEX IF NOT EXISTS idx_payments_fee_record   ON public.payments(fee_record_id);
CREATE INDEX IF NOT EXISTS idx_payments_student      ON public.payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_receipt      ON public.payments(receipt_number);
CREATE INDEX IF NOT EXISTS idx_payments_paid_at      ON public.payments(school_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_payments_gateway_ref
  ON public.payments(gateway_reference) WHERE gateway_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_pending
  ON public.payments(school_id, status) WHERE status = 'pending_verification';

-- ---------------------------------------------------------------------------
-- payment_gateways — per-school gateway configuration
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.payment_gateways (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id            UUID NOT NULL REFERENCES public.schools(id),

  gateway_name         TEXT NOT NULL
                       CHECK (gateway_name IN (
                         'flutterwave', 'pawapay', 'dpo', 'pesapal',
                         'airtel_money', 'mtn_momo', 'zanaco_zpay', 'other'
                       )),

  display_name         TEXT NOT NULL,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  is_primary           BOOLEAN NOT NULL DEFAULT FALSE,

  api_key_encrypted    TEXT,
  api_secret_encrypted TEXT,
  webhook_secret       TEXT,
  -- Encrypted or hashed at the application layer. Never returned by any API
  -- response — the routes select an explicit column list, never `*`.

  merchant_id          TEXT,
  gateway_config       JSONB NOT NULL DEFAULT '{}'::JSONB,
  supported_currencies TEXT[] NOT NULL DEFAULT ARRAY['ZMW'],
  test_mode            BOOLEAN NOT NULL DEFAULT FALSE,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, gateway_name)
);

CREATE INDEX IF NOT EXISTS idx_gateways_school ON public.payment_gateways(school_id);
CREATE INDEX IF NOT EXISTS idx_gateways_active ON public.payment_gateways(school_id, is_active);

DROP TRIGGER IF EXISTS update_timestamp_on_payment_gateways ON public.payment_gateways;
CREATE TRIGGER update_timestamp_on_payment_gateways
  BEFORE UPDATE ON public.payment_gateways
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges and RLS enablement (policies land in 0071)
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.fee_structures    FROM anon;
REVOKE ALL ON public.fee_records       FROM anon;
REVOKE ALL ON public.payments          FROM anon;
REVOKE ALL ON public.payment_gateways  FROM anon;

GRANT SELECT, INSERT, UPDATE ON public.fee_structures   TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.fee_records      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.payment_gateways TO authenticated;
-- payments is INSERT + SELECT only. There is no UPDATE privilege for end users
-- at all: corrections are reversal rows. Verification is the one exception and
-- runs through a SECURITY DEFINER function in 0075, not a direct UPDATE.
GRANT SELECT, INSERT ON public.payments TO authenticated;

REVOKE DELETE, TRUNCATE ON public.fee_structures   FROM authenticated, anon;
REVOKE DELETE, TRUNCATE ON public.fee_records      FROM authenticated, anon;
REVOKE DELETE, TRUNCATE ON public.payments         FROM authenticated, anon;
REVOKE DELETE, TRUNCATE ON public.payment_gateways FROM authenticated, anon;

ALTER TABLE public.fee_structures   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_structures   FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.fee_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_records      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments         FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.payment_gateways ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_gateways FORCE  ROW LEVEL SECURITY;

-- === MIGRATION END ===
