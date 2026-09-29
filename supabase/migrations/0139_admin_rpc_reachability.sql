-- Migration: 0139_admin_rpc_reachability.sql
-- Created: 2026-09-29
-- Description: Public wrappers for three admin functions stranded in the `afritech` schema,
--              where PostgREST cannot reach them.
-- Related documents: Official Documentation/05 Core Database and API Reference/ENDPOINTS.md
--                    Official Documentation/17 Integration and Pricing/PRICING.md
--
-- ===========================================================================
-- A FUNCTION IN `afritech` IS UNREACHABLE FROM THE APPLICATION
--
-- `supabase/config.toml` sets `schemas = ["public"]`. PostgREST exposes that schema and no other,
-- so `client.rpc('x')` resolves against `public.x` and nothing else. A function defined in
-- `afritech` can be called from SQL — a migration, a pgTAP suite, the SQL editor — and **never by
-- a route**.
--
-- The established convention is `public.admin_*`, which is why `admin_update_tier()`,
-- `admin_set_tier_feature()` and `admin_create_override()` all work. Three functions drifted from
-- it, and all three drifted silently because nothing fails until something tries to call them:
--
--   * `afritech.delete_tier_price_band()`   — `0129`
--   * `afritech.publish_prompt_template()`  — `0134`, and CLAUDE.md tells a reader to use it
--   * `afritech.set_tier_pricing_model()`   — `0138`, written yesterday, by me, one migration
--                                             after documenting the same class of problem
--
-- The third is the instructive one. `0138` exists precisely because per-student pricing had no
-- reachable entry point, and it added another unreachable entry point. Checking `config.toml`
-- takes ten seconds and I did it only when writing the route that would have failed.
--
-- ---------------------------------------------------------------------------
-- WRAPPERS, NOT MOVES
-- ---------------------------------------------------------------------------
-- The `afritech` originals stay. `platform_incidents_test.sql` calls
-- `afritech.publish_prompt_template()` directly and would break on a move, and moving a
-- SECURITY DEFINER function means re-granting and re-reasoning about its search_path for no gain.
--
-- A wrapper is a thin, honest indirection: the rule and the permission check live once, in the
-- implementation, and `public` carries the name a route can reach.
--
-- **The rule this leaves behind: a function the application must call belongs in `public` with an
-- `admin_` prefix. `afritech` is for configuration data and for functions only SQL calls.**
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. Switch a tier between flat and per-student pricing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_tier_pricing_model(
  p_tier_name     TEXT,
  p_pricing_model TEXT
)
RETURNS TABLE (tier_name TEXT, pricing_model TEXT, band_count BIGINT)
LANGUAGE sql
/**
 * INVOKER, deliberately. The wrapped function is SECURITY DEFINER and does its own
 * `is_afritech_admin()` check, so making the wrapper DEFINER too would stack two elevations and
 * put the real check one level further from the reader. The wrapper carries no privilege of its
 * own and decides nothing.
 */
