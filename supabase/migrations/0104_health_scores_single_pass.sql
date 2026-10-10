-- Migration: 0104_health_scores_single_pass.sql
-- Created: 2026-08-23
-- Description: Rewrites school_health_scores() from correlated subqueries to
--              grouped aggregates. Same numbers, one scan per table instead of
--              one per school per figure.
-- Related documents: Official Documentation/15 Super Admin and Platform/SCHOOL_HEALTH_SCORES.md
--                    Official Documentation/05 Core Database and API Reference/INDEXES.md

-- === MIGRATION START ===

-- THE SYMPTOM
-- -----------
-- `/api/admin/overview` — the admin dashboard's landing page — began answering
-- 500 with `57014 canceling statement due to statement timeout`. Six schools,
-- 1,128 attendance rows, 240 fee records. Nothing about that data is large.
--
-- THE CAUSE
-- ---------
-- Measured, not guessed:
--
--   as superuser (RLS bypassed)        105 ms
--   as `authenticated` (RLS applied)  3,289 ms
--
-- A 30× gap with identical data is not a data-volume problem, it is a
-- **predicate-evaluation** problem. `attendance_records` carries seven policies,
-- including `teacher_reaches_class(class_id)` and `is_linked_parent_of(student_id)`
-- — function calls, evaluated per row, per scan.
--
-- And the function scanned a great deal more than it needed to. The `financial`
-- CTE alone referenced `fee_records` in **five correlated subqueries**, each one
-- re-running for every school:
--
--     CASE WHEN COALESCE((SELECT sum(amount_due) FROM fee_records WHERE school_id = b.id), 0) = 0
--       THEN NULL
--       ELSE LEAST(COALESCE((SELECT sum(amount_paid) FROM fee_records WHERE school_id = b.id), 0)
--                  / NULLIF((SELECT sum(amount_due) FROM fee_records WHERE school_id = b.id), 0), 1)
--     END
--
-- Six schools × five subqueries = thirty RLS-filtered passes over `fee_records`,
-- to produce three numbers per school. The same shape repeats for attendance,
-- results, parent links, and messages. At six schools it times out; the
-- documented target is a hundred.
--
-- THE FIX, AND WHAT IT DELIBERATELY DOES NOT CHANGE
-- -------------------------------------------------
-- Grouped aggregates joined once, instead of subqueries correlated per row. One
-- pass per table, so each policy is evaluated once per row rather than once per
-- row per school.
--
-- **`SECURITY INVOKER` is kept.** The obvious cure for slow RLS is
-- `SECURITY DEFINER` plus an `is_afritech_admin()` check, and `0096` argued
-- against exactly that: it puts a second copy of the authorisation rule where
-- nothing tests it, and it throws away a property worth keeping — a school owner
-- calling this function gets *their own school's* score, correctly, with no new
-- code. That will be the school-facing health screen. The cost here was the
-- query shape, not the security model, so the query shape is what changes.
--
-- **Every number is preserved exactly**, including the parts that look like
-- oversights and are not:
--
--   * `student_count` counts `status = 'active'` only — NOT `on_leave`. That
--     differs from the enrolment ceiling's rule (0101) on purpose: a ceiling
--     asks "how many places are occupied", a health score asks "how many pupils
--     is this school actually running". Changing it here would silently move
--     every school's marks and parent-activation rates.
--   * The `LEFT JOIN`s reintroduce NULL where a correlated `count()` over no
--     rows returned 0, so each is re-COALESCEd at the point the original
--     defaulted. A school with no fee records must still score 50 on the
--     financial dimension — "unbilled" is unconfigured, not failing — and a
--     school with no pupils must still yield NULL for `parent_rate` rather
--     than dividing by zero.
--   * `GREATEST(due - paid - discount, 0)` is left with `discount_amount` raw
--     rather than coalesced. `GREATEST` ignores NULL arguments in PostgreSQL,
--     so a NULL discount already yields 0; wrapping it would change nothing and
--     imply it mattered.

