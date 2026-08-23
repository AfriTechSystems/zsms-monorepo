-- Migration: 0101_dynamic_student_ceilings.sql
-- Created: 2026-08-23
-- Description: Makes the student ceiling a resolved, per-school configuration value
--              rather than a tier column read directly — adds the
--              `student_limit_override` override type, the resolver, the capacity
--              function the portal reads, and the enrolment guard that enforces it.
-- Related documents: Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--                    Official Documentation/17 Integration and Pricing/PRICING.md
--                    Official Documentation/07 Students and Parents/STUDENTS.md

-- === MIGRATION START ===

-- WHY
-- ---
-- `afritech.subscription_tiers.student_limit` has existed since 0082 and is
-- already admin-editable through `admin_update_tier()`. What was missing is
-- everything around it:
--
--   1. The seeded values disagreed with both PRICING.md and DYNAMIC_CONFIG.md —
--      Starter was 150 against a documented 200, Professional was NULL
--      (unlimited) against a documented 1,000. A ceiling is not inert the way an
--      unset price is: it decides whether a school can enrol its next pupil, and
--      the two documents that a commercial decision would be read from both said
--      something the database did not do.
--
--   2. There was no per-school exception. Every other commercial value in this
--      system can be varied for one school through
--      `afritech.school_feature_overrides` — a tier, a trial length, a single
--      feature. The student ceiling could not be, so the only way to let one
--      school run 30 pupils over its tier was to raise the ceiling for every
--      school on that tier.
--
--   3. Nothing enforced it. `whatsapp_quota` has `consume_message_quota()`;
--      `student_limit` had no equivalent, so the column was configuration that
--      described a rule nothing applied.
--
-- The ceiling stays configuration throughout. Nothing below contains a student
-- count — the trigger reads the same resolver the UI reads, and the resolver
-- reads the tier table. Grepping this file for a literal enrolment number finds
-- only the seed alignment, which is a starting value a super admin edits.

-- ---------------------------------------------------------------------------
-- 1. Align the seeded ceilings with the documented benchmarks
--
-- Guarded rather than unconditional. `0082`'s seed values are 150 / 500 / NULL /
-- NULL; the benchmark is 200 / 500 / 1,000 / unlimited. Each row is updated ONLY
-- if it still holds exactly what 0082 wrote — so a ceiling a super admin has
-- since edited is left alone. That matters most for Professional, where the
-- change is a TIGHTENING (unlimited → 1,000): silently capping a tier an
-- operator had deliberately uncapped is the one direction of this change that
-- could stop a real school enrolling.
--
-- These are starting values, not constants. The whole point of the table is that
-- the next change to them is made from the pricing screen, not from a migration.
-- ---------------------------------------------------------------------------
UPDATE afritech.subscription_tiers
SET student_limit = 200, updated_by = 'migration:0101', updated_at = NOW()
WHERE tier_name = 'starter' AND student_limit = 150;

UPDATE afritech.subscription_tiers
SET student_limit = 1000, updated_by = 'migration:0101', updated_at = NOW()
WHERE tier_name = 'professional' AND student_limit IS NULL;

-- Growth (500) and Enterprise (unlimited) already match the benchmark. No
-- statement for them: a no-op UPDATE would still bump updated_at and updated_by,
-- making it look as though a decision was taken here that was not.

-- ---------------------------------------------------------------------------
-- 2. `student_limit_override` — the per-school exception
--
-- Reuses the existing override table rather than adding a parallel mechanism.
-- Everything that makes that table auditable is then inherited for free: a
-- mandatory `reason`, a `granted_by` taken from the session, an optional
-- `expires_at`, and revocation as an UPDATE rather than a DELETE.
--
-- The value lives in `override_value` (TEXT), exactly as `tier_override` does.
-- 'unlimited' is spelled out rather than encoded as an empty string or a
-- negative number, because this column is read by a human deciding whether a
-- support decision was correct.
-- ---------------------------------------------------------------------------
ALTER TABLE afritech.school_feature_overrides
  DROP CONSTRAINT IF EXISTS override_shape;

ALTER TABLE afritech.school_feature_overrides
  ADD CONSTRAINT override_shape CHECK (
    (override_type IN ('grant_feature', 'revoke_feature') AND feature_key IS NOT NULL)
    OR (override_type IN ('extend_subscription', 'extend_trial', 'tier_override',
                          'student_limit_override') AND feature_key IS NULL)
  );

ALTER TABLE afritech.school_feature_overrides
  DROP CONSTRAINT IF EXISTS school_feature_overrides_override_type_check;

ALTER TABLE afritech.school_feature_overrides
  ADD CONSTRAINT school_feature_overrides_override_type_check CHECK (
    override_type IN (
      'grant_feature', 'revoke_feature',
      'extend_subscription', 'extend_trial', 'tier_override',
      'student_limit_override'
    )
  );

-- A student_limit_override whose value is not a number is not a smaller ceiling,
-- it is a ceiling that cannot be resolved — and the resolver would have to guess
-- which way to fail. Refused at write time instead.
ALTER TABLE afritech.school_feature_overrides
  DROP CONSTRAINT IF EXISTS student_limit_override_has_valid_value;

