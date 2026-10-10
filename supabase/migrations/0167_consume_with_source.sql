-- ---------------------------------------------------------------------------
-- 0167 — spending school credits or personal credits, by choice
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/18 AI Module/AI_OVERVIEW.md`
--       `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
--
-- ## The problem, stated precisely
--
-- `ai_credit_account_for_caller()` returns the SCHOOL wallet whenever the caller
-- has an organisation. A teacher who belongs to a ZSMS school therefore had no
-- reachable personal wallet AT ALL: every spend landed on the school, including
-- personal Teacher Hub work on credits the teacher had bought with their own
-- money. They could top up a wallet they could never spend from.
--
-- So `ai_credit_consume()` gains a source.
--
--   * `school`   — the school's wallet, limited by what this teacher was assigned
--   * `personal` — the teacher's OWN wallet, reachable even inside an organisation
--   * `auto`     — school if they have school credits available, else personal
--
-- `auto` is the default, so every existing caller keeps working unchanged and
-- keeps school-first behaviour.
--
-- ## Why school-first is right, and it is not deference
--
-- School credits expire at the end of the period the school paid for. Personal
-- credits do not. Spending the perishable balance first is therefore also what is
-- best for the teacher — the interests align, which is rare enough to be worth
-- stating rather than leaving as a policy somebody later argues with.
--
-- ## One generation is never split across two sources
--
-- If the school balance covers part of a lesson plan and the teacher's covers the
-- rest, this refuses rather than taking some from each. A spend split across two
-- payers makes the ledger unreadable, the receipt unexplainable, and a refund
-- impossible to reason about. The source is decided BEFORE the model is called,
-- and the whole charge lands on it.
--
-- ## Replaced, not overloaded
--
-- The function is dropped and recreated with the new trailing parameter rather
-- than a second overload created beside it. Two functions of the same name,
-- distinguished only by a defaulted argument, make every existing call site
-- ambiguous — and the ambiguity would surface at runtime, on a financial
-- function, as `function is not unique`. Nothing in the database depends on it:
-- callers reach it by name through PostgREST.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.ai_credit_consume(
  TEXT, INT, TEXT, INT, INT, NUMERIC, TEXT, JSONB
);

