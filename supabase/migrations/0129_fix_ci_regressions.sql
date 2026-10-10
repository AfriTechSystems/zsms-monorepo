-- Migration: 0129_fix_ci_regressions.sql
-- Created: 2026-09-27
-- Description: Three regressions the first CI run found — a breaking change to
--              `announcements`, and two DELETE grants that violated tested
--              repository-wide invariants.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md
--                    Official Documentation/01 Foundation Layer/CONVENTIONS.md
--
-- ===========================================================================
-- WHAT CI FOUND, AND WHY NOTHING LOCAL COULD HAVE
--
-- All three were introduced by me, all three were invisible to every check that can
-- run on this machine, and all three were caught the first time 21 pgTAP suites ran
-- against a database built from scratch. `npm run db:test:plans` counts assertions
-- without executing them, so a suite that errors on line one still "passes" the plan
-- check.
--
-- ---------------------------------------------------------------------------
-- 1. `0114` broke every existing writer of `announcements`
-- ---------------------------------------------------------------------------
-- It added `target_audience` and `target_scope` as NOT NULL with no default, and a
-- trigger deriving `target_type` FROM them. Every caller that already inserted
-- `target_type` — which was the only way to do it before — now fails with a
-- not-null violation.
--
-- That is not merely a test problem. **`/api/announcements` inserts `target_type`
-- directly**, so the older announcements route has been broken since 0114 was
-- applied. Two pgTAP suites written before 0114 fail for the same reason, and they
-- are the ones that told me.
--
-- The fix is to make the derivation **bidirectional** rather than to edit the callers
-- to match. A caller that supplies audience and scope gets `target_type` derived, as
-- before. A caller that supplies only `target_type` now gets audience and scope
-- derived from it. A BEFORE trigger runs ahead of the NOT NULL check, so filling them
-- there satisfies the constraint.
--
-- Editing the two suites instead would have hidden the broken route.
--
-- ---------------------------------------------------------------------------
-- 2 and 3. Two DELETE grants against invariants this repository tests for
-- ---------------------------------------------------------------------------
-- `tenant_isolation_test.sql` asserts *"no DELETE or TRUNCATE privilege exists
-- anywhere in public for end-user roles"*, and `communications_test.sql` asserts
-- *"authenticated can never DELETE or TRUNCATE afritech configuration"*. Both are
-- deliberate, long-standing, and tested. I granted DELETE twice:
--
--   * `0110` on `public.student_custom_values`, reasoning that clearing a pupil's
--     answer is an ordinary correction rather than destroying a record. The
--     reasoning is fine; granting the privilege to do it was not, because the rule
--     is repository-wide and I did not check for it.
--   * `0128` on `afritech.tier_student_price_bands`, so a price band could be
--     removed.
--
-- Both are revoked. Both operations are legitimate, so both get a named
-- SECURITY DEFINER function instead — the same shape `verify_payment()` already uses
-- for an act that must not be a bare table privilege.
--
-- These functions necessarily RESTATE their permission checks, which normally I
-- would avoid: the policy should be the single place a rule lives. Here the
-- invariant forbids the grant that would let RLS decide, so the duplication is
-- forced rather than chosen, and it is written next to the reason.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. Bidirectional derivation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_announcement_target_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  /**
   * Old caller: `target_type` given, the two dimensions absent. Expand it.
   *
   * `grade` and `class` map to a PARENT audience because that is what the worker
   * actually did before 0114 — recording the behaviour as it was, which is the same
   * choice 0114's backfill made for existing rows.
   */
  IF NEW.target_audience IS NULL OR NEW.target_scope IS NULL THEN
    NEW.target_audience := COALESCE(NEW.target_audience, CASE NEW.target_type
      WHEN 'all_parents'  THEN 'parents'
      WHEN 'all_students' THEN 'students'
      WHEN 'all_staff'    THEN 'staff'
      WHEN 'grade'        THEN 'parents'
      WHEN 'class'        THEN 'parents'
      WHEN 'individual'   THEN 'individuals'
      WHEN 'platform'     THEN 'everyone'
    END);
    NEW.target_scope := COALESCE(NEW.target_scope, CASE NEW.target_type
      WHEN 'grade'      THEN 'grade'
      WHEN 'class'      THEN 'class'
      WHEN 'individual' THEN 'individual'
      WHEN 'platform'   THEN 'platform'
      ELSE 'school'
    END);
  END IF;

  -- New caller: the two dimensions given. Derive the flattened column, which stays a
  -- mirror and is never authoritative.
  NEW.target_type :=
    CASE
      WHEN NEW.target_scope = 'platform'   THEN 'platform'
      WHEN NEW.target_scope = 'individual' THEN 'individual'
      WHEN NEW.target_scope = 'grade'      THEN 'grade'
      WHEN NEW.target_scope = 'class'      THEN 'class'
      WHEN NEW.target_audience = 'parents'  THEN 'all_parents'
      WHEN NEW.target_audience = 'students' THEN 'all_students'
      WHEN NEW.target_audience = 'staff'    THEN 'all_staff'
      ELSE NEW.target_type
    END;

  RETURN NEW;
