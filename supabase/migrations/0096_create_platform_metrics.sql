-- Migration: 0096_create_platform_metrics.sql
-- Created: 2026-08-17
-- Description: Platform-wide metrics and per-school health scores for the
--              AfriTech admin dashboard.
-- Related documents: Official Documentation/15 Super Admin and Platform/PLATFORM_METRICS.md
--                    Official Documentation/15 Super Admin and Platform/SCHOOL_HEALTH_SCORES.md
--                    Official Documentation/15 Super Admin and Platform/SUPERADMIN.md

-- === MIGRATION START ===

-- **These are SECURITY INVOKER on purpose, and that is the whole design.**
--
-- The obvious shape for an admin dashboard is a `SECURITY DEFINER` function that
-- checks `is_afritech_admin()` and then reads everything. That works, and it
-- puts a second copy of the authorisation rule in a place where nothing tests
-- it — the same trade ADR-042 had to make for workers, and it is only worth
-- making when there is no alternative.
--
-- Here there is one. Every table these read already carries an
-- `afritech_admin_all_*` policy, so RLS already answers "who may see across
-- schools". Running as INVOKER means the aggregate is scoped by exactly the
-- policies the pgTAP suites already assert: an AfriTech admin gets the platform,
-- a school owner calling the same function gets their own school and nothing
-- else, and a parent gets nothing. No new authorisation surface, no second rule
-- to keep in step.
--
-- The consequence to know: these return *what the caller may see*, not "the
-- platform". A school owner calling `platform_metrics()` gets a row of ones.
-- That is correct rather than a leak.

-- ---------------------------------------------------------------------------
-- platform_metrics — the top of the admin dashboard
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_metrics()
RETURNS TABLE (
  schools_total          BIGINT,
  schools_active         BIGINT,
  schools_trial          BIGINT,
  schools_suspended      BIGINT,
  students_total         BIGINT,
  staff_total            BIGINT,
  collected_this_month   NUMERIC,
  outstanding_total      NUMERIC,
  arrears_total          NUMERIC,
  payments_pending       BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM public.schools),
    (SELECT count(*) FROM public.schools WHERE status = 'active'),
    (SELECT count(*) FROM public.schools WHERE status = 'trial'),
    (SELECT count(*) FROM public.schools WHERE status = 'suspended'),
    -- Soft-deleted students are excluded everywhere they are counted. A
    -- withdrawn pupil still has rows (CONVENTIONS.md prohibition 8) and would
    -- otherwise inflate every enrolment figure on the dashboard.
    (SELECT count(*) FROM public.students WHERE NOT is_deleted AND status = 'active'),
    (SELECT count(*) FROM public.staff_members WHERE is_active),
    -- Verified payments only. A recorded-but-unverified payment is a claim, not
    -- money, and putting it in a revenue figure is how a dashboard lies.
    COALESCE((SELECT sum(amount) FROM public.payments
               WHERE status = 'verified'
                 AND paid_at >= date_trunc('month', NOW())), 0),
    COALESCE((SELECT sum(GREATEST(amount_due - amount_paid - discount_amount, 0))
                FROM public.fee_records), 0),
    COALESCE((SELECT sum(GREATEST(amount_due - amount_paid - discount_amount, 0))
                FROM public.fee_records
               WHERE due_date < CURRENT_DATE), 0),
    (SELECT count(*) FROM public.payments WHERE status = 'pending_verification');
$$;

COMMENT ON FUNCTION public.platform_metrics() IS
  'Dashboard headline figures, scoped by RLS. An AfriTech admin sees the platform; a school sees itself.';

GRANT EXECUTE ON FUNCTION public.platform_metrics() TO authenticated;

