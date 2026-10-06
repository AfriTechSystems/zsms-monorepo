-- ===========================================================================
-- 0226 — `due_date` is TIMESTAMPTZ, not DATE
--
-- `0225`'s score computed `fr.updated_at::DATE - fr.due_date`, which is
-- `date - timestamptz` and yields an INTERVAL. Comparing that to an integer
-- raised
--
--   42883: operator does not exist: interval >= integer
--
-- on the first call, so **no behaviour score could be calculated at all** and no
-- loan application could be submitted.
--
-- The migration applied cleanly: plpgsql resolves operators at RUN time, so a
-- type error inside a function body is invisible until something calls it. That
-- is the third time in this repository a function has applied and failed on
-- first use, and the reason the skill insists on exercising rather than reading.
--
-- Both sides are cast to DATE. `date - date` is an integer number of days, which
-- is what the lateness bands are counted in.
-- ===========================================================================

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
                       AND fr.updated_at::DATE <= fr.due_date::DATE),
    COUNT(*) FILTER (WHERE fr.status = 'paid' AND fr.due_date IS NOT NULL
                       AND fr.updated_at::DATE - fr.due_date::DATE BETWEEN 1 AND 7),
    COUNT(*) FILTER (WHERE fr.status = 'paid' AND fr.due_date IS NOT NULL
                       AND fr.updated_at::DATE - fr.due_date::DATE BETWEEN 8 AND 14),
    COUNT(*) FILTER (WHERE fr.status = 'paid' AND fr.due_date IS NOT NULL
                       AND fr.updated_at::DATE - fr.due_date::DATE BETWEEN 15 AND 30),
    COUNT(*) FILTER (WHERE fr.status = 'paid' AND fr.due_date IS NOT NULL
                       AND fr.updated_at::DATE - fr.due_date::DATE > 30),
    /*
      Still outstanding and PAST DUE. The document says "excluding current term":
      a fee that is not yet due is not a failure to pay.
    */
    COUNT(*) FILTER (WHERE fr.status <> 'paid' AND fr.due_date IS NOT NULL
                       AND fr.due_date::DATE < CURRENT_DATE - 30)
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

