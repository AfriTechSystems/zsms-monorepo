-- ===========================================================================
-- 0219 — drop the AI-toggle functions `0216` superseded
--
-- `0210` added `admin_set_ai_generation()` and `admin_ai_generation_status()`
-- for one setting. `0216` replaced them with the generic
-- `admin_set_platform_setting()` / `admin_platform_settings()` pair, and the
-- screen and route that called the specific ones are gone.
--
-- `npm run gaps` found them: two functions nothing calls. They are dropped
-- rather than left in place or excepted, because leaving them would mean **two
-- ways to change one value** — and only one of them writes the audit metadata
-- the settings screen now relies on (`platform_setting_changed` with `was` and
-- `now`). A later caller picking the older function would silently stop
-- producing that trail.
--
-- The setting itself is untouched: `ai_live_generation` still lives in
-- `afritech.platform_settings`, still defaults to off, and `ai_live_generation()`
-- — the reader every route uses — is unchanged.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.admin_set_ai_generation(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.admin_ai_generation_status();

DO $$
DECLARE v_n INT;
BEGIN
  SELECT COUNT(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('admin_set_ai_generation', 'admin_ai_generation_status');

  IF v_n <> 0 THEN
    RAISE EXCEPTION '0219: % superseded function(s) still present', v_n;
  END IF;

  -- The reader and the setting must survive: every route consults the first and
  -- the toggle lives in the second.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ai_live_generation'
  ) THEN
    RAISE EXCEPTION '0219: ai_live_generation() was dropped — every AI route reads it';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM afritech.platform_settings WHERE key = 'ai_live_generation'
  ) THEN
    RAISE EXCEPTION '0219: the ai_live_generation setting is missing';
  END IF;

  -- And the generic setter that replaced them must be there.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_set_platform_setting'
  ) THEN
    RAISE EXCEPTION '0219: admin_set_platform_setting() is missing — nothing could set a toggle';
  END IF;
END;
$$;