ALTER TABLE afritech.school_feature_overrides
  ADD CONSTRAINT student_limit_override_has_valid_value CHECK (
    override_type <> 'student_limit_override'
    OR (override_value = 'unlimited' OR override_value ~ '^[0-9]+$')
  );

COMMENT ON COLUMN afritech.school_feature_overrides.override_value IS
  'Type-dependent payload. tier_override: a tier name. student_limit_override: a non-negative integer, or the literal ''unlimited''.';

-- ---------------------------------------------------------------------------
-- 3. school_student_limit() — the resolver
--
-- Same shape of decision as `school_has_feature()`, and deliberately the same
-- ordering discipline: fixed in one function, not assembled by each caller.
--
--   1. active student_limit_override  → that value
--   2. active tier_override           → the overridden tier's ceiling
--   3. the school's own tier          → the tier's ceiling
--
-- There is no revoke direction here — a ceiling is a number, not a boolean, so
-- an override that lowers it is expressed by giving a lower number.
--
-- `is_unlimited` is returned as its own column rather than left implied by a
-- NULL. NULL in `student_limit` means unlimited, but NULL out of a function also
-- reads as "no answer", and the two must not be confused by a caller deciding
-- whether to let a pupil through. A caller that ignores `is_unlimited` and reads
-- only `student_limit` sees NULL and, if it treats that as zero, blocks
-- everything — the wrong direction to fail by accident.
--
-- SECURITY DEFINER for the same reason `school_has_feature()` is: the answer is
-- assembled from `afritech` tables a school cannot read, but the school is
-- entitled to know its own ceiling.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_student_limit(p_school_id UUID)
RETURNS TABLE (student_limit INT, is_unlimited BOOLEAN, source TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, afritech
AS $$
DECLARE
  v_value TEXT;
  v_tier  TEXT;
  v_limit INT;
BEGIN
  -- 1. Per-school ceiling.
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
    -- No such school. Not "unlimited" — a caller must not read a missing school
    -- as permission to enrol into it.
    RETURN QUERY SELECT 0::INT, FALSE, 'unknown_school'::TEXT;
    RETURN;
  END IF;

  SELECT t.student_limit INTO v_limit
  FROM afritech.subscription_tiers t
  WHERE t.tier_name = v_tier;

  IF NOT FOUND THEN
    -- A tier with no row in the pricing table has no ceiling at all. 0082 warns
    -- about exactly this. Treated as unlimited rather than as zero: the school
    -- is on a tier AfriTech sold it, and a configuration gap on our side must
    -- not lock its enrolment.
    RETURN QUERY SELECT NULL::INT, TRUE, 'tier_missing'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT v_limit, (v_limit IS NULL),
    CASE WHEN v_value IS NOT NULL THEN 'tier_override' ELSE 'tier' END::TEXT;
END;
$$;

COMMENT ON FUNCTION public.school_student_limit(UUID) IS
  'Resolved student ceiling for one school. Order: student_limit_override > tier_override > tier (DYNAMIC_CONFIG.md).';

REVOKE ALL ON FUNCTION public.school_student_limit(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_student_limit(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. school_student_capacity() — resolved ceiling plus where the school stands
--
-- One call, because every consumer needs both halves. The enrolment screen shows
-- "142 of 200", the guard needs to know whether the next insert fits, and the
-- admin school-detail page shows the same pair. Splitting it would mean each
-- caller writing its own count query, and the counting RULE below is the part
-- that must not be reimplemented three times.
--
-- WHAT COUNTS TOWARD THE CEILING: pupils currently on the roll —
-- `status IN ('active','on_leave')` and not soft-deleted. A transferred,
-- graduated, or withdrawn pupil does not, and that is a commercial decision
-- worth stating: counting them would make every school's usage rise
-- monotonically forever, so a school would eventually be billed a tier upgrade
-- for pupils who left years ago. `on_leave` DOES count — the pupil is still
-- enrolled and still occupies a place.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_student_capacity(p_school_id UUID)
RETURNS TABLE (
  student_limit INT,
  is_unlimited  BOOLEAN,
  source        TEXT,
  current_count INT,
  remaining     INT,
  at_capacity   BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, afritech
AS $$
DECLARE
  v_limit     INT;
  v_unlimited BOOLEAN;
  v_source    TEXT;
  v_count     INT;
BEGIN
  SELECT l.student_limit, l.is_unlimited, l.source
    INTO v_limit, v_unlimited, v_source
  FROM public.school_student_limit(p_school_id) l;

  SELECT count(*)::INT INTO v_count
  FROM public.students s
  WHERE s.school_id = p_school_id
    AND NOT s.is_deleted
    AND s.status IN ('active', 'on_leave');

  RETURN QUERY SELECT
    v_limit,
    v_unlimited,
    v_source,
    v_count,
    CASE WHEN v_unlimited THEN NULL ELSE GREATEST(v_limit - v_count, 0) END,
    CASE WHEN v_unlimited THEN FALSE ELSE v_count >= v_limit END;
END;
$$;

COMMENT ON FUNCTION public.school_student_capacity(UUID) IS
  'Resolved student ceiling plus current enrolment for one school. Counts status active/on_leave, not soft-deleted.';

REVOKE ALL ON FUNCTION public.school_student_capacity(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_student_capacity(UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The enrolment guard
--
-- In the database rather than in the API route, for the same reason tenant
-- isolation is: there is more than one writer. The students API route is one,
-- the CSV import job is another, and a support operator with the service role is
-- a third. A check that lives in one route is a check the other two walk past.
--
-- It fires on INSERT, and on the UPDATE that puts a pupil back on the roll —
-- undoing a soft delete, or moving `withdrawn` back to `active`. Both raise the
-- count exactly as an INSERT does, and a ceiling that only watches INSERT is one
-- you get around by withdrawing a pupil and re-activating them.
--
-- ERRCODE 'ZS001' rather than a generic raise: the API layer has to tell this
-- apart from a constraint violation to render the upgrade message, and matching
-- on the text of an error message is not a contract.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_student_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech
AS $$
DECLARE
  v_limit     INT;
  v_unlimited BOOLEAN;
  v_count     INT;
BEGIN
  -- Only rows that will occupy a place are checked. Importing a graduated pupil
  -- for historical records must not be refused by a ceiling they do not consume.
  IF NEW.is_deleted OR NEW.status NOT IN ('active', 'on_leave') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Already on the roll before this UPDATE — nothing new is being consumed, so
    -- an edit to a name or a class is never blocked by a full school.
    IF NOT OLD.is_deleted AND OLD.status IN ('active', 'on_leave') THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT c.student_limit, c.is_unlimited, c.current_count
    INTO v_limit, v_unlimited, v_count
  FROM public.school_student_capacity(NEW.school_id) c;

  IF v_unlimited THEN
    RETURN NEW;
  END IF;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION
      'This school has reached its plan limit of % enrolled pupils. Upgrade the subscription tier, or ask AfriTech for a per-school limit override, to enrol more.',
      v_limit
      USING ERRCODE = 'ZS001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_student_limit() IS
  'Refuses an enrolment that would exceed the resolved ceiling. Reads school_student_capacity() — no number is written here.';

DROP TRIGGER IF EXISTS enforce_student_limit_on_students ON public.students;
CREATE TRIGGER enforce_student_limit_on_students
  BEFORE INSERT OR UPDATE OF status, is_deleted, school_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.enforce_student_limit();

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_limit INT;
  v_unlimited BOOLEAN;
  v_source TEXT;
  v_count INT;
BEGIN
  -- The benchmark is now in the database.
  SELECT student_limit INTO v_limit FROM afritech.subscription_tiers WHERE tier_name = 'starter';
  IF v_limit IS DISTINCT FROM 200 THEN
    RAISE EXCEPTION '0101: starter ceiling is %, expected 200', v_limit;
  END IF;

  SELECT student_limit INTO v_limit FROM afritech.subscription_tiers WHERE tier_name = 'growth';
  IF v_limit IS DISTINCT FROM 500 THEN
    RAISE EXCEPTION '0101: growth ceiling is %, expected 500', v_limit;
  END IF;

  SELECT student_limit INTO v_limit FROM afritech.subscription_tiers WHERE tier_name = 'professional';
  IF v_limit IS DISTINCT FROM 1000 THEN
    RAISE EXCEPTION '0101: professional ceiling is %, expected 1000', v_limit;
  END IF;

  SELECT student_limit INTO v_limit FROM afritech.subscription_tiers WHERE tier_name = 'enterprise';
  IF v_limit IS NOT NULL THEN
    RAISE EXCEPTION '0101: enterprise ceiling is %, expected unlimited', v_limit;
  END IF;

  -- The resolver answers for a real school, and reports where the answer came from.
  SELECT l.student_limit, l.is_unlimited, l.source INTO v_limit, v_unlimited, v_source
  FROM public.schools s, LATERAL public.school_student_limit(s.id) l
  WHERE s.subscription_tier = 'starter' LIMIT 1;

  IF v_source IS NOT NULL AND v_source <> 'tier' THEN
    RAISE EXCEPTION '0101: starter school resolved from % rather than the tier', v_source;
  END IF;

  -- No existing school is already over the ceiling this migration sets. If one
  -- were, the trigger would refuse its next enrolment on the strength of a
  -- number chosen here rather than by an operator, and that should be a visible
  -- failure now rather than a support ticket later.
  SELECT count(*)::INT INTO v_count
  FROM public.schools s, LATERAL public.school_student_capacity(s.id) c
  WHERE NOT c.is_unlimited AND c.current_count > c.student_limit;

  IF v_count > 0 THEN
    RAISE EXCEPTION '0101: % school(s) are already above the ceiling this migration sets', v_count;
  END IF;

  -- The override type is writable.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'afritech.school_feature_overrides'::regclass
      AND conname = 'school_feature_overrides_override_type_check'
      AND pg_get_constraintdef(oid) LIKE '%student_limit_override%'
  ) THEN
    RAISE EXCEPTION '0101: student_limit_override is not admitted by the override_type CHECK';
  END IF;
END;
$$;

-- === MIGRATION END ===
