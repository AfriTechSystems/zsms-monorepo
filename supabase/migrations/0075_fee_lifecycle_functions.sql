-- Migration: 0075_fee_lifecycle_functions.sql
-- Created: 2026-08-15
-- Description: The fee lifecycle — generate records from structures, number
--              receipts, derive balances from verified payments, verify a
--              payment, and publish results.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md
--                    Official Documentation/01 Foundation Layer/CONVENTIONS.md
--
-- WHY THESE ARE DATABASE FUNCTIONS AND NOT ROUTE CODE
-- ---------------------------------------------------
-- Three of these must be atomic or they are wrong:
--
--   * Receipt numbering. Two concurrent payments computing "count + 1" produce
--     the same receipt number. The UNIQUE constraint would catch it, but as a
--     500 during a cash handover. A sequence-free approach that locks the
--     school row is correct and cheap.
--   * Balance derivation. fee_records.amount_paid must equal the sum of that
--     record's verified payments at all times. Recomputing it in a trigger means
--     it cannot drift; recomputing it in a route means it drifts the first time
--     any other path writes a payment.
--   * Verification. Flipping status to 'verified' must record who and when in
--     the same statement, or the audit trail has gaps.
--
-- SECURITY DEFINER is used deliberately and each function checks the caller's
-- role itself. They are the only route to their respective state changes, which
-- is why 0070 grants no UPDATE privilege on payments to end users at all.

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- generate_fee_records — structure -> per-student ledger lines
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_fee_records(
  p_academic_year TEXT,
  p_term_number   INT,
  p_due_date      TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (created_count INT, skipped_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_role   TEXT := public.get_user_role();
  v_created INT := 0;
  v_skipped INT := 0;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'No school in session' USING ERRCODE = '42501';
  END IF;

  IF NOT (v_role IN ('org:owner', 'org:accountant')
          OR public.has_permission_grant('fees', 'write')) THEN
    RAISE EXCEPTION 'Only the owner or accountant may generate fee records'
      USING ERRCODE = '42501';
  END IF;

  WITH matched AS (
    SELECT
      s.id            AS student_id,
      fs.id           AS fee_structure_id,
      fs.fee_label,
      fs.amount,
      fs.currency_code
    FROM public.students s
    JOIN public.fee_structures fs
      ON  fs.school_id     = s.school_id
      AND fs.academic_year = p_academic_year
      AND fs.term_number   = p_term_number
      AND fs.is_active     = TRUE
      -- 'ALL' applies to every grade; otherwise the grade must match.
      AND (fs.grade_id = 'ALL' OR fs.grade_id = s.grade_id)
      -- Boarding and day students can be charged differently.
      AND (
        fs.student_type = 'all'
        OR (fs.student_type = 'boarding' AND s.is_boarding = TRUE)
        OR (fs.student_type = 'day'      AND s.is_boarding = FALSE)
      )
    WHERE s.school_id  = v_school
      AND s.is_deleted = FALSE
      AND s.status     = 'active'
  ),
  inserted AS (
    INSERT INTO public.fee_records (
      school_id, student_id, fee_structure_id, academic_year, term_number,
      fee_label, amount_due, currency_code, due_date
    )
    SELECT
      v_school, m.student_id, m.fee_structure_id, p_academic_year, p_term_number,
      m.fee_label, m.amount, m.currency_code, p_due_date
    FROM matched m
    -- Idempotent: re-running a generation must never double a balance. The
    -- UNIQUE on (school, student, year, term, label) makes this exact.
    ON CONFLICT (school_id, student_id, academic_year, term_number, fee_label)
    DO NOTHING
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM inserted)::INT,
    (SELECT count(*) FROM matched)::INT - (SELECT count(*) FROM inserted)::INT
  INTO v_created, v_skipped;

  RETURN QUERY SELECT v_created, v_skipped;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_fee_records(TEXT, INT, TIMESTAMPTZ) TO authenticated;

-- ---------------------------------------------------------------------------
-- Receipt numbering — REC-<school code>-<6 digits>
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_receipt_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code TEXT;
  v_next BIGINT;
BEGIN
  IF NEW.receipt_number IS NOT NULL AND NEW.receipt_number <> '' THEN
    RETURN NEW;
  END IF;

  -- Lock the school row so concurrent payments serialise on it. Without this,
  -- two cashiers taking money at once compute the same sequence.
  SELECT school_id INTO v_code
  FROM public.schools
  WHERE id = NEW.school_id
  FOR UPDATE;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Unknown school % for payment', NEW.school_id;
  END IF;

  SELECT COALESCE(MAX(NULLIF(regexp_replace(p.receipt_number, '^.*-', ''), '')::BIGINT), 0) + 1
  INTO v_next
  FROM public.payments p
  WHERE p.school_id = NEW.school_id;

  NEW.receipt_number := 'REC-' || v_code || '-' || lpad(v_next::TEXT, 6, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_receipt_number_on_payments ON public.payments;
CREATE TRIGGER assign_receipt_number_on_payments
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.assign_receipt_number();

-- ---------------------------------------------------------------------------
-- Balance derivation — amount_paid and status follow VERIFIED payments only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_fee_record_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee_record UUID := COALESCE(NEW.fee_record_id, OLD.fee_record_id);
  v_paid   NUMERIC(12,2);
  v_due    NUMERIC(12,2);
  v_disc   NUMERIC(12,2);
  v_status TEXT;
BEGIN
  -- Pending, rejected, queried, and voided payments contribute nothing. A
  -- submitted payment must not reduce a balance before someone confirms it.
  SELECT COALESCE(SUM(p.amount), 0)
  INTO v_paid
  FROM public.payments p
  WHERE p.fee_record_id = v_fee_record
    AND p.status    = 'verified'
    AND p.is_voided = FALSE;

  SELECT fr.amount_due, fr.discount_amount, fr.status
  INTO v_due, v_disc, v_status
  FROM public.fee_records fr
  WHERE fr.id = v_fee_record;

  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- 'waived', 'loan_pending', and 'loan_paid' are set deliberately elsewhere and
  -- are not derivable from payment sums, so they are left alone.
  IF v_status IN ('waived', 'loan_pending', 'loan_paid') THEN
    UPDATE public.fee_records SET amount_paid = v_paid WHERE id = v_fee_record;
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.fee_records
  SET amount_paid = v_paid,
      status = CASE
                 WHEN v_paid <= 0                        THEN 'unpaid'
                 WHEN v_paid <  (v_due - v_disc)         THEN 'partial'
                 WHEN v_paid =  (v_due - v_disc)         THEN 'paid'
                 ELSE 'overpaid'
               END
  WHERE id = v_fee_record;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS recalculate_balance_on_payments ON public.payments;
CREATE TRIGGER recalculate_balance_on_payments
  AFTER INSERT OR UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.recalculate_fee_record_balance();

-- ---------------------------------------------------------------------------
-- verify_payment — the only path from pending_verification to verified
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_payment(
  p_payment_id UUID,
  p_decision   TEXT,              -- 'verified' | 'rejected' | 'queried'
  p_reason     TEXT DEFAULT NULL
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_role   TEXT := public.get_user_role();
  v_actor  TEXT := public.get_user_id();
  v_row    public.payments;
BEGIN
  IF p_decision NOT IN ('verified', 'rejected', 'queried') THEN
    RAISE EXCEPTION 'Invalid decision: %', p_decision USING ERRCODE = '22023';
  END IF;

  IF NOT (v_role IN ('org:owner', 'org:accountant')
          OR public.has_permission_grant('payments', 'write')) THEN
    RAISE EXCEPTION 'Only the owner or accountant may verify payments'
      USING ERRCODE = '42501';
  END IF;

  IF p_decision = 'rejected' AND (p_reason IS NULL OR btrim(p_reason) = '') THEN
    RAISE EXCEPTION 'A rejection requires a reason' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_row FROM public.payments WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found' USING ERRCODE = 'P0002';
  END IF;

  -- The tenant check is explicit because this function is SECURITY DEFINER and
  -- therefore bypasses the RLS that would otherwise have hidden the row.
  IF v_row.school_id IS DISTINCT FROM v_school THEN
    RAISE EXCEPTION 'Payment belongs to another school' USING ERRCODE = '42501';
  END IF;

  IF v_row.status = 'verified' THEN
    RAISE EXCEPTION 'Payment is already verified; correct it with a reversal instead'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.payments
  SET status           = p_decision,
      verified_by      = CASE WHEN p_decision = 'verified' THEN v_actor ELSE verified_by END,
      verified_at      = CASE WHEN p_decision = 'verified' THEN NOW()   ELSE verified_at END,
      rejection_reason = CASE WHEN p_decision IN ('rejected', 'queried') THEN p_reason ELSE rejection_reason END
  WHERE id = p_payment_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_payment(UUID, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- publish_results — the principal's act, and the lock that follows it
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_results(
  p_academic_year TEXT,
  p_term_number   INT,
  p_class_id      TEXT DEFAULT NULL   -- NULL publishes the whole term
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_role   TEXT := public.get_user_role();
  v_count  INT;
BEGIN
  IF v_role NOT IN ('org:owner', 'org:principal') THEN
    RAISE EXCEPTION 'Only the owner or principal may publish results'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.exam_results
  SET results_published = TRUE,
      published_at      = NOW()
  WHERE school_id       = v_school
    AND academic_year   = p_academic_year
    AND term_number     = p_term_number
    AND (p_class_id IS NULL OR class_id = p_class_id)
    AND results_published = FALSE
    -- A mark that was never entered is not a result. Publishing NULLs would
    -- lock empty rows and show blank grades on a report card.
    AND marks_obtained IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_results(TEXT, INT, TEXT) TO authenticated;

-- === MIGRATION END ===
