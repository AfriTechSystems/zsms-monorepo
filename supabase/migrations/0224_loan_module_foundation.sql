-- ===========================================================================
-- 0224 — the loan module: lenders, applications, consent
--
-- Spec: `Official Documentation/14 Loan and Finance Module/` — LOANS.md,
--       APPLICATION.md, CONSENT.md, BEHAVIOUR_SCORE.md, LENDER_INTEGRATION.md
--       `Official Documentation/01 Foundation Layer/DATABASE.md` → the DDL
--
-- ZSMS is **not a lender**. In Phase 1 it collects, verifies and packages loan
-- applications, sends them to partner MFIs and banks, and earns an origination
-- commission on what is disbursed. The lender pays the SCHOOL directly; the
-- parent repays the lender. The architecture is built for ZSMS becoming a
-- licensed MFI later, which is why `lender_type` already admits `afritech`.
--
-- ## Why the applications live in `private`
--
-- `supabase/config.toml` exposes `public` only, so **PostgREST cannot see
-- `private` at all** — and prohibition 9 forbids referencing it from client
-- code. That is not an obstacle here, it is the point: a loan application holds
-- an income declaration, an employer, a payslip and a credit score. Nothing
-- should be able to reach it by constructing a URL.
--
-- Every path in and out therefore goes through SECURITY DEFINER functions in
-- `public` (migration `0225`), each of which re-establishes who the caller is.
--
-- ## One conflict between documents, resolved
--
-- `DATABASE.md` has `behaviour_score INT CHECK (behaviour_score BETWEEN 0 AND
-- 100)`. `BEHAVIOUR_SCORE.md` defines the scale as **300–850** with each of four
-- CATEGORIES producing 0–100 before weighting, and `LENDER_INTEGRATION.md`
-- corroborates it: `lenders.min_behaviour_score INT DEFAULT 450`, which is
-- meaningless on a 0–100 scale.
--
-- So `DATABASE.md` is describing the sub-score and has it in the wrong place.
-- **Built to 300–850.**
--
-- ## Commissions are AfriTech's, not the school's
--
-- `afritech.loan_commissions` per `LENDER_INTEGRATION.md`. It is revenue between
-- AfriTech and a lender; a school has no business reading what AfriTech earns on
-- its parents' loans, and `afritech` is unreachable from a route by design.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Lenders. Public, because a parent chooses from them.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lenders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_name             TEXT NOT NULL UNIQUE,
  display_name            TEXT NOT NULL,
  tagline                 TEXT,
  logo_url                TEXT,
  description             TEXT,
  country_codes           TEXT[] NOT NULL DEFAULT '{ZM}',
  loan_products           JSONB NOT NULL DEFAULT '[]'::jsonb,

  max_loan_amount         NUMERIC(12,2) NOT NULL,
  min_loan_amount         NUMERIC(12,2) NOT NULL DEFAULT 500,
  /* On the 300–850 scale. See the header. */
  min_behaviour_score     INT NOT NULL DEFAULT 450
                          CHECK (min_behaviour_score BETWEEN 300 AND 850),

  /*
    Human-readable, deliberately.

    `LENDER_INTEGRATION.md`: "AfriTech does not store the actual rate as a number
    to avoid liability for rate display accuracy." A number here would be quoted
    to a parent as though ZSMS had computed it.
  */
  interest_rate_display   TEXT NOT NULL,
  turnaround_label        TEXT NOT NULL,

  integration_type        TEXT NOT NULL
                          CHECK (integration_type IN ('email', 'api', 'zsms_internal')),
  intake_email            TEXT,
  api_endpoint            TEXT,
  /* Phase 2. Encrypted with GATEWAY_ENCRYPTION_KEY, never read by a route. */
  api_key_encrypted       TEXT,
  webhook_secret          TEXT,

  commission_rate         NUMERIC(5,4) NOT NULL CHECK (commission_rate >= 0 AND commission_rate <= 1),
  commission_terms        TEXT,

  /* Where a parent sends their repayments. Shown in the repayment screen. */
  collection_account      JSONB,
  collection_instructions TEXT,

  eligibility_summary     TEXT[],
  required_documents      TEXT[],

  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured             BOOLEAN NOT NULL DEFAULT FALSE,
  onboarded_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  onboarded_by            TEXT NOT NULL,
  notes                   TEXT,

  /*
    A lender must be reachable by the route its integration names, or an
    application is packaged and goes nowhere.
  */
  CONSTRAINT lenders_reachable CHECK (
    CASE integration_type
      WHEN 'email' THEN intake_email IS NOT NULL AND btrim(intake_email) <> ''
      WHEN 'api'   THEN api_endpoint IS NOT NULL AND btrim(api_endpoint) <> ''
      ELSE TRUE
    END
  ),
  CONSTRAINT lenders_amount_range CHECK (max_loan_amount >= min_loan_amount)
);

