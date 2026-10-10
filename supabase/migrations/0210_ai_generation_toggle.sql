-- ===========================================================================
-- 0210 — turn live AI generation on and off from the admin dashboard
--
-- Asked for on 2026-10-05: a toggle AfriTech controls, rather than an
-- environment variable.
--
-- ## What was wrong with the environment variable
--
-- `AI_GENERATOR` is read by `liveGenerationEnabled()` in `packages/ai`, and it
-- is a DEPLOYMENT-level setting: changing it means editing `.env.local` or a
-- Vercel variable and redeploying. That is the wrong grain for a switch whose
-- whole purpose is operational — "stop spending money right now" is not a thing
-- to wait for a build on, and neither is "the curriculum importer needs the
-- model for the next ten minutes".
--
-- It was also invisible. Nothing in the product said whether AI was on, so the
-- answer lived in a file one person could read.
--
-- ## The division of responsibility
--
-- The database setting is the SWITCH. The environment variable becomes a
-- CEILING: `AI_GENERATOR=off` forces live generation off whatever this row
-- says, so an environment that must never call a model — a staging instance
-- sharing production keys, a developer's machine — cannot be switched on from a
-- web page.
--
-- The real prerequisite was never the variable. It is an API key with credit on
-- it, and that is checked where the call is made rather than restated here.
--
-- ## Why the setting is a string
--
-- `afritech.platform_settings` is `key TEXT, value TEXT`, already holding
-- `financial_retention_years` and `erasure_grace_days`. A boolean column for
-- this one setting would be a second shape for the same table to serve, and the
-- reader casts.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The setting, off by default.
-- ---------------------------------------------------------------------------

/*
  OFF, deliberately, and `ON CONFLICT DO NOTHING` so re-running never flips a
  live platform back.

  Off is the safe default because on costs money per call. An environment that
  comes up with this unset should serve the template scaffold, not start
  spending.
*/
INSERT INTO afritech.platform_settings (key, value, description)
VALUES (
  'ai_live_generation',
  'false',
  'Whether lesson plans, quizzes and curriculum extraction call a real model. '
  'OFF serves the template scaffold, which is a working product rather than an '
  'error. Turning it ON spends AI credits on every generation. The environment '
  'variable AI_GENERATOR=off overrides this to OFF regardless, so an instance '
  'that must never call a model cannot be switched on from the dashboard.'
)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Reading it.
-- ---------------------------------------------------------------------------

/*
  A typed reader, rather than every caller casting `platform_setting()`.

  Anything that is not exactly 'true' reads as false. A setting that has been
  hand-edited to 'yes' or 'TRUE ' must not silently start spending money, and a
  permissive cast is how that happens.
*/
CREATE OR REPLACE FUNCTION public.ai_live_generation()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT lower(btrim(value)) = 'true'
       FROM afritech.platform_settings
      WHERE key = 'ai_live_generation'),
    FALSE
  );
$$;

REVOKE ALL ON FUNCTION public.ai_live_generation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_live_generation() FROM anon;
GRANT EXECUTE ON FUNCTION public.ai_live_generation() TO authenticated;

COMMENT ON FUNCTION public.ai_live_generation() IS
  'Whether live AI generation is switched on. Readable by any signed-in caller: a teacher''s Hub screen says whether their generator is model-backed.';

