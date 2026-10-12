-- ===========================================================================
-- 0262 — `authenticated` no longer holds USAGE on `private`
--
-- Spec: `16 Testing and Launch/SECURITY_AUDIT.md` → *1.4 Private Schema
--       Inaccessibility*
--       `01 Foundation Layer/CONVENTIONS.md` → prohibition 9
--
-- ## How this was found
--
-- `npm run security:audit` (added with this migration) executes the mechanically
-- checkable half of SECURITY_AUDIT.md. Check 1.4 failed on its first run:
-- `has_schema_privilege('authenticated', 'private', 'USAGE')` was TRUE.
--
-- ## What the exposure actually was, stated accurately
--
-- **No loan data was readable.** `private` has no table grants to `authenticated`
-- or `anon` at all, so a SELECT fails on the table privilege before RLS is
-- consulted. The script's first draft said "loan employer, income and payslip
-- exposed", which was wrong and has been corrected — overstating a finding is its
-- own kind of defect, and an audit that cries wolf gets ignored on the day it is
-- right.
--
-- What USAGE did grant was the ability to **name** objects in the schema, and one
-- latent risk worth closing: with USAGE held, a future `GRANT SELECT` mistake on
-- a `private` table would be immediately exploitable. Without it, the same
-- mistake is still blocked by the schema privilege. That is the whole argument —
-- defence in depth against a migration nobody has written yet.
--
-- ## Why this is safe
--
-- Every function that reads `private` is **SECURITY DEFINER** —
-- `submit_loan_application`, `my_loan_applications`, `school_loan_applications`,
-- `admin_loan_applications`, `admin_update_loan_application`. A DEFINER function
-- runs with the owner's privileges, so none of them needs the caller to hold
-- USAGE. Verified by listing them before writing this.
--
-- No code in `apps/` or `packages/` references `private.` at all, which is
-- prohibition 9 and was already being honoured.
--
-- `private.refuse_consent_mutation()` also loses its EXECUTE grant. It is a
-- **trigger** function: triggers fire with the privileges of the table owner, not
-- the caller, so a direct EXECUTE grant was never needed and only widened the
-- surface. The assertion below proves the trigger still fires, because "the grant
-- is gone" is not the property that matters — "consent is still immutable" is.
-- ===========================================================================

REVOKE USAGE ON SCHEMA private FROM authenticated;
REVOKE USAGE ON SCHEMA private FROM anon;

REVOKE ALL ON FUNCTION private.refuse_consent_mutation() FROM authenticated;
REVOKE ALL ON FUNCTION private.refuse_consent_mutation() FROM anon;

/*
  And for anything created in `private` later.

  Default privileges are what would otherwise re-grant this quietly: a new table
  in `private` created by a role whose defaults include `authenticated` would
  arrive reachable, and nothing would say so.
*/
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON FUNCTIONS FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA private REVOKE ALL ON FUNCTIONS FROM anon;

-- ---------------------------------------------------------------------------
-- Exercise it: the privilege is gone AND the loan module still works.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_fn     TEXT;
  v_missing TEXT := '';
BEGIN
  -- 1. The privilege is gone.
  IF has_schema_privilege('authenticated', 'private', 'USAGE') THEN
    RAISE EXCEPTION '0262: authenticated still holds USAGE on private';
  END IF;
  IF has_schema_privilege('anon', 'private', 'USAGE') THEN
    RAISE EXCEPTION '0262: anon still holds USAGE on private';
  END IF;

  -- 2. No end-user role picked up a table privilege along the way.
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema = 'private' AND grantee IN ('authenticated', 'anon')
  ) THEN
    RAISE EXCEPTION '0262: an end-user role holds a table privilege in private';
  END IF;

  /*
    3. Every loan function must still be EXECUTE-able by `authenticated`.

    This is the assertion that matters. Revoking schema USAGE while leaving the
    DEFINER functions grantable is the whole point — if this fails, the loan module
    has just been switched off for every parent and the privilege change is a
    regression rather than a hardening.
  */
  FOR v_fn IN
    SELECT unnest(ARRAY[
      'submit_loan_application',
      'my_loan_applications',
      'school_loan_applications',
      'admin_loan_applications',
      'admin_update_loan_application'
    ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
        AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    ) THEN
      v_missing := v_missing || v_fn || ' ';
    END IF;
  END LOOP;

  IF v_missing <> '' THEN
    RAISE EXCEPTION
      '0262: these loan functions are no longer callable, so the module is broken: %',
      v_missing;
  END IF;

  -- 4. Each of them must still be DEFINER, which is what makes (3) work.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('submit_loan_application', 'my_loan_applications',
                        'school_loan_applications', 'admin_loan_applications',
                        'admin_update_loan_application')
      AND NOT p.prosecdef
  ) THEN
    RAISE EXCEPTION
      '0262: a loan function is SECURITY INVOKER, so revoking USAGE just broke it';
  END IF;

  RAISE NOTICE
    '0262: verified — USAGE revoked, no table grants, all five loan functions still callable as DEFINER';
END;
$$;

-- ---------------------------------------------------------------------------
-- Consent must still be immutable. The trigger, not the grant, is the control.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_id UUID;
BEGIN
  BEGIN
    SELECT id INTO v_id FROM private.loan_consent_log LIMIT 1;

    IF v_id IS NULL THEN
      /*
        No consent rows on dev. Assert the trigger is attached rather than skipping
        — `0173` attached an audit trigger, asserted attachment, and every write
        through it then failed, so attachment alone is weak evidence. It is still
        better than nothing, and the pgTAP suite covers behaviour.
      */
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'private' AND c.relname = 'loan_consent_log'
          AND NOT t.tgisinternal
      ) THEN
        RAISE EXCEPTION '0262: nothing protects the consent log from being edited';
      END IF;
      RAISE NOTICE '0262: no consent fixture; trigger attachment asserted only';
      RETURN;
    END IF;

    -- A real write must still be refused.
    BEGIN
      UPDATE private.loan_consent_log SET consented_at = NOW() WHERE id = v_id;
      RAISE EXCEPTION '0262: a consent record was edited — it is no longer evidence';
    EXCEPTION
      WHEN raise_exception THEN
        IF SQLERRM LIKE '%0262:%' THEN RAISE; END IF;
        -- The guard fired, which is the behaviour wanted.
        NULL;
      WHEN insufficient_privilege THEN NULL;
    END;

    RAISE NOTICE '0262: verified — the consent log still refuses an edit';
  END;
END;
$$;