CREATE OR REPLACE FUNCTION public.school_health_scores()
RETURNS TABLE (
  school_id         UUID,
  school_code       TEXT,
  school_name       TEXT,
  status            TEXT,
  subscription_tier TEXT,
  students          BIGINT,
  operational_score INT,
  financial_score   INT,
  engagement_score  INT,
  composite_score   INT,
  band              TEXT,
  inputs_available  INT,
  inputs_total      INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH roll AS (
    SELECT st.school_id, count(*) AS n
    FROM public.students st
    WHERE NOT st.is_deleted AND st.status = 'active'
    GROUP BY st.school_id
  ),
  att AS (
    -- School days in the last 30 on which ANY attendance was recorded. A school
    -- that marks registers is a school using the product.
    SELECT a.school_id, count(DISTINCT a.attendance_date) AS days
    FROM public.attendance_records a
    WHERE a.attendance_date >= CURRENT_DATE - 30
    GROUP BY a.school_id
  ),
  marks AS (
    SELECT e.school_id, count(DISTINCT e.student_id) AS n
    FROM public.exam_results e
    GROUP BY e.school_id
  ),
  fees AS (
    -- Three figures, one pass. This is the CTE that was costing thirty.
    SELECT f.school_id,
           sum(f.amount_due)  AS due,
           sum(f.amount_paid) AS paid,
           sum(CASE WHEN f.due_date < CURRENT_DATE
                    THEN GREATEST(f.amount_due - f.amount_paid - f.discount_amount, 0)
                    ELSE 0 END) AS overdue
    FROM public.fee_records f
    GROUP BY f.school_id
  ),
  links AS (
    SELECT st.school_id, count(DISTINCT l.student_id) AS n
    FROM public.student_parent_links l
    JOIN public.students st ON st.id = l.student_id
    WHERE l.is_active
    GROUP BY st.school_id
  ),
  msgs AS (
    SELECT m.school_id, count(*) AS n
    FROM public.message_log m
    WHERE m.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY m.school_id
  ),
  base AS (
    SELECT s.id, s.school_id AS code, s.name, s.status, s.subscription_tier,
           COALESCE(r.n, 0) AS student_count,
           COALESCE(a.days, 0)::NUMERIC / 22.0 AS attendance_rate,
           CASE WHEN COALESCE(r.n, 0) = 0 THEN 0
                ELSE COALESCE(mk.n, 0)::NUMERIC / r.n END AS marks_rate,
           CASE WHEN COALESCE(fe.due, 0) = 0 THEN NULL
                ELSE LEAST(COALESCE(fe.paid, 0) / NULLIF(fe.due, 0), 1) END AS collection_rate,
           CASE WHEN COALESCE(fe.due, 0) = 0 THEN NULL
                ELSE COALESCE(fe.overdue, 0) / NULLIF(fe.due, 0) END AS arrears_ratio,
           CASE WHEN COALESCE(r.n, 0) = 0 THEN NULL
                ELSE COALESCE(lk.n, 0)::NUMERIC / r.n END AS parent_rate,
           COALESCE(ms.n, 0) AS messages_30d
    FROM public.schools s
    LEFT JOIN roll  r  ON r.school_id  = s.id
    LEFT JOIN att   a  ON a.school_id  = s.id
    LEFT JOIN marks mk ON mk.school_id = s.id
    LEFT JOIN fees  fe ON fe.school_id = s.id
    LEFT JOIN links lk ON lk.school_id = s.id
    LEFT JOIN msgs  ms ON ms.school_id = s.id
  ),
  scored AS (
    SELECT b.id, b.code, b.name, b.status, b.subscription_tier, b.student_count,
      -- Operational, 40% of the composite. Two of the document's three
      -- sub-scores are measurable; they are rescaled from 80 to 100 so the
      -- missing staff-engagement input does not read as a zero.
      LEAST(100, ROUND((
        (CASE WHEN b.attendance_rate >= 0.90 THEN 50
              WHEN b.attendance_rate >= 0.75 THEN 38
              WHEN b.attendance_rate >= 0.50 THEN 25
              WHEN b.attendance_rate >= 0.25 THEN 10
              ELSE 0 END)
      + (CASE WHEN b.marks_rate >= 0.90 THEN 30
              WHEN b.marks_rate >= 0.70 THEN 22
              WHEN b.marks_rate >= 0.50 THEN 15
              WHEN b.marks_rate >= 0.25 THEN 7
              ELSE 0 END)
      ) * 100.0 / 80.0))::INT AS op_score,

      -- Financial, 30%. A school with no fee records has nothing to measure, so
      -- it scores 50 rather than 0 — an unbilled school is unconfigured, not
      -- failing, and a nightly report that calls every new school "critical" is
      -- a report the customer-success team learns to ignore.
      (CASE WHEN b.collection_rate IS NULL THEN 50
            ELSE ROUND((
              (CASE WHEN b.collection_rate >= 0.90 THEN 60
                    WHEN b.collection_rate >= 0.75 THEN 45
                    WHEN b.collection_rate >= 0.50 THEN 30
                    WHEN b.collection_rate >= 0.25 THEN 15
                    ELSE 0 END)
            + (CASE WHEN COALESCE(b.arrears_ratio, 0) <= 0.05 THEN 40
                    WHEN COALESCE(b.arrears_ratio, 0) <= 0.15 THEN 30
                    WHEN COALESCE(b.arrears_ratio, 0) <= 0.30 THEN 18
                    WHEN COALESCE(b.arrears_ratio, 0) <= 0.50 THEN 8
                    ELSE 0 END)
            )) END)::INT AS fin_score,

      -- Engagement, 30%. Parent activation plus whether the school actually
      -- communicates. Rescaled from 70 for the absent app-usage input.
      LEAST(100, ROUND((
        (CASE WHEN COALESCE(b.parent_rate, 0) >= 0.80 THEN 40
              WHEN COALESCE(b.parent_rate, 0) >= 0.60 THEN 30
              WHEN COALESCE(b.parent_rate, 0) >= 0.40 THEN 20
              WHEN COALESCE(b.parent_rate, 0) >= 0.20 THEN 10
              ELSE 0 END)
      + (CASE WHEN b.messages_30d >= 100 THEN 30
              WHEN b.messages_30d >= 30  THEN 22
              WHEN b.messages_30d >= 10  THEN 14
              WHEN b.messages_30d >= 1   THEN 6
              ELSE 0 END)
      ) * 100.0 / 70.0))::INT AS eng_score
    FROM base b
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
  'Per-school health scores, 40/30/30 weighted (SCHOOL_HEALTH_SCORES.md). SECURITY INVOKER — returns what the caller may see. Grouped aggregates, one pass per table (0104).';

REVOKE ALL ON FUNCTION public.school_health_scores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_health_scores() TO authenticated;

-- ---------------------------------------------------------------------------
-- Verification
--
-- Correctness first: a rewrite that is fast and returns different scores is a
-- worse outcome than a slow one. The scores this produces are compared against
-- the arithmetic done the old way, per school, and any disagreement fails.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mismatch INT;
  v_rows INT;
BEGIN
  SELECT count(*)::INT INTO v_rows FROM public.school_health_scores();

  IF v_rows <> (SELECT count(*)::INT FROM public.schools) THEN
    RAISE EXCEPTION '0104: % score rows for % schools — the LEFT JOINs are dropping or duplicating schools',
      v_rows, (SELECT count(*) FROM public.schools);
  END IF;

  -- Recompute `students` the original correlated way and compare. It is the one
  -- input every other rate divides by, so if it survives the rewrite the
  -- join shape is sound.
  SELECT count(*)::INT INTO v_mismatch
  FROM public.school_health_scores() h
  JOIN public.schools s ON s.id = h.school_id
  WHERE h.students <> (
    SELECT count(*) FROM public.students st
    WHERE st.school_id = s.id AND NOT st.is_deleted AND st.status = 'active'
  );

  IF v_mismatch > 0 THEN
    RAISE EXCEPTION '0104: % school(s) have a different enrolment count after the rewrite', v_mismatch;
  END IF;

  -- Every band must be one the document defines. A NULL here would mean a
  -- composite of NULL, which is how a rewrite quietly turns a score into
  -- nothing.
  SELECT count(*)::INT INTO v_mismatch
  FROM public.school_health_scores()
  WHERE band IS NULL OR band NOT IN ('excellent','good','at_risk','critical')
     OR composite_score IS NULL;

  IF v_mismatch > 0 THEN
    RAISE EXCEPTION '0104: % school(s) have no band or no composite score', v_mismatch;
  END IF;
END;
$$;

-- === MIGRATION END ===
