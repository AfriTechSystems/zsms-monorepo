-- ---------------------------------------------------------------------------
-- 0178 — Teacher Hub plans can be read and edited from the product
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
--       `Official Documentation/17 Integration and Pricing/PRICING.md`
--
-- ## The trap this is the fourth instance of
--
-- `0130` granted `INSERT, UPDATE ON afritech.teacher_hub_plans TO authenticated`,
-- policy-gated to AfriTech. So the database has always permitted editing a plan.
--
-- **`supabase/config.toml` sets `schemas = ["public"]`.** PostgREST resolves
-- against that schema and nothing else, so a table in `afritech` is reachable
-- from SQL, a migration and a pgTAP suite — and never from a route. The grant was
-- real and unusable: changing the Hub's price meant editing the database by hand.
--
-- `CLAUDE.md` records three functions that drifted into `afritech` before `0139`
-- added `public` wrappers. This is the same mistake made with a TABLE rather than
-- a function, which is why the existing rule did not catch it: nothing fails at
-- build time, and the grant looks correct in review.
--
-- ## Why prices are not simply exposed through a view
--
-- A `security_invoker` view over the table would make it readable, and would also
-- make every column writable by anybody the policy admits — including
-- `plan_code`, which `standalone_teacher_accounts.plan_code` references. Renaming
-- a plan code in place would orphan every account on it.
--
-- So the write is a function with a fixed parameter list, and `plan_code`
-- identifies the row rather than being one of the things it can change.
--
-- ## What cannot be changed, and why
--
-- `billing_period` and `ai_credits_period` are not parameters. Both are read by
-- `ai_credit_balance()` to decide what window an allowance is summed over, and
-- changing one on a live plan silently re-prices every teacher on it — a teacher
-- on a monthly allowance switched to `lifetime` would find their credits never
-- reset. Changing a plan's period is a migration with a decision behind it, not a
-- field on a form.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Read.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_teacher_hub_plans()
RETURNS TABLE (
  out_plan_code           TEXT,
  out_display_name        TEXT,
  out_billing_period      TEXT,
  out_price               NUMERIC,
  out_currency_code       TEXT,
  out_included_resources  INT,
  out_ai_credits_included INT,
  out_ai_credits_period   TEXT,
  out_is_active           BOOLEAN,
  out_sort_order          INT,
  out_subscribers         INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'AfriTech only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.plan_code, p.display_name, p.billing_period, p.price, p.currency_code,
    p.included_resources, p.ai_credits_included, p.ai_credits_period,
    p.is_active, p.sort_order,
    -- How many teachers are on it. The number that makes a price change a
    -- decision rather than a typo: raising the price of a plan nobody holds is
    -- not the same act as raising one held by four hundred people.
    (SELECT COUNT(*)::INT
       FROM public.standalone_teacher_accounts AS a
      WHERE a.plan_code = p.plan_code
        AND a.subscription_status = 'active')
  FROM afritech.teacher_hub_plans AS p
  ORDER BY p.sort_order, p.plan_code;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Write.
--
-- NULL means "leave it alone" on every parameter, so a form that sends one field
-- does not blank the rest. `plan_code` identifies the row and is never a thing
-- this can change — see the header on orphaning accounts.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_teacher_hub_plan(
  p_plan_code           TEXT,
  p_display_name        TEXT    DEFAULT NULL,
  p_price               NUMERIC DEFAULT NULL,
  p_included_resources  INT     DEFAULT NULL,
  p_ai_credits_included INT     DEFAULT NULL,
  p_is_active           BOOLEAN DEFAULT NULL,
  p_sort_order          INT     DEFAULT NULL
)
RETURNS TABLE (out_updated BOOLEAN, out_plan_code TEXT, out_subscribers INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_rows INT;
  v_subs INT;
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'AfriTech only' USING ERRCODE = '42501';
  END IF;

  IF p_price IS NOT NULL AND p_price < 0 THEN
    RAISE EXCEPTION 'A plan price cannot be negative' USING ERRCODE = '22023';
  END IF;

  IF p_ai_credits_included IS NOT NULL AND p_ai_credits_included < 0 THEN
    RAISE EXCEPTION 'A credit allowance cannot be negative' USING ERRCODE = '22023';
  END IF;

  UPDATE afritech.teacher_hub_plans AS p
     SET display_name        = COALESCE(p_display_name, p.display_name),
         price               = COALESCE(p_price, p.price),
         included_resources  = COALESCE(p_included_resources, p.included_resources),
         ai_credits_included = COALESCE(p_ai_credits_included, p.ai_credits_included),
         is_active           = COALESCE(p_is_active, p.is_active),
         sort_order          = COALESCE(p_sort_order, p.sort_order),
         updated_at          = NOW()
   WHERE p.plan_code = p_plan_code;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN QUERY SELECT FALSE, p_plan_code, 0;
    RETURN;
  END IF;

  SELECT COUNT(*)::INT INTO v_subs
  FROM public.standalone_teacher_accounts AS a
  WHERE a.plan_code = p_plan_code AND a.subscription_status = 'active';

  /*
    Audited. A plan price is commercial configuration that changes what every
    teacher on it pays, and `afritech` tables carry no row-change trigger — so
    without this, a price change would leave no record of who made it.
  */
  PERFORM public.log_audit_event(
    'teacher_hub_plan_updated', 'teacher_hub_plans', NULL,
    jsonb_build_object(
      'plan_code', p_plan_code,
      'price', p_price,
      'ai_credits_included', p_ai_credits_included,
      'is_active', p_is_active,
      'subscribers_affected', v_subs
    ),
    NULL
  );

  RETURN QUERY SELECT TRUE, p_plan_code, v_subs;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants. AfriTech-only is enforced INSIDE each function as well as by the
-- grant, because `authenticated` covers every teacher and school user too.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_teacher_hub_plans()',
    'public.admin_update_teacher_hub_plan(TEXT, TEXT, NUMERIC, INT, INT, BOOLEAN, INT)'
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

-- ---------------------------------------------------------------------------
-- Assert the wrappers are in `public`.
--
-- The whole point is reachability from a route. A wrapper that drifted into
-- `afritech` would be exactly as unusable as the table it exists to expose, and
-- would look correct in review — which is how the original happened.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_name TEXT;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['admin_teacher_hub_plans', 'admin_update_teacher_hub_plan']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name
    ) THEN
      RAISE EXCEPTION '% is not in public, so PostgREST cannot reach it', v_name;
    END IF;
  END LOOP;
END;
$$;
