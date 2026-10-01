-- ---------------------------------------------------------------------------
-- 0166 — who used the school's credits, and on what
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/18 AI Module/AI_OVERVIEW.md`
--       `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
--
-- ## The privacy line this draws, and why it is in SQL rather than a route
--
-- A teacher may hold two balances: credits their school assigned them, and credits
-- they bought themselves for their own Teacher Hub work.
--
-- **The school sees the first and never the second.** The school paid for its own
-- credits and is entitled to know how they were spent. It paid nothing toward a
-- teacher's personal professional development, and showing it would turn a billing
-- feature into a surveillance one — a principal able to see that a teacher spent
-- their own money generating interview-practice material has learned something the
-- school has no business knowing.
--
-- That rule is enforced here, by the WHERE clause, rather than in a route that
-- remembers to filter. A route is one forgotten condition away from leaking it; a
-- function is the same condition in one place, and `school_credits_test.sql`
-- asserts it.
--
-- The filter is `account_id = the school's wallet`. `0163` deliberately did not add
-- a `funded_by` column precisely so there is one fact here rather than two that
-- could disagree.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.school_credit_usage(
  p_from DATE DEFAULT NULL,
  p_to   DATE DEFAULT NULL
)
RETURNS TABLE (
  out_clerk_user_id   TEXT,
  out_teacher_name    TEXT,
  out_credits_spent   INT,
  out_actions         INT,
  out_allocated       INT,
  out_from_reserve    INT,
  out_last_used_at    TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school  UUID := public.current_school_uuid();
  v_account UUID;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Only a school can read its own credit usage' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_account FROM public.ai_credit_accounts WHERE school_id = v_school;
  IF v_account IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    l.actor_user_id,
    -- The staff row's name when there is one. A teacher who has left keeps their
    -- spend in the ledger but may have no staff row, and dropping the line would
    -- make the totals stop adding up.
    COALESCE(
      MAX(sm.first_name || ' ' || sm.last_name),
      '(no longer on staff)'
    )::TEXT,
    COALESCE(-SUM(l.credits), 0)::INT,
    COUNT(*)::INT,
    COALESCE((
      SELECT SUM(a.credits_allocated)
      FROM public.school_credit_assignments AS a
      WHERE a.clerk_user_id = l.actor_user_id
        AND a.school_id = v_school
        AND a.revoked_at IS NULL
        AND CURRENT_DATE BETWEEN a.period_start AND a.period_end
    ), 0)::INT,
    -- A school-account spend with no assignment behind it came from the reserve.
    COALESCE(-SUM(l.credits) FILTER (WHERE l.assignment_id IS NULL), 0)::INT,
    MAX(l.created_at)
  FROM public.ai_credit_ledger AS l
  LEFT JOIN public.staff_members AS sm
    ON sm.clerk_user_id = l.actor_user_id AND sm.school_id = v_school
  WHERE
    -- THE PRIVACY LINE. The school's own wallet only; a teacher's personal
    -- spending is on a different account and is never counted here.
    l.account_id = v_account
    AND l.reason = 'consume'
    AND (p_from IS NULL OR l.created_at >= p_from::TIMESTAMPTZ)
    AND (p_to IS NULL OR l.created_at < (p_to + 1)::TIMESTAMPTZ)
  GROUP BY l.actor_user_id
  ORDER BY 3 DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.school_credit_usage(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_credit_usage(DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_credit_usage(DATE, DATE) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.school_credit_usage(DATE, DATE)', 'EXECUTE') THEN
    RAISE EXCEPTION 'school_credit_usage is executable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.school_credit_usage(DATE, DATE)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute school_credit_usage';
  END IF;
END;
$$;