/*
  The whole state of the switch, for the admin screen.

  Who last changed it and when are part of the answer, not decoration — a
  platform-wide switch over spending needs to say who moved it, and the audit
  log is a separate screen nobody checks first.
*/
CREATE OR REPLACE FUNCTION public.admin_ai_generation_status()
RETURNS TABLE (
  out_enabled     BOOLEAN,
  out_updated_by  TEXT,
  out_updated_at  TIMESTAMPTZ,
  out_description TEXT
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
  SELECT
    lower(btrim(s.value)) = 'true',
    s.updated_by,
    s.updated_at,
    s.description
  FROM afritech.platform_settings s
  WHERE s.key = 'ai_live_generation';
END;
$$;

REVOKE ALL ON FUNCTION public.admin_ai_generation_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_ai_generation_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_ai_generation_status() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Moving it.
-- ---------------------------------------------------------------------------

/*
  AfriTech only, and audited.

  The role check is inside the function rather than expressed as a GRANT,
  because `authenticated` is one role to PostgreSQL — the distinction between an
  AfriTech administrator and a school owner exists only in the claims.

  A reason is REQUIRED. This switch governs platform-wide spending and the
  question asked three months later is never "was it on" but "why was it turned
  on" — and an audit row with no reason cannot answer that.
*/
CREATE OR REPLACE FUNCTION public.admin_set_ai_generation(
  p_enabled BOOLEAN,
  p_reason  TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_user TEXT := public.get_user_id();
  v_was  BOOLEAN;
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'AfriTech administrators only' USING ERRCODE = '42501';
  END IF;

  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'Say whether to switch it on or off' USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Give a reason — this switch governs platform-wide spending'
      USING ERRCODE = '22023';
  END IF;

  SELECT lower(btrim(value)) = 'true' INTO v_was
  FROM afritech.platform_settings
  WHERE key = 'ai_live_generation';

  UPDATE afritech.platform_settings
  SET value      = CASE WHEN p_enabled THEN 'true' ELSE 'false' END,
      updated_by = v_user,
      updated_at = NOW()
  WHERE key = 'ai_live_generation';

  IF NOT FOUND THEN
    -- The row is seeded above, so its absence means somebody deleted it. Named
    -- rather than silently re-created, because a missing settings row is a
    -- sign something else went wrong.
    RAISE EXCEPTION 'The ai_live_generation setting is missing from platform_settings'
      USING ERRCODE = 'P0002';
  END IF;

  /*
    `afritech` tables carry NO row-change trigger, so this call is the only
    record that the switch moved. `record_id` is NULL because the table is keyed
    on TEXT and the column is a UUID; the key lives in the metadata.
  */
  PERFORM public.log_audit_event(
    CASE WHEN p_enabled THEN 'ai_generation_enabled' ELSE 'ai_generation_disabled' END,
    'afritech.platform_settings',
    NULL,
    jsonb_build_object(
      'key', 'ai_live_generation',
      'was', v_was,
      'now', p_enabled,
      'reason', btrim(p_reason)
    ),
    NULL,
    NULL,
    NULL
  );

  RETURN p_enabled;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_ai_generation(BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_ai_generation(BOOLEAN, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_ai_generation(BOOLEAN, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_set_ai_generation(BOOLEAN, TEXT) IS
  'Switches live AI generation on or off platform-wide. AfriTech only, reason required, audited. AI_GENERATOR=off in the environment overrides this to OFF.';

-- ---------------------------------------------------------------------------
-- 4. Assert the shapes PostgREST depends on.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_n INT;
BEGIN
  /*
    All three must be in `public`.

    `supabase/config.toml` sets `schemas = ["public"]`, so a function in
    `afritech` is reachable from SQL and never from a route — no build error, a
    404 the first time somebody clicks the toggle. That trap has cost this
    schema five separate sessions.
  */
  SELECT COUNT(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('ai_live_generation', 'admin_ai_generation_status',
                      'admin_set_ai_generation');

  IF v_n <> 3 THEN
    RAISE EXCEPTION 'Expected 3 functions in public, found % — an overload or a wrong schema', v_n;
  END IF;

  -- The row must exist, or the toggle has nothing to move.
  SELECT COUNT(*) INTO v_n
  FROM afritech.platform_settings WHERE key = 'ai_live_generation';

  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ai_live_generation setting was not seeded';
  END IF;

  -- And it must read as OFF on a fresh database.
  IF public.ai_live_generation() THEN
    RAISE EXCEPTION 'ai_live_generation defaulted to ON — it must default to OFF';
  END IF;
END;
$$;
