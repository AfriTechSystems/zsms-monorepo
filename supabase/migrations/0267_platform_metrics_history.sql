-- ===========================================================================
-- 0267 — a history to draw a growth line against
--
-- Spec: reference image W1, which shows a twelve-month "School Growth" chart.
--
-- ## Why this migration exists at all
--
-- That chart was the one thing in W1 I refused to draw. `platform_metrics()`
-- returns **current counts**, not a history, so a growth line would have meant
-- inventing ten months of data — and a reader cannot tell an invented trend from
-- a measured one. It was omitted and raised as a gap instead.
--
-- This closes it honestly: a daily snapshot, and a chart that shows only what has
-- actually been recorded.
--
-- ## A snapshot table, not a query over history
--
-- There is no way to ask "how many schools were active in March" after the fact.
-- `schools.status` holds today's value and `created_at` cannot answer it either:
-- a school created in January and suspended in February was active in neither
-- month by that reasoning. The only correct answer is to have written it down at
-- the time, which is what this does.
--
-- ## Deliberately coarse
--
-- One row per day per metric, not per hour. The chart is monthly; finer
-- resolution would be rows nobody reads. Recording is idempotent per day, so a
-- worker that runs twice leaves one row.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS afritech.platform_metrics_daily (
  captured_on    DATE NOT NULL,
  schools_total  INT  NOT NULL,
  schools_active INT  NOT NULL,
  schools_trial  INT  NOT NULL,
  students_total INT  NOT NULL,
  staff_total    INT  NOT NULL,
  /*
    MRR as at that day. A figure a board asks about retrospectively more often
    than any other, and the one that is most obviously wrong to back-fill.
  */
  mrr_zmw        NUMERIC(14,2) NOT NULL DEFAULT 0,
  captured_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (captured_on)
);

COMMENT ON TABLE afritech.platform_metrics_daily IS
  'One snapshot per day of the platform-wide counts. Exists because "how many schools were active in March" is unanswerable after the fact — status holds today''s value and created_at cannot reconstruct it (0267).';

/*
  `afritech` is not exposed through PostgREST, so this table is reachable from SQL,
  a migration and a pgTAP suite — never from a route. The reader below is a `public`
  function for exactly that reason.
*/
ALTER TABLE afritech.platform_metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.platform_metrics_daily FORCE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Capture. Called by the worker; idempotent per day.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.worker_capture_platform_metrics()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mrr NUMERIC(14,2);
BEGIN
  /*
    MRR computed the same way `admin_business_metrics()` does — from live
    subscription state rather than from invoices, because recurring revenue is what
    WILL be billed and an invoice is what WAS. Duplicated deliberately rather than
    calling that function: it is gated on `billing:read`, and a worker has no
    capabilities at all.
  */
  SELECT COALESCE(SUM(
    CASE
      WHEN t.pricing_model = 'per_student' THEN
        COALESCE(t.monthly_price_zmw, 0) * GREATEST((
          SELECT count(*) FROM public.students st
          WHERE st.school_id = s.id
            AND st.status IN ('active', 'on_leave')
            AND st.is_deleted = FALSE), 0)
      ELSE COALESCE(t.monthly_price_zmw, 0)
    END), 0)
  INTO v_mrr
  FROM public.schools s
  JOIN afritech.subscription_tiers t ON t.tier_name = s.subscription_tier
  WHERE s.status = 'active';

  INSERT INTO afritech.platform_metrics_daily AS d
    (captured_on, schools_total, schools_active, schools_trial,
     students_total, staff_total, mrr_zmw)
  SELECT
    CURRENT_DATE,
    (SELECT count(*) FROM public.schools),
    (SELECT count(*) FROM public.schools WHERE status = 'active'),
    (SELECT count(*) FROM public.schools WHERE status = 'trial'),
    (SELECT count(*) FROM public.students
      WHERE status IN ('active', 'on_leave') AND is_deleted = FALSE),
    (SELECT count(*) FROM public.staff_members WHERE COALESCE(is_active, TRUE)),
    v_mrr
  /*
    Re-running on the same day OVERWRITES rather than being ignored. A worker that
    retried after a partial failure should leave the later, more complete reading —
    and a snapshot taken at 02:00 is not more true than one taken at 02:05.
  */
  ON CONFLICT (captured_on) DO UPDATE
  SET schools_total  = EXCLUDED.schools_total,
      schools_active = EXCLUDED.schools_active,
      schools_trial  = EXCLUDED.schools_trial,
      students_total = EXCLUDED.students_total,
      staff_total    = EXCLUDED.staff_total,
      mrr_zmw        = EXCLUDED.mrr_zmw,
      captured_at    = NOW();

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.worker_capture_platform_metrics() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_capture_platform_metrics() FROM anon;
REVOKE ALL ON FUNCTION public.worker_capture_platform_metrics() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.worker_capture_platform_metrics() TO service_role;

-- ---------------------------------------------------------------------------
-- Reading.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_platform_history(p_days INT DEFAULT 365)
RETURNS TABLE (
  out_captured_on    DATE,
  out_schools_total  INT,
  out_schools_active INT,
  out_students_total INT,
  out_mrr_zmw        NUMERIC(14,2)
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

  /*
    Returns ONLY days that were actually captured. No gap filling, no carrying the
    last value forward.

    A line drawn through interpolated points looks exactly like a line drawn through
    measured ones, and the chart's whole purpose is to be believed. A gap in the
    data should look like a gap.
  */
  RETURN QUERY
  SELECT d.captured_on, d.schools_total, d.schools_active, d.students_total, d.mrr_zmw
  FROM afritech.platform_metrics_daily d
  WHERE d.captured_on >= CURRENT_DATE - GREATEST(p_days, 1)
  ORDER BY d.captured_on;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_platform_history(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_platform_history(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_history(INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_before INT;
  v_after  INT;
  v_row    RECORD;
BEGIN
  SELECT count(*)::INT INTO v_before FROM afritech.platform_metrics_daily;

  PERFORM public.worker_capture_platform_metrics();
  SELECT count(*)::INT INTO v_after FROM afritech.platform_metrics_daily;

  IF v_after <> v_before + 1 AND v_before > 0 THEN
    NULL;  -- today may already have been captured; the idempotency check below covers it
  END IF;

  SELECT * INTO v_row FROM afritech.platform_metrics_daily
  WHERE captured_on = CURRENT_DATE;

  IF v_row.captured_on IS NULL THEN
    RAISE EXCEPTION '0267: capture produced no row for today';
  END IF;
  IF v_row.schools_total < v_row.schools_active THEN
    RAISE EXCEPTION '0267: more active schools than schools exist';
  END IF;

  -- Running twice must leave ONE row for today, not two.
  PERFORM public.worker_capture_platform_metrics();
  SELECT count(*)::INT INTO v_after
  FROM afritech.platform_metrics_daily WHERE captured_on = CURRENT_DATE;

  IF v_after <> 1 THEN
    RAISE EXCEPTION '0267: capturing twice in one day left % rows', v_after;
  END IF;

  -- The worker function must be unreachable by a signed-in user.
  IF has_function_privilege('authenticated',
       'public.worker_capture_platform_metrics()', 'EXECUTE') THEN
    RAISE EXCEPTION '0267: a signed-in user can write platform history';
  END IF;
  IF has_function_privilege('anon', 'public.admin_platform_history(INT)', 'EXECUTE') THEN
    RAISE EXCEPTION '0267: anon can read platform history';
  END IF;

  RAISE NOTICE '0267: verified — capture works, idempotent per day, worker-only write';
END;
$$;
