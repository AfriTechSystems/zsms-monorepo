-- Migration: 0121_harden_afritech_admin_guard.sql
-- Created: 2026-09-27
-- Description: `is_afritech_admin()` returns FALSE rather than NULL for a session
--              with no organisation claim, and the network attach/detach guards no
--              longer depend on three-valued logic.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md
--
-- ===========================================================================
-- THE DEFECT, WHICH 0120 INTRODUCED AND THIS FIXES
--
-- `is_afritech_admin()` was:
--
--     SELECT (auth.jwt() -> 'o' ->> 'slg') = 'afritech-systems-admin';
--
-- For a session with no `o` claim at all, `auth.jwt() -> 'o' ->> 'slg'` is NULL and
-- `NULL = 'afritech-systems-admin'` is **NULL** — not FALSE. Three-valued logic.
--
-- In an RLS policy that is harmless: `USING (NULL)` filters the row exactly as
-- `USING (FALSE)` would, which is why forty policies have used this safely since
-- migration 0001.
--
-- In PL/pgSQL it is not harmless at all:
--
--     IF NOT public.is_afritech_admin() THEN
--       RAISE EXCEPTION 'Only AfriTech can ...';
--     END IF;
--
-- `NOT NULL` is NULL, and `IF NULL THEN` does not execute its branch. So the guard
-- was silently skipped for any caller whose JWT carries no organisation — which is
-- exactly a **School Network member**, who belongs to no school org by design.
--
-- The practical effect in 0120: a network owner calling `attach_school_to_network()`
-- sailed past the AfriTech check. They were then stopped by the next test, because
-- SECURITY INVOKER meant RLS hid the school from them and they got "School not
-- found" — so nothing was actually attachable. A second accident prevented the
-- first from being exploitable, which is not a control.
--
-- Found by an assertion that expected 42501 and caught P0002 instead. The wrong
-- error code was the whole tell; a test asserting only "it throws" would have
-- passed and left this in.
--
-- THE FIX, AT THE ROOT
--
-- `is_afritech_admin()` now COALESCEs to FALSE. Policy behaviour is unchanged —
-- NULL and FALSE filter identically — and every future `IF NOT ...` caller is safe
-- by construction rather than by remembering. The guards in 0120 are also made
-- explicit, because defence in depth is cheap here and the intent should be
-- readable at the call site.
-- ===========================================================================

-- === MIGRATION START ===

CREATE OR REPLACE FUNCTION public.is_afritech_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  -- COALESCE, not a bare comparison: a session with no organisation claim must be
  -- FALSE here, never NULL. See the header for what NULL did.
  SELECT COALESCE((auth.jwt() -> 'o' ->> 'slg') = 'afritech-systems-admin', FALSE);
$$;

COMMENT ON FUNCTION public.is_afritech_admin() IS
  'TRUE only for a session acting in the AfriTech admin organisation. Returns '
  'FALSE, never NULL, so `IF NOT is_afritech_admin()` is a usable guard (0121).';

-- ---------------------------------------------------------------------------
-- The two guards, restated so they do not rely on the helper being non-NULL.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attach_school_to_network(
  p_network_id UUID,
  p_school_id  UUID
)
RETURNS public.school_network_schools
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.school_network_schools;
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION
      'Only AfriTech can attach a school to a network. Ownership of a school is '
      'not something this system can verify, so it is not self-service.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.school_networks WHERE id = p_network_id) THEN
    RAISE EXCEPTION 'Network not found.' USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.schools WHERE id = p_school_id) THEN
    RAISE EXCEPTION 'School not found.' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT * INTO v_row FROM public.school_network_schools
  WHERE school_id = p_school_id AND network_id = p_network_id AND is_active;
  IF FOUND THEN
    RETURN v_row;
  END IF;

  -- Retire an attachment to a different network, keeping the history.
  UPDATE public.school_network_schools
  SET    is_active = FALSE, detached_at = NOW()
  WHERE  school_id = p_school_id AND is_active;

  INSERT INTO public.school_network_schools (network_id, school_id, attached_by)
  VALUES (p_network_id, p_school_id,
          NULLIF(btrim(COALESCE(current_setting('request.jwt.claims', true), '')), '')::JSONB->>'sub')
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.detach_school_from_network(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech can detach a school from a network.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.school_network_schools
  SET    is_active = FALSE, detached_at = NOW()
  WHERE  school_id = p_school_id AND is_active;

  RETURN FOUND;
END;
$$;

-- === MIGRATION END ===
