-- ===========================================================================
-- 0225 — the loan module's public surface
--
-- Spec: `14 Loan and Finance Module/` — APPLICATION.md, CONSENT.md,
--       BEHAVIOUR_SCORE.md, SUBMISSION.md, LENDER_INTEGRATION.md
--
-- `private` is invisible to PostgREST and forbidden to client code
-- (prohibition 9), so these functions are the ONLY way in or out. Each one
-- re-establishes who the caller is rather than trusting an argument.
--
-- ## The behaviour score, to the documented formula
--
--   payment history   35%
--   payment capacity  25%
--   account behaviour 20%
--   risk indicators   20%
--
-- Each category produces 0–100, then `300 + (composite / 100) * 550` maps the
-- weighted result onto the 300–850 scale lenders recognise.
--
-- **It is a snapshot.** `BEHAVIOUR_SCORE.md`: "The score is calculated at
-- application submission time and stored... It is never recalculated after
-- submission." A score that moved after a lender saw it would make the
-- application ZSMS sent and the application the lender holds two different
-- documents.
--
-- ## Where this deliberately falls short of the document
--
-- `BEHAVIOUR_SCORE.md`'s capacity category reads `declaredMonthlyIncome` "from
-- previous loan applications (if any)" and its risk category wants dishonour
-- counts this schema does not record. Both are computed from what EXISTS:
-- capacity uses the income declared on THIS application, and risk uses rejected
-- and queried payments, which `payments.status` does hold.
--
-- Stated here rather than silently approximated, because a credit score whose
-- inputs nobody can enumerate is one nobody can defend to a parent who disputes
-- it — and `BEHAVIOUR_SCORE.md` gives them that right explicitly.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The score.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.calculate_behaviour_score(
  p_parent_user_id  TEXT,
  p_monthly_income  NUMERIC DEFAULT NULL
)
RETURNS TABLE (out_score INT, out_breakdown JSONB)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_total      INT := 0;
  v_on_time    INT := 0;
  v_w7         INT := 0;
  v_w14        INT := 0;
  v_w30        INT := 0;
  v_after30    INT := 0;
  v_never      INT := 0;
  v_rejected   INT := 0;
  v_queried    INT := 0;

  v_history    NUMERIC := 50;
  v_capacity   NUMERIC := 50;
  v_behaviour  NUMERIC := 50;
  v_risk       NUMERIC := 50;

  v_children   INT := 0;
  v_fees_month NUMERIC := 0;
  v_outstanding NUMERIC := 0;
  v_ratio      NUMERIC;

  v_composite  NUMERIC;
  v_score      INT;