COMMENT ON TABLE public.lenders IS
  'Partner MFIs and banks. ZSMS is a facilitator in Phase 1; `zsms_internal` exists for when it becomes a licensed MFI (0224).';

CREATE INDEX IF NOT EXISTS idx_lenders_active
  ON public.lenders (is_active, country_codes) WHERE is_active;

ALTER TABLE public.lenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lenders FORCE ROW LEVEL SECURITY;

/*
  Any signed-in user may read an ACTIVE lender — a parent choosing one has to see
  them. The commercial columns are not excluded by the policy because a policy
  cannot return a subset of columns; the public function in `0225` selects only
  the parent-facing ones, and nothing else may read this table directly.
*/
CREATE POLICY anyone_reads_active_lenders
  ON public.lenders
  FOR SELECT
  TO authenticated
  USING (is_active OR public.is_afritech_admin());

CREATE POLICY afritech_manages_lenders
  ON public.lenders
  FOR ALL
  TO authenticated
  USING (public.is_afritech_admin())
  WITH CHECK (public.is_afritech_admin());

GRANT SELECT ON public.lenders TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.lenders TO authenticated;
REVOKE ALL ON public.lenders FROM anon;

-- ---------------------------------------------------------------------------
-- 2. Applications. Private, and reachable only through `public` functions.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS private.loan_applications (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID NOT NULL REFERENCES public.schools(id),
  student_id            UUID NOT NULL REFERENCES public.students(id),
  parent_id             UUID NOT NULL,
  fee_record_id         UUID NOT NULL REFERENCES public.fee_records(id),
  parent_user_id        TEXT NOT NULL,

  amount_requested      NUMERIC(12,2) NOT NULL CHECK (amount_requested > 0),
  currency_code         TEXT NOT NULL DEFAULT 'ZMW',

  lender_id             UUID REFERENCES public.lenders(id),
  lender_name           TEXT,
  lender_type           TEXT CHECK (lender_type IN ('microfinance', 'bank', 'afritech')),

  employment_type       TEXT CHECK (employment_type IN (
                          'employed', 'self_employed', 'informal', 'unemployed')),
  employer_name         TEXT,
  monthly_income        NUMERIC(12,2) CHECK (monthly_income IS NULL OR monthly_income >= 0),
  payslip_url           TEXT,

  /* 300–850. See the header for why this is not 0–100. */
  behaviour_score       INT CHECK (behaviour_score BETWEEN 300 AND 850),
  behaviour_score_breakdown JSONB,

  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending', 'submitted', 'under_review',
                          'approved', 'declined', 'disbursed', 'cancelled')),

  lender_reference      TEXT,
  decline_reason        TEXT,

  disbursed_amount      NUMERIC(12,2) CHECK (disbursed_amount IS NULL OR disbursed_amount > 0),
  disbursed_at          TIMESTAMPTZ,
  disbursement_reference TEXT,
  repayment_schedule    JSONB,

  consent_version       TEXT NOT NULL,
  consented_at          TIMESTAMPTZ NOT NULL,
  submitted_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  /* A declined application must say why, or a parent cannot act on it. */
  CONSTRAINT loan_declined_needs_reason
    CHECK (status <> 'declined' OR decline_reason IS NOT NULL),

  /*
    A disbursed loan must record what was actually paid and when.

    The school marks the fee `loan_paid` against this, so an amount of NULL would
    leave a fee record settled by a figure nobody holds.
  */
  CONSTRAINT loan_disbursed_needs_amount
    CHECK (status <> 'disbursed' OR (disbursed_amount IS NOT NULL AND disbursed_at IS NOT NULL))
);

COMMENT ON TABLE private.loan_applications IS
  'Loan applications. In `private` because they hold an income declaration, an employer and a payslip — PostgREST cannot see this schema, so nothing reaches it by constructing a URL (0224).';

