-- Migration: 0124_per_student_pricing.sql
-- Created: 2026-09-27
-- Description: A tier can be priced per pupil, in admin-set bands. Such a tier has
--              no enrolment ceiling, and a school's subscription charge becomes a
--              resolved figure rather than a column.
-- Related documents: Official Documentation/17 Integration and Pricing/PRICING.md
--                    Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--
-- ===========================================================================
-- THE MODEL
--
-- A per-student plan **is a tier**. It keeps everything a tier already owns —
-- features through `tier_features`, its WhatsApp quota, its place in the catalogue —
-- and gains `pricing_model = 'per_student'` plus a set of bands. Two per-student
-- plans with different feature sets are two tiers, which needs no new mechanism and
-- leaves `school_has_feature()` completely untouched.
--
-- That separation is the point: **a tier says what you get, a pricing model says how
-- you are charged.** Conflating them is how "the cheap plan" ends up meaning both a
-- price and a feature set in a way nobody can change independently.
--
-- WHY A PER-STUDENT TIER HAS NO CEILING
--
-- `school_student_limit()` enforces a cap through an AFTER trigger raising ZS001.
-- The cap's purpose is commercial: you bought the 250-pupil plan. If a school pays
-- per pupil, capping enrolment means charging for growth and then preventing it —
-- a school enrolling its 251st pupil should be billed for 251, not blocked from
-- admitting a child.
--
-- So the resolver returns unlimited for a per-student tier. Note where in the order:
-- AFTER the per-school override, so an operator who explicitly pins a ceiling is
-- still honoured. That keeps "a negotiated cap on a per-student plan" available
-- without another migration, and it preserves the existing precedence exactly.
--
-- A MISSING BAND MUST NOT BILL ZERO
--
-- The dangerous failure here is a school whose roll falls outside every configured
-- band: the obvious implementation sums nothing and issues a K0 invoice, which
-- looks like a successful billing run and loses real revenue silently. So the
-- resolver returns a NULL amount with a stated reason, and the invoice run refuses
-- to issue rather than issuing nothing. Same instinct as recording a grade with no
-- scale: a gap must be visible, not absorbed.
-- ===========================================================================

-- === MIGRATION START ===

ALTER TABLE afritech.subscription_tiers
  ADD COLUMN IF NOT EXISTS pricing_model TEXT NOT NULL DEFAULT 'flat';

ALTER TABLE afritech.subscription_tiers
  DROP CONSTRAINT IF EXISTS subscription_tiers_pricing_model_check;
ALTER TABLE afritech.subscription_tiers
  ADD CONSTRAINT subscription_tiers_pricing_model_check
  CHECK (pricing_model IN ('flat', 'per_student'));

COMMENT ON COLUMN afritech.subscription_tiers.pricing_model IS
  'How this tier is charged: `flat` uses monthly_price_*, `per_student` uses the '
  'bands in afritech.tier_student_price_bands. Features and quota are unaffected '
  'either way — a tier says what you get, a pricing model says how you pay (0124).';

-- ---------------------------------------------------------------------------
-- The bands. Admin-set, per tier, both currencies.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afritech.tier_student_price_bands (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tier_name          TEXT NOT NULL REFERENCES afritech.subscription_tiers(tier_name)
                     ON DELETE CASCADE,

  min_students       INT NOT NULL CHECK (min_students >= 0),
  -- NULL means "and above" — the catch-all band. Exactly one per tier should have
  -- it, or a large school falls outside every band; the invoice run reports that
  -- rather than billing zero.
  max_students       INT CHECK (max_students IS NULL OR max_students >= min_students),

  price_per_student_zmw NUMERIC(10,2) NOT NULL CHECK (price_per_student_zmw >= 0),
  price_per_student_usd NUMERIC(10,2) NOT NULL CHECK (price_per_student_usd >= 0),

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (tier_name, min_students)
);

CREATE INDEX IF NOT EXISTS idx_tier_bands_tier
  ON afritech.tier_student_price_bands(tier_name, min_students);

DROP TRIGGER IF EXISTS update_timestamp_on_tier_student_price_bands
  ON afritech.tier_student_price_bands;
CREATE TRIGGER update_timestamp_on_tier_student_price_bands
  BEFORE UPDATE ON afritech.tier_student_price_bands
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

/**
 * Bands for one tier may not overlap.
 *
 * Without this, 1–100 and 50–200 both match a school of 80 and the price depends on
 * which row the planner reads first — a bill that changes between runs with no
 * change to the data. An exclusion constraint over `int4range` would be the
 * idiomatic guard, but it needs `btree_gist` for the tier equality and that
 * extension is not enabled here; a trigger states the rule in a message an operator
 * can act on, which is the more useful half anyway.
 */
