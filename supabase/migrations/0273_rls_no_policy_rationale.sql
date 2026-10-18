-- ===========================================================================
-- 0273 — why five tables have RLS enabled and no policy
--
-- Comments only. Nothing is granted, revoked, created or dropped.
--
-- ## What prompted it
--
-- Supabase's security advisor reports `rls_enabled_no_policy` against five tables:
--
--   * `afritech.loan_commissions`
--   * `afritech.platform_metrics_daily`
--   * `afritech.platform_settings`
--   * `private.consent_templates`
--   * `private.loan_consent_log`
--
-- It is INFO rather than WARN, and in this schema it is **correct and deliberate** —
-- but nothing said so anywhere, so it read as a backlog item. The risk is not the
-- finding; it is somebody closing it by adding a permissive policy to a table that is
-- currently unreachable, and calling that an improvement.
--
-- ## Why deny-all is the right state here, verified rather than assumed
--
-- All five are `ENABLE ROW LEVEL SECURITY` **and** `FORCE`, with zero policies, which
-- denies every non-bypassing role outright. Three facts make that correct:
--
--   1. **Neither schema is exposed.** `supabase/config.toml` sets `schemas = ["public"]`,
--      so PostgREST resolves nothing in `afritech` or `private`. There is no URL.
--   2. **They carry no grants at all** — not to `anon`, not to `authenticated`, not
--      even to `service_role`. A policy would have nothing to admit.
--   3. **Each is reached through a `public` SECURITY DEFINER wrapper**, which is where
--      the authorisation actually lives, and that was checked by reading the
--      catalogue rather than inferred:
--
--        afritech.loan_commissions      -> admin_business_metrics,
--                                          admin_update_loan_application
--        afritech.platform_metrics_daily -> admin_platform_history,
--                                          worker_capture_platform_metrics
--        afritech.platform_settings      -> admin_platform_settings,
--                                          admin_set_platform_setting,
--                                          ai_live_generation, platform_setting
--        private.loan_consent_log        -> submit_loan_application
--
-- So the pattern is the one `0096` states for the metrics functions and `0169` for the
-- AI credit aggregates: the table is unreachable and a named function is the only door.
-- Adding a policy would not harden anything — it would open something.
--
-- ## One genuine finding, recorded and not fixed here
--
-- `private.consent_templates` is the exception in that list: **no function reads it.**
-- `submit_loan_application()` writes a `loan_consent_log` row carrying the template
-- version AND a hash of the wording, so what a parent agreed to is provable later —
-- which is the hard half and it is built. But the wording itself is never served, so
-- nothing shows a parent the text before they consent to a lender seeing their data.
--
-- That is the "finished, correct, unreachable" shape `DOC_AUDIT_PROGRESS.md` found in
-- eleven of eighteen folders, and `npm run gaps` cannot see it because the missing
-- link is a READ that no screen asks for. It is left open deliberately: the loan
-- module is post-launch (ADR-018 Phase 1), and the fix is a product decision about
-- when the wording is displayed, not a migration. Recorded here because this is where
-- the next person looking at these five tables will be.
-- ===========================================================================

COMMENT ON TABLE afritech.loan_commissions IS
  'What AfriTech earns per disbursed loan. In `afritech` because a school has no '
  'business reading what AfriTech earns on its parents'' loans (0224). '
  'RLS is enabled and FORCED with no policy, deliberately: the schema is not exposed '
  'to PostgREST, the table has no grants, and `admin_business_metrics()` / '
  '`admin_update_loan_application()` are the only doors. Do not add a policy to '
  'silence the advisor — it would open a table that is currently shut (0273).';

COMMENT ON TABLE afritech.platform_metrics_daily IS
  'One snapshot per day of the platform-wide counts. Exists because "how many schools '
  'were active in March" is unanswerable after the fact — status holds today''s value '
  'and created_at cannot reconstruct it (0267). '
  'RLS enabled and FORCED with no policy, deliberately: read through '
  '`admin_platform_history()`, written by `worker_capture_platform_metrics()`. No '
  'grants, no PostgREST exposure. Do not add a policy to silence the advisor (0273).';

COMMENT ON TABLE afritech.platform_settings IS
  'Operational switches AfriTech can move without a deployment, each with a reason '
  'recorded in the audit log. Holds the live-AI-generation kill switch, which is why '
  'it is a table and not an environment variable: "stop spending money right now" '
  'must not wait for a build (0210, generalised by 0216). '
  'Read through `platform_setting()` / `ai_live_generation()` / '
  '`admin_platform_settings()`; moved only by `admin_set_platform_setting()`, which is '
  'AfriTech-only and demands a reason. Writes UPDATE and never INSERT, so a typo '
  'cannot create a row nothing reads. RLS enabled and FORCED with no policy, '
  'deliberately — no grants, no PostgREST exposure. Do not add one (0273).';

COMMENT ON TABLE private.consent_templates IS
  'Versioned consent wording. A log row stores the version AND the hash, so the exact '
  'text a parent agreed to is provable years later (0224). '
  'RLS enabled and FORCED with no policy, deliberately — `private` is never referenced '
  'from client code and the table has no grants. '
  'KNOWN GAP (0273): no function reads this table, so the wording is never shown to a '
  'parent before they consent. The evidence half is built; the display half is a '
  'product decision, and the loan module is post-launch (ADR-018 Phase 1). '
  '`npm run gaps` cannot see this because the missing link is a read nothing asks for.';

COMMENT ON TABLE private.loan_consent_log IS
  'IMMUTABLE record of a parent consenting to one lender seeing their data. No UPDATE, '
  'no DELETE — it is the evidence that the disclosure was lawful (0224). '
  'RLS enabled and FORCED with no policy, deliberately: written only by '
  '`submit_loan_application()`, no grants, `private` is never referenced from client '
  'code (CONVENTIONS.md prohibition 9). Do not add a policy to silence the advisor — '
  'on an immutability record that would be the wrong direction entirely (0273).';


-- ---------------------------------------------------------------------------
-- Assert the premise the comments rest on, so this does not become a claim that
-- outlives its own truth. If any of the five ever gains a grant or a policy, the
-- comments above are wrong and this fails rather than misleading somebody.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  r      RECORD;
  v_bad  TEXT := '';
BEGIN
  FOR r IN
    SELECT n.nspname AS sch, c.relname AS tbl, c.oid,
           c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           (SELECT count(*) FROM pg_policies p
             WHERE p.schemaname = n.nspname AND p.tablename = c.relname) AS pols
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (n.nspname || '.' || c.relname) IN (
      'afritech.loan_commissions',
      'afritech.platform_metrics_daily',
      'afritech.platform_settings',
      'private.consent_templates',
      'private.loan_consent_log'
    )
  LOOP
    IF NOT r.rls OR NOT r.forced THEN
      v_bad := v_bad || format(' %s.%s is not RLS-forced;', r.sch, r.tbl);
    END IF;

    IF r.pols <> 0 THEN
      v_bad := v_bad || format(' %s.%s now has %s policies, so its comment is wrong;',
                               r.sch, r.tbl, r.pols);
    END IF;

    IF has_table_privilege('anon', r.oid, 'SELECT')
       OR has_table_privilege('authenticated', r.oid, 'SELECT')
    THEN
      v_bad := v_bad || format(' %s.%s is now readable by a user role;', r.sch, r.tbl);
    END IF;
  END LOOP;

  IF v_bad <> '' THEN
    RAISE EXCEPTION '0273: the rationale no longer matches the schema:%', v_bad;
  END IF;

  RAISE NOTICE '0273: PASS  five tables deny-all by construction, rationale recorded';
END;
$do$;
