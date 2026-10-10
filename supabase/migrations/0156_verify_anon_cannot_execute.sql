-- Migration: 0156_verify_anon_cannot_execute.sql
-- Created: 2026-09-30
-- Description: `0151` revoked PUBLIC execute and did not verify it. Measured afterwards against
--              `zsms-dev`: `register_school` was denied and `admin_create_school` was not.
-- Related documents: Official Documentation/01 Foundation Layer/SECURITY_POLICIES.md
--                    Official Documentation/02 Authentication and Identity/PERMISSIONS.md
--
-- ===========================================================================
-- A REVOKE THAT WORKED FOR ONE FUNCTION AND NOT ITS NEIGHBOUR
--
-- `0151` looped over `admin\_%` plus two named functions and revoked EXECUTE from PUBLIC. Measured
-- afterwards with the anon key against the live dev project:
--
--     register_school      → 401  permission denied for function register_school     ✔
--     admin_create_school  → 401  Only AfriTech creates a school.                     ✘
--
-- The second message comes from **inside** the function. It executed. Both were in the same loop, so
-- the loop ran — it simply did not cover what it claimed to.
--
-- The instructive part is not which pattern misfired. It is that `0151` asserted `n >= 10` and
-- stopped there: a count of *statements issued*, which says nothing about whether the privilege
-- afterwards is the one intended. The guard confirmed the loop had work to do and then declared
-- victory.
--
-- ---------------------------------------------------------------------------
-- SO THIS ONE ASSERTS THE OUTCOME
-- ---------------------------------------------------------------------------
-- Same revoke, three differences:
--
--   1. `anon` is revoked **explicitly** as well as via PUBLIC, so a direct grant from any source is
--      removed rather than assumed absent.
--   2. The set is built from `pg_proc` by name **and** listed by hand where a name pattern would be
--      fragile, so nothing depends on `LIKE` escaping behaving as expected.
--   3. It ends with `has_function_privilege('anon', …)` over every function in the set and
--      **raises with the offenders named** if any still holds EXECUTE. A migration that cannot prove
--      its own effect is a comment.
--
-- `school_verified_metrics` (`0155`) is added to the set. It was reachable by `anon`, and it returns
-- the raw pupil and teacher counts that `PUBLIC_DIRECTORY.md` withholds as competitively sensitive —
-- the exact numbers `search_schools` is careful to publish only as ratios, because a count beside a
-- ratio reconstructs the roll.
-- ===========================================================================

-- === MIGRATION START ===

DO $$
DECLARE
  r         RECORD;
  v_bad     TEXT;
  v_touched INT := 0;
BEGIN
  -- ---------------------------------------------------------------------------
  -- Revoke.
  -- ---------------------------------------------------------------------------
  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND (
         -- `starts_with` rather than LIKE, so underscore escaping cannot be the reason a function
         -- is missed. This is the line 0151 got wrong, one way or another.
         starts_with(p.proname, 'admin_')
         OR p.proname IN (
           'register_school',
           'attach_own_registered_school',
           -- Added here: returns the raw counts the directory deliberately withholds.
           'school_verified_metrics',
           'set_school_public_profile',
           'ensure_onboarding_checklist'
         )
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
    -- Explicitly too. A grant held directly by `anon` survives a revoke aimed only at PUBLIC.
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT  EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    v_touched := v_touched + 1;
  END LOOP;

  IF v_touched < 15 THEN
    RAISE EXCEPTION
      'Only % functions matched, which is fewer than this schema holds. Check the predicate before '
      'trusting this migration.', v_touched;
  END IF;

  -- ---------------------------------------------------------------------------
  -- Prove it. This is the part 0151 was missing.
  -- ---------------------------------------------------------------------------
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
    INTO v_bad
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND (
       starts_with(p.proname, 'admin_')
       OR p.proname IN (
         'register_school', 'attach_own_registered_school',
         'school_verified_metrics', 'set_school_public_profile',
         'ensure_onboarding_checklist'
       )
     )
     AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'anon can still execute: %. The revoke did not take — do not assume a REVOKE worked because '
      'it did not error.', v_bad;
  END IF;

  RAISE NOTICE 'anon execute revoked and verified on % functions', v_touched;
END;
$$;

/**
 * The two functions `anon` is MEANT to reach, re-granted explicitly.
 *
 * Neither matches the predicate above, so neither was touched — but naming them here means the set
 * of anon-reachable functions in ZSMS is written down in one place rather than inferred from the
 * absence of a revoke. There are exactly three: these two and `school_branding_by_slug()`, which
 * themes the sign-in page before anybody has signed in.
 */
GRANT EXECUTE ON FUNCTION public.search_schools(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, NUMERIC, INT, INT) TO anon;
GRANT EXECUTE ON FUNCTION public.school_public_profile(TEXT) TO anon;

-- === MIGRATION END ===
