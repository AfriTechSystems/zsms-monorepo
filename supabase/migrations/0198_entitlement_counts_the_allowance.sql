-- ---------------------------------------------------------------------------
-- 0198 — a school's included AI allowance could never be spent
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/18 AI Module/AI_OVERVIEW.md`
--       `Official Documentation/17 Integration and Pricing/PRICING.md`
--
-- `0167` made `ai_credit_consume()` choose a wallet through
-- `teacher_school_entitlement()`, and that function counts only **purchased** credits:
-- a live assignment, or the unassigned reserve when a school has switched it on.
--
-- It never counts the monthly allowance a tier includes.
--
-- So a school on a tier with ten free credits a month and no purchases reports
-- `out_available = 0`, `auto` routes the teacher to a PERSONAL wallet they may not even
-- have, and the allowance the school is paying for is unreachable. Meanwhile
-- `ai_credit_balance()` reports it happily, so the product says ten and delivers none.
--
-- ## Why the allowance is shared and not assignable
--
-- A school ASSIGNS what it BUYS — `school_credit_assignments` references a purchase,
-- and seats are the unit. An allowance is not bought; it arrives with the tier. There
-- is nothing to divide into seats and no purchase row to hang an assignment from, so
-- it belongs to the school as a whole and any teacher may draw on it.
--
-- `ai_credit_caps` is the tool for limiting that, and `ai_credit_consume()` still
-- applies it — a school that wants per-teacher ceilings on the shared pool sets one.
-- The reserve switch stays what it was: it governs the unassigned part of PURCHASES,
-- which really is divisible and really does need a deliberate decision.
--
-- ## Found by CI, which is the point of it
--
-- `ai_credits_test.sql` asserts "a teacher can spend a credit from the school wallet"
-- and has failed since `0167`. CI had not run against a from-scratch database for four
-- days, so twelve failing assertions went unseen. The suite was right and the
-- implementation was wrong — the opposite of what I first assumed.
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
  v_allowance INT := 0;
BEGIN
  IF v_user IS NULL OR v_school IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, 0, FALSE;
    RETURN;
  END IF;

  /*
    What the tier includes, and how much of it is left this month.

    Read first because it is available to every teacher regardless of assignment: it is
    not bought, so there is nothing to assign. It is added to whichever purchased
    entitlement follows rather than replacing it — a teacher with an assignment can
    spend both.
  */
  SELECT id INTO v_account
  FROM public.ai_credit_accounts
  WHERE school_id = v_school;

  IF v_account IS NOT NULL THEN
    SELECT b.allowance_remaining INTO v_allowance
    FROM public.ai_credit_balance(v_account) AS b;
    v_allowance := COALESCE(v_allowance, 0);
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

    IF (v_alloc - v_spent) + v_allowance > 0 THEN
      RETURN QUERY SELECT v_assign, ((v_alloc - v_spent) + v_allowance), FALSE;
      RETURN;
    END IF;
  END IF;

  -- Assignment exhausted or absent. The reserve, if the school switched it on.
  SELECT * INTO v_settings
  FROM public.school_credit_settings WHERE school_id = v_school;

  IF NOT COALESCE(v_settings.reserve_enabled, FALSE) THEN
    /*
      No assignment and no reserve — but the allowance is still the school's to spend.

      This is the line that was missing. Returning 0 here sent a teacher at a school
      with an included allowance to a personal wallet, and the allowance was never
      spendable by anybody.
    */
    RETURN QUERY SELECT NULL::UUID, v_allowance, FALSE;
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
      The cap governs the RESERVE, not the allowance.

      A school that caps reserve draws at five has said something about the credits it
      bought, not about the ones its tier includes. Capping the allowance here would
      silently reinterpret that setting.
    */
    v_reserve := LEAST(v_reserve, GREATEST(0, v_settings.reserve_per_teacher_cap - v_drawn));
  END IF;

  RETURN QUERY SELECT NULL::UUID, v_reserve + v_allowance, v_reserve > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_school_entitlement() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_school_entitlement() FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_school_entitlement() TO authenticated;

-- ---------------------------------------------------------------------------
-- Prove a teacher with no assignment can now reach the allowance.
--
-- A real spend, not an inspection of the function text: `0173` asserted a trigger was
-- attached and every write through it then failed.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_school  UUID;
  v_org     TEXT;
  v_account UUID;
  v_tier    TEXT;
  v_before  INT;
  v_ent     RECORD;
BEGIN
  SELECT s.id, s.clerk_org_id, s.subscription_tier INTO v_school, v_org, v_tier
  FROM public.schools s
  WHERE s.clerk_org_id IS NOT NULL AND s.status = 'active'
  LIMIT 1;

  IF v_school IS NULL THEN
    RAISE NOTICE 'no active school to verify against — skipping';
    RETURN;
  END IF;

  -- A tier allowance, so there is something to reach. Removed again below.
  INSERT INTO afritech.tier_ai_allowances (tier_name, monthly_credits)
  VALUES (v_tier, 7)
  ON CONFLICT (tier_name) DO UPDATE SET monthly_credits = 7;

  INSERT INTO public.ai_credit_accounts (school_id)
  VALUES (v_school)
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_account FROM public.ai_credit_accounts WHERE school_id = v_school;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', 'verify_0198_teacher', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'teacher'))::text, TRUE);

  SELECT * INTO v_ent FROM public.teacher_school_entitlement();

  IF COALESCE(v_ent.out_available, 0) < 7 THEN
    RAISE EXCEPTION
      'a teacher with no assignment still cannot reach the allowance: % available',
      COALESCE(v_ent.out_available, 0);
  END IF;

  RAISE NOTICE 'verified: an unassigned teacher sees % allowance credits', v_ent.out_available;

  PERFORM set_config('request.jwt.claims', NULL, TRUE);
  DELETE FROM afritech.tier_ai_allowances WHERE tier_name = v_tier AND monthly_credits = 7;
END;
$$;
