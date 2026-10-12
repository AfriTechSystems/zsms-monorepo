-- ===========================================================================
-- 0264 — a tier's AI allowance is editable
--
-- Spec: `18 AI Module/AI_OVERVIEW.md`, `17 Integration and Pricing/PRICING.md`,
--       ADR-031 ("would a business person reasonably want to change this
--       without a deployment?")
--
-- ## The gap
--
-- `afritech.tier_ai_allowances` is **empty**, and nothing can write it. Grepped
-- on 2026-10-11: the table is referenced by exactly two migrations — `0132`,
-- which created it, and `0198`, which inserts a row inside a rolled-back
-- assertion. No function, no route, no screen.
--
-- So `ai_allowance_for_account()` resolves every school on every tier to **zero
-- included credits**, and AfriTech cannot change that without writing a
-- migration. A school paying K2,000 a month for Professional gets no AI at all,
-- and the only way to give them any is a deployment.
--
-- That is the exact failure `PRICING.md` and ADR-031 exist to prevent. Every
-- other commercial number in this schema — tier prices, feature flags, student
-- ceilings, credit pack prices — is editable from `/admin/pricing`. This one was
-- configuration with no editor, which is indistinguishable from a hardcoded zero.
--
-- ## No amounts are invented here
--
-- The table stays empty after this migration. `CLAUDE.md` is right that the
-- numbers need a business decision, and seeding a guess would make that decision
-- by accident — a school would be told its plan includes 50 credits because a
-- migration said so. What this adds is the **mechanism**: AfriTech sets the
-- numbers once they are decided, from a screen, without a deployment.
--
-- ## Zero is a value, not an absence
--
-- `monthly_credits` admits 0, and that is deliberate: "this tier deliberately
-- includes no AI" and "nobody has decided yet" are different facts a school
-- should be able to distinguish. An explicit 0 row says the first. No row says
-- the second, and `admin_tier_ai_allowances()` reports which it is so a screen
-- can say so too.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Reading: every tier, with or without an allowance row.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_tier_ai_allowances()
RETURNS TABLE (
  out_tier_name       TEXT,
  out_display_name    TEXT,
  out_monthly_price   NUMERIC(12,2),
  out_monthly_credits INT,
  -- FALSE means nobody has decided, which is not the same as a decided zero.
  out_is_set          BOOLEAN,
  out_updated_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  /*
    Gated on `billing:read` rather than on being AfriTech at all (`0237`). An AI
    allowance is a commercial term, so it sits with whoever sets prices — not with
    a support engineer.
  */
  IF NOT public.has_afritech_capability('billing:read') THEN
    RAISE EXCEPTION 'Not available' USING ERRCODE = '42501';
  END IF;

  /*
    LEFT JOIN from the tiers, so a tier with no allowance row still appears.

    Driving from the allowance table instead would show nothing at all today and
    hide the very problem this function exists to surface.
  */
  RETURN QUERY
  SELECT
    t.tier_name,
    t.display_name,
    t.monthly_price_zmw,
    COALESCE(a.monthly_credits, 0),
    a.tier_name IS NOT NULL,
    a.updated_at
  FROM afritech.subscription_tiers t
  LEFT JOIN afritech.tier_ai_allowances a ON a.tier_name = t.tier_name
  ORDER BY t.display_order, t.tier_name;
END;
$$;

COMMENT ON FUNCTION public.admin_tier_ai_allowances() IS
  'Every tier with its included monthly AI credits, and whether an allowance has actually been decided. LEFT JOIN from the tiers so an undecided tier is visible rather than absent (0264).';

REVOKE ALL ON FUNCTION public.admin_tier_ai_allowances() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_tier_ai_allowances() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_tier_ai_allowances() TO authenticated;

-- ---------------------------------------------------------------------------
-- Writing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_tier_ai_allowance(
  p_tier_name       TEXT,
  p_monthly_credits INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor TEXT := public.get_user_id();
BEGIN
  -- Writing a commercial term needs `billing:write`, not merely read.
  IF NOT public.has_afritech_capability('billing:write') THEN
    RAISE EXCEPTION 'Not available' USING ERRCODE = '42501';
  END IF;

  -- The tier must exist, or this writes an allowance nothing will ever resolve.
  IF NOT EXISTS (
    SELECT 1 FROM afritech.subscription_tiers WHERE tier_name = p_tier_name
  ) THEN
    RAISE EXCEPTION 'There is no tier called "%"', p_tier_name
      USING ERRCODE = '22023';
  END IF;

  IF p_monthly_credits IS NULL OR p_monthly_credits < 0 THEN
    RAISE EXCEPTION 'An allowance cannot be negative' USING ERRCODE = '22023';
  END IF;

  /*
    An upper bound, because a typo here is expensive in a way a price typo is not:
    a price is visible on an invoice, whereas a stray zero on an allowance is spent
    silently by teachers generating lesson plans against AfriTech's model bill.
  */
  IF p_monthly_credits > 100000 THEN
    RAISE EXCEPTION
      'That is more than 100,000 credits a month. If it is deliberate, raise the cap deliberately.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO afritech.tier_ai_allowances (tier_name, monthly_credits, updated_at)
  VALUES (p_tier_name, p_monthly_credits, NOW())
  ON CONFLICT (tier_name) DO UPDATE
  SET monthly_credits = EXCLUDED.monthly_credits,
      updated_at      = NOW();

  /*
    `afritech` tables have NO row-change trigger, so anything written there needs
    an explicit audit call or the act goes unrecorded. Changing what every school
    on a tier is entitled to is exactly the kind of act that should not.
  */
  /*
    Argument order and types read from the catalogue, not assumed. The first draft
    guessed `(table, id, action, metadata, actor)`; the real signature is
    `(p_action, p_table_name, p_record_id UUID, p_metadata, p_school_id, ...)`.

    `p_record_id` is a UUID and a tier is keyed by NAME, so the tier goes in the
    metadata and the id stays NULL — a text key forced into a uuid column is how a
    log row becomes unqueryable. `p_school_id` is NULL because this is a
    platform-wide change, not one school's.
  */
  PERFORM public.log_audit_event(
    'update',
    'afritech.tier_ai_allowances',
    NULL,
    jsonb_build_object(
      'tier_name', p_tier_name,
      'monthly_credits', p_monthly_credits,
      'actor', v_actor
    ),
    NULL
  );

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.admin_set_tier_ai_allowance(TEXT, INT) IS
  'Sets a tier''s included monthly AI credits (ADR-031: a business person changes this without a deployment). No amounts are seeded by migration — the table stays empty until somebody decides (0264).';

REVOKE ALL ON FUNCTION public.admin_set_tier_ai_allowance(TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_tier_ai_allowance(TEXT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_tier_ai_allowance(TEXT, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_tier  TEXT;
  v_row   RECORD;
  v_count INT;
BEGIN
  BEGIN
    SELECT tier_name INTO v_tier FROM afritech.subscription_tiers
    ORDER BY display_order LIMIT 1;

    IF v_tier IS NULL THEN
      RAISE NOTICE '0264: no tier fixture; skipping';
      RAISE EXCEPTION 'ZSMS_0264_ROLLBACK';
    END IF;

    -- A school owner must not set AfriTech's commercial terms.
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_owner', 'role', 'authenticated',
      'o', json_build_object('id', 'org_probe_0264', 'rol', 'owner'))::text, TRUE);
    BEGIN
      PERFORM public.admin_set_tier_ai_allowance(v_tier, 50);
      RAISE EXCEPTION '0264: a school owner set a tier AI allowance';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    /*
      A support agent may not either. `0237` gives them `schools:read` and
      `incidents:write` and nothing commercial — this asserts the capability split
      is doing real work rather than being decorative.
    */
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_support', 'role', 'authenticated',
      'o', json_build_object('id', 'org_afritech', 'slg', 'afritech-systems-admin',
                             'rol', 'support_agent'))::text, TRUE);
    BEGIN
      PERFORM public.admin_set_tier_ai_allowance(v_tier, 50);
      RAISE EXCEPTION '0264: a support agent set a tier AI allowance';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_afritech', 'role', 'authenticated',
      'o', json_build_object('id', 'org_afritech', 'slg', 'afritech-systems-admin',
                             'rol', 'super_admin'))::text, TRUE);

    -- Every tier must be listed, whether or not it has an allowance.
    SELECT count(*) INTO v_count FROM public.admin_tier_ai_allowances();
    IF v_count <> (SELECT count(*) FROM afritech.subscription_tiers) THEN
      RAISE EXCEPTION
        '0264: % tier(s) listed but % exist — an undecided tier is being hidden',
        v_count, (SELECT count(*) FROM afritech.subscription_tiers);
    END IF;

    -- Undecided reads as is_set = FALSE, not as a decided zero.
    SELECT * INTO v_row FROM public.admin_tier_ai_allowances()
    WHERE out_tier_name = v_tier;
    IF v_row.out_is_set THEN
      RAISE EXCEPTION
        '0264: a tier with no allowance row claims to have a decided allowance';
    END IF;

    -- Setting one works, and an explicit 0 is distinguishable from undecided.
    PERFORM public.admin_set_tier_ai_allowance(v_tier, 0);
    SELECT * INTO v_row FROM public.admin_tier_ai_allowances()
    WHERE out_tier_name = v_tier;
    IF NOT v_row.out_is_set THEN
      RAISE EXCEPTION '0264: an explicit zero is indistinguishable from undecided';
    END IF;
    IF v_row.out_monthly_credits <> 0 THEN
      RAISE EXCEPTION '0264: the zero did not save';
    END IF;

    PERFORM public.admin_set_tier_ai_allowance(v_tier, 120);
    SELECT * INTO v_row FROM public.admin_tier_ai_allowances()
    WHERE out_tier_name = v_tier;
    IF v_row.out_monthly_credits <> 120 THEN
      RAISE EXCEPTION '0264: the allowance did not update, got %',
        v_row.out_monthly_credits;
    END IF;

    -- A tier that does not exist is refused.
    BEGIN
      PERFORM public.admin_set_tier_ai_allowance('no_such_tier', 10);
      RAISE EXCEPTION '0264: an allowance was set for a tier that does not exist';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;

    -- Negative and absurd values are refused.
    BEGIN
      PERFORM public.admin_set_tier_ai_allowance(v_tier, -5);
      RAISE EXCEPTION '0264: a negative allowance was accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
    BEGIN
      PERFORM public.admin_set_tier_ai_allowance(v_tier, 999999);
      RAISE EXCEPTION '0264: an absurd allowance was accepted without challenge';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;

    IF has_function_privilege('anon',
         'public.admin_set_tier_ai_allowance(TEXT, INT)', 'EXECUTE') THEN
      RAISE EXCEPTION '0264: anon can set a tier AI allowance';
    END IF;

    RAISE NOTICE
      '0264: verified — owner and support agent refused, every tier listed, explicit 0 distinguishable from undecided, bad values refused';

    RAISE EXCEPTION 'ZSMS_0264_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0264_ROLLBACK' THEN
        NULL;
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;

-- ---------------------------------------------------------------------------
-- The table is STILL EMPTY, deliberately.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM afritech.tier_ai_allowances) THEN
    RAISE NOTICE
      '0264: tier_ai_allowances has rows. If a migration seeded them, that migration made a commercial decision by accident.';
  ELSE
    RAISE NOTICE
      '0264: tier_ai_allowances is empty, as intended. AfriTech sets the numbers from /admin/pricing once decided.';
  END IF;
END;
$$;
