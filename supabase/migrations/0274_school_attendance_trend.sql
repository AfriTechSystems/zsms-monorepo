-- ===========================================================================
-- 0274 — a school's attendance over the last N days, aggregated in SQL
--
-- ## Why this is a function and not a wider SELECT
--
-- `/api/school/overview` already reads `attendance_records` for ONE day and counts
-- the statuses in TypeScript. Widening that to a fortnight would ship roughly
-- `roll × days` rows to the route to be reduced to a dozen numbers — about 7,000
-- rows for a 500-pupil school — because PostgREST cannot GROUP BY. The aggregation
-- belongs where the rows are.
--
-- ## SECURITY INVOKER, deliberately, and there is no school clause
--
-- This runs as the caller, so **RLS is the authorisation** and the function needs no
-- `school_id` filter of its own. That is the same decision `search_everything()`
-- (`0266`) records: a teacher assigned to three classes sees those three classes'
-- attendance here, without this function knowing what a teaching assignment is.
--
-- The consequence is worth stating because it looks like a bug otherwise: **two
-- people at one school can legitimately get different numbers from this function.**
-- A head teacher sees the school; a class teacher sees their classes. That is the
-- same thing every other section of the dashboard does.
--
-- A DEFINER function here would have to re-implement the teacher-scoping rules that
-- already exist as policies, and would be the second place they could drift.
--
-- ## `holiday` is a status, and a holiday is not a zero
--
-- `attendance_records.status` admits FIVE values, not the three the dashboard card
-- names: `present`, `absent`, `late`, `excused`, `holiday`.
--
-- `holiday` is the one that matters here. A day the school was closed is not a day
-- with nobody present — it is a day with no school. Folding it into an absence count
-- would draw a cliff to 0% across every half-term break, and the reader would
-- reasonably conclude the register was not marked. So it is returned as its own
-- count, and the caller is expected to drop those days rather than plot them.
-- CONVENTIONS and the UI skill both put it the same way: unavailable is not zero.
--
-- `excused` is returned separately too, rather than being folded into `absent`.
-- Whether an authorised absence counts against an attendance rate is a school's
-- policy and in some cases a reporting requirement, so this returns the facts and
-- lets the screen decide. Deciding it here would bake one school's answer into the
-- database for all of them.
--
-- ## The window is clamped
--
-- `p_days` is bounded to 1–90. Not to protect the database — RLS already limits the
-- rows — but because an unbounded argument on a chart endpoint is an invitation to
-- ask for ten years and render 3,650 points into 400 pixels.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.school_attendance_trend(p_days INT DEFAULT 14)
RETURNS TABLE (
  out_date     DATE,
  out_present  INT,
  out_late     INT,
  out_absent   INT,
  out_excused  INT,
  out_holiday  INT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $fn$
  SELECT
    a.attendance_date,
    COUNT(*) FILTER (WHERE a.status = 'present')::INT,
    COUNT(*) FILTER (WHERE a.status = 'late')::INT,
    COUNT(*) FILTER (WHERE a.status = 'absent')::INT,
    COUNT(*) FILTER (WHERE a.status = 'excused')::INT,
    COUNT(*) FILTER (WHERE a.status = 'holiday')::INT
  FROM public.attendance_records a
  WHERE a.attendance_date > CURRENT_DATE - LEAST(GREATEST(COALESCE(p_days, 14), 1), 90)
    AND a.attendance_date <= CURRENT_DATE
  GROUP BY a.attendance_date
  ORDER BY a.attendance_date;
$fn$;

COMMENT ON FUNCTION public.school_attendance_trend(INT) IS
  'One row per day with a marked register, for the last p_days days (clamped 1-90). SECURITY INVOKER: RLS scopes it, so a class teacher sees their classes and a head teacher sees the school. `holiday` is returned as its own count because a closed day is not a day of total absence - drop those days rather than plotting them. Added by 0274.';

REVOKE ALL ON FUNCTION public.school_attendance_trend(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_attendance_trend(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_attendance_trend(INT) TO authenticated;


-- ---------------------------------------------------------------------------
-- Exercise it. A migration that only asserts the function EXISTS asserts the
-- easy property — `0173` did exactly that and broke every write through the
-- trigger it had just attached. What matters is that it returns rows and that
-- the clamp holds.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_rows   INT;
  v_oldest DATE;
BEGIN
  -- Runs as the migration role, which bypasses RLS, so this proves the SQL is
  -- valid and the grouping works. It deliberately proves nothing about scoping —
  -- that needs a real session, which is what the pgTAP suites are for.
  SELECT count(*) INTO v_rows FROM public.school_attendance_trend(14);

  SELECT min(out_date) INTO v_oldest FROM public.school_attendance_trend(10000);
  IF v_oldest IS NOT NULL AND v_oldest < CURRENT_DATE - 90 THEN
    RAISE EXCEPTION '0274: the day clamp is not holding — got data from %', v_oldest;
  END IF;

  IF (SELECT count(*) FROM public.school_attendance_trend(0)) > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.school_attendance_trend(0)
        WHERE out_date = CURRENT_DATE
     )
  THEN
    RAISE EXCEPTION '0274: p_days=0 should clamp to 1 and return today only';
  END IF;

  IF has_function_privilege('anon', 'public.school_attendance_trend(INT)', 'EXECUTE') THEN
    RAISE EXCEPTION '0274: anon can execute school_attendance_trend';
  END IF;

  RAISE NOTICE '0274: PASS  % day(s) returned, clamp holds, anon refused', v_rows;
END;
$do$;