END;
$$;

-- The trigger must now fire when a caller supplies only `target_type`, so it can no
-- longer be limited to UPDATE OF the two new columns.
DROP TRIGGER IF EXISTS set_target_type_on_announcements ON public.announcements;
CREATE TRIGGER set_target_type_on_announcements
  BEFORE INSERT OR UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_announcement_target_type();

COMMENT ON FUNCTION public.set_announcement_target_type() IS
  'Keeps target_type, target_audience and target_scope consistent in BOTH '
  'directions. 0114 made the two new columns NOT NULL with no default, which broke '
  'every existing caller that inserted target_type — including /api/announcements. '
  'See 0129.';

-- ---------------------------------------------------------------------------
-- 2. Clearing a pupil's custom field answer, without a DELETE grant.
-- ---------------------------------------------------------------------------
REVOKE DELETE ON public.student_custom_values FROM authenticated;

CREATE OR REPLACE FUNCTION public.clear_student_custom_values(
  p_student_id UUID,
  p_field_ids  UUID[]
)
RETURNS INT
LANGUAGE plpgsql
-- DEFINER because `authenticated` now holds no DELETE on the table, by invariant.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role    TEXT := public.get_user_role();
  v_school  UUID := public.current_school_uuid();
  v_deleted INT;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'No school in session.' USING ERRCODE = '42501';
  END IF;

  -- Mirrors `management_write_standard_custom_values` from 0111. Restated because the
  -- invariant forbids the grant that would let the policy decide — see the header.
  IF v_role NOT IN ('org:owner', 'org:principal', 'org:admin') THEN
    RAISE EXCEPTION 'Only the owner, principal and administrator edit pupil records.'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.student_custom_values v
  WHERE  v.student_id = p_student_id
    AND  v.field_id = ANY (p_field_ids)
    -- Own school only. Without this the function would be a cross-tenant delete,
    -- because SECURITY DEFINER has bypassed the policy that used to say so.
    AND  v.school_id = v_school
    AND  EXISTS (
      SELECT 1 FROM public.school_custom_fields f
      WHERE f.id = v.field_id
        -- A sensitive field stays with the owner and principal, exactly as its write
        -- policy says. An administrator clearing a medical note would otherwise be a
        -- way around a restriction they cannot even read through.
        AND (f.sensitivity = 'standard' OR v_role IN ('org:owner', 'org:principal'))
    );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_student_custom_values(UUID, UUID[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Removing a price band, without a DELETE grant on afritech configuration.
-- ---------------------------------------------------------------------------
REVOKE DELETE ON afritech.tier_student_price_bands FROM authenticated;

CREATE OR REPLACE FUNCTION afritech.delete_tier_price_band(p_band_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = afritech, public, pg_temp
AS $$
BEGIN
  -- `IS NOT TRUE`, not `NOT` — the NULL-versus-FALSE lesson from 0121.
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech can remove a price band.' USING ERRCODE = '42501';
  END IF;

  DELETE FROM afritech.tier_student_price_bands WHERE id = p_band_id;
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION afritech.delete_tier_price_band(UUID) TO authenticated;

-- === MIGRATION END ===