CREATE OR REPLACE FUNCTION afritech.reject_overlapping_price_bands()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = afritech, public, pg_temp
AS $$
DECLARE
  v_clash RECORD;
BEGIN
  SELECT b.min_students, b.max_students INTO v_clash
  FROM   afritech.tier_student_price_bands b
  WHERE  b.tier_name = NEW.tier_name
    AND  b.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::UUID)
    -- Two ranges overlap unless one ends before the other begins. NULL max is
    -- treated as infinity on both sides.
    AND  COALESCE(b.max_students, 2147483647) >= NEW.min_students
    AND  COALESCE(NEW.max_students, 2147483647) >= b.min_students
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'That band overlaps an existing one for %: % to %. Bands must not overlap, '
      'or a school''s price depends on which row is read first.',
      NEW.tier_name, v_clash.min_students, COALESCE(v_clash.max_students::TEXT, 'and above')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_overlap_on_tier_student_price_bands
  ON afritech.tier_student_price_bands;
CREATE TRIGGER reject_overlap_on_tier_student_price_bands
  BEFORE INSERT OR UPDATE ON afritech.tier_student_price_bands
  FOR EACH ROW EXECUTE FUNCTION afritech.reject_overlapping_price_bands();

-- ---------------------------------------------------------------------------
-- The ceiling, now aware of pricing model.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_student_limit(p_school_id UUID)
RETURNS TABLE (student_limit INTEGER, is_unlimited BOOLEAN, source TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, afritech
AS $$
DECLARE
  v_value TEXT;
  v_tier  TEXT;
  v_limit INT;
  v_model TEXT;
BEGIN
  -- 1. Per-school ceiling. Still the most specific instruction and still wins —
  --    including over per-student pricing, so a negotiated cap remains possible
  --    without another migration.
  SELECT o.override_value INTO v_value
  FROM afritech.school_feature_overrides o
  WHERE o.school_id = p_school_id
    AND o.override_type = 'student_limit_override'
    AND o.is_active
    AND (o.expires_at IS NULL OR o.expires_at > NOW())
  ORDER BY o.created_at DESC
  LIMIT 1;

  IF v_value IS NOT NULL THEN
    IF v_value = 'unlimited' THEN
      RETURN QUERY SELECT NULL::INT, TRUE, 'school_override'::TEXT;
    ELSE
      RETURN QUERY SELECT v_value::INT, FALSE, 'school_override'::TEXT;
    END IF;
    RETURN;
  END IF;

  -- 2. Tier override, else the school's actual tier.
  SELECT o.override_value INTO v_value
  FROM afritech.school_feature_overrides o
  WHERE o.school_id = p_school_id
    AND o.override_type = 'tier_override'
    AND o.is_active
    AND (o.expires_at IS NULL OR o.expires_at > NOW())
  ORDER BY o.created_at DESC
  LIMIT 1;

  IF v_value IS NOT NULL THEN
    v_tier := v_value;
  ELSE
    SELECT s.subscription_tier INTO v_tier FROM public.schools s WHERE s.id = p_school_id;
  END IF;

  IF v_tier IS NULL THEN
    RETURN QUERY SELECT 0::INT, FALSE, 'unknown_school'::TEXT;
    RETURN;
  END IF;

  SELECT t.student_limit, t.pricing_model INTO v_limit, v_model
  FROM afritech.subscription_tiers t
  WHERE t.tier_name = v_tier;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::INT, TRUE, 'tier_missing'::TEXT;
    RETURN;
  END IF;

  -- 3. NEW: a per-student tier has no ceiling. Charging for growth and then
  --    blocking it would be the product refusing a child a place over a plan the
  --    school is already paying per pupil for.
  IF v_model = 'per_student' THEN
    RETURN QUERY SELECT NULL::INT, TRUE, 'per_student_pricing'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_limit, (v_limit IS NULL),
    CASE WHEN v_value IS NOT NULL THEN 'tier_override' ELSE 'tier' END::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- What a school is charged for its subscription, before add-ons and tax.
-- ---------------------------------------------------------------------------

/**
 * Resolves one school's subscription charge.
 *
 * `out_reason` is the important column. It is NULL on success and carries a
 * sentence when the charge could NOT be resolved — an unknown tier, or a roll
 * outside every band. The invoice run reads it and refuses to issue, because the
 * alternative is a K0 invoice that looks like a successful billing run.
 *
 * Effective tier honours `tier_override`, so a school moved to another tier by an
 * operator is billed on the tier it is actually using. Reading
 * `schools.subscription_tier` directly here would bill the tier it was sold.
 */
CREATE OR REPLACE FUNCTION public.school_subscription_charge(
  p_school_id UUID,
  p_currency  TEXT DEFAULT 'ZMW'
)
RETURNS TABLE (
  out_tier          TEXT,
  out_pricing_model TEXT,
  out_student_count INT,
  out_unit_price    NUMERIC,
  out_amount        NUMERIC,
  out_currency      TEXT,
  out_reason        TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_tier   TEXT;
  v_model  TEXT;
  v_flat   NUMERIC;
  v_count  INT;
  v_unit   NUMERIC;
BEGIN
  IF upper(COALESCE(p_currency, 'ZMW')) NOT IN ('ZMW', 'USD') THEN
    RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::INT, NULL::NUMERIC, NULL::NUMERIC,
                        p_currency, 'Unsupported currency.'::TEXT;
    RETURN;
  END IF;

  SELECT COALESCE(
    (SELECT o.override_value FROM afritech.school_feature_overrides o
      WHERE o.school_id = p_school_id AND o.override_type = 'tier_override'
        AND o.is_active AND (o.expires_at IS NULL OR o.expires_at > NOW())
      ORDER BY o.created_at DESC LIMIT 1),
    (SELECT s.subscription_tier FROM public.schools s WHERE s.id = p_school_id)
  ) INTO v_tier;

  IF v_tier IS NULL THEN
    RETURN QUERY SELECT NULL::TEXT, NULL::TEXT, NULL::INT, NULL::NUMERIC, NULL::NUMERIC,
                        upper(p_currency), 'School not found, or it has no tier.'::TEXT;
    RETURN;
  END IF;

  SELECT t.pricing_model,
         CASE WHEN upper(p_currency) = 'USD' THEN t.monthly_price_usd
              ELSE t.monthly_price_zmw END
    INTO v_model, v_flat
  FROM afritech.subscription_tiers t
  WHERE t.tier_name = v_tier;

  IF NOT FOUND THEN
    RETURN QUERY SELECT v_tier, NULL::TEXT, NULL::INT, NULL::NUMERIC, NULL::NUMERIC,
                        upper(p_currency),
                        format('Tier "%s" has no row in the price list.', v_tier);
    RETURN;
  END IF;

  IF v_model = 'flat' THEN
    RETURN QUERY SELECT v_tier, v_model, NULL::INT, NULL::NUMERIC, v_flat,
                        upper(p_currency), NULL::TEXT;
    RETURN;
  END IF;

  -- Per student. The roll as it stands right now — the agreed basis: a snapshot a
  -- school can check against its own records on the day the invoice is dated.
  SELECT count(*)::INT INTO v_count
  FROM   public.students s
  WHERE  s.school_id = p_school_id
    AND  s.is_deleted = FALSE
    AND  s.status IN ('active', 'on_leave');

  SELECT CASE WHEN upper(p_currency) = 'USD' THEN b.price_per_student_usd
              ELSE b.price_per_student_zmw END
    INTO v_unit
  FROM   afritech.tier_student_price_bands b
  WHERE  b.tier_name = v_tier
    AND  v_count >= b.min_students
    AND  (b.max_students IS NULL OR v_count <= b.max_students)
  -- Narrowest matching band wins if configuration is imperfect, though the overlap
  -- trigger should make that unreachable.
  ORDER BY b.min_students DESC
  LIMIT 1;

  IF v_unit IS NULL THEN
    RETURN QUERY SELECT v_tier, v_model, v_count, NULL::NUMERIC, NULL::NUMERIC,
                        upper(p_currency),
                        format(
                          'No price band on "%s" covers %s pupils. Add a band, or one with no upper limit.',
                          v_tier, v_count);
    RETURN;
  END IF;

  RETURN QUERY SELECT v_tier, v_model, v_count, v_unit, ROUND(v_unit * v_count, 2),
                      upper(p_currency), NULL::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- RLS and privileges.
-- ---------------------------------------------------------------------------
ALTER TABLE afritech.tier_student_price_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.tier_student_price_bands FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_price_bands" ON afritech.tier_student_price_bands;
CREATE POLICY "afritech_admin_all_price_bands"
ON afritech.tier_student_price_bands FOR ALL
USING (public.is_afritech_admin()) WITH CHECK (public.is_afritech_admin());

-- The `afritech` schema is not exposed to PostgREST (0097/0098), so no grant to
-- `authenticated` is made here. The admin screen reaches bands through a public
-- view and named functions, the same route the tier screen already uses.
REVOKE ALL ON afritech.tier_student_price_bands FROM anon;

GRANT EXECUTE ON FUNCTION public.school_subscription_charge(UUID, TEXT) TO authenticated;

-- === MIGRATION END ===
