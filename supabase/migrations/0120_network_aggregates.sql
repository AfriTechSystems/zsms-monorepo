-- Migration: 0120_network_aggregates.sql
-- Created: 2026-09-27
-- Description: The read-only aggregate surface a School Network dashboard renders,
--              and the AfriTech-only function that attaches a school to a network.
-- Related documents: Official Documentation/15 Super Admin and Platform/PLATFORM_METRICS.md
--                    Official Documentation/01 Foundation Layer/DATABASE.md
--
-- ===========================================================================
-- BUILT FOR 100 SCHOOLS, WHICH DICTATES THE SHAPE
--
-- The obvious implementation is a function returning one row per school that
-- computes each metric with a correlated subquery. At 5 schools nobody notices; at
-- 100 it is 100 sequential scans per metric and the dashboard is the slowest screen
-- in the product.
--
-- So every metric below is ONE grouped scan over the network's whole school set,
-- joined together at the end. Five scans total regardless of whether the network
-- has 5 schools or 100. The existing `/api/admin/schools/[id]` N+1 — one
-- `school_has_feature()` call per feature — is the mistake this avoids repeating,
-- and it is already tracked in CLAUDE.md as wanting exactly this treatment.
--
-- Attendance is windowed to 30 days rather than all time. Across 100 schools all
-- time is millions of rows for a figure nobody reads at that range, and a
-- dashboard that is slow is a dashboard nobody opens.
--
-- WHAT THESE FUNCTIONS DO NOT RETURN
--
-- No pupil names, no individual fee records, no marks. `data_scope` gates the
-- financial columns, and academic detail is not offered at all at network level in
-- this migration. To see a child, a network member switches into that school and
-- becomes an ordinary `org:owner` — which is why this surface can be aggregate-only
-- without being useless.
-- ===========================================================================

-- === MIGRATION START ===

/**
 * One row per school in the caller's network.
 *
 * SECURITY DEFINER, gated on `my_network_id()`. The gate is the first thing it
 * does: with no network the CTE is empty and every join produces nothing, so a
 * caller outside a network gets an empty set rather than an error — which is the
 * right answer for a screen that simply does not apply to them.
 */
