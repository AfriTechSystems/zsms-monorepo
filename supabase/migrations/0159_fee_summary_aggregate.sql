-- ---------------------------------------------------------------------------
-- 0159 — school_fee_summary(): the fee totals, computed over the whole set
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/09 Fees and Payments/FEES.md`
--       `Official Documentation/01 Foundation Layer/RLS.md`
--
-- ## The defect this fixes
--
-- `/api/school/fees` computed its summary — outstanding, arrears, pupils owing,
-- pupils overdue — by summing the ROWS IT HAD FETCHED, under `.limit(500)`.
--
-- For a school with more than 500 pupils matching the filter, every one of those
-- four figures was silently wrong: the screen said "Outstanding" and showed the
-- outstanding balance of an arbitrary 500 pupils, ordered by arrears. Nothing
-- indicated a truncation had happened. A bursar reconciling against the bank
-- would have found a discrepancy with no way to see where it came from.
--
-- It became urgent because the screen is being paginated. Summing the fetched
-- rows under a 25-row page would have reduced the school's total arrears to the
-- arrears of whichever 25 pupils were on screen — the same bug, but visible on
-- every school rather than only large ones.
--
-- A total that is displayed must be computed over everything it claims to total.
-- That cannot be done in the application when the application only holds a page,
-- so it moves into the database, where the filter and the aggregate see the same
-- rows.
--
-- ## SECURITY INVOKER, deliberately
--
-- No `SECURITY DEFINER`. The function reads `student_fee_balance`, itself a
-- `security_invoker` view, so the caller's own RLS policies decide which pupils
-- are counted — `financial_staff_read_fee_records` and its siblings already
-- scope this to the caller's school.
--
-- Written as DEFINER it would have summed every school's arrears into one
-- number, and because it returns a total rather than rows, nothing on screen
-- would have looked wrong. A cross-tenant leak that renders as a plausible
-- figure is worse than one that renders as somebody else's pupil list.
--
-- ## The filter duplicates the route's, and that is the point
--
-- `p_filter` and `p_search` mirror the route's query exactly, because a summary
-- computed over a different set than the list is a subtler lie than no summary
-- at all. They are applied here in SQL so the two cannot drift apart silently —
-- `fee_summary_test.sql` asserts the aggregate equals the sum of the rows the
-- same filter returns.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.school_fee_summary(
  p_filter TEXT DEFAULT 'outstanding',
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  out_total_pupils    BIGINT,
  out_outstanding     NUMERIC,
  out_arrears         NUMERIC,
  out_pupils_owing    BIGINT,
  out_pupils_overdue  BIGINT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    COUNT(*)::BIGINT                                              AS out_total_pupils,
    COALESCE(SUM(b.outstanding), 0)::NUMERIC                      AS out_outstanding,
    COALESCE(SUM(b.arrears_amount), 0)::NUMERIC                   AS out_arrears,
    COUNT(*) FILTER (WHERE b.outstanding > 0)::BIGINT             AS out_pupils_owing,
    COUNT(*) FILTER (WHERE b.is_overdue IS TRUE)::BIGINT          AS out_pupils_overdue
  FROM public.student_fee_balance AS b
  WHERE
    -- Mirrors the route: 'overdue' narrows to overdue, 'outstanding' to a
    -- positive balance, anything else is every pupil the caller may read.
    CASE
      WHEN p_filter = 'overdue'     THEN b.is_overdue IS TRUE
      WHEN p_filter = 'outstanding' THEN b.outstanding > 0
      ELSE TRUE
    END
    AND (
      p_search IS NULL
      OR btrim(p_search) = ''
      OR b.first_name   ILIKE '%' || btrim(p_search) || '%'
      OR b.last_name    ILIKE '%' || btrim(p_search) || '%'
      OR b.student_code ILIKE '%' || btrim(p_search) || '%'
    );
$$;

COMMENT ON FUNCTION public.school_fee_summary(TEXT, TEXT) IS
  'Fee totals over every pupil the caller may read, for the given filter. '
  'SECURITY INVOKER: the caller''s RLS decides the scope. Exists because the '
  'route previously summed only the rows it had fetched under a limit.';

-- `anon` has no business reading a school''s arrears. `authenticated` is the
-- only grant; RLS on the underlying view does the rest.
REVOKE ALL ON FUNCTION public.school_fee_summary(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_fee_summary(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_fee_summary(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Assert the grant actually took, rather than assuming it did.
--
-- `0151` issued a REVOKE that looked right and did nothing, because
-- `REVOKE ... FROM anon` does not remove the EXECUTE that `CREATE FUNCTION`
-- grants to PUBLIC. It was only caught because `0156` checked the outcome
-- instead of counting the statements it had run.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF has_function_privilege('anon', 'public.school_fee_summary(TEXT, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'school_fee_summary is executable by anon — the REVOKE did not take';
  END IF;

  IF NOT has_function_privilege(
       'authenticated', 'public.school_fee_summary(TEXT, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION
      'school_fee_summary is not executable by authenticated — the GRANT did not take';
  END IF;
END;
$$;
