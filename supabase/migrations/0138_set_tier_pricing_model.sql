-- Migration: 0138_set_tier_pricing_model.sql
-- Created: 2026-09-29
-- Description: Lets AfriTech switch a tier between flat and per-student pricing.
-- Related documents: Official Documentation/17 Integration and Pricing/PRICING.md
--                    Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--
-- ===========================================================================
-- THE PRICING MODEL INTENDED FOR MOST SCHOOLS COULD ONLY BE SET BY SQL
--
-- `0124` built per-student pricing properly: `pricing_model` on the tier, `tier_student_price_bands`
-- with an overlap-rejection trigger, `school_student_limit()` reporting unlimited with a source of
-- `per_student_pricing`, and `school_subscription_charge()` returning NULL and a reason rather than
-- a misleading zero.
--
-- What it never got was a way to turn it on. `admin_update_tier()` takes prices, the student limit,
-- the WhatsApp quota and the public-listing flag — and not `pricing_model`. So every tier has sat
-- on `flat` since the day the feature was written, and the only way to change that was a hand-run
-- UPDATE against production.
--
-- The band table needs nothing: `authenticated` already holds INSERT, SELECT and UPDATE on it,
-- gated by `afritech_admin_all_price_bands`, with `0124`'s trigger rejecting overlapping bands and
-- `0129`'s `delete_tier_price_band()` handling removal. Only the switch was missing.
--
-- ---------------------------------------------------------------------------
-- SWITCHING TO per_student WITH NO BANDS IS ALLOWED, AND SAYS SO
-- ---------------------------------------------------------------------------
-- The tempting guard is to refuse the switch until at least one band exists. That gets the order
-- backwards: an admin has to pick the model before the band form is meaningful, and forcing bands
-- first would mean inventing a band to unlock the screen that defines bands.
--
-- It is safe because `school_subscription_charge()` already returns NULL with
-- `reason = 'no_price_band'` rather than a zero — an unpriced school is visibly unpriced rather
-- than silently free. The function returns the band count so the caller can say so plainly, which
-- the admin screen does.
-- ===========================================================================

-- === MIGRATION START ===

CREATE OR REPLACE FUNCTION afritech.set_tier_pricing_model(
  p_tier_name     TEXT,
  p_pricing_model TEXT
)
RETURNS TABLE (tier_name TEXT, pricing_model TEXT, band_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = afritech, public, pg_temp
AS $$
DECLARE
  v_bands BIGINT;
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech changes a pricing model.' USING ERRCODE = '42501';
  END IF;

  -- Restated rather than relying on the column CHECK, so the message names the valid values. A
  -- raw check violation tells the caller a constraint failed and not which words are allowed.
  IF p_pricing_model NOT IN ('flat', 'per_student') THEN
    RAISE EXCEPTION 'Pricing model must be flat or per_student, not %.', p_pricing_model
      USING ERRCODE = '22023';
  END IF;

  UPDATE afritech.subscription_tiers
     SET pricing_model = p_pricing_model,
         updated_by    = COALESCE(public.get_actor_id(), public.get_user_id(), 'system'),
         updated_at    = NOW()
   WHERE subscription_tiers.tier_name = p_tier_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No tier named %.', p_tier_name USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_bands
    FROM afritech.tier_student_price_bands b
   WHERE b.tier_name = p_tier_name;

  /**
   * The band count comes back so the caller can warn rather than guess. Switching to per-student
   * with zero bands is permitted — an admin must choose the model before the band form means
   * anything — and `school_subscription_charge()` already returns NULL with a reason for that
   * state, so such a school is visibly unpriced rather than quietly free.
   */
  RETURN QUERY SELECT p_tier_name, p_pricing_model, v_bands;
END;
$$;

GRANT EXECUTE ON FUNCTION afritech.set_tier_pricing_model(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION afritech.set_tier_pricing_model(TEXT, TEXT) IS
  'Switches a tier between flat and per-student pricing. Returns the band count so a caller can '
  'warn that a per-student tier has no bands yet — which is allowed, and which '
  'school_subscription_charge() reports as NULL with a reason rather than as free.';

-- === MIGRATION END ===
