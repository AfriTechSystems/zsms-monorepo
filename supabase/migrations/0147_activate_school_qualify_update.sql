-- Migration: 0147_activate_school_qualify_update.sql
-- Created: 2026-09-29
-- Description: `admin_activate_school()` raised "column reference id is ambiguous". Same class as
--              `0146`, different statement: an UPDATE whose WHERE names an OUT parameter.
-- Related documents: Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md
--
-- ===========================================================================
-- THE RULE THIS PAIR OF MIGRATIONS ESTABLISHES
--
-- A PL/pgSQL function declaring `RETURNS TABLE (...)` gets one variable per output column, live
-- for the whole body. Any statement that mentions one of those names unqualified is ambiguous, and
-- **the error arrives on first call, not on `CREATE FUNCTION`** — a body is parsed lazily, so the
-- migration applies, `db push` succeeds, and the failure waits for the first caller.
--
-- `0146` fixed the conflict-target case. This is the ordinary one: `UPDATE public.schools SET ...
-- WHERE id = p_school_id`, where `id` is both the column and the output parameter.
--
-- `admin_update_school_commercial()` in `0140` has the identical return shape and has always
-- worked, because it happens to write `UPDATE public.schools s ... WHERE s.id = p_school_id`. The
-- alias was not there for this reason; it just was there.
--
-- **So the rule, stated once: in a PL/pgSQL function with `RETURNS TABLE`, alias the target of
-- every UPDATE and DELETE and qualify every column.** It costs three characters and removes a
-- class of failure that no migration, type-check, lint or plan count can see — only a real call.
-- ===========================================================================

-- === MIGRATION START ===

CREATE OR REPLACE FUNCTION public.admin_activate_school(
  p_school_id         UUID,
  p_verification_note TEXT
)
RETURNS TABLE (
  id         UUID,
  school_id  TEXT,
  name       TEXT,
  status     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_org    TEXT;
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech activates a school.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(BTRIM(p_verification_note), '') = '' THEN
    RAISE EXCEPTION
      'Record what the verification call established. The note is the evidence.'
      USING ERRCODE = '22023';
  END IF;

  SELECT s.status, s.clerk_org_id INTO v_status, v_org
    FROM public.schools s WHERE s.id = p_school_id;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'No school with that id.' USING ERRCODE = 'P0002';
  END IF;

  -- Activating a school whose Clerk organisation was never created would put it in the public
  -- directory with no way for anybody to sign in to it.
  IF v_org LIKE 'pending_%' THEN
    RAISE EXCEPTION
      'This school has no Clerk organisation yet — finish provisioning before activating it.'
      USING ERRCODE = '55000';
  END IF;

  -- Aliased. `id` is an OUT parameter of this function, so an unqualified `WHERE id = ...`
  -- matches both the variable and the column. See this migration's header.
  UPDATE public.schools AS s
     SET status     = 'active',
         updated_at = NOW()
   WHERE s.id = p_school_id;

  UPDATE public.school_onboarding
     SET verified_at       = COALESCE(verified_at, NOW()),
         verified_by       = COALESCE(verified_by, public.get_user_id()),
         verification_note = p_verification_note,
         activated_at      = NOW(),
         activated_by      = public.get_user_id()
   WHERE school_onboarding.school_id = p_school_id;

  PERFORM public.log_audit_event(
    'school_activated', 'schools', p_school_id,
    jsonb_build_object('from_status', v_status, 'note', p_verification_note),
    p_school_id
  );

  RETURN QUERY
  SELECT s.id, s.school_id, s.name, s.status
    FROM public.schools s WHERE s.id = p_school_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_activate_school(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.admin_activate_school(UUID, TEXT) IS
  'Moves a school to active and records the verification call. The note is required — it is the '
  'only evidence the verification happened. Aliased in 0147: the UPDATE named an OUT parameter.';

-- === MIGRATION END ===
