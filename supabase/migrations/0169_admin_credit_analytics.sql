-- ---------------------------------------------------------------------------
-- 0169 — AfriTech's view of AI usage: aggregates, never named teachers
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/15 Super Admin and Platform/PLATFORM_METRICS.md`
--       `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
--       `Official Documentation/18 AI Module/AI_OVERVIEW.md`
--
-- ## The decision this encodes
--
-- The request was for AfriTech to see, per school, "which school staff exactly
-- and how much each staff is using". Decided 2026-09-30 to narrow that to
-- aggregates and distributions, for two reasons:
--
--   * **It does not serve the business question.** Pricing, packaging and roadmap
--     decisions are made from totals by school, by content type, by subject and
--     grade, and from the shape of the usage curve. "Mrs Banda generated 47
--     lesson plans" informs no decision that the distribution does not.
--   * **It is a liability under the Data Protection Act 2021.** AfriTech holding
--     per-named-teacher behavioural profiles across every customer school needs a
--     documented purpose, and "it might be useful later" is not one. The
--     narrowest collection that answers the question is also the one that cannot
--     leak what it never held.
--
-- A school still sees its own staff by name through `school_credit_usage()`
-- (0166). That is the right place for it: the school employs those people and
-- paid for those credits. AfriTech is a processor here, not the employer.
--
-- ## How the rule is enforced rather than asserted
--
-- None of these functions returns `actor_user_id`, and none takes a parameter
-- that could narrow a result to one person. `out_teachers_active` is a COUNT.
-- The distribution buckets are counts of teachers per band, so a band containing
-- exactly one teacher reveals a number but never a name — and a name is what
-- would make it personal data.
--
-- This is a deliberate limit on a tool AfriTech owns. If a support case genuinely
-- needs per-teacher detail, the route is impersonation (IMPERSONATION.md), which
-- is logged, reason-required and visible to the school. An analytics screen is
-- not that, and should not quietly become it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. One school's AI usage, summarised.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_school_ai_summary(p_school_id UUID)
RETURNS TABLE (
  out_credits_purchased INT,
  out_credits_spent     INT,
  out_credits_remaining INT,
  out_teachers_assigned INT,
  out_teachers_active   INT,
  out_actions           INT,
  out_cost_usd          NUMERIC,
  out_from_reserve      INT,
  out_last_used_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_account UUID;
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'AfriTech only' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_account FROM public.ai_credit_accounts WHERE school_id = p_school_id;

  RETURN QUERY
  SELECT
    COALESCE((SELECT SUM(p.total_credits)::INT
                FROM public.school_credit_purchases p
               WHERE p.school_id = p_school_id), 0),
    COALESCE((SELECT -SUM(l.credits)::INT
                FROM public.ai_credit_ledger l
               WHERE l.account_id = v_account AND l.reason = 'consume'), 0),
    COALESCE((SELECT SUM(l.credits)::INT
                FROM public.ai_credit_ledger l
               WHERE l.account_id = v_account), 0),
    COALESCE((SELECT COUNT(DISTINCT a.clerk_user_id)::INT
                FROM public.school_credit_assignments a
               WHERE a.school_id = p_school_id AND a.revoked_at IS NULL), 0),
    -- A COUNT, deliberately. See the header: never a list of who.
    COALESCE((SELECT COUNT(DISTINCT l.actor_user_id)::INT
                FROM public.ai_credit_ledger l
               WHERE l.account_id = v_account AND l.reason = 'consume'), 0),
    COALESCE((SELECT COUNT(*)::INT
                FROM public.ai_credit_ledger l
               WHERE l.account_id = v_account AND l.reason = 'consume'), 0),
    COALESCE((SELECT SUM(l.cost_usd)
                FROM public.ai_credit_ledger l
               WHERE l.account_id = v_account AND l.reason = 'consume'), 0)::NUMERIC,
    COALESCE((SELECT -SUM(l.credits)::INT
                FROM public.ai_credit_ledger l
               WHERE l.account_id = v_account AND l.reason = 'consume'
                 AND l.assignment_id IS NULL), 0),
    (SELECT MAX(l.created_at)
       FROM public.ai_credit_ledger l
      WHERE l.account_id = v_account AND l.reason = 'consume');
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. What is being generated — the breakdown that actually informs the roadmap.
--
-- `p_school_id` NULL means platform-wide. That is the shape most business
-- questions take: not "what does Alpha Academy generate" but "what do schools
-- generate", which tells you which tool to build next.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ai_usage_breakdown(
  p_school_id UUID DEFAULT NULL,
  p_dimension TEXT DEFAULT 'feature'
)
RETURNS TABLE (
  out_label         TEXT,
  out_credits_spent INT,
  out_actions       INT,
  out_cost_usd      NUMERIC,
  out_schools       INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'AfriTech only' USING ERRCODE = '42501';
  END IF;

  IF p_dimension NOT IN ('feature', 'subject', 'grade', 'resource_kind', 'curriculum') THEN
    RAISE EXCEPTION 'Unknown dimension: %', p_dimension USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    /*
      Subject, grade, resource kind and curriculum are read from the ledger row's
      metadata, which `create_teaching_resource()` writes at charge time. Reading
      them from `teaching_resources` instead would miss every charge whose resource
      was later deleted — and a deleted lesson plan still cost money and still says
      what teachers wanted.
    */
    COALESCE(
      CASE p_dimension
        WHEN 'feature'       THEN l.feature_key
        WHEN 'subject'       THEN l.metadata ->> 'subject'
        WHEN 'grade'         THEN l.metadata ->> 'grade_level'
        WHEN 'resource_kind' THEN l.metadata ->> 'resource_kind'
        WHEN 'curriculum'    THEN l.metadata ->> 'curriculum_type'
      END,
      '(not recorded)'
    )::TEXT,
    COALESCE(-SUM(l.credits), 0)::INT,
    COUNT(*)::INT,
    COALESCE(SUM(l.cost_usd), 0)::NUMERIC,
    -- How many schools, not which teachers.
    COUNT(DISTINCT ac.school_id)::INT
  FROM public.ai_credit_ledger AS l
  JOIN public.ai_credit_accounts AS ac ON ac.id = l.account_id
  WHERE l.reason = 'consume'
    AND (p_school_id IS NULL OR ac.school_id = p_school_id)
    -- School wallets only. A teacher's personal Hub spending is not AfriTech's
    -- business at the per-school level either, and mixing the two would make the
    -- per-school totals wrong as well as nosy.
    AND ac.school_id IS NOT NULL
  GROUP BY 1
  ORDER BY 2 DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. The distribution — the shape of usage, with nobody named.
--
-- This is what replaces "which staff exactly". A school where one teacher does
-- everything and a school where thirty share it evenly are different businesses
-- with different retention risks, and the bands say which you are looking at
-- without identifying anybody.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ai_usage_distribution(p_school_id UUID DEFAULT NULL)
RETURNS TABLE (
  out_band     TEXT,
  out_teachers INT,
  out_credits  INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'AfriTech only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH per_teacher AS (
    SELECT l.actor_user_id, COALESCE(-SUM(l.credits), 0)::INT AS spent
    FROM public.ai_credit_ledger AS l
    JOIN public.ai_credit_accounts AS ac ON ac.id = l.account_id
    WHERE l.reason = 'consume'
      AND ac.school_id IS NOT NULL
      AND (p_school_id IS NULL OR ac.school_id = p_school_id)
    GROUP BY l.actor_user_id
  ),
  banded AS (
    SELECT
      CASE
        WHEN spent = 0        THEN 'none'
        WHEN spent <= 5       THEN '1-5'
        WHEN spent <= 20      THEN '6-20'
        WHEN spent <= 60      THEN '21-60'
        WHEN spent <= 150     THEN '61-150'
        ELSE '150+'
      END AS band,
      spent
    FROM per_teacher
  )
  SELECT b.band::TEXT, COUNT(*)::INT, COALESCE(SUM(b.spent), 0)::INT
  FROM banded AS b
  GROUP BY b.band
  ORDER BY MIN(b.spent);
  -- `actor_user_id` is aggregated away before it leaves the CTE. Nothing in the
  -- result set can be traced back to a person.
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants. AfriTech-only is enforced INSIDE each function as well as by the
-- grant, because `authenticated` covers every school user too — the GRANT alone
-- would make a school's bursar able to call these.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_school_ai_summary(UUID)',
    'public.admin_ai_usage_breakdown(UUID, TEXT)',
    'public.admin_ai_usage_distribution(UUID)'
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
-- Assert the privacy rule structurally, not just in prose.
--
-- No analytics function may return a column that carries a user identifier. A
-- future edit adding `actor_user_id` to a result set fails here rather than
-- shipping, which is the only form of this rule that survives somebody being
-- asked for "just a bit more detail".
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn      TEXT;
  v_args    TEXT;
  v_offender TEXT;
BEGIN
  FOR v_fn, v_args IN
    SELECT p.proname, pg_get_function_result(p.oid)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'admin_ai_%' OR
          (n.nspname = 'public' AND p.proname = 'admin_school_ai_summary')
  LOOP
    IF v_args ILIKE '%user_id%' OR v_args ILIKE '%clerk_user%' OR v_args ILIKE '%actor%' THEN
      v_offender := COALESCE(v_offender || ', ', '') || v_fn;
    END IF;
  END LOOP;

  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION
      'AfriTech analytics must not return user identifiers — offending: %', v_offender;
  END IF;
END;
$$;