-- ---------------------------------------------------------------------------
-- school_health_scores — the churn early-warning table
--
-- Implements SCHOOL_HEALTH_SCORES.md: three dimensions weighted 40 / 30 / 30,
-- banded at 80 / 65 / 45. The band thresholds and dimension weights are the
-- document's, not chosen here.
--
-- **Two of the document's inputs cannot be computed from this schema yet, and
-- are omitted rather than approximated:**
--
--   * `active_teacher_rate` needs a per-user last-active timestamp. `staff_members`
--     has no login telemetry, and inferring "active" from whether a teacher ever
--     marked attendance conflates the staff-engagement dimension with the
--     attendance one — it would make the operational score partly a function of
--     itself.
--   * `parent_app_usage` needs mobile session data. PowerSync is Phase 4+.
--
-- Where an input is unavailable its sub-score is excluded and the dimension is
-- rescaled over the sub-scores that ARE measurable, so a missing input does not
-- silently read as a zero. A school with perfect attendance should not show as
-- unhealthy because we cannot yet see teacher logins. `inputs_available` is
-- returned so the dashboard can say which score is provisional instead of
-- presenting a partial score as a complete one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_health_scores()
RETURNS TABLE (
  school_id          UUID,
  school_code        TEXT,
  school_name        TEXT,
  status             TEXT,
  subscription_tier  TEXT,
  students           BIGINT,
  operational_score  INT,
  financial_score    INT,
  engagement_score   INT,
  composite_score    INT,
  band               TEXT,
  inputs_available   INT,
  inputs_total       INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH base AS (
    SELECT s.id, s.school_id AS code, s.name, s.status, s.subscription_tier,
           (SELECT count(*) FROM public.students st
             WHERE st.school_id = s.id AND NOT st.is_deleted AND st.status = 'active') AS student_count
    FROM public.schools s
  ),
  operational AS (
    SELECT b.id,
      -- Attendance compliance: school days in the last 30 on which ANY
      -- attendance was recorded. A school that marks registers is a school
      -- using the product.
      COALESCE((
        SELECT count(DISTINCT a.attendance_date)::NUMERIC / 22.0
        FROM public.attendance_records a
        WHERE a.school_id = b.id AND a.attendance_date >= CURRENT_DATE - 30
      ), 0) AS attendance_rate,
      -- Marks completion: results entered this year against students enrolled.
      CASE WHEN b.student_count = 0 THEN 0 ELSE COALESCE((
        SELECT count(DISTINCT e.student_id)::NUMERIC / b.student_count
        FROM public.exam_results e
        WHERE e.school_id = b.id
      ), 0) END AS marks_rate
    FROM base b
  ),
  financial AS (
    SELECT b.id,
      -- Collection rate: paid against billed, all time.
      CASE WHEN COALESCE((SELECT sum(f.amount_due) FROM public.fee_records f WHERE f.school_id = b.id), 0) = 0
        THEN NULL
        ELSE LEAST(
          COALESCE((SELECT sum(f.amount_paid) FROM public.fee_records f WHERE f.school_id = b.id), 0)
          / NULLIF((SELECT sum(f.amount_due) FROM public.fee_records f WHERE f.school_id = b.id), 0), 1)
      END AS collection_rate,
      -- Arrears ratio: overdue against billed. Lower is healthier.
      CASE WHEN COALESCE((SELECT sum(f.amount_due) FROM public.fee_records f WHERE f.school_id = b.id), 0) = 0
        THEN NULL
        ELSE COALESCE((SELECT sum(GREATEST(f.amount_due - f.amount_paid - f.discount_amount, 0))
                         FROM public.fee_records f
                        WHERE f.school_id = b.id AND f.due_date < CURRENT_DATE), 0)
             / NULLIF((SELECT sum(f.amount_due) FROM public.fee_records f WHERE f.school_id = b.id), 0)
      END AS arrears_ratio
    FROM base b
  ),
  engagement AS (
    SELECT b.id,
      -- Parent activation: students with at least one active guardian link.
      CASE WHEN b.student_count = 0 THEN NULL ELSE COALESCE((
        SELECT count(DISTINCT l.student_id)::NUMERIC / b.student_count
        FROM public.student_parent_links l
        JOIN public.students st ON st.id = l.student_id
        WHERE st.school_id = b.id AND l.is_active
      ), 0) END AS parent_rate,
      -- Communication: messages actually dispatched in the last 30 days.
      (SELECT count(*) FROM public.message_log m
        WHERE m.school_id = b.id AND m.created_at >= NOW() - INTERVAL '30 days') AS messages_30d
    FROM base b
  ),
  scored AS (
    SELECT b.id, b.code, b.name, b.status, b.subscription_tier, b.student_count,
      -- Operational, 40% of the composite. Two of the document's three
      -- sub-scores are measurable; they are rescaled from 80 to 100 so the
      -- missing staff-engagement input does not read as a zero.
      LEAST(100, ROUND((
        (CASE WHEN o.attendance_rate >= 0.90 THEN 50
              WHEN o.attendance_rate >= 0.75 THEN 38
              WHEN o.attendance_rate >= 0.50 THEN 25
              WHEN o.attendance_rate >= 0.25 THEN 10
              ELSE 0 END)
      + (CASE WHEN o.marks_rate >= 0.90 THEN 30
              WHEN o.marks_rate >= 0.70 THEN 22
              WHEN o.marks_rate >= 0.50 THEN 15
              WHEN o.marks_rate >= 0.25 THEN 7
              ELSE 0 END)
      ) * 100.0 / 80.0))::INT AS op_score,

      -- Financial, 30%. A school with no fee records has nothing to measure, so
      -- it scores 50 rather than 0 — an unbilled school is unconfigured, not
      -- failing, and a nightly report that calls every new school "critical" is
      -- a report the customer-success team learns to ignore.
      (CASE WHEN f.collection_rate IS NULL THEN 50
            ELSE ROUND((
              (CASE WHEN f.collection_rate >= 0.90 THEN 60
                    WHEN f.collection_rate >= 0.75 THEN 45
                    WHEN f.collection_rate >= 0.50 THEN 30
                    WHEN f.collection_rate >= 0.25 THEN 15
                    ELSE 0 END)
            + (CASE WHEN COALESCE(f.arrears_ratio, 0) <= 0.05 THEN 40
                    WHEN COALESCE(f.arrears_ratio, 0) <= 0.15 THEN 30
                    WHEN COALESCE(f.arrears_ratio, 0) <= 0.30 THEN 18
                    WHEN COALESCE(f.arrears_ratio, 0) <= 0.50 THEN 8
                    ELSE 0 END)
            )) END)::INT AS fin_score,

      -- Engagement, 30%. Parent activation plus whether the school actually
      -- communicates. Rescaled from 70 for the absent app-usage input.
      LEAST(100, ROUND((
        (CASE WHEN COALESCE(e.parent_rate, 0) >= 0.80 THEN 40
              WHEN COALESCE(e.parent_rate, 0) >= 0.60 THEN 30
              WHEN COALESCE(e.parent_rate, 0) >= 0.40 THEN 20
              WHEN COALESCE(e.parent_rate, 0) >= 0.20 THEN 10
              ELSE 0 END)
      + (CASE WHEN e.messages_30d >= 100 THEN 30
              WHEN e.messages_30d >= 30  THEN 22
              WHEN e.messages_30d >= 10  THEN 14
              WHEN e.messages_30d >= 1   THEN 6
              ELSE 0 END)
      ) * 100.0 / 70.0))::INT AS eng_score
    FROM base b
    JOIN operational o ON o.id = b.id
    JOIN financial   f ON f.id = b.id
    JOIN engagement  e ON e.id = b.id
  )
  SELECT
    s.id, s.code, s.name, s.status, s.subscription_tier, s.student_count,
    s.op_score, s.fin_score, s.eng_score,
    ROUND(s.op_score * 0.40 + s.fin_score * 0.30 + s.eng_score * 0.30)::INT AS composite,
    CASE
      WHEN ROUND(s.op_score * 0.40 + s.fin_score * 0.30 + s.eng_score * 0.30) >= 80 THEN 'excellent'
      WHEN ROUND(s.op_score * 0.40 + s.fin_score * 0.30 + s.eng_score * 0.30) >= 65 THEN 'good'
      WHEN ROUND(s.op_score * 0.40 + s.fin_score * 0.30 + s.eng_score * 0.30) >= 45 THEN 'at_risk'
      ELSE 'critical'
    END AS band,
    -- 4 of 6 documented inputs are computable today. Returned so the dashboard
    -- can mark the score provisional rather than presenting it as complete.
    4, 6
  FROM scored s
  ORDER BY composite ASC, s.name ASC;
$$;

COMMENT ON FUNCTION public.school_health_scores() IS
  'Per-school churn early warning. 40/30/30 weighting and 80/65/45 bands per SCHOOL_HEALTH_SCORES.md. Scoped by RLS. 4 of 6 documented inputs are computable — see inputs_available.';

GRANT EXECUTE ON FUNCTION public.school_health_scores() TO authenticated;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_defs INT;
BEGIN
  -- Neither function may be SECURITY DEFINER. If one is later "optimised" into
  -- a definer, it silently stops being scoped by RLS and starts returning every
  -- school's finances to whoever can execute it.
  SELECT count(*) INTO v_defs
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('platform_metrics', 'school_health_scores')
    AND p.prosecdef;

  IF v_defs > 0 THEN
    RAISE EXCEPTION
      '0096: % metric function(s) are SECURITY DEFINER — they must run as the caller so RLS scopes them', v_defs;
  END IF;

  PERFORM public.platform_metrics();
  PERFORM public.school_health_scores();
END;
$$;

-- === MIGRATION END ===
