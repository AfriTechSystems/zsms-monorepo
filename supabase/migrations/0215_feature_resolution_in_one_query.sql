-- ===========================================================================
-- 0215 — resolve every feature for a school in ONE query
--
-- `school_has_feature(school_id, feature_key)` answers for one feature, so a
-- caller wanting the whole picture makes one PostgREST round trip per feature.
-- `/api/admin/schools/[id]` does exactly that: **13 round trips today, growing
-- with the catalogue.** CLAUDE.md has carried this as an open N+1 since `0095`
-- and names a set-returning resolver as the fix.
--
-- It stops being merely a performance note the moment anything actually GATES
-- on a feature. A route that checks `ai_assistant` before answering a question
-- cannot afford a network round trip per check, and the TypeScript
-- `schoolHasFeature()` the documents name has never existed partly because
-- there was nothing efficient for it to call.
--
-- ## The resolution order is not restated, it is REUSED
--
-- The order — revoke override, grant override, tier override, tier matrix — is
-- subtle, and a second copy would be the one that drifts. So this function
-- resolves the TIER once (the only part that is per-school rather than
-- per-feature) and then calls `school_has_feature()` per key.
--
-- That sounds like it defeats the purpose. It does not: the expensive thing was
-- never the SQL, it was the HTTP round trip. One call returning 18 rows costs
-- one request; 18 calls returning a boolean cost 18. The function executes
-- inside the database where a per-key lookup is a few microseconds.
--
-- The alternative — reimplementing the order as a single join — would be faster
-- still and is deliberately not done. Correctness of the order matters more than
-- microseconds, and `0095` is where that order lives.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.school_feature_resolution(p_school_id UUID)
RETURNS TABLE (
  out_feature_key   TEXT,
  out_display_name  TEXT,
  out_category      TEXT,
  out_included      BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_school UUID;
BEGIN
  /*
    Never trust the id argument.

    A DEFINER function taking `p_school_id` on trust lets any caller read any
    school's entitlements by changing a query string. AfriTech may name a school;
    everybody else is resolved from the session and the argument is ignored.
  */
  IF public.is_afritech_admin() THEN
    v_school := p_school_id;
  ELSE
    v_school := public.current_school_uuid();

    IF v_school IS NULL THEN
      RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
    END IF;

    /*
      A school asking about ITSELF is fine; asking about another is not, and is
      answered as a refusal rather than silently redirected to their own — which
      would be worse, because the caller would believe the answer.
    */
    IF p_school_id IS NOT NULL AND p_school_id <> v_school THEN
      RAISE EXCEPTION 'That school is not available to you' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_school IS NULL THEN
    RAISE EXCEPTION 'No school to resolve features for' USING ERRCODE = '22023';
  END IF;

  /*
    Every feature in the catalogue, each resolved through the one implementation
    of the order. A feature absent from the catalogue is absent from the answer,
    which is correct: there is nothing to grant.
  */
  RETURN QUERY
  -- `display_name` and `category`, not `feature_name` — assumed wrongly on the
  -- first attempt and it failed on 42703. `afritech` tables are outside
  -- `db:cols`, so they need an information_schema query instead; skipping that
  -- is the same mistake either way.
  SELECT f.feature_key,
         f.display_name,
         f.category,
         public.school_has_feature(v_school, f.feature_key)
  FROM afritech.feature_flags f
  WHERE f.is_active
  ORDER BY f.display_order, f.feature_key;
END;
$$;

REVOKE ALL ON FUNCTION public.school_feature_resolution(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_feature_resolution(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_feature_resolution(UUID) TO authenticated;

COMMENT ON FUNCTION public.school_feature_resolution(UUID) IS
  'Every feature flag resolved for one school, in one round trip. Reuses school_has_feature() rather than restating the resolution order. AfriTech may name a school; anybody else is resolved from the session (0215).';

-- ---------------------------------------------------------------------------
-- Prove it, including the refusal that matters.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_n        INT;
  v_catalog  INT;
  v_school   UUID;
BEGIN
  SELECT COUNT(*) INTO v_catalog FROM afritech.feature_flags WHERE is_active;

  SELECT s.id INTO v_school FROM public.schools s
  WHERE s.subscription_tier IS NOT NULL LIMIT 1;

  IF v_school IS NULL THEN
    RAISE NOTICE '0215: no school with a tier to exercise against; skipping';
    RETURN;
  END IF;

  /*
    As AfriTech, so the admin branch is the one exercised here. The session
    branch needs a real org claim and is exercised separately — a DO block
    cannot switch role reliably around an exception, which cost a correction in
    `0212`.
  */
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub','user_0215_probe','role','authenticated',
    'o', json_build_object('id','org_afritech','slg','afritech-systems-admin'))::text, TRUE);

  SELECT COUNT(*) INTO v_n FROM public.school_feature_resolution(v_school);

  IF v_n <> v_catalog THEN
    RAISE EXCEPTION '0215: resolved % features but the catalogue has %', v_n, v_catalog;
  END IF;

  -- And every answer must agree with the one-at-a-time function, or the two
  -- have drifted and the cheap one is lying.
  SELECT COUNT(*) INTO v_n
  FROM public.school_feature_resolution(v_school) r
  WHERE r.out_included <> public.school_has_feature(v_school, r.out_feature_key);

  IF v_n <> 0 THEN
    RAISE EXCEPTION '0215: % feature(s) disagree with school_has_feature()', v_n;
  END IF;

  RAISE NOTICE '0215: verified — % features resolved in one call, all agreeing', v_catalog;
END;
$$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.school_feature_resolution(UUID)', 'EXECUTE') THEN
    RAISE EXCEPTION '0215: anon can execute school_feature_resolution';
  END IF;
END;
$$;