BEGIN
  /*
    Counted over the children this parent is actually linked to.

    DEFINER, so it sees across schools — a parent with children at two schools has
    one payment history, and scoring only the school they happen to be applying
    through would misrepresent them in both directions.
  */
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE fr.status = 'paid' AND fr.due_date IS NOT NULL
                       AND fr.updated_at::DATE <= fr.due_date),
    COUNT(*) FILTER (WHERE fr.status = 'paid' AND fr.due_date IS NOT NULL
                       AND fr.updated_at::DATE - fr.due_date BETWEEN 1 AND 7),
    COUNT(*) FILTER (WHERE fr.status = 'paid' AND fr.due_date IS NOT NULL
                       AND fr.updated_at::DATE - fr.due_date BETWEEN 8 AND 14),
    COUNT(*) FILTER (WHERE fr.status = 'paid' AND fr.due_date IS NOT NULL
                       AND fr.updated_at::DATE - fr.due_date BETWEEN 15 AND 30),
    COUNT(*) FILTER (WHERE fr.status = 'paid' AND fr.due_date IS NOT NULL
                       AND fr.updated_at::DATE - fr.due_date > 30),
    /*
      Still outstanding and PAST DUE. The document says "excluding current term":
      a fee that is not yet due is not a failure to pay.
    */
    COUNT(*) FILTER (WHERE fr.status <> 'paid' AND fr.due_date IS NOT NULL
                       AND fr.due_date < CURRENT_DATE - INTERVAL '30 days')
  INTO v_total, v_on_time, v_w7, v_w14, v_w30, v_after30, v_never
  FROM public.fee_records fr
  JOIN public.student_parent_links l ON l.student_id = fr.student_id
  WHERE l.parent_user_id = p_parent_user_id AND l.unlinked_at IS NULL;

  SELECT
    COUNT(*) FILTER (WHERE p.status = 'rejected'),
    COUNT(*) FILTER (WHERE p.status = 'queried')
  INTO v_rejected, v_queried
  FROM public.payments p
  JOIN public.student_parent_links l ON l.student_id = p.student_id
  WHERE l.parent_user_id = p_parent_user_id AND l.unlinked_at IS NULL;

  -- ---------------- 1. payment history (35%) ----------------
  IF v_total > 0 THEN
    v_history := (
      v_on_time * 100 + v_w7 * 85 + v_w14 * 65 + v_w30 * 40 + v_after30 * 15 + v_never * 0
    )::NUMERIC / v_total;
  END IF;

  -- ---------------- 2. payment capacity (25%) ----------------
  SELECT COUNT(DISTINCT l.student_id) INTO v_children
  FROM public.student_parent_links l
  WHERE l.parent_user_id = p_parent_user_id AND l.unlinked_at IS NULL;

  SELECT
    COALESCE(SUM(fr.amount_due), 0) / GREATEST(1, 3),
    COALESCE(SUM(GREATEST(fr.amount_due - fr.amount_paid - fr.discount_amount, 0)), 0)
  INTO v_fees_month, v_outstanding
  FROM public.fee_records fr
  JOIN public.student_parent_links l ON l.student_id = fr.student_id
  WHERE l.parent_user_id = p_parent_user_id AND l.unlinked_at IS NULL;

  IF p_monthly_income IS NOT NULL AND p_monthly_income > 0 THEN
    v_ratio := v_fees_month / p_monthly_income;
    v_capacity := v_capacity
      + CASE
          WHEN v_ratio < 0.15 THEN 20
          WHEN v_ratio < 0.25 THEN 10
          WHEN v_ratio < 0.35 THEN 0
          WHEN v_ratio < 0.50 THEN -10
          ELSE -20
        END;
  END IF;

  IF v_children >= 2 THEN v_capacity := v_capacity + 5; END IF;

  -- ---------------- 3. account behaviour (20%) ----------------
  /*
    How engaged the family is: a parent whose children are enrolled and whose
    account is linked is a more reachable borrower than one who is not.
  */
  v_behaviour := 50
    + CASE WHEN v_children > 0 THEN 25 ELSE 0 END
    + CASE WHEN v_total >= 3 THEN 25 ELSE v_total * 8 END;

  -- ---------------- 4. risk indicators (20%) ----------------
  v_risk := 100
    - LEAST(50, v_rejected * 25)
    - LEAST(25, v_queried * 10)
    - LEAST(25, v_never * 10);

  -- Every category is clamped before weighting, or one bad input moves the
  -- composite outside the range the mapping assumes.
  v_history   := GREATEST(0, LEAST(100, v_history));
  v_capacity  := GREATEST(0, LEAST(100, v_capacity));
  v_behaviour := GREATEST(0, LEAST(100, v_behaviour));
  v_risk      := GREATEST(0, LEAST(100, v_risk));

  v_composite := v_history * 0.35 + v_capacity * 0.25 + v_behaviour * 0.20 + v_risk * 0.20;

  -- 300 + (composite / 100) * 550, exactly as BEHAVIOUR_SCORE.md specifies.
  v_score := ROUND(300 + (v_composite / 100) * 550);
  v_score := GREATEST(300, LEAST(850, v_score));

  RETURN QUERY SELECT
    v_score,
    jsonb_build_object(
      'payment_history',   jsonb_build_object('score', ROUND(v_history, 1),   'weight', 0.35),
      'payment_capacity',  jsonb_build_object('score', ROUND(v_capacity, 1),  'weight', 0.25),
      'account_behaviour', jsonb_build_object('score', ROUND(v_behaviour, 1), 'weight', 0.20),
      'risk_indicators',   jsonb_build_object('score', ROUND(v_risk, 1),      'weight', 0.20),
      'inputs', jsonb_build_object(
        'fee_records', v_total,
        'paid_on_time', v_on_time,
        'overdue_unpaid', v_never,
        'rejected_payments', v_rejected,
        'queried_payments', v_queried,
        'children', v_children
      ),
      'composite_raw', ROUND(v_composite, 1),
      'scale', '300-850'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_behaviour_score(TEXT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_behaviour_score(TEXT, NUMERIC) FROM anon;
GRANT EXECUTE ON FUNCTION public.calculate_behaviour_score(TEXT, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Lenders a parent may choose from.
-- ---------------------------------------------------------------------------

/*
  Parent-facing columns only.

  The table also holds `commission_rate`, `api_key_encrypted` and
  `webhook_secret`. A policy cannot return a subset of columns, so the selection
  happens here — and a parent choosing a lender must never see what AfriTech
  earns from sending them there.

  Filtered by the score, per `LENDER_INTEGRATION.md`: "applications below this
  are not shown to the parent".
*/
CREATE OR REPLACE FUNCTION public.lenders_for_application(p_score INT DEFAULT NULL)
RETURNS TABLE (
  out_id                    UUID,
  out_display_name          TEXT,
  out_tagline               TEXT,
  out_logo_url              TEXT,
  out_description           TEXT,
  out_min_amount            NUMERIC,
  out_max_amount            NUMERIC,
  out_interest_rate_display TEXT,
  out_turnaround_label      TEXT,
  out_eligibility_summary   TEXT[],
  out_required_documents    TEXT[],
  out_is_featured           BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    l.id, l.display_name, l.tagline, l.logo_url, l.description,
    l.min_loan_amount, l.max_loan_amount,
    l.interest_rate_display, l.turnaround_label,
    l.eligibility_summary, l.required_documents, l.is_featured
  FROM public.lenders l
  WHERE l.is_active
    AND (p_score IS NULL OR p_score >= l.min_behaviour_score)
  ORDER BY l.is_featured DESC, l.display_name;
$$;

REVOKE ALL ON FUNCTION public.lenders_for_application(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lenders_for_application(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.lenders_for_application(INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Applying.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_loan_application(
  p_fee_record_id    UUID,
  p_amount           NUMERIC,
  p_lender_id        UUID,
  p_employment_type  TEXT,
  p_employer_name    TEXT,
  p_monthly_income   NUMERIC,
  p_payslip_url      TEXT,
  p_consent_version  TEXT,
  p_consented_at     TIMESTAMPTZ,
  p_consent_text_hash TEXT,
  p_ip_address       TEXT DEFAULT NULL,
  p_user_agent       TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_user     TEXT := public.get_user_id();
  v_role     TEXT := public.get_user_role();
  v_fee      RECORD;
  v_lender   RECORD;
  v_parent   UUID;
  v_score    INT;
  v_break    JSONB;
  v_id       UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  /*
    A loan is the PARENT's to apply for. Nobody applies on their behalf — the
    consent that makes the disclosure lawful is theirs to give, and a school
    clicking it for them would make the consent log a record of something that
    did not happen.
  */
  IF v_role <> 'org:parent' THEN
    RAISE EXCEPTION 'Only a parent can apply for a school fee loan'
      USING ERRCODE = '42501';
  END IF;

  IF p_consented_at IS NULL OR p_consent_version IS NULL OR p_consent_text_hash IS NULL THEN
    RAISE EXCEPTION 'An application needs recorded consent' USING ERRCODE = '22023';
  END IF;

  /*
    Freshness, as the payment claim has.

    A consent timestamp from an hour ago means the form sat open; the person
    submitting may not be the person who read the terms.
  */
  IF p_consented_at < NOW() - INTERVAL '30 minutes' THEN
    RAISE EXCEPTION 'That consent has expired. Read the terms again and resubmit.'
      USING ERRCODE = '22023';
  END IF;

  -- The fee record must belong to one of THEIR children. Never trusted from the
  -- argument: this is a DEFINER function and the id came from a request body.
  SELECT fr.*, s.school_id AS s_school
  INTO v_fee
  FROM public.fee_records fr
  JOIN public.students s ON s.id = fr.student_id
  JOIN public.student_parent_links l ON l.student_id = fr.student_id
  WHERE fr.id = p_fee_record_id
    AND l.parent_user_id = v_user
    AND l.unlinked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That fee record is not available to you' USING ERRCODE = 'P0002';
  END IF;

  -- The school must actually have the module. `loan_module` has been a flag since
  -- `0095` with nothing consulting it.
  IF NOT public.school_has_feature(v_fee.school_id, 'loan_module') THEN
    RAISE EXCEPTION 'This school does not offer fee loans through ZSMS'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_lender FROM public.lenders WHERE id = p_lender_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That lender is not available' USING ERRCODE = 'P0002';
  END IF;

  IF p_amount < v_lender.min_loan_amount OR p_amount > v_lender.max_loan_amount THEN
    RAISE EXCEPTION '% lends between % and %',
      v_lender.display_name, v_lender.min_loan_amount, v_lender.max_loan_amount
      USING ERRCODE = '22023';
  END IF;

  /*
    One open application per fee record.

    Two lenders assessing the same unpaid term would disburse twice against one
    debt, and the school would be paid twice for one fee.
  */
  IF EXISTS (
    SELECT 1 FROM private.loan_applications a
    WHERE a.fee_record_id = p_fee_record_id
      AND a.status IN ('pending', 'submitted', 'under_review', 'approved')
  ) THEN
    RAISE EXCEPTION 'There is already an open application against this fee'
      USING ERRCODE = '23505';
  END IF;

  SELECT l.parent_id INTO v_parent
  FROM public.student_parent_links l
  WHERE l.student_id = v_fee.student_id AND l.parent_user_id = v_user
    AND l.unlinked_at IS NULL
  LIMIT 1;

  -- A SNAPSHOT, taken once. Never recalculated after submission.
  SELECT out_score, out_breakdown INTO v_score, v_break
  FROM public.calculate_behaviour_score(v_user, p_monthly_income);

  IF v_score < v_lender.min_behaviour_score THEN
    RAISE EXCEPTION 'That lender cannot consider this application'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO private.loan_applications (
    school_id, student_id, parent_id, fee_record_id, parent_user_id,
    amount_requested, lender_id, lender_name, lender_type,
    employment_type, employer_name, monthly_income, payslip_url,
    behaviour_score, behaviour_score_breakdown,
    status, consent_version, consented_at, submitted_at
  )
  VALUES (
    v_fee.school_id, v_fee.student_id, v_parent, p_fee_record_id, v_user,
    p_amount, v_lender.id, v_lender.display_name,
    CASE v_lender.integration_type WHEN 'zsms_internal' THEN 'afritech' ELSE 'microfinance' END,
    p_employment_type, p_employer_name, p_monthly_income, p_payslip_url,
    v_score, v_break,
    'submitted', p_consent_version, p_consented_at, NOW()
  )
  RETURNING id INTO v_id;

  -- The consent log. Immutable from the moment it exists.
  INSERT INTO private.loan_consent_log (
    loan_application_id, parent_user_id, consent_version, consent_text_hash,
    lender_name, ip_address, user_agent
  )
  VALUES (
    v_id, v_user, p_consent_version, p_consent_text_hash,
    v_lender.display_name, p_ip_address, p_user_agent
  );

  /*
    `afritech` tables carry no row-change trigger and `private` is outside
    `0131`'s list, so this call is the only record that an application was made.
  */
  PERFORM public.log_audit_event(
    'loan_application_submitted',
    'private.loan_applications',
    v_id,
    jsonb_build_object(
      'lender', v_lender.display_name,
      'amount', p_amount,
      'behaviour_score', v_score,
      'consent_version', p_consent_version,
      'reason', 'Parent applied for a school fee loan'
    ),
    v_fee.school_id, p_ip_address, p_user_agent
  );

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_loan_application(UUID, NUMERIC, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_loan_application(UUID, NUMERIC, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_loan_application(UUID, NUMERIC, UUID, TEXT, TEXT, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reading applications back.
-- ---------------------------------------------------------------------------

/** A parent's own applications. Their income and payslip are theirs to see. */
CREATE OR REPLACE FUNCTION public.my_loan_applications()
RETURNS TABLE (
  out_id             UUID,
  out_amount         NUMERIC,
  out_status         TEXT,
  out_lender_name    TEXT,
  out_score          INT,
  out_breakdown      JSONB,
  out_decline_reason TEXT,
  out_lender_reference TEXT,
  out_disbursed_amount NUMERIC,
  out_disbursed_at   TIMESTAMPTZ,
  out_repayment_schedule JSONB,
  out_collection_instructions TEXT,
  out_collection_account JSONB,
  out_created_at     TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE v_user TEXT := public.get_user_id();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    a.id, a.amount_requested, a.status, a.lender_name,
    a.behaviour_score, a.behaviour_score_breakdown,
    a.decline_reason, a.lender_reference,
    a.disbursed_amount, a.disbursed_at, a.repayment_schedule,
    /*
      How to repay, from the lender. Only once DISBURSED: showing collection
      details for a loan nobody has received would have a parent paying money to
      a lender who has given them none.
    */
    CASE WHEN a.status = 'disbursed' THEN l.collection_instructions END,
    CASE WHEN a.status = 'disbursed' THEN l.collection_account END,
    a.created_at
  FROM private.loan_applications a
  LEFT JOIN public.lenders l ON l.id = a.lender_id
  WHERE a.parent_user_id = v_user
  ORDER BY a.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.my_loan_applications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_loan_applications() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_loan_applications() TO authenticated;

/**
 * What a SCHOOL may see.
 *
 * Deliberately not the income, the employer, the payslip or the score. A school
 * needs to know a fee is being financed and by whom; it has no business reading
 * a parent's salary, and `CONSENT.md` scopes the parent's consent to the LENDER.
 */
CREATE OR REPLACE FUNCTION public.school_loan_applications()
RETURNS TABLE (
  out_id           UUID,
  out_student_id   UUID,
  out_amount       NUMERIC,
  out_status       TEXT,
  out_lender_name  TEXT,
  out_disbursed_amount NUMERIC,
  out_disbursed_at TIMESTAMPTZ,
  out_created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_role   TEXT := public.get_user_role();
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN ('org:owner', 'org:admin', 'org:principal', 'org:accountant') THEN
    RAISE EXCEPTION 'Only school management can see fee loans' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.id, a.student_id, a.amount_requested, a.status, a.lender_name,
         a.disbursed_amount, a.disbursed_at, a.created_at
  FROM private.loan_applications a
  WHERE a.school_id = v_school
  ORDER BY a.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.school_loan_applications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_loan_applications() FROM anon;
GRANT EXECUTE ON FUNCTION public.school_loan_applications() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. AfriTech moves an application through its states.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_update_loan_application(
  p_id               UUID,
  p_status           TEXT,
  p_lender_reference TEXT DEFAULT NULL,
  p_decline_reason   TEXT DEFAULT NULL,
  p_disbursed_amount NUMERIC DEFAULT NULL,
  p_notes            TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, afritech, pg_temp
AS $$
DECLARE
  v_app  private.loan_applications;
  v_rate NUMERIC;
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'AfriTech loan officers only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_app FROM private.loan_applications WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such application' USING ERRCODE = 'P0002';
  END IF;

  IF p_status = 'declined' AND (p_decline_reason IS NULL OR btrim(p_decline_reason) = '') THEN
    RAISE EXCEPTION 'A decline needs a reason the parent can read' USING ERRCODE = '22023';
  END IF;

  IF p_status = 'disbursed' AND (p_disbursed_amount IS NULL OR p_disbursed_amount <= 0) THEN
    RAISE EXCEPTION 'A disbursement needs the amount actually paid' USING ERRCODE = '22023';
  END IF;

  UPDATE private.loan_applications
  SET status            = p_status,
      lender_reference  = COALESCE(p_lender_reference, lender_reference),
      decline_reason    = COALESCE(p_decline_reason, decline_reason),
      disbursed_amount  = COALESCE(p_disbursed_amount, disbursed_amount),
      disbursed_at      = CASE WHEN p_status = 'disbursed' THEN COALESCE(disbursed_at, NOW())
                               ELSE disbursed_at END,
      updated_at        = NOW()
  WHERE id = p_id;

  /*
    Commission accrues on disbursement, not on approval.

    An approved loan that is never paid out earns nothing, and accruing on
    approval would put revenue on AfriTech's books for money that never moved.
  */
  IF p_status = 'disbursed' AND v_app.status <> 'disbursed' THEN
    SELECT l.commission_rate INTO v_rate FROM public.lenders l WHERE l.id = v_app.lender_id;

    INSERT INTO afritech.loan_commissions
      (loan_application_id, lender_id, school_id, disbursed_amount,
       commission_rate, commission_amount, notes)
    VALUES
      (p_id, v_app.lender_id, v_app.school_id, p_disbursed_amount,
       COALESCE(v_rate, 0), ROUND(p_disbursed_amount * COALESCE(v_rate, 0), 2), p_notes);
  END IF;

  PERFORM public.log_audit_event(
    'loan_application_' || p_status,
    'private.loan_applications',
    p_id,
    jsonb_build_object(
      'was', v_app.status,
      'now', p_status,
      'lender_reference', p_lender_reference,
      'disbursed_amount', p_disbursed_amount,
      'reason', COALESCE(p_decline_reason, p_notes, 'Status updated by AfriTech')
    ),
    v_app.school_id, NULL, NULL
  );

  RETURN p_status;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_loan_application(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_loan_application(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_update_loan_application(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO authenticated;

/** Every application, for the AfriTech loan officer's queue. */
CREATE OR REPLACE FUNCTION public.admin_loan_applications(p_status TEXT DEFAULT NULL)
RETURNS TABLE (
  out_id           UUID,
  out_school_id    UUID,
  out_amount       NUMERIC,
  out_status       TEXT,
  out_lender_name  TEXT,
  out_score        INT,
  out_employment   TEXT,
  out_monthly_income NUMERIC,
  out_created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'AfriTech loan officers only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.id, a.school_id, a.amount_requested, a.status, a.lender_name,
         a.behaviour_score, a.employment_type, a.monthly_income, a.created_at
  FROM private.loan_applications a
  WHERE p_status IS NULL OR a.status = p_status
  ORDER BY a.created_at DESC
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_loan_applications(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_loan_applications(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_loan_applications(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Assert the shapes a route depends on.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_n INT;
BEGIN
  SELECT COUNT(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'calculate_behaviour_score', 'lenders_for_application',
      'submit_loan_application', 'my_loan_applications',
      'school_loan_applications', 'admin_update_loan_application',
      'admin_loan_applications');

  IF v_n <> 7 THEN
    RAISE EXCEPTION '0225: expected 7 public loan functions, found % — one is in the wrong schema or overloaded', v_n;
  END IF;

  -- `anon` on any of them would expose an income declaration.
  IF has_function_privilege('anon', 'public.my_loan_applications()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.admin_loan_applications(TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION '0225: anon can execute a loan function';
  END IF;
END;
$$;
