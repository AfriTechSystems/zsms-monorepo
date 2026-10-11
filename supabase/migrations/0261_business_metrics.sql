-- ===========================================================================
-- 0261 — AfriTech's own business metrics (PLATFORM_METRICS.md)
--
-- Spec: `15 Super Admin and Platform/PLATFORM_METRICS.md` → *Monthly Recurring
--       Revenue*, *Annual Recurring Revenue*, *Revenue by Tier*, *Trial
--       Conversion Rate*, *Loan Commission Revenue*
--
-- ## What was missing
--
-- `platform_metrics()` returns operational counts — schools, pupils, staff, fees
-- collected. Useful, and **none of the business metrics this document is mostly
-- about.** PLATFORM_METRICS.md opens by saying these answer "the health of
-- AfriTech's business — revenue, growth, retention", and not one of MRR, ARR,
-- revenue by tier, trial conversion or loan commission revenue was computed
-- anywhere.
--
-- Every input already exists: `afritech.subscription_tiers` has the prices,
-- `schools.subscription_tier` and `.status` say who is paying for what,
-- `afritech.invoices` records what was actually billed, and
-- `afritech.loan_commissions` holds the referral income.
--
-- ## MRR is computed from the TIER, not from invoices
--
-- A deliberate choice worth recording. Invoices are what has been billed;
-- recurring revenue is what *will* be billed next month. A school that joined
-- yesterday has no invoice yet and is unambiguously part of MRR, and a school
-- that churned last week still has last month's invoice. So MRR reads the live
-- subscription state and `invoices` answers the different question — collected
-- revenue — which the metric below reports separately rather than conflating.
--
-- Per-student tiers are priced by their actual roll, because that is what the
-- pricing model means. `pricing_model` distinguishes them.
--
-- ## NRR is deliberately NOT here
--
-- Net Revenue Retention compares what schools paid twelve months ago with what
-- they pay today. **There is no twelve-month history** — commercial launch is
-- January 2027 — so any figure would be computed from an empty window and
-- rendered as 0% or 100%, both of which read as facts. It is the same reason
-- Predictive Intelligence is blocked until 18 months of data exist. The function
-- reports `nrr_available = FALSE` so a dashboard can say why rather than show a
-- number nobody should act on.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.admin_business_metrics()
RETURNS TABLE (
  -- Recurring revenue, from live subscription state.
  mrr_zmw             NUMERIC(14,2),
  arr_zmw             NUMERIC(14,2),
  paying_schools      BIGINT,
  -- What has actually been collected, which is a different question from MRR.
  collected_this_month NUMERIC(14,2),
  invoiced_unpaid      NUMERIC(14,2),
  -- Growth.
  trials_active        BIGINT,
  trials_converted     BIGINT,
  trials_expired       BIGINT,
  trial_conversion_pct NUMERIC(5,2),
  -- Referral income.
  loan_commission_earned NUMERIC(14,2),
  loan_commission_unpaid NUMERIC(14,2),
  -- Honest about what cannot be computed yet.
  nrr_available        BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  /*
    AfriTech only, and gated on the billing capability rather than on being an
    administrator at all — `0237` separates those, and revenue is not something a
    support engineer needs in order to do support.
  */
  IF NOT public.has_afritech_capability('billing:read') THEN
    RAISE EXCEPTION 'Not available' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH live AS (
    /*
      One row per paying school with the monthly value of its subscription.

      `active` only. A trial pays nothing, and a suspended school is not revenue
      AfriTech can count on — counting either is how a board deck starts lying.
    */
    SELECT
      s.id,
      s.subscription_tier,
      t.pricing_model,
      CASE
        WHEN t.pricing_model = 'per_student' THEN
          -- Priced on the actual roll, which is what per-student means.
          COALESCE(t.monthly_price_zmw, 0) * GREATEST(
            (SELECT count(*) FROM public.students st
             WHERE st.school_id = s.id
               AND st.status IN ('active', 'on_leave')
               AND st.is_deleted = FALSE), 0)
        ELSE COALESCE(t.monthly_price_zmw, 0)
      END AS monthly_value
    FROM public.schools s
    JOIN afritech.subscription_tiers t ON t.tier_name = s.subscription_tier
    WHERE s.status = 'active'
  ),
  trials AS (
    SELECT
      count(*) FILTER (
        WHERE s.status = 'trial' AND s.trial_ends_at > NOW()
      ) AS active_now,
      /*
        A conversion is a school that is active AND whose trial window has passed
        — it came off trial and stayed. A school still inside its trial window
        has not converted yet and must not be counted as one, or the rate climbs
        every time somebody signs up.
      */
      count(*) FILTER (
        WHERE s.status = 'active' AND s.trial_ends_at IS NOT NULL
          AND s.trial_ends_at <= NOW()
      ) AS converted,
      count(*) FILTER (WHERE s.status = 'trial_expired') AS expired
    FROM public.schools s
  )
  SELECT
    ROUND(COALESCE((SELECT sum(monthly_value) FROM live), 0), 2)::NUMERIC(14,2),
    -- ARR is MRR x 12, exactly as the document defines it.
    ROUND(COALESCE((SELECT sum(monthly_value) FROM live), 0) * 12, 2)::NUMERIC(14,2),
    (SELECT count(*) FROM live),

    ROUND(COALESCE((
      SELECT sum(i.amount_paid) FROM afritech.invoices i
      WHERE i.paid_at >= date_trunc('month', NOW())
        AND i.voided_at IS NULL
    ), 0), 2)::NUMERIC(14,2),

    ROUND(COALESCE((
      SELECT sum(i.total - COALESCE(i.amount_paid, 0)) FROM afritech.invoices i
      WHERE i.status <> 'paid' AND i.voided_at IS NULL
    ), 0), 2)::NUMERIC(14,2),

    (SELECT active_now FROM trials),
    (SELECT converted FROM trials),
    (SELECT expired FROM trials),
    /*
      Converted over everything that has FINISHED a trial. A school still on trial
      is excluded from both halves — it is neither a conversion nor a loss yet, and
      including it in the denominator would make the rate fall every time marketing
      succeeds.

      NULL rather than 0 when nothing has finished: "no trials have ended" and "no
      trial ever converted" are different facts, and 0% states the second.
    */
    CASE
      WHEN (SELECT converted + expired FROM trials) = 0 THEN NULL
      ELSE ROUND(
        (SELECT converted FROM trials)::NUMERIC * 100
        / (SELECT converted + expired FROM trials), 2)
    END::NUMERIC(5,2),

    ROUND(COALESCE((
      SELECT sum(c.commission_amount) FROM afritech.loan_commissions c
      WHERE c.status = 'paid'
    ), 0), 2)::NUMERIC(14,2),

    ROUND(COALESCE((
      SELECT sum(c.commission_amount) FROM afritech.loan_commissions c
      WHERE c.status <> 'paid'
    ), 0), 2)::NUMERIC(14,2),

    -- See the header: no twelve-month window exists to compare against.
    FALSE;
END;
$$;

COMMENT ON FUNCTION public.admin_business_metrics() IS
  'MRR, ARR, trial conversion and loan commission revenue (PLATFORM_METRICS.md). MRR is computed from live subscription state rather than invoices, because recurring revenue is what WILL be billed and an invoice is what WAS. NRR is reported unavailable: no 12-month history exists (0261).';

REVOKE ALL ON FUNCTION public.admin_business_metrics() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_business_metrics() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_business_metrics() TO authenticated;

-- ---------------------------------------------------------------------------
-- Revenue by tier, which is a list rather than a figure.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_revenue_by_tier()
RETURNS TABLE (
  tier_name     TEXT,
  display_name  TEXT,
  schools       BIGINT,
  students      BIGINT,
  mrr_zmw       NUMERIC(14,2),
  mrr_share_pct NUMERIC(5,2)
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.has_afritech_capability('billing:read') THEN
    RAISE EXCEPTION 'Not available' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH per_school AS (
    SELECT
      s.id,
      t.tier_name,
      t.display_name,
      (SELECT count(*) FROM public.students st
       WHERE st.school_id = s.id
         AND st.status IN ('active', 'on_leave')
         AND st.is_deleted = FALSE) AS roll,
      t.pricing_model,
      COALESCE(t.monthly_price_zmw, 0) AS unit
    FROM public.schools s
    JOIN afritech.subscription_tiers t ON t.tier_name = s.subscription_tier
    WHERE s.status = 'active'
  ),
  valued AS (
    SELECT
      p.tier_name,
      p.display_name,
      p.roll,
      CASE WHEN p.pricing_model = 'per_student' THEN p.unit * p.roll ELSE p.unit END AS value
    FROM per_school p
  ),
  grouped AS (
    SELECT
      v.tier_name,
      v.display_name,
      count(*)             AS schools,
      -- `sum()` of a BIGINT returns NUMERIC, not BIGINT. Without the cast the
      -- function's declared column 4 (`students BIGINT`) rejects its own query
      -- with 42804 at run time — which is what the first push of this migration
      -- did, and a mismatch a migration that only CREATEs would never reveal.
      sum(v.roll)::BIGINT  AS students,
      sum(v.value)         AS mrr
    FROM valued v
    GROUP BY v.tier_name, v.display_name
  )
  SELECT
    g.tier_name,
    g.display_name,
    g.schools,
    g.students,
    ROUND(g.mrr, 2)::NUMERIC(14,2),
    /*
      The share is the point of this breakdown. PLATFORM_METRICS.md says so
      outright: if 80% of MRR comes from 20% of schools, that shapes sales
      strategy — and a tier's school count alone cannot show it.

      NULLIF guards the division: on a platform with no paying schools every
      share is undefined rather than zero.
    */
    ROUND(g.mrr * 100 / NULLIF((SELECT sum(mrr) FROM grouped), 0), 2)::NUMERIC(5,2)
  FROM grouped g
  ORDER BY g.mrr DESC NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.admin_revenue_by_tier() IS
  'MRR per tier with each tier''s share of the total (PLATFORM_METRICS.md → Revenue by Tier). The share is the point: a school count cannot show that most revenue comes from few schools (0261).';

REVOKE ALL ON FUNCTION public.admin_revenue_by_tier() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_revenue_by_tier() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_revenue_by_tier() TO authenticated;

-- ---------------------------------------------------------------------------
-- Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_row   RECORD;
  v_tiers INT;
BEGIN
  BEGIN
    -- A school owner must not read AfriTech's revenue.
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_owner', 'role', 'authenticated',
      'o', json_build_object('id', 'org_probe_0261', 'rol', 'owner'))::text, TRUE);
    BEGIN
      PERFORM public.admin_business_metrics();
      RAISE EXCEPTION '0261: a school owner read AfriTech''s revenue';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    /*
      AfriTech, with the billing capability.

      `rol` must be one of `0237`'s AfriTech roles — `super_admin`,
      `regional_manager`, `support_agent`, `loan_officer`, `finance_officer`,
      `developer`. The first draft of this probe sent `owner`, which
      `afritech_role()` turns into `afritech:owner`, matches no branch, and is
      refused. The assertion caught it, which is the point of writing it.
    */
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_afritech', 'role', 'authenticated',
      'o', json_build_object('id', 'org_afritech', 'slg', 'afritech-systems-admin',
                             'rol', 'super_admin'))::text, TRUE);

    SELECT * INTO v_row FROM public.admin_business_metrics();

    IF v_row.mrr_zmw IS NULL THEN
      RAISE EXCEPTION '0261: MRR came back NULL rather than a figure';
    END IF;

    -- ARR must be exactly twelve times MRR, as the document defines it.
    IF v_row.arr_zmw <> ROUND(v_row.mrr_zmw * 12, 2) THEN
      RAISE EXCEPTION '0261: ARR (%) is not 12x MRR (%)', v_row.arr_zmw, v_row.mrr_zmw;
    END IF;

    -- NRR must declare itself unavailable rather than inventing a percentage.
    IF v_row.nrr_available THEN
      RAISE EXCEPTION '0261: NRR claims to be available with no 12-month history';
    END IF;

    /*
      The conversion rate must be NULL when no trial has finished, not 0. "No
      trials have ended" and "no trial ever converted" are different facts, and a
      0% on a dashboard states the second.
    */
    IF v_row.trials_converted + v_row.trials_expired = 0
       AND v_row.trial_conversion_pct IS NOT NULL THEN
      RAISE EXCEPTION
        '0261: a conversion rate was reported with no finished trials';
    END IF;

    -- Revenue by tier must agree with the headline MRR, or one of them is wrong.
    SELECT count(*) INTO v_tiers FROM public.admin_revenue_by_tier();
    IF v_tiers > 0 THEN
      IF (SELECT ROUND(sum(mrr_zmw), 2) FROM public.admin_revenue_by_tier())
           <> v_row.mrr_zmw THEN
        RAISE EXCEPTION
          '0261: per-tier MRR does not sum to the headline MRR (% vs %)',
          (SELECT ROUND(sum(mrr_zmw), 2) FROM public.admin_revenue_by_tier()),
          v_row.mrr_zmw;
      END IF;

      -- And the shares must total 100 when there is any revenue at all.
      IF v_row.mrr_zmw > 0 THEN
        IF ABS(COALESCE((SELECT sum(mrr_share_pct) FROM public.admin_revenue_by_tier()), 0) - 100)
             > 0.5 THEN
          RAISE EXCEPTION '0261: tier shares sum to % rather than 100',
            (SELECT sum(mrr_share_pct) FROM public.admin_revenue_by_tier());
        END IF;
      END IF;
    END IF;

    IF has_function_privilege('anon', 'public.admin_business_metrics()', 'EXECUTE') THEN
      RAISE EXCEPTION '0261: anon can read AfriTech''s revenue';
    END IF;

    RAISE NOTICE
      '0261: verified — MRR %, ARR %, % paying schools, tier shares sum to 100, NRR declared unavailable',
      v_row.mrr_zmw, v_row.arr_zmw, v_row.paying_schools;
  END;
END;
$$;