-- ---------------------------------------------------------------------------
-- What a teacher may spend from the school, and which assignment pays.
--
-- Separate from the consume so the screen can ask the same question the charge
-- will ask. A balance shown by one rule and enforced by another is how somebody
-- is told they have credits and then refused.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_school_entitlement()
RETURNS TABLE (
  out_assignment_id UUID,
  out_available     INT,
  out_from_reserve  BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user     TEXT := public.get_user_id();
  v_school   UUID := public.current_school_uuid();
  v_assign   UUID;
  v_alloc    INT := 0;
  v_spent    INT := 0;
  v_settings RECORD;
  v_reserve  INT := 0;
  v_drawn    INT := 0;
BEGIN
  IF v_user IS NULL OR v_school IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, 0, FALSE;
    RETURN;
  END IF;

  /*
    The live assignment expiring SOONEST. A teacher may hold two — a termly one and
    a monthly top-up — and spending the one about to lapse first is the same
    reasoning `0132` applies to lots.
  */
  SELECT a.id, a.credits_allocated INTO v_assign, v_alloc
  FROM public.school_credit_assignments AS a
  WHERE a.clerk_user_id = v_user
    AND a.school_id = v_school
    AND a.revoked_at IS NULL
    AND CURRENT_DATE BETWEEN a.period_start AND a.period_end
  ORDER BY a.period_end ASC
  LIMIT 1;

  IF v_assign IS NOT NULL THEN
    SELECT COALESCE(-SUM(l.credits), 0)::INT INTO v_spent
    FROM public.ai_credit_ledger AS l
    WHERE l.assignment_id = v_assign AND l.reason = 'consume';

    IF v_alloc - v_spent > 0 THEN
      RETURN QUERY SELECT v_assign, (v_alloc - v_spent), FALSE;
      RETURN;
    END IF;
  END IF;

  -- Assignment exhausted or absent. The reserve, if the school switched it on.
  SELECT * INTO v_settings
  FROM public.school_credit_settings WHERE school_id = v_school;

  IF NOT COALESCE(v_settings.reserve_enabled, FALSE) THEN
    RETURN QUERY SELECT NULL::UUID, 0, FALSE;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(public.school_credit_unassigned(p.id)), 0)::INT INTO v_reserve
  FROM public.school_credit_purchases AS p
  WHERE p.school_id = v_school
    AND CURRENT_DATE BETWEEN p.period_start AND p.period_end;

  IF v_settings.reserve_per_teacher_cap IS NOT NULL THEN
    -- A school-account consume with no assignment behind it is a reserve draw.
    SELECT COALESCE(-SUM(l.credits), 0)::INT INTO v_drawn
    FROM public.ai_credit_ledger AS l
    JOIN public.ai_credit_accounts AS ac ON ac.id = l.account_id
    WHERE ac.school_id = v_school
      AND l.actor_user_id = v_user
      AND l.reason = 'consume'
      AND l.assignment_id IS NULL;

    v_reserve := LEAST(v_reserve, GREATEST(0, v_settings.reserve_per_teacher_cap - v_drawn));
  END IF;

  RETURN QUERY SELECT NULL::UUID, v_reserve, TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- The charge.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_credit_consume(
  p_feature_key     TEXT,
  p_units           INT     DEFAULT 1,
  p_model_name      TEXT    DEFAULT NULL,
  p_input_tokens    INT     DEFAULT NULL,
  p_output_tokens   INT     DEFAULT NULL,
  p_cost_usd        NUMERIC DEFAULT NULL,
  p_idempotency_key TEXT    DEFAULT NULL,
  p_metadata        JSONB   DEFAULT '{}'::jsonb,
  p_source          TEXT    DEFAULT 'auto'
)
RETURNS TABLE (
  credits_charged  INT,
  funded_allowance INT,
  funded_purchased INT,
  funded_by        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_user       TEXT := public.get_user_id();
  v_school     UUID := public.current_school_uuid();
  v_account    UUID;
  v_source     TEXT;
  v_ent        RECORD;
  v_assignment UUID;
  v_price      INT;
  v_required   INT;
  v_from_allow INT := 0;
  v_from_purch INT := 0;
  v_cap        INT;
  v_cap_used   INT;
  v_remaining  INT;
  v_take       INT;
  v_prior      INT;
  b            RECORD;
  lot          RECORD;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;

  IF p_source NOT IN ('auto', 'school', 'personal') THEN
    RAISE EXCEPTION 'Unknown credit source: %', p_source USING ERRCODE = '22023';
  END IF;

  SELECT credits_per_action INTO v_price
    FROM afritech.ai_credit_prices
   WHERE feature_key = p_feature_key AND is_active;

  IF v_price IS NULL THEN
    RAISE EXCEPTION 'No active credit price for %.', p_feature_key USING ERRCODE = 'P0002';
  END IF;

  v_required := v_price * GREATEST(p_units, 1);

  -- A free action succeeds and writes nothing. A spreadsheet import consumes no
  -- vision call, and must not be blocked by an empty wallet for a cost it never incurs.
  IF v_required = 0 THEN
    RETURN QUERY SELECT 0, 0, 0, 'none'::TEXT;
    RETURN;
  END IF;

  -- ---- choose the source --------------------------------------------------
  SELECT * INTO v_ent FROM public.teacher_school_entitlement();

  IF p_source = 'school' THEN
    IF v_school IS NULL THEN
      RAISE EXCEPTION 'You are not signed in to a school.' USING ERRCODE = '42501';
    END IF;
    IF v_ent.out_available < v_required THEN
      RAISE EXCEPTION
        'Your school credits are short: % needed, % left. Switch to your own credits or ask your school for more.',
        v_required, v_ent.out_available
        USING ERRCODE = '42501';
    END IF;
    v_source := 'school';

  ELSIF p_source = 'personal' THEN
    v_source := 'personal';

  ELSE
    -- `auto`: school first, and only if it covers the WHOLE charge. See the header
    -- on never splitting one generation across two payers.
    v_source := CASE WHEN v_ent.out_available >= v_required THEN 'school' ELSE 'personal' END;
  END IF;

  -- ---- resolve the wallet -------------------------------------------------
  IF v_source = 'school' THEN
    SELECT id INTO v_account FROM public.ai_credit_accounts WHERE school_id = v_school;
    v_assignment := v_ent.out_assignment_id;
  ELSE
    /*
      The teacher's OWN wallet, found by `owner_user_id` — NOT through
      `ai_credit_account_for_caller()`, which would hand back the school's because
      the caller has an organisation. That substitution is the whole defect this
      migration exists to fix, and doing it correctly here is the fix.
    */
    SELECT id INTO v_account FROM public.ai_credit_accounts WHERE owner_user_id = v_user;
    IF v_account IS NULL THEN
      INSERT INTO public.ai_credit_accounts (owner_user_id) VALUES (v_user)
      ON CONFLICT (owner_user_id) WHERE owner_user_id IS NOT NULL DO NOTHING
      RETURNING id INTO v_account;
      IF v_account IS NULL THEN
        SELECT id INTO v_account FROM public.ai_credit_accounts WHERE owner_user_id = v_user;
      END IF;
    END IF;
    v_assignment := NULL;
  END IF;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'No credit wallet available.' USING ERRCODE = '42501';
  END IF;

  -- ---- idempotency, before anything is charged ----------------------------
  IF p_idempotency_key IS NOT NULL THEN
    SELECT COALESCE(-SUM(credits), 0)::INT INTO v_prior
      FROM public.ai_credit_ledger
     WHERE account_id = v_account AND idempotency_key = p_idempotency_key;

    IF v_prior > 0 THEN
      RETURN QUERY
      SELECT v_prior,
             COALESCE((SELECT -SUM(credits)::INT FROM public.ai_credit_ledger
                        WHERE account_id = v_account AND idempotency_key = p_idempotency_key
                          AND funded_from = 'allowance'), 0),
             COALESCE((SELECT -SUM(credits)::INT FROM public.ai_credit_ledger
                        WHERE account_id = v_account AND idempotency_key = p_idempotency_key
                          AND funded_from = 'purchased'), 0),
             v_source;
      RETURN;
    END IF;
  END IF;

  -- Lock the WALLET. Two teachers generating at once must not both read the same
  -- balance and both pass.
  PERFORM 1 FROM public.ai_credit_accounts WHERE id = v_account FOR UPDATE;

  SELECT * INTO b FROM public.ai_credit_balance(v_account);

  -- `ai_credit_caps` still applies on a school wallet: it is the right tool for a
  -- school that buys credits and assigns none, and an assignment does not exempt
  -- somebody from a ceiling the school set.
  SELECT monthly_credit_cap INTO v_cap
    FROM public.ai_credit_caps
   WHERE account_id = v_account AND clerk_user_id = v_user;

  IF v_cap IS NOT NULL THEN
    SELECT COALESCE(-SUM(credits), 0) INTO v_cap_used
      FROM public.ai_credit_ledger
     WHERE account_id = v_account AND actor_user_id = v_user
       AND reason IN ('consume', 'reserve')
       AND date_trunc('month', created_at) = date_trunc('month', NOW());

    IF v_cap_used + v_required > v_cap THEN
      RAISE EXCEPTION
        'Your monthly AI limit of % credits is reached (used %). Ask your school to raise it.',
        v_cap, v_cap_used
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF b.total_available < v_required THEN
    RAISE EXCEPTION
      'Not enough AI credits: % needed, % available. Top up to continue.',
      v_required, b.total_available
      USING ERRCODE = '42501';
  END IF;

  -- Allowance first: it is free and it resets. Spending purchased credits while an
  -- allowance sat unused would cost the customer money for nothing.
  v_from_allow := LEAST(b.allowance_remaining, v_required);

  IF v_from_allow > 0 THEN
    INSERT INTO public.ai_credit_ledger
      (account_id, reason, credits, funded_from, feature_key, actor_user_id,
       model_name, input_tokens, output_tokens, cost_usd, idempotency_key, metadata,
       assignment_id)
    VALUES
      (v_account, 'consume', -v_from_allow, 'allowance', p_feature_key, v_user,
       p_model_name, p_input_tokens, p_output_tokens, p_cost_usd, p_idempotency_key,
       p_metadata, v_assignment);
  END IF;

  v_remaining := v_required - v_from_allow;

  -- Then purchased lots, SOONEST EXPIRY FIRST — spending what was about to be lost.
  FOR lot IN
    SELECT t.id,
           (SELECT COALESCE(SUM(m.credits), 0)
              FROM public.ai_credit_ledger m
             WHERE m.id = t.id OR m.lot_id = t.id) AS remaining
      FROM public.ai_credit_ledger t
     WHERE t.account_id = v_account AND t.reason = 'topup' AND t.expires_at > NOW()
     ORDER BY t.expires_at ASC, t.created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    CONTINUE WHEN lot.remaining <= 0;

    v_take := LEAST(lot.remaining, v_remaining);

    INSERT INTO public.ai_credit_ledger
      (account_id, reason, credits, funded_from, lot_id, feature_key, actor_user_id,
       model_name, input_tokens, output_tokens, cost_usd, idempotency_key, metadata,
       assignment_id)
    VALUES
      (v_account, 'consume', -v_take, 'purchased', lot.id, p_feature_key, v_user,
       p_model_name, p_input_tokens, p_output_tokens, p_cost_usd,
       CASE WHEN v_from_allow = 0 AND v_remaining = v_required THEN p_idempotency_key END,
       p_metadata, v_assignment);

    v_from_purch := v_from_purch + v_take;
    v_remaining  := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    -- Unreachable: the balance was checked under the same lock. Raised rather than
    -- ignored, because reaching it means the balance function and the lot walk
    -- disagree, and silently under-charging is the worst response to that.
    RAISE EXCEPTION 'Credit allocation failed to settle % credits.', v_remaining
      USING ERRCODE = 'XX000';
  END IF;

  RETURN QUERY SELECT v_required, v_from_allow, v_from_purch, v_source;
END;
$$;

COMMENT ON FUNCTION public.ai_credit_consume(TEXT, INT, TEXT, INT, INT, NUMERIC, TEXT, JSONB, TEXT) IS
  'Charges for one AI action against the school wallet or the teacher''s own, chosen by '
  'p_source (auto|school|personal). Never splits one charge across both. Stamps '
  'assignment_id on school-funded rows, so per-teacher usage is exact and a reserve draw '
  'is distinguishable by that column being NULL.';

DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.ai_credit_consume(TEXT, INT, TEXT, INT, INT, NUMERIC, TEXT, JSONB, TEXT)',
    'public.teacher_school_entitlement()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);

    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute %', v_fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated cannot execute %', v_fn;
    END IF;
  END LOOP;
END;
$$;
