-- ---------------------------------------------------------------------------
-- 0164 — quoting, buying, assigning and spending school credits
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
--       `Official Documentation/18 AI Module/AI_OVERVIEW.md`
--
-- Every write to the three tables in `0163` happens here. None of them carries an
-- INSERT or UPDATE policy for a school, so these functions are the only way in —
-- which is what enforces that assignments never exceed what was bought.
--
-- ## `termly` means the school's own term, not three months
--
-- `school_term_dates` holds `starts_on`/`ends_on` per school per term. A termly
-- purchase runs to the END of the term the purchase date falls in; if it falls
-- between terms, to the end of the next one. Deriving it from a clock instead
-- would reproduce the calendar-month defect that already costs a Hub teacher five
-- of their first sixty credits.
--
-- A school that has not configured its terms cannot buy a termly plan. That is a
-- refusal with a clear reason, which is better than silently inventing ninety days
-- and billing for it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Resolve the period for a plan.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_credit_period(
  p_school_id   UUID,
  p_period_kind TEXT,
  p_from        DATE DEFAULT NULL
)
RETURNS TABLE (out_period_start DATE, out_period_end DATE)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from DATE := COALESCE(p_from, CURRENT_DATE);
  v_end  DATE;
BEGIN
  IF p_period_kind = 'monthly' THEN
    -- From the purchase date, not the 1st. See the header.
    RETURN QUERY SELECT v_from, (v_from + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  ELSIF p_period_kind = 'annual' THEN
    RETURN QUERY SELECT v_from, (v_from + INTERVAL '1 year' - INTERVAL '1 day')::DATE;

  ELSIF p_period_kind = 'termly' THEN
    -- The term containing the purchase date.
    SELECT t.ends_on INTO v_end
    FROM public.school_term_dates AS t
    WHERE t.school_id = p_school_id
      AND v_from BETWEEN t.starts_on AND t.ends_on
    ORDER BY t.ends_on
    LIMIT 1;

    IF v_end IS NULL THEN
      -- Bought in the holidays: the next term that starts.
      SELECT t.ends_on INTO v_end
      FROM public.school_term_dates AS t
      WHERE t.school_id = p_school_id
        AND t.starts_on > v_from
      ORDER BY t.starts_on
      LIMIT 1;
    END IF;

    IF v_end IS NULL THEN
      RAISE EXCEPTION
        'This school has no term dates covering % — set them in Settings before buying a termly plan.',
        v_from
        USING ERRCODE = '22023';
    END IF;

    RETURN QUERY SELECT v_from, v_end;

  ELSE
    RAISE EXCEPTION 'Unknown period kind: %', p_period_kind USING ERRCODE = '22023';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The quote. Pure — writes nothing, so the screen can call it on every change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_credit_quote(
  p_plan_code TEXT,
  p_seats     INT
)
RETURNS TABLE (
  out_plan_code        TEXT,
  out_display_name     TEXT,
  out_period_kind      TEXT,
  out_seats            INT,
  out_credits_per_seat INT,
  out_total_credits    INT,
  out_price_per_seat   NUMERIC,
  out_total_amount     NUMERIC,
  out_currency_code    TEXT,
  out_period_start     DATE,
  out_period_end       DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_plan   RECORD;
  v_period RECORD;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Only a school can quote for credits' USING ERRCODE = '42501';
  END IF;

  IF p_seats IS NULL OR p_seats < 1 THEN
    RAISE EXCEPTION 'At least one seat is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_plan
  FROM afritech.school_credit_plans
  WHERE plan_code = p_plan_code AND is_active;

  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'No such plan: %', p_plan_code USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_period
  FROM public.school_credit_period(v_school, v_plan.period_kind, NULL);

  RETURN QUERY SELECT
    v_plan.plan_code,
    v_plan.display_name,
    v_plan.period_kind,
    p_seats,
    v_plan.credits_per_seat,
    p_seats * v_plan.credits_per_seat,
    v_plan.price_per_seat,
    (p_seats * v_plan.price_per_seat)::NUMERIC(12,2),
    v_plan.currency_code,
    v_period.out_period_start,
    v_period.out_period_end;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Buy.
--
-- Creates three things in one transaction: the purchase, the `topup` lot in the
-- ledger that actually holds the credits, and a DRAFT invoice.
--
-- Draft, not issued. `0126` has AfriTech record payment by hand, and a school
-- that could issue its own invoice could also mark it paid. The school commits to
-- the purchase; AfriTech issues the bill.
--
-- The credits are usable immediately, before payment. That is a deliberate
-- commercial choice matching the rest of ZSMS billing — a trial school already has
-- the product before it has paid — and the exposure is bounded by the purchase
-- being an auditable commitment with an invoice attached.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_purchase_credits(
  p_plan_code TEXT,
  p_seats     INT
)
RETURNS TABLE (
  out_purchase_id   UUID,
  out_total_credits INT,
  out_total_amount  NUMERIC,
  out_period_start  DATE,
  out_period_end    DATE,
  out_invoice_id    UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_school    UUID := public.current_school_uuid();
  v_user      TEXT := public.get_user_id();
  v_quote     RECORD;
  v_account   UUID;
  v_lot       UUID;
  v_invoice   UUID;
  v_number    TEXT;
  v_tier      TEXT;
  v_purchase  UUID;
BEGIN
  IF v_school IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Only a signed-in school may buy credits' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_quote FROM public.school_credit_quote(p_plan_code, p_seats);

  -- The school's wallet, created on first use by 0132's helper. Resolved directly
  -- rather than through `ai_credit_account_for_caller()` so this cannot silently
  -- land on a personal wallet if the claim shape ever changes.
  SELECT id INTO v_account FROM public.ai_credit_accounts WHERE school_id = v_school;
  IF v_account IS NULL THEN
    INSERT INTO public.ai_credit_accounts (school_id) VALUES (v_school)
    ON CONFLICT (school_id) WHERE school_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_account;
    IF v_account IS NULL THEN
      SELECT id INTO v_account FROM public.ai_credit_accounts WHERE school_id = v_school;
    END IF;
  END IF;

  -- The lot. `expires_at` is the period end, so 0132's balance arithmetic stops
  -- counting these credits on the same day the assignments do.
  INSERT INTO public.ai_credit_ledger
    (account_id, reason, credits, expires_at, actor_user_id, metadata)
  VALUES (
    v_account, 'topup', v_quote.out_total_credits,
    (v_quote.out_period_end + INTERVAL '1 day')::TIMESTAMPTZ,
    v_user,
    jsonb_build_object('source', 'school_credit_purchase', 'plan_code', p_plan_code)
  )
  RETURNING id INTO v_lot;

  SELECT subscription_tier INTO v_tier FROM public.schools WHERE id = v_school;

  -- Numbering: distinct prefix so a credit invoice is recognisable at a glance and
  -- cannot collide with the subscription sequence.
  v_number := 'AIC-' || to_char(NOW(), 'YYYYMM') || '-' ||
              lpad((
                SELECT COUNT(*) + 1 FROM afritech.invoices
                WHERE invoice_kind = 'ai_credits'
                  AND date_trunc('month', created_at) = date_trunc('month', NOW())
              )::TEXT, 4, '0');

  INSERT INTO afritech.invoices (
    invoice_number, school_id, invoice_kind, period_start, period_end, currency,
    tier_name, pricing_model, subtotal, total, status, created_by, notes
  )
  VALUES (
    v_number, v_school, 'ai_credits',
    v_quote.out_period_start, v_quote.out_period_end, v_quote.out_currency_code,
    COALESCE(v_tier, 'unknown'),
    -- Flat: a fixed amount, not derived from the roll. Literally true here.
    'flat',
    v_quote.out_total_amount, v_quote.out_total_amount,
    'draft', v_user,
    'AI credits: ' || p_seats || ' seat(s) × ' || v_quote.out_credits_per_seat || ' credits'
  )
  RETURNING id INTO v_invoice;

  INSERT INTO afritech.invoice_lines
    (invoice_id, line_type, description, quantity, unit_price, amount)
  VALUES (
    v_invoice, 'addon',
    v_quote.out_display_name || ' — AI credits, ' || v_quote.out_credits_per_seat || ' per teacher',
    p_seats, v_quote.out_price_per_seat, v_quote.out_total_amount
  );

  INSERT INTO public.school_credit_purchases (
    school_id, account_id, plan_code, period_kind, credits_per_seat, price_per_seat,
    currency_code, seats, total_credits, total_amount, period_start, period_end,
    lot_id, invoice_id, created_by
  )
  VALUES (
    v_school, v_account, p_plan_code, v_quote.out_period_kind, v_quote.out_credits_per_seat,
    v_quote.out_price_per_seat, v_quote.out_currency_code, p_seats, v_quote.out_total_credits,
    v_quote.out_total_amount, v_quote.out_period_start, v_quote.out_period_end,
    v_lot, v_invoice, v_user
  )
  RETURNING id INTO v_purchase;

  PERFORM public.log_audit_event(
    'school_credits_purchased', 'school_credit_purchases', v_purchase,
    jsonb_build_object('seats', p_seats, 'credits', v_quote.out_total_credits,
                       'amount', v_quote.out_total_amount, 'invoice', v_number),
    v_school
  );

  RETURN QUERY SELECT
    v_purchase, v_quote.out_total_credits, v_quote.out_total_amount,
    v_quote.out_period_start, v_quote.out_period_end, v_invoice;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. How many seats of a purchase are still unassigned.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_credit_unassigned(p_purchase_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(
    0,
    p.total_credits - COALESCE((
      SELECT SUM(a.credits_allocated)
      FROM public.school_credit_assignments AS a
      WHERE a.purchase_id = p.id AND a.revoked_at IS NULL
    ), 0)
  )::INT
  FROM public.school_credit_purchases AS p
  WHERE p.id = p_purchase_id;
$$;

-- ---------------------------------------------------------------------------
-- 5. Assign.
--
-- Takes an ARRAY, so "all teachers" is one call rather than forty, and so the
-- whole set either fits in what remains or none of it is written. Assigning
-- thirty of forty teachers and failing on the thirty-first would leave the school
-- to work out who got credits.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_assign_credits(
  p_purchase_id UUID,
  p_user_ids    TEXT[]
)
RETURNS TABLE (out_assigned INT, out_unassigned_remaining INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school    UUID := public.current_school_uuid();
  v_user      TEXT := public.get_user_id();
  v_purchase  RECORD;
  v_targets   TEXT[];
  v_needed    INT;
  v_available INT;
  v_count     INT;
BEGIN
  IF v_school IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Only a signed-in school may assign credits' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_purchase
  FROM public.school_credit_purchases
  WHERE id = p_purchase_id
    -- Own school's purchase only. This is a DEFINER function, so without this
    -- clause a school could assign another school's credits to its own staff.
    AND school_id = v_school;

  IF v_purchase IS NULL THEN
    RAISE EXCEPTION 'No such purchase' USING ERRCODE = '42501';
  END IF;

  IF v_purchase.period_end < CURRENT_DATE THEN
    RAISE EXCEPTION 'That purchase expired on %', v_purchase.period_end
      USING ERRCODE = '22023';
  END IF;

  /*
    Drop anybody who already holds a live assignment on this purchase, rather than
    letting the unique index raise. Pressing "assign to all" twice is a normal
    thing to do — the second press should be a no-op for those already covered and
    should still cover anybody newly on staff.
  */
  SELECT COALESCE(array_agg(DISTINCT u), '{}') INTO v_targets
  FROM unnest(p_user_ids) AS u
  WHERE u IS NOT NULL
    AND btrim(u) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.school_credit_assignments AS a
      WHERE a.purchase_id = p_purchase_id
        AND a.clerk_user_id = u
        AND a.revoked_at IS NULL
    );

  v_count := COALESCE(array_length(v_targets, 1), 0);
  IF v_count = 0 THEN
    RETURN QUERY SELECT 0, public.school_credit_unassigned(p_purchase_id);
    RETURN;
  END IF;

  v_needed    := v_count * v_purchase.credits_per_seat;
  v_available := public.school_credit_unassigned(p_purchase_id);

  -- All or nothing: see the header.
  IF v_needed > v_available THEN
    RAISE EXCEPTION
      'That needs % credits but only % are unassigned. Buy more seats or assign fewer teachers.',
      v_needed, v_available
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.school_credit_assignments (
    school_id, purchase_id, clerk_user_id, credits_allocated,
    period_start, period_end, assigned_by
  )
  SELECT
    v_school, p_purchase_id, t, v_purchase.credits_per_seat,
    v_purchase.period_start, v_purchase.period_end, v_user
  FROM unnest(v_targets) AS t;

  PERFORM public.log_audit_event(
    'school_credits_assigned', 'school_credit_assignments', p_purchase_id,
    jsonb_build_object('teachers', v_count, 'credits', v_needed),
    v_school
  );

  RETURN QUERY SELECT v_count, public.school_credit_unassigned(p_purchase_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Revoke — a teacher who leaves, or was assigned by mistake.
--
-- The UNSPENT remainder returns to unassigned. What they already spent does not:
-- those credits are gone, the ledger records who spent them, and rewriting that
-- would be falsifying a financial record to tidy a balance.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_revoke_credit_assignment(p_assignment_id UUID)
RETURNS TABLE (out_revoked BOOLEAN, out_credits_returned INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_spent  INT;
  v_alloc  INT;
  v_rows   INT;
BEGIN
  IF v_school IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Only a signed-in school may revoke an assignment' USING ERRCODE = '42501';
  END IF;

  SELECT a.credits_allocated INTO v_alloc
  FROM public.school_credit_assignments AS a
  WHERE a.id = p_assignment_id AND a.school_id = v_school AND a.revoked_at IS NULL;

  IF v_alloc IS NULL THEN
    RETURN QUERY SELECT FALSE, 0;
    RETURN;
  END IF;

  SELECT COALESCE(-SUM(l.credits), 0)::INT INTO v_spent
  FROM public.ai_credit_ledger AS l
  WHERE l.assignment_id = p_assignment_id AND l.reason = 'consume';

  UPDATE public.school_credit_assignments AS a
     SET revoked_at = NOW(), revoked_by = v_user
   WHERE a.id = p_assignment_id AND a.school_id = v_school AND a.revoked_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  PERFORM public.log_audit_event(
    'school_credit_assignment_revoked', 'school_credit_assignments', p_assignment_id,
    jsonb_build_object('allocated', v_alloc, 'spent', v_spent),
    v_school
  );

  RETURN QUERY SELECT v_rows > 0, GREATEST(0, v_alloc - v_spent);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. A teacher's two balances, side by side.
--
-- THE REASON THIS EXISTS: `ai_credit_account_for_caller()` returns the SCHOOL
-- wallet whenever the caller has an organisation. A teacher who belongs to a
-- school therefore has no reachable personal wallet through it at all — every
-- spend, including personal Hub work on credits they bought themselves, would
-- land on the school.
--
-- This resolves BOTH, so the generator can offer the choice and default sensibly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_credit_balances()
RETURNS TABLE (
  out_school_id          UUID,
  out_school_name        TEXT,
  out_school_allocated   INT,
  out_school_spent       INT,
  out_school_available   INT,
  out_school_expires_on  DATE,
  out_reserve_available  INT,
  out_personal_available INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user     TEXT := public.get_user_id();
  v_school   UUID := public.current_school_uuid();
  v_alloc    INT  := 0;
  v_spent    INT  := 0;
  v_expires  DATE;
  v_reserve  INT  := 0;
  v_personal INT  := 0;
  v_name     TEXT;
  v_settings RECORD;
  v_account  UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  -- ---- the school side ----
  IF v_school IS NOT NULL THEN
    SELECT s.name INTO v_name FROM public.schools AS s WHERE s.id = v_school;

    SELECT
      COALESCE(SUM(a.credits_allocated), 0)::INT,
      MAX(a.period_end)
    INTO v_alloc, v_expires
    FROM public.school_credit_assignments AS a
    WHERE a.clerk_user_id = v_user
      AND a.school_id = v_school
      AND a.revoked_at IS NULL
      AND CURRENT_DATE BETWEEN a.period_start AND a.period_end;

    SELECT COALESCE(-SUM(l.credits), 0)::INT INTO v_spent
    FROM public.ai_credit_ledger AS l
    JOIN public.school_credit_assignments AS a ON a.id = l.assignment_id
    WHERE a.clerk_user_id = v_user
      AND a.school_id = v_school
      AND a.revoked_at IS NULL
      AND CURRENT_DATE BETWEEN a.period_start AND a.period_end
      AND l.reason = 'consume';

    -- ---- the reserve, if the school turned it on ----
    SELECT * INTO v_settings
    FROM public.school_credit_settings WHERE school_id = v_school;

    IF v_settings.reserve_enabled THEN
      SELECT COALESCE(SUM(public.school_credit_unassigned(p.id)), 0)::INT INTO v_reserve
      FROM public.school_credit_purchases AS p
      WHERE p.school_id = v_school
        AND CURRENT_DATE BETWEEN p.period_start AND p.period_end;

      IF v_settings.reserve_per_teacher_cap IS NOT NULL THEN
        -- What this teacher has already drawn from the reserve: a school-account
        -- `consume` with no assignment behind it (see 0163's column comment).
        v_reserve := LEAST(
          v_reserve,
          GREATEST(0, v_settings.reserve_per_teacher_cap - (
            SELECT COALESCE(-SUM(l.credits), 0)::INT
            FROM public.ai_credit_ledger AS l
            JOIN public.ai_credit_accounts AS ac ON ac.id = l.account_id
            WHERE ac.school_id = v_school
              AND l.actor_user_id = v_user
              AND l.reason = 'consume'
              AND l.assignment_id IS NULL
          ))
        );
      END IF;
    END IF;
  END IF;

  -- ---- the personal side ----
  SELECT id INTO v_account FROM public.ai_credit_accounts WHERE owner_user_id = v_user;
  IF v_account IS NOT NULL THEN
    SELECT b.total_available INTO v_personal
    FROM public.ai_credit_balance(v_account) AS b;
  END IF;

  RETURN QUERY SELECT
    v_school, v_name, v_alloc, v_spent,
    GREATEST(0, v_alloc - v_spent),
    v_expires, v_reserve, COALESCE(v_personal, 0);
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants. `authenticated` for everything; a school's spending is not public.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.school_credit_period(UUID, TEXT, DATE)',
    'public.school_credit_quote(TEXT, INT)',
    'public.school_purchase_credits(TEXT, INT)',
    'public.school_credit_unassigned(UUID)',
    'public.school_assign_credits(UUID, TEXT[])',
    'public.school_revoke_credit_assignment(UUID)',
    'public.teacher_credit_balances()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);
  END LOOP;

  -- Assert, never assume — 0151's REVOKE read correctly and did nothing.
  FOREACH v_fn IN ARRAY ARRAY[
    'public.school_credit_period(UUID, TEXT, DATE)',
    'public.school_credit_quote(TEXT, INT)',
    'public.school_purchase_credits(TEXT, INT)',
    'public.school_credit_unassigned(UUID)',
    'public.school_assign_credits(UUID, TEXT[])',
    'public.school_revoke_credit_assignment(UUID)',
    'public.teacher_credit_balances()'
  ]
  LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute %', v_fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated cannot execute %', v_fn;
    END IF;
  END LOOP;
END;
$$;
