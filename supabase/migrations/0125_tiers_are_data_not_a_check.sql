-- Migration: 0125_tiers_are_data_not_a_check.sql
-- Created: 2026-09-27
-- Description: The list of subscription tiers becomes data. Replaces the hardcoded
--              CHECK on `tier_name` and on `schools.subscription_tier` with a
--              foreign key, so AfriTech can create a plan without a migration.
-- Related documents: Official Documentation/17 Integration and Pricing/PRICING.md
--                    Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-014, ADR-040
--
-- ===========================================================================
-- THE CONTRADICTION THIS RESOLVES
--
-- `CLAUDE.md` states, and `PRICING.md` states, that pricing and feature access are
-- **entirely database-driven** and that a price, tier or feature inclusion must
-- never be hardcoded. Meanwhile:
--
--   afritech.subscription_tiers: CHECK (tier_name IN ('starter','growth','professional','enterprise'))
--   public.schools:              CHECK (subscription_tier IN (same four))
--
-- So the set of plans AfriTech can sell was fixed in DDL, in two places, and adding
-- a fifth plan required a migration to both. The tier *contents* were data; the tier
-- *list* was not. This was found trying to add exactly the plan this work is for — a
-- per-student plan intended for most schools — and being refused by a constraint.
--
-- It is the same failure ADR-040 already tracks for `curriculum_type` and
-- `level_type`: a closed CHECK on a value that was always going to grow.
--
-- WHY A FOREIGN KEY RATHER THAN JUST DROPPING THE CHECK
--
-- Dropping the CHECK alone would make `schools.subscription_tier` free text, and a
-- typo would silently put a school on a tier that does not exist. `school_has_feature()`
-- and `school_student_limit()` both resolve through the tier name, and both already
-- have a "tier not found" branch — reachable by a misspelling, and it grants
-- unlimited pupils.
--
-- A foreign key to `subscription_tiers(tier_name)` gives the flexibility and closes
-- that hole at the same time: any tier that exists is valid, and nothing else is.
-- ON UPDATE CASCADE so renaming a tier carries the schools with it rather than
-- orphaning them.
--
-- The `afritech` schema is not exposed to PostgREST, so the FK crossing schemas is
-- a database-level relationship only — it adds no new surface.
-- ===========================================================================

-- === MIGRATION START ===

-- 1. The tier list itself: any sensible key, not four literals.
ALTER TABLE afritech.subscription_tiers
  DROP CONSTRAINT IF EXISTS subscription_tiers_tier_name_check;

ALTER TABLE afritech.subscription_tiers
  ADD CONSTRAINT subscription_tiers_tier_name_shape
  CHECK (tier_name ~ '^[a-z][a-z0-9_]{1,38}$');

COMMENT ON COLUMN afritech.subscription_tiers.tier_name IS
  'Stable key for a plan, referenced by schools.subscription_tier and '
  'tier_features. Shape-checked, not enumerated — AfriTech creates plans as data '
  '(0125). Immutable in practice: renaming cascades but breaks anything that '
  'recorded the old name outside this database.';

-- 2. A school's tier must be a tier that exists.
ALTER TABLE public.schools
  DROP CONSTRAINT IF EXISTS schools_subscription_tier_check;

-- Any school already sitting on a tier with no row would break the FK. There should
-- be none, but a failed ALTER here is far better than discovering it later.
DO $$
DECLARE
  v_orphans INT;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM   public.schools s
  WHERE  s.subscription_tier IS NOT NULL
    AND  NOT EXISTS (
      SELECT 1 FROM afritech.subscription_tiers t WHERE t.tier_name = s.subscription_tier
    );

  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      '% school(s) are on a tier with no row in afritech.subscription_tiers. '
      'Seed the missing tier before adding the foreign key.', v_orphans;
  END IF;
END;
$$;

ALTER TABLE public.schools
  DROP CONSTRAINT IF EXISTS fk_schools_subscription_tier;
ALTER TABLE public.schools
  ADD CONSTRAINT fk_schools_subscription_tier
  FOREIGN KEY (subscription_tier)
  REFERENCES afritech.subscription_tiers(tier_name)
  -- Renaming a plan carries its schools along rather than orphaning them.
  ON UPDATE CASCADE
  -- Never ON DELETE CASCADE: deleting a tier must not delete schools. RESTRICT
  -- makes AfriTech move the schools off a plan before retiring it, which is the
  -- correct order of operations anyway.
  ON DELETE RESTRICT;

COMMENT ON COLUMN public.schools.subscription_tier IS
  'The plan this school is on. Foreign key to afritech.subscription_tiers, so the '
  'set of plans is data rather than DDL (0125). A tier_override in '
  'school_feature_overrides can point a school at a different tier temporarily '
  'without changing this.';

-- 3. `tier_override` points at a tier name too, and had no validation at all.
--    A misspelled override silently resolved to "tier_missing", which
--    school_student_limit() treats as UNLIMITED — so a typo removed a school's
--    enrolment ceiling. Worth closing while the same ground is being covered.
CREATE OR REPLACE FUNCTION afritech.validate_tier_override_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = afritech, public, pg_temp
AS $$
BEGIN
  IF NEW.override_type = 'tier_override'
     AND NOT EXISTS (
       SELECT 1 FROM afritech.subscription_tiers t WHERE t.tier_name = NEW.override_value
     ) THEN
    RAISE EXCEPTION
      '"%" is not a subscription tier. A mistyped tier override resolves to no '
      'tier, which would give the school unlimited enrolment.', NEW.override_value
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_tier_override_on_school_feature_overrides
  ON afritech.school_feature_overrides;
CREATE TRIGGER validate_tier_override_on_school_feature_overrides
  BEFORE INSERT OR UPDATE ON afritech.school_feature_overrides
  FOR EACH ROW EXECUTE FUNCTION afritech.validate_tier_override_value();

-- === MIGRATION END ===
