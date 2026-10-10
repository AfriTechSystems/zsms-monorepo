-- Migration: 0123_network_billing_and_access.sql
-- Created: 2026-09-27
-- Description: Records how a network is billed, and records the deliberate act of
--              giving a network member access to one of its schools.
-- Related documents: Official Documentation/17 Integration and Pricing/PRICING.md
--                    Official Documentation/03 Infrastructure Services/CLERK.md
--
-- ===========================================================================
-- BILLING: WHAT THIS DOES AND DOES NOT DO
--
-- There is **no invoicing anywhere in ZSMS.** `afritech.subscription_tiers` is a
-- price list and `schools.subscription_tier` is a column; nothing generates an
-- invoice, nothing collects money from a school, and no code reads a price to
-- charge anybody. So "consolidated billing for a network" cannot be built today —
-- there is nothing to consolidate.
--
-- What this migration does is stop the network being the thing that blocks it. A
-- `billing_mode` records the intent, defaulting to `per_school`, which is exactly
-- what happens now: each school carries its own tier and would be invoiced
-- separately if invoicing existed. When billing is built it reads this column
-- rather than needing a migration and a backfill across every network.
--
-- The pricing question itself stays open and belongs to PRICING.md: whether a
-- 100-school network pays 100 × tier, and whether volume changes the rate. That is
-- a commercial decision, not a schema one, and inventing a discount here would put
-- a number in the database that nobody agreed.
--
-- ACCESS: WHY THE CLERK GRANT IS RECORDED HERE AT ALL
--
-- Entering a school means being a member of its Clerk organisation, and Clerk holds
-- that membership. So why a column?
--
-- Because attaching a school for reporting and letting somebody open a child's
-- record are different decisions, and only the first is visible in this database.
-- Without this column an operator looking at a network cannot tell which schools
-- its owner can actually enter, and the answer lives in a different system behind a
-- different login. `owner_access_granted_at` is the audit trail of the deliberate
-- step — not the permission itself, which remains Clerk's.
--
-- It is nullable and stays NULL until somebody grants access. A network whose
-- schools were attached for reporting only is a legitimate and common state.
-- ===========================================================================

-- === MIGRATION START ===

ALTER TABLE public.school_networks
  ADD COLUMN IF NOT EXISTS billing_mode TEXT NOT NULL DEFAULT 'per_school';

ALTER TABLE public.school_networks
  DROP CONSTRAINT IF EXISTS school_networks_billing_mode_check;
ALTER TABLE public.school_networks
  ADD CONSTRAINT school_networks_billing_mode_check CHECK (
    billing_mode IN ('per_school', 'consolidated')
  );

COMMENT ON COLUMN public.school_networks.billing_mode IS
  'How this network is intended to be invoiced. `per_school` is current behaviour '
  'and the default. Nothing reads this yet — ZSMS has no invoicing. It exists so '
  'billing, when built, needs no migration. See 0123 and PRICING.md.';

-- ---------------------------------------------------------------------------
-- The deliberate access grant.
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_network_schools
  ADD COLUMN IF NOT EXISTS owner_access_granted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS owner_access_granted_by TEXT,
  -- The email the Clerk invitation went to, so an operator can see who was invited
  -- without opening Clerk. Not a permission — a record of what was done.
  ADD COLUMN IF NOT EXISTS owner_access_invited_email TEXT;

COMMENT ON COLUMN public.school_network_schools.owner_access_granted_at IS
  'When a network member was invited into this school''s Clerk organisation, so '
  'they can open it rather than only see its aggregates. NULL means attached for '
  'reporting only, which is a legitimate state. The permission itself lives in '
  'Clerk; this is the audit trail of the deliberate step (0123).';

/**
 * Records that access was granted. Called after the Clerk invitation succeeds.
 *
 * AfriTech only, and guarded with `IS NOT TRUE` rather than `NOT` — the NULL-vs-FALSE
 * lesson from 0121, applied at the point of writing rather than rediscovered.
 *
 * Separate from the invitation itself because the invitation is a Clerk API call
 * that cannot happen inside a transaction: if it succeeds and this fails, the
 * worst case is an untracked grant, which a re-grant corrects. The reverse order
 * would record an access nobody has.
 */
CREATE OR REPLACE FUNCTION public.record_network_school_access(
  p_school_id UUID,
  p_email     TEXT
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
    RAISE EXCEPTION 'Only AfriTech can grant a network member access to a school.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.school_network_schools
  SET    owner_access_granted_at    = NOW(),
         owner_access_granted_by    = NULLIF(btrim(COALESCE(current_setting('request.jwt.claims', true), '')), '')::JSONB->>'sub',
         owner_access_invited_email = NULLIF(btrim(COALESCE(p_email, '')), '')
  WHERE  school_id = p_school_id
    AND  is_active
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That school is not attached to any network.'
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_network_school_access(UUID, TEXT) TO authenticated;

-- === MIGRATION END ===
