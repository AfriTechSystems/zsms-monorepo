-- Migration: 0140_school_commercial_columns.sql
-- Created: 2026-09-29
-- Description: SECURITY FIX. A school owner could set their own subscription tier, extend their
--              own trial, and switch on paid modules.
-- Related documents: Official Documentation/01 Foundation Layer/SECURITY_POLICIES.md
--                    Official Documentation/17 Integration and Pricing/PRICING.md
--                    Official Documentation/06 School and Tenant Management/SCHOOL_CONFIG.md
--
-- ===========================================================================
-- EVERY PRICED DIMENSION OF THE PRODUCT WAS SELF-SERVE
--
-- `authenticated` held a **table-level** UPDATE grant on `public.schools`, which covers every
-- column. `owner_update_own_school` then checked only that the caller is the owner of that school
-- — which they are. Nothing anywhere checked WHICH columns were being written.
--
-- Demonstrated against `zsms-dev` before this migration was written, as an ordinary school owner:
--
--   before:  starter  / trial / trial ends 2026-10-02
--   after:   enterprise / trial / trial ends 2036-09-29 / whatsapp_enabled / max_students 999999
--
-- A school owner could give themselves the top tier, extend their trial by a decade, and switch on
-- the paid modules. Only `clerk_org_id` was refused, and that is an accident rather than a defence:
-- the policy's WITH CHECK requires `clerk_org_id = get_school_id()`, so changing it fails the
-- check it is not there to enforce.
--
-- ---------------------------------------------------------------------------
-- WHY THE POLICY WAS NOT THE PLACE TO FIX IT
-- ---------------------------------------------------------------------------
-- RLS decides which ROWS a statement may touch. It has no opinion about columns — `WITH CHECK`
-- sees the finished row and cannot tell a changed `subscription_tier` from one that was already
-- there. So no policy could express this rule, and writing a trigger to compare old and new would
-- be re-implementing a privilege system Postgres already has.
--
-- **The grant is the right tool**, and it is the same one `0130` used for the Teacher Hub's trial
-- counter: name the columns a role may write, and the rest are refused before RLS is consulted.
-- The lesson generalises — **a table holding both user-editable and commercially-significant
-- columns needs a column-level grant, not a row policy.**
--
-- ---------------------------------------------------------------------------
-- WHAT THIS BREAKS, AND WHAT REPLACES IT
-- ---------------------------------------------------------------------------
-- The column grant applies to `authenticated`, which an AfriTech administrator also is. So
-- `PATCH /api/admin/schools/[id]` — which writes `status`, `subscription_tier`,
-- `finance_module_enabled` and `whatsapp_enabled` straight to the table — stops working, and must.
--
-- `admin_update_school_commercial()` replaces it: SECURITY DEFINER, AfriTech-only, and the single
-- named place a commercial term changes. That is the same shape as `verify_payment()` and
-- `teacher_hub_activate_subscription()` — money-adjacent acts are functions, not table writes,
-- so there is no path that changes one without a decision being attributable.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. The commercial terms, behind a named act.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_school_commercial(
  p_school_id              UUID,
  p_status                 TEXT    DEFAULT NULL,
  p_subscription_tier      TEXT    DEFAULT NULL,
  p_finance_module_enabled BOOLEAN DEFAULT NULL,
  p_whatsapp_enabled       BOOLEAN DEFAULT NULL,
  p_trial_ends_at          TIMESTAMPTZ DEFAULT NULL,
  p_subscription_ends_at   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  id                     UUID,
  school_id              TEXT,
  name                   TEXT,
  status                 TEXT,
  subscription_tier      TEXT,
  finance_module_enabled BOOLEAN,
  whatsapp_enabled       BOOLEAN,
  trial_ends_at          TIMESTAMPTZ,
  subscription_ends_at   TIMESTAMPTZ,
  updated_at             TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech changes a school''s commercial terms.' USING ERRCODE = '42501';
  END IF;

  /**
   * NULL means "leave it alone", so a caller sending one field does not blank the others. The same
   * convention `admin_update_tier()` uses — and the same limitation, which is that a column cannot
   * be set back to NULL through this function. None of these should ever need to be.
   */
  UPDATE public.schools s
     SET status                 = COALESCE(p_status, s.status),
         subscription_tier      = COALESCE(p_subscription_tier, s.subscription_tier),
         finance_module_enabled = COALESCE(p_finance_module_enabled, s.finance_module_enabled),
         whatsapp_enabled       = COALESCE(p_whatsapp_enabled, s.whatsapp_enabled),
         trial_ends_at          = COALESCE(p_trial_ends_at, s.trial_ends_at),
         subscription_ends_at   = COALESCE(p_subscription_ends_at, s.subscription_ends_at),
         updated_at             = NOW()
   WHERE s.id = p_school_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No school with that id.' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  SELECT s.id, s.school_id, s.name, s.status, s.subscription_tier,
         s.finance_module_enabled, s.whatsapp_enabled, s.trial_ends_at,
         s.subscription_ends_at, s.updated_at
    FROM public.schools s WHERE s.id = p_school_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_school_commercial(
  UUID, TEXT, TEXT, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ
) TO authenticated;

COMMENT ON FUNCTION public.admin_update_school_commercial(
  UUID, TEXT, TEXT, BOOLEAN, BOOLEAN, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'The only way a school''s tier, status, trial dates or paid modules change. Table UPDATE on '
  'those columns is revoked from authenticated — before 0140 a school owner could set their own '
  'tier to enterprise.';

-- ---------------------------------------------------------------------------
-- 2. The grant. This is the actual fix.
-- ---------------------------------------------------------------------------
REVOKE UPDATE ON public.schools FROM authenticated;

/**
 * What a school owner may edit about their own school — the profile, and nothing else.
 *
 * Deliberately absent, each for its own reason:
 *
 *   `subscription_tier`, `status`, `trial_ends_at`, `subscription_ends_at`,
 *   `finance_module_enabled`, `whatsapp_enabled`, `max_students`
 *       Commercial terms. `admin_update_school_commercial()` and nothing else.
 *
 *   `school_id`, `clerk_org_id`, `country_code`
 *       Identity. `school_id` appears in every pupil identifier and every receipt number ever
 *       issued; changing it would orphan them all.
 *
 *   `city_code`
 *       Part of the school identifier format (`ZM-LSK-0001`). Editing it would leave the code and
 *       the identifier disagreeing, with no way to tell which is right.
 */
GRANT UPDATE (name, address, phone, email, logo_url, type, level)
  ON public.schools TO authenticated;

-- === MIGRATION END ===
