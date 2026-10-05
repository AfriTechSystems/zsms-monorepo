-- ===========================================================================
-- 0216 — read and write every platform setting from one place
--
-- `afritech.platform_settings` holds three rows and had one function behind it:
-- `platform_setting(key)`, a reader. `0210` added a bespoke
-- `admin_set_ai_generation()` for a single key, which does not generalise — the
-- next toggle would get another function, and the one after that another.
--
-- Asked for on 2026-10-06: the toggles live in several places and belong in one
-- section. That needs a generic list-and-set pair, not a function per switch.
--
-- ## Why writes are restricted to keys that already exist
--
-- `admin_set_platform_setting()` UPDATEs and never INSERTs. A settings table
-- that accepts new keys from a web request is a table where a typo creates
-- `ai_live_generaton = true` that nothing reads, sits next to the real row, and
-- reads as the toggle being broken. New settings arrive by migration, where
-- their description and default are written down.
--
-- ## Why a reason is required
--
-- The same argument as `0210`: `afritech` tables carry NO row-change trigger, so
-- the explicit `log_audit_event()` call is the only record a setting moved. The
-- question months later is never what a value is — it is in the table — but why
-- it was changed.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Reading all of them.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_platform_settings()
RETURNS TABLE (
  out_key         TEXT,
  out_value       TEXT,
  out_description TEXT,
  out_updated_by  TEXT,
  out_updated_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'AfriTech administrators only' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.key, s.value, s.description, s.updated_by, s.updated_at
  FROM afritech.platform_settings s
  ORDER BY s.key;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_platform_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_platform_settings() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_settings() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Changing one.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_platform_setting(
  p_key    TEXT,
  p_value  TEXT,
  p_reason TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_user TEXT := public.get_user_id();
  v_was  TEXT;
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'AfriTech administrators only' USING ERRCODE = '42501';
  END IF;

  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RAISE EXCEPTION 'A setting cannot be blank' USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Give a reason — platform settings change behaviour for every school'
      USING ERRCODE = '22023';
  END IF;

  SELECT s.value INTO v_was
  FROM afritech.platform_settings s WHERE s.key = p_key;

  /*
    Unknown key is a refusal, not an insert.

    A settings table that accepts new keys from a web request is one where a typo
    creates a row nothing reads, sitting next to the real one — and the symptom
    is "the toggle does not work".
  */
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no platform setting called %. New settings are added by migration.', p_key
      USING ERRCODE = 'P0002';
  END IF;

  -- Nothing to do, and an audit row saying a value changed to itself is noise
  -- in the trail that matters.
  IF v_was = btrim(p_value) THEN
    RETURN v_was;
  END IF;

  UPDATE afritech.platform_settings
  SET value      = btrim(p_value),
      updated_by = v_user,
      updated_at = NOW()
  WHERE key = p_key;

  PERFORM public.log_audit_event(
    'platform_setting_changed',
    'afritech.platform_settings',
    NULL,
    jsonb_build_object(
      'key', p_key,
      'was', v_was,
      'now', btrim(p_value),
      'reason', btrim(p_reason)
    ),
    NULL, NULL, NULL
  );

  RETURN btrim(p_value);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_platform_setting(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_platform_setting(TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_platform_setting(TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_set_platform_setting(TEXT, TEXT, TEXT) IS
  'Changes one platform setting. AfriTech only, reason required, audited. Refuses an unknown key — new settings arrive by migration (0216).';

-- ---------------------------------------------------------------------------
-- 3. A setting for the AI assistant's rate limits, which AI_ASSISTANT.md
--    specifies as numbers and which must not be hardcoded.
-- ---------------------------------------------------------------------------

/*
  `AI_ASSISTANT.md`: "Maximum 100 assistant interactions per school per day.
  Maximum 20 per individual user per day."

  Those are defaults, not constants — confirmed on 2026-10-06. A school running a
  pilot will want more and a school abusing it will want less, and neither should
  need a deployment. Seeded with the documented figures.
*/
INSERT INTO afritech.platform_settings (key, value, description)
VALUES
  ('ai_assistant_daily_school_limit', '100',
   'Assistant interactions one school may make per day. AI_ASSISTANT.md''s default. '
   'Guards against a loop or an automated query running up cost.'),
  ('ai_assistant_daily_user_limit', '20',
   'Assistant interactions one person may make per day. AI_ASSISTANT.md''s default.')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Prove the refusals, since they are the whole value of the function.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_n INT;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub','user_0216_probe','role','authenticated',
    'o', json_build_object('id','org_afritech','slg','afritech-systems-admin'))::text, TRUE);

  -- An unknown key must be refused rather than created.
  BEGIN
    PERFORM public.admin_set_platform_setting('not_a_real_setting', 'x', 'probe');
    RAISE EXCEPTION '0216: an unknown key was accepted and would have been created';
  EXCEPTION
    WHEN SQLSTATE 'P0002' THEN NULL;
  END;

  -- A blank reason must be refused.
  BEGIN
    PERFORM public.admin_set_platform_setting('ai_assistant_daily_user_limit', '25', '  ');
    RAISE EXCEPTION '0216: a blank reason was accepted';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- The happy path writes and audits.
  PERFORM public.admin_set_platform_setting(
    'ai_assistant_daily_user_limit', '25', 'Verifying the setting writer');

  SELECT COUNT(*) INTO v_n
  FROM afritech.platform_settings
  WHERE key = 'ai_assistant_daily_user_limit' AND value = '25';

  IF v_n <> 1 THEN
    RAISE EXCEPTION '0216: the setting did not change';
  END IF;

  SELECT COUNT(*) INTO v_n
  FROM public.audit_logs
  WHERE action = 'platform_setting_changed'
    AND metadata ->> 'key' = 'ai_assistant_daily_user_limit';

  IF v_n < 1 THEN
    RAISE EXCEPTION '0216: the change was not audited';
  END IF;

  -- Put the documented default back.
  PERFORM public.admin_set_platform_setting(
    'ai_assistant_daily_user_limit', '20', 'Restoring the default after the test');

  RAISE NOTICE '0216: verified — unknown key refused, blank reason refused, change audited';
END;
$$;