SECURITY INVOKER
SET search_path = public, afritech, pg_temp
AS $$
  SELECT * FROM afritech.set_tier_pricing_model(p_tier_name, p_pricing_model);
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_tier_pricing_model(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Add or replace a price band.
-- ---------------------------------------------------------------------------
/**
 * New rather than a wrapper: there was no band writer at all. `0124` created the table and the
 * overlap trigger, `0128` granted SELECT, `0129` added deletion — and nothing was ever able to
 * create one, which is why `tier_student_price_bands` has been empty since it was built.
 */
CREATE OR REPLACE FUNCTION public.admin_upsert_tier_price_band(
  p_tier_name         TEXT,
  p_min_students      INT,
  p_max_students      INT,
  p_price_zmw         NUMERIC,
  p_price_usd         NUMERIC,
  p_band_id           UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech sets a price band.' USING ERRCODE = '42501';
  END IF;

  IF p_min_students < 1 THEN
    RAISE EXCEPTION 'A band must start at one pupil or more.' USING ERRCODE = '22023';
  END IF;

  /**
   * NULL `max_students` is the open-ended top band — "and everything above". It is not a missing
   * value, and a tier without one leaves a school that grows past the highest band unpriced.
   * `school_subscription_charge()` reports that rather than guessing, which is correct, but the
   * admin screen should not let it happen by accident.
   */
  IF p_max_students IS NOT NULL AND p_max_students < p_min_students THEN
    RAISE EXCEPTION 'The upper limit (%) is below the lower limit (%).',
      p_max_students, p_min_students USING ERRCODE = '22023';
  END IF;

  IF p_band_id IS NOT NULL THEN
    UPDATE afritech.tier_student_price_bands
       SET tier_name             = p_tier_name,
           min_students          = p_min_students,
           max_students          = p_max_students,
           price_per_student_zmw = p_price_zmw,
           price_per_student_usd = p_price_usd
     WHERE id = p_band_id
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
      RAISE EXCEPTION 'No price band with that id.' USING ERRCODE = 'P0002';
    END IF;
  ELSE
    INSERT INTO afritech.tier_student_price_bands
      (tier_name, min_students, max_students, price_per_student_zmw, price_per_student_usd)
    VALUES
      (p_tier_name, p_min_students, p_max_students, p_price_zmw, p_price_usd)
    RETURNING id INTO v_id;
  END IF;

  -- Overlap is NOT checked here. `0124`'s trigger owns that rule, and it names the band that
  -- collides — restating it would be a second copy that can disagree with the first.
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_upsert_tier_price_band(TEXT, INT, INT, NUMERIC, NUMERIC, UUID)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Remove a price band, and publish a prompt.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_tier_price_band(p_band_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, afritech, pg_temp
AS $$
  SELECT afritech.delete_tier_price_band(p_band_id);
$$;

GRANT EXECUTE ON FUNCTION public.admin_delete_tier_price_band(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_publish_prompt_template(
  p_feature_key   TEXT,
  p_system_prompt TEXT,
  p_user_template TEXT,
  p_model_params  JSONB DEFAULT '{}'::jsonb,
  p_change_note   TEXT  DEFAULT NULL
)
RETURNS INT
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, afritech, pg_temp
AS $$
  SELECT afritech.publish_prompt_template(
    p_feature_key, p_system_prompt, p_user_template, p_model_params, p_change_note);
$$;

GRANT EXECUTE ON FUNCTION public.admin_publish_prompt_template(TEXT, TEXT, TEXT, JSONB, TEXT)
  TO authenticated;

COMMENT ON FUNCTION public.admin_publish_prompt_template(TEXT, TEXT, TEXT, JSONB, TEXT) IS
  'PostgREST-reachable wrapper. The implementation and its AfriTech check live in '
  'afritech.publish_prompt_template(); only public functions can be called by a route.';

-- ---------------------------------------------------------------------------
-- 4. Bands need to be readable by a route as well as writable.
-- ---------------------------------------------------------------------------
/**
 * `subscription_tier_catalogue` already carries `price_bands` as JSON, which is what the pricing
 * screen reads. This view exists for the band EDITOR, which needs each band's `id` to update or
 * delete one — an aggregated JSON column cannot be edited row by row.
 *
 * `security_invoker`, so the caller's own privileges and the `afritech_admin_all_price_bands`
 * policy decide. Which means the caller also needs SELECT on the underlying table — the two-gate
 * rule that `0122` and `0128` each had to learn, and `0128` already granted it.
 */
CREATE OR REPLACE VIEW public.tier_price_bands
WITH (security_invoker = true) AS
SELECT b.id, b.tier_name, b.min_students, b.max_students,
       b.price_per_student_zmw, b.price_per_student_usd, b.created_at, b.updated_at
FROM   afritech.tier_student_price_bands b;

GRANT SELECT ON public.tier_price_bands TO authenticated;

COMMENT ON VIEW public.tier_price_bands IS
  'Price bands with their ids, for the band editor. The pricing SCREEN reads price_bands from '
  'subscription_tier_catalogue; an editor needs per-row ids, which an aggregate cannot give.';

-- === MIGRATION END ===
