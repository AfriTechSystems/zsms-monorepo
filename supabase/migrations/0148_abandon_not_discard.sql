-- Migration: 0148_abandon_not_discard.sql
-- Created: 2026-09-29
-- Description: `admin_discard_unprovisioned_school()` could never run. Creating a school writes an
--              audit row, and an audit row makes the school undeletable — as intended.
-- Related documents: Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md
--                    Official Documentation/01 Foundation Layer/COMPLIANCE.md
--
-- ===========================================================================
-- THE AUDIT TRAIL WINS, AND THAT IS THE POINT
--
-- `0144` gave a failed provisioning a recovery path: delete the school, since nobody could ever
-- have reached it. The argument was sound and the code was unreachable.
--
-- `admin_create_school()` calls `log_audit_event()`, which writes an `audit_logs` row carrying
-- `school_id` as a foreign key to `public.schools(id)`. So by the time anybody could want to
-- discard a school, a row already references it, and:
--
--   * the DELETE is refused by `audit_logs_school_id_fkey`;
--   * the FK cannot be `ON DELETE SET NULL`, because `0131` puts a BEFORE UPDATE OR DELETE trigger
--     on `audit_logs` that raises unconditionally — the cascade's own UPDATE would be blocked;
--   * deleting the audit rows first is the one thing an audit trail exists to prevent.
--
-- Three independent routes, all closed, all closed deliberately. **A school that was created
-- cannot be erased, because its creation was recorded.** That is the correct behaviour and the
-- feature was wrong, so the feature changes.
--
-- ---------------------------------------------------------------------------
-- ABANDON, NOT DISCARD
-- ---------------------------------------------------------------------------
-- The replacement marks the attempt `terminated` and leaves everything where it is. The row is
-- visible only to AfriTech — `clerk_org_id` is still a placeholder matching no JWT — and the
-- admin list already filters by status.
--
-- **The identifier is therefore NOT reused**, which reverses what `0144`'s header said. That claim
-- was true of a delete that could not happen; with the row still present, `get_next_school_sequence()`
-- takes MAX+1 past it and the next school in that city gets the following number. Which is the
-- behaviour business rule 1 wanted in the first place.
--
-- The old function is dropped rather than left as an alias. It promised removal, it never removed
-- anything, and a name that lies is worse than a missing name.
-- ===========================================================================

-- === MIGRATION START ===

DROP FUNCTION IF EXISTS public.admin_discard_unprovisioned_school(UUID);

CREATE OR REPLACE FUNCTION public.admin_abandon_unprovisioned_school(
  p_school_id UUID,
  p_reason    TEXT DEFAULT NULL
)
RETURNS TABLE (
  out_id        UUID,
  out_school_id TEXT,
  out_status    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org  TEXT;
  v_code TEXT;
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech abandons a school.' USING ERRCODE = '42501';
  END IF;

  SELECT s.clerk_org_id, s.school_id INTO v_org, v_code
    FROM public.schools s WHERE s.id = p_school_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No school with that id.' USING ERRCODE = 'P0002';
  END IF;

  /**
   * Only an attempt that never got its organisation. A provisioned school reaching `terminated`
   * is a commercial decision with notice periods and a data-retention clock attached, and it goes
   * through `admin_update_school_commercial()` where that decision is visible as one.
   */
  IF v_org NOT LIKE 'pending\_%' THEN
    RAISE EXCEPTION
      'This school is provisioned. Terminating a live school is a commercial decision — use the '
      'subscription controls, not the provisioning recovery path.'
      USING ERRCODE = '55000';
  END IF;

  -- Aliased, per the rule 0147 states: `out_` prefixes here mean no OUT parameter can collide
  -- with a column, but the alias costs nothing and the next editor does not have to check.
  UPDATE public.schools AS s
     SET status     = 'terminated',
         updated_at = NOW()
   WHERE s.id = p_school_id;

  PERFORM public.log_audit_event(
    'school_abandoned', 'schools', p_school_id,
    jsonb_build_object(
      'school_code', v_code,
      'reason', COALESCE(p_reason, 'clerk_organisation_never_created')
    ),
    p_school_id
  );

  RETURN QUERY
  SELECT s.id, s.school_id, s.status FROM public.schools s WHERE s.id = p_school_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_abandon_unprovisioned_school(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_abandon_unprovisioned_school(UUID, TEXT) IS
  'Marks a failed provisioning attempt terminated. It cannot be deleted: creating it wrote an '
  'audit row, and audit_logs is immutable by trigger and references schools by foreign key. The '
  'identifier stays spent.';

-- === MIGRATION END ===