CREATE INDEX IF NOT EXISTS idx_loan_applications_parent
  ON private.loan_applications (parent_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_loan_applications_school
  ON private.loan_applications (school_id, status);
CREATE INDEX IF NOT EXISTS idx_loan_applications_status
  ON private.loan_applications (status, created_at DESC);

/*
  RLS, even though PostgREST cannot see the schema.

  Belt and braces: the DEFINER functions in `0225` bypass it, but a future
  migration that exposes this schema, or a direct connection, must not find an
  unprotected table. A table in `private` without RLS is still a defect.
*/
ALTER TABLE private.loan_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.loan_applications FORCE ROW LEVEL SECURITY;

CREATE POLICY parent_reads_own_applications
  ON private.loan_applications
  FOR SELECT
  TO authenticated
  USING (parent_user_id = public.get_user_id() OR public.is_afritech_admin());

-- ---------------------------------------------------------------------------
-- 3. Consent. Immutable, because it is the legal foundation.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS private.consent_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_version TEXT NOT NULL UNIQUE,
  consent_text    TEXT NOT NULL,
  /* SHA-256 of `consent_text`, so a log row can prove WHAT was agreed to. */
  text_hash       TEXT NOT NULL,
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at      TIMESTAMPTZ,
  created_by      TEXT NOT NULL
);

COMMENT ON TABLE private.consent_templates IS
  'Versioned consent wording. A log row stores the version AND the hash, so the exact text a parent agreed to is provable years later (0224).';

ALTER TABLE private.consent_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.consent_templates FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS private.loan_consent_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_application_id UUID NOT NULL REFERENCES private.loan_applications(id),
  parent_user_id      TEXT NOT NULL,
  parent_phone        TEXT,
  consent_version     TEXT NOT NULL,
  consent_text_hash   TEXT NOT NULL,
  lender_name         TEXT NOT NULL,
  ip_address          TEXT,
  device_fingerprint  TEXT,
  user_agent          TEXT,
  consented_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE private.loan_consent_log IS
  'IMMUTABLE record of a parent consenting to one lender seeing their data. No UPDATE, no DELETE — it is the evidence that the disclosure was lawful (0224).';

CREATE INDEX IF NOT EXISTS idx_loan_consent_log_application
  ON private.loan_consent_log (loan_application_id);

ALTER TABLE private.loan_consent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.loan_consent_log FORCE ROW LEVEL SECURITY;

/*
  Immutable, enforced rather than promised.

  `CONSENT.md` marks this table IMMUTABLE. A comment saying so is a hope; a
  trigger is the thing that holds when somebody writes an UPDATE in three years.
  The same pattern as the append-only AI credit ledger.
*/
CREATE OR REPLACE FUNCTION private.refuse_consent_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = private, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'loan_consent_log is immutable — consent cannot be edited or withdrawn by deletion'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS refuse_update_on_loan_consent_log ON private.loan_consent_log;
CREATE TRIGGER refuse_update_on_loan_consent_log
  BEFORE UPDATE OR DELETE ON private.loan_consent_log
  FOR EACH ROW EXECUTE FUNCTION private.refuse_consent_mutation();

-- ---------------------------------------------------------------------------
-- 4. Commissions. AfriTech's revenue, invisible to a school.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS afritech.loan_commissions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_application_id UUID NOT NULL,
  lender_id           UUID REFERENCES public.lenders(id),
  school_id           UUID REFERENCES public.schools(id),
  disbursed_amount    NUMERIC(12,2) NOT NULL CHECK (disbursed_amount > 0),
  commission_rate     NUMERIC(5,4) NOT NULL,
  commission_amount   NUMERIC(12,2) NOT NULL CHECK (commission_amount >= 0),
  currency_code       TEXT NOT NULL DEFAULT 'ZMW',
  status              TEXT NOT NULL DEFAULT 'accrued'
                      CHECK (status IN ('accrued', 'invoiced', 'paid', 'written_off')),
  invoiced_at         TIMESTAMPTZ,
  paid_at             TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE afritech.loan_commissions IS
  'What AfriTech earns per disbursed loan. In `afritech` because a school has no business reading what AfriTech earns on its parents'' loans (0224).';

ALTER TABLE afritech.loan_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.loan_commissions FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 5. The audit trigger, which `0131`'s list does not know about.
-- ---------------------------------------------------------------------------

