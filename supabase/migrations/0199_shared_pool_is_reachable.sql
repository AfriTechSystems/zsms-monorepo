-- ---------------------------------------------------------------------------
-- 0199 — credits topped up to a school wallet could not be spent either
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/18 AI Module/AI_OVERVIEW.md`
--
-- `0198` made the tier allowance reachable. The same fault remains one level on: a lot
-- created by `ai_credit_topup()` sits on the school's account and no teacher can reach
-- it, because `teacher_school_entitlement()` counts only seat purchases — an assignment
-- or the reserve.
--
-- ## The model, stated plainly, because it had drifted into three ideas with one name
--
-- A school's AI credits come from three places, and they are not the same kind of
-- thing:
--
--   * **The tier allowance.** Arrives with the subscription. Not bought, so there is
--     nothing to assign and no purchase row to hang an assignment from. Shared.
--   * **A seat purchase** (`school_credit_purchases`). Bought as seats and ASSIGNED to
--     named teachers; the unassigned remainder is the reserve, off by default. This is
--     the thing `0163`–`0169` built, and it is the only one assignment applies to.
--   * **A direct top-up** (`ai_credit_topup`). A lot on the account with no seats and
--     nobody's name on it. Shared, like the allowance.
--
-- A seat purchase ALSO writes a `topup` ledger lot — tagged
-- `metadata->>'source' = 'school_credit_purchase'` — which is why the shared pool
-- cannot simply be "all purchased credits". Counting those again here would let the
-- same credit be spent twice: once through an assignment and once through the pool.
--
-- `ai_credit_caps` governs the shared pool, which is what it was always for.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.teacher_school_entitlement()
RETURNS TABLE (out_assignment_id UUID, out_available INTEGER, out_from_reserve BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user      TEXT := public.get_user_id();
  v_school    UUID := public.current_school_uuid();
  v_assign    UUID;
  v_alloc     INT := 0;
  v_spent     INT := 0;
  v_settings  RECORD;
  v_reserve   INT := 0;
  v_drawn     INT := 0;
  v_account   UUID;
  v_shared    INT := 0;
BEGIN
  IF v_user IS NULL OR v_school IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, 0, FALSE;
    RETURN;
  END IF;

  SELECT id INTO v_account
  FROM public.ai_credit_accounts
  WHERE school_id = v_school;

  /*
    The shared pool: what is left of the tier allowance this month, plus every live lot
    that is NOT a seat purchase.

    The `metadata` test is what keeps a seat purchase out. Those credits are reached
    through an assignment or the reserve, and counting them here as well would let one
    credit be spent twice.
  */
  IF v_account IS NOT NULL THEN
    SELECT COALESCE(b.allowance_remaining, 0) INTO v_shared
    FROM public.ai_credit_balance(v_account) AS b;

    SELECT v_shared + COALESCE(SUM(lot.remaining), 0)::INT INTO v_shared
    FROM (
      SELECT (SELECT COALESCE(SUM(m.credits), 0)
                FROM public.ai_credit_ledger m
               WHERE m.id = t.id OR m.lot_id = t.id) AS remaining
        FROM public.ai_credit_ledger t
       WHERE t.account_id = v_account
         AND t.reason = 'topup'
         AND t.expires_at > NOW()
         AND COALESCE(t.metadata ->> 'source', '') <> 'school_credit_purchase'
    ) AS lot;
  END IF;

  /*
    The live assignment expiring SOONEST. A teacher may hold two — a termly one and a
    monthly top-up — and spending the one about to lapse first is the same reasoning
    `0132` applies to lots.
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

    IF (v_alloc - v_spent) + v_shared > 0 THEN
      RETURN QUERY SELECT v_assign, ((v_alloc - v_spent) + v_shared), FALSE;
      RETURN;
    END IF;
  END IF;

  -- Assignment exhausted or absent. The reserve, if the school switched it on.
  SELECT * INTO v_settings
  FROM public.school_credit_settings WHERE school_id = v_school;

  IF NOT COALESCE(v_settings.reserve_enabled, FALSE) THEN
    -- No seats to draw on, but the shared pool is still the school's to spend.
    RETURN QUERY SELECT NULL::UUID, v_shared, FALSE;
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

    /*
      The cap governs the RESERVE, not the shared pool.

      A school that caps reserve draws at five has said something about the seats it
      bought. Applying that to the allowance would silently reinterpret the setting;
      `ai_credit_caps` is the control for the pool.
    */
    v_reserve := LEAST(v_reserve, GREATEST(0, v_settings.reserve_per_teacher_cap - v_drawn));
  END IF;

  RETURN QUERY SELECT NULL::UUID, v_reserve + v_shared, v_reserve > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_school_entitlement() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_school_entitlement() FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_school_entitlement() TO authenticated;

-- ---------------------------------------------------------------------------
-- Prove a directly topped-up lot is spendable, and that a seat purchase is NOT
-- double-counted.
--
-- The writes happen inside a nested block that always aborts, so nothing survives.
-- `ai_credit_ledger` is append-only by trigger — DELETE is refused, correctly — which
-- the first version of this block discovered by trying to tidy up after itself. A
-- financial ledger is exactly the wrong place to leave migration fixtures, so they are
-- rolled back rather than removed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_school  UUID;
  v_org     TEXT;
  v_account UUID;
  v_problem TEXT;
BEGIN
  SELECT s.id, s.clerk_org_id INTO v_school, v_org
  FROM public.schools s
  WHERE s.clerk_org_id IS NOT NULL AND s.status = 'active'
  LIMIT 1;

  IF v_school IS NULL THEN
    RAISE NOTICE 'no active school to verify against — skipping';
    RETURN;
  END IF;

  BEGIN
    DECLARE
      v_ent    RECORD;
      v_before INT;
    BEGIN
      INSERT INTO public.ai_credit_accounts (school_id) VALUES (v_school)
      ON CONFLICT DO NOTHING;
      SELECT id INTO v_account FROM public.ai_credit_accounts WHERE school_id = v_school;

      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', 'verify_0199', 'role', 'authenticated',
          'o', json_build_object('id', v_org, 'rol', 'teacher'))::text, TRUE);

      SELECT out_available INTO v_before FROM public.teacher_school_entitlement();

      -- A plain top-up: no seats, nobody's name on it.
      INSERT INTO public.ai_credit_ledger
        (account_id, reason, credits, expires_at, actor_user_id, metadata)
      VALUES (v_account, 'topup', 5, NOW() + INTERVAL '30 days', 'verify_0199',
              '{"source":"verification_0199"}'::JSONB);

      SELECT * INTO v_ent FROM public.teacher_school_entitlement();
      IF v_ent.out_available <> v_before + 5 THEN
        v_problem := format('a direct top-up is unreachable: %s before, %s after',
                            v_before, v_ent.out_available);
      END IF;

      -- A seat-purchase lot must NOT raise the shared pool — it is reached by
      -- assignment, and counting it here would spend one credit twice.
      INSERT INTO public.ai_credit_ledger
        (account_id, reason, credits, expires_at, actor_user_id, metadata)
      VALUES (v_account, 'topup', 100, NOW() + INTERVAL '30 days', 'verify_0199',
              '{"source":"school_credit_purchase"}'::JSONB);

      SELECT * INTO v_ent FROM public.teacher_school_entitlement();
      IF v_problem IS NULL AND v_ent.out_available <> v_before + 5 THEN
        v_problem := format('a seat purchase was double-counted: %s', v_ent.out_available);
      END IF;
    END;

    -- Always abort the nested block, so the ledger rows never persist.
    RAISE EXCEPTION 'zsms_rollback_marker' USING ERRCODE = 'ZS199';
  EXCEPTION
    WHEN SQLSTATE 'ZS199' THEN
      NULL;  -- expected: the writes are discarded
  END;

  PERFORM set_config('request.jwt.claims', NULL, TRUE);

  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem;
  END IF;

  RAISE NOTICE 'verified: direct top-ups spendable, seat purchases not double-counted';
END;
$$;