CREATE OR REPLACE FUNCTION public.network_school_summary()
RETURNS TABLE (
  out_school_uuid     UUID,
  out_school_code     TEXT,
  out_school_name     TEXT,
  out_city_code       TEXT,
  out_status          TEXT,
  out_tier            TEXT,
  out_clerk_org_id    TEXT,
  out_pupils          INT,
  out_staff           INT,
  out_capacity        INT,
  out_at_capacity     BOOLEAN,
  -- NULL rather than 0 when the caller may not see money. A zero would read as
  -- "this school is owed nothing", which is a different and false claim.
  out_fees_billed     NUMERIC,
  out_fees_collected  NUMERIC,
  out_fees_outstanding NUMERIC,
  out_collection_rate INT,
  out_attendance_rate INT,
  out_results_published INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH access AS (
  SELECT out_network_id AS network_id, out_can_see_money AS can_see_money
  FROM   public.my_network_access()
),
mine AS (
  SELECT ns.school_id
  FROM   public.school_network_schools ns
  JOIN   access a ON a.network_id = ns.network_id
  WHERE  ns.is_active
),
-- One grouped scan per metric. Not one per school.
pupil_counts AS (
  SELECT s.school_id, count(*)::INT AS pupils
  FROM   public.students s JOIN mine m ON m.school_id = s.school_id
  WHERE  s.is_deleted = FALSE AND s.status IN ('active', 'on_leave')
  GROUP  BY s.school_id
),
staff_counts AS (
  SELECT sm.school_id, count(*)::INT AS staff
  FROM   public.staff_members sm JOIN mine m ON m.school_id = sm.school_id
  WHERE  sm.is_active
  GROUP  BY sm.school_id
),
fee_totals AS (
  SELECT fr.school_id,
         SUM(fr.amount_due - COALESCE(fr.discount_amount, 0)) AS billed,
         SUM(fr.amount_paid) AS collected
  FROM   public.fee_records fr JOIN mine m ON m.school_id = fr.school_id
  GROUP  BY fr.school_id
),
attendance_rates AS (
  SELECT ar.school_id,
         -- Holidays out of the denominator, late counted as present — the same
         -- arithmetic the parent screens use. Three places computing an attendance
         -- rate differently is worse than any one of them being slightly coarse.
         count(*) FILTER (WHERE ar.status <> 'holiday') AS school_days,
         count(*) FILTER (WHERE ar.status IN ('present', 'late')) AS present_days
  FROM   public.attendance_records ar JOIN mine m ON m.school_id = ar.school_id
  WHERE  ar.attendance_date >= (CURRENT_DATE - INTERVAL '30 days')
  GROUP  BY ar.school_id
),
result_counts AS (
  SELECT er.school_id, count(*)::INT AS published
  FROM   public.exam_results er JOIN mine m ON m.school_id = er.school_id
  WHERE  er.results_published
  GROUP  BY er.school_id
)
SELECT sc.id, sc.school_id, sc.name, sc.city_code, sc.status, sc.subscription_tier,
       sc.clerk_org_id,
       COALESCE(pc.pupils, 0),
       COALESCE(stc.staff, 0),
       cap.student_limit,
       COALESCE(cap.at_capacity, FALSE),
       CASE WHEN a.can_see_money THEN COALESCE(ft.billed, 0) END,
       CASE WHEN a.can_see_money THEN COALESCE(ft.collected, 0) END,
       CASE WHEN a.can_see_money
            THEN COALESCE(ft.billed, 0) - COALESCE(ft.collected, 0) END,
       -- The rate is NOT gated: a collection percentage is a performance figure, not
       -- an amount, and it is what a viewer role exists to see. The kwacha are
       -- gated above.
       CASE WHEN COALESCE(ft.billed, 0) > 0
            THEN ROUND((COALESCE(ft.collected, 0) / ft.billed) * 100)::INT END,
       CASE WHEN COALESCE(ar.school_days, 0) > 0
            THEN ROUND((ar.present_days::NUMERIC / ar.school_days) * 100)::INT END,
       COALESCE(rc.published, 0)
FROM   mine m
JOIN   public.schools sc ON sc.id = m.school_id
CROSS JOIN access a
LEFT JOIN public.school_capacity cap ON cap.school_id = sc.id
LEFT JOIN pupil_counts     pc  ON pc.school_id  = sc.id
LEFT JOIN staff_counts     stc ON stc.school_id = sc.id
LEFT JOIN fee_totals       ft  ON ft.school_id  = sc.id
LEFT JOIN attendance_rates ar  ON ar.school_id  = sc.id
LEFT JOIN result_counts    rc  ON rc.school_id  = sc.id
ORDER  BY sc.name;
$$;

COMMENT ON FUNCTION public.network_school_summary() IS
  'One row per school in the caller''s network, aggregates only. Five grouped scans '
  'regardless of school count — built for 100 schools. Money columns are NULL when '
  'the network''s data_scope or the caller''s role does not permit them.';

/**
 * Network totals, derived from the per-school summary.
 *
 * Built on the same function rather than re-aggregating the base tables, so the
 * dashboard's headline figures cannot disagree with the list beneath them. That
 * disagreement is the classic reporting bug and it is entirely avoidable.
 */
CREATE OR REPLACE FUNCTION public.network_overview()
RETURNS TABLE (
  out_schools          INT,
  out_pupils           INT,
  out_staff            INT,
  out_fees_billed      NUMERIC,
  out_fees_collected   NUMERIC,
  out_fees_outstanding NUMERIC,
  out_collection_rate  INT,
  out_attendance_rate  INT,
  out_schools_at_capacity INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::INT,
         COALESCE(SUM(out_pupils), 0)::INT,
         COALESCE(SUM(out_staff), 0)::INT,
         SUM(out_fees_billed),
         SUM(out_fees_collected),
         SUM(out_fees_outstanding),
         CASE WHEN COALESCE(SUM(out_fees_billed), 0) > 0
              THEN ROUND((SUM(out_fees_collected) / SUM(out_fees_billed)) * 100)::INT END,
         -- Weighted by pupils, not a mean of percentages. A mean would let a
         -- 12-pupil school move the network's attendance figure as much as a
         -- 900-pupil one, which is how a headline number becomes meaningless.
         CASE WHEN SUM(out_pupils) FILTER (WHERE out_attendance_rate IS NOT NULL) > 0
              THEN ROUND(
                SUM(out_attendance_rate * out_pupils) FILTER (WHERE out_attendance_rate IS NOT NULL)::NUMERIC
                / SUM(out_pupils) FILTER (WHERE out_attendance_rate IS NOT NULL)
              )::INT END,
         count(*) FILTER (WHERE out_at_capacity)::INT
  FROM   public.network_school_summary();
$$;

-- ---------------------------------------------------------------------------
-- Attaching a school — AfriTech only, one school at a time.
-- ---------------------------------------------------------------------------

/**
 * Attaches a school to a network, or moves it from another one.
 *
 * AfriTech only. The agreed decision, and the reason is concrete: there is no
 * proof-of-ownership check anywhere in this system, so a self-service version would
 * let any network attach any school by id and read its aggregates immediately.
 *
 * Moving a school retires the previous row rather than updating it, so the history
 * of which network a school belonged to survives — the partial unique index permits
 * exactly one active row per school and any number of retired ones.
 */
CREATE OR REPLACE FUNCTION public.attach_school_to_network(
  p_network_id UUID,
  p_school_id  UUID
)
RETURNS public.school_network_schools
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.school_network_schools;
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION
      'Only AfriTech can attach a school to a network. Ownership of a school is '
      'not something this system can verify, so it is not self-service.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.school_networks WHERE id = p_network_id) THEN
    RAISE EXCEPTION 'Network not found.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = p_school_id) THEN
    RAISE EXCEPTION 'School not found.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Already here: nothing to do, and reporting success is truthful.
  SELECT * INTO v_row FROM public.school_network_schools
  WHERE school_id = p_school_id AND network_id = p_network_id AND is_active;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  -- Retire an attachment to a different network, keeping the history.
  UPDATE public.school_network_schools
  SET    is_active = FALSE, detached_at = NOW()
  WHERE  school_id = p_school_id AND is_active;

  INSERT INTO public.school_network_schools (network_id, school_id, attached_by)
  VALUES (p_network_id, p_school_id,
          NULLIF(btrim(COALESCE(current_setting('request.jwt.claims', true), '')), '')::JSONB->>'sub')
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.detach_school_from_network(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'Only AfriTech can detach a school from a network.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.school_network_schools
  SET    is_active = FALSE, detached_at = NOW()
  WHERE  school_id = p_school_id AND is_active;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.network_school_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.network_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_school_to_network(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detach_school_from_network(UUID) TO authenticated;

-- === MIGRATION END ===