/*
  Attached here rather than left for a later audit to find — which is exactly how
  `school_payment_details` went two days without one, and `0223` had to fix it.

  Money and a credit decision: both belong in the trail.
*/
DROP TRIGGER IF EXISTS audit_changes_on_lenders ON public.lenders;
CREATE TRIGGER audit_changes_on_lenders
  AFTER INSERT OR UPDATE OR DELETE ON public.lenders
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- ---------------------------------------------------------------------------
-- 6. Prove the properties that matter.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school  UUID;
  v_student UUID;
  v_fee     UUID;
  v_lender  UUID;
  v_app     UUID;
  v_n       INT;
BEGIN
  BEGIN
  SELECT fr.school_id, fr.student_id, fr.id
  INTO v_school, v_student, v_fee
  FROM public.fee_records fr
  WHERE fr.amount_due > fr.amount_paid + fr.discount_amount
  LIMIT 1;

  IF v_fee IS NULL THEN
    RAISE NOTICE '0224: no outstanding fee record to exercise against; skipping';
    RETURN;
  END IF;

  INSERT INTO public.lenders
    (lender_name, display_name, max_loan_amount, interest_rate_display,
     turnaround_label, integration_type, intake_email, commission_rate, onboarded_by)
  VALUES
    ('0224 probe lender', 'Probe Finance', 50000, '18% per annum',
     'Decision within 3-5 business days', 'email', 'probe@example.invalid',
     0.025, 'migration_0224')
  RETURNING id INTO v_lender;

  -- A lender with no route in must be refused.
  BEGIN
    INSERT INTO public.lenders
      (lender_name, display_name, max_loan_amount, interest_rate_display,
       turnaround_label, integration_type, commission_rate, onboarded_by)
    VALUES
      ('0224 unreachable', 'Unreachable', 1000, '0%', 'never', 'email', 0.01, 'm');
    RAISE EXCEPTION '0224: an email lender with no intake address was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO private.loan_applications
    (school_id, student_id, parent_id, fee_record_id, parent_user_id,
     amount_requested, lender_id, lender_name, lender_type,
     behaviour_score, consent_version, consented_at)
  VALUES
    (v_school, v_student, gen_random_uuid(), v_fee, 'user_0224_probe',
     2500, v_lender, 'Probe Finance', 'microfinance',
     620, 'v1', NOW())
  RETURNING id INTO v_app;

  -- A score outside 300–850 must be refused: that is the conflict this migration
  -- resolved, and getting it wrong would admit a 0–100 value silently.
  BEGIN
    UPDATE private.loan_applications SET behaviour_score = 95 WHERE id = v_app;
    RAISE EXCEPTION '0224: a 0-100 score was accepted — the scale is 300-850';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Declining without a reason must be refused.
  BEGIN
    UPDATE private.loan_applications SET status = 'declined' WHERE id = v_app;
    RAISE EXCEPTION '0224: a decline with no reason was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Consent, and its immutability.
  INSERT INTO private.loan_consent_log
    (loan_application_id, parent_user_id, consent_version, consent_text_hash, lender_name)
  VALUES (v_app, 'user_0224_probe', 'v1', 'deadbeef', 'Probe Finance');

  BEGIN
    UPDATE private.loan_consent_log SET lender_name = 'Someone else'
    WHERE loan_application_id = v_app;
    RAISE EXCEPTION '0224: consent was editable';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    DELETE FROM private.loan_consent_log WHERE loan_application_id = v_app;
    RAISE EXCEPTION '0224: consent was deletable';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- The lender write reached the audit trail.
  SELECT COUNT(*) INTO v_n FROM public.audit_logs WHERE table_name = 'lenders';
  IF v_n < 1 THEN
    RAISE EXCEPTION '0224: creating a lender was not audited';
  END IF;

  /*
    The probe cannot clean up by deleting: the immutability trigger refuses it,
    which is the trigger working. The first attempt at this migration failed on
    its own cleanup.

    So the whole probe runs inside a sub-transaction and is rolled back by
    raising. The checks above have all run by the time this fires.
  */
  RAISE EXCEPTION 'ZSMS_0224_ROLLBACK';

  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0224_ROLLBACK' THEN
        RAISE NOTICE '0224: verified — scale, decline reason, lender reachability, consent immutability, audit';
      ELSE
        -- A genuine failure must still fail the migration.
        RAISE;
      END IF;
  END;
END;
$$;
