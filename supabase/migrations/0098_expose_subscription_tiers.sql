-- Migration: 0098_expose_subscription_tiers.sql
-- Created: 2026-08-17
-- Description: Read view and price-update function for afritech.subscription_tiers,
--              so the admin dashboard can edit pricing without a deployment.
-- Related documents: Official Documentation/17 Integration and Pricing/PRICING.md
--                    Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md

-- === MIGRATION START ===

-- Same shape and the same reasoning as 0097: `afritech` is not exposed through
-- PostgREST, and it should stay that way, so the one relation the pricing screen
-- needs is surfaced through `public` rather than opening the schema.
--
-- `subscription_tiers` predates this work and has no RLS. Adding it now rather
-- than only adding a view: a view is not a security boundary, and an unpoliced
-- base table with a public view over it is a table anyone can read. The policy
-- mirrors 0095 — anyone signed in may read the published price list (a school
-- needs it for its own upgrade screen, and it is on the marketing site anyway),
-- and only an AfriTech admin may change a price.

ALTER TABLE afritech.subscription_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.subscription_tiers FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_subscription_tiers" ON afritech.subscription_tiers;
CREATE POLICY "afritech_admin_all_subscription_tiers"
ON afritech.subscription_tiers FOR ALL
USING (public.is_afritech_admin())
WITH CHECK (public.is_afritech_admin());

DROP POLICY IF EXISTS "authenticated_read_subscription_tiers" ON afritech.subscription_tiers;
CREATE POLICY "authenticated_read_subscription_tiers"
ON afritech.subscription_tiers FOR SELECT
USING (TRUE);

GRANT SELECT, INSERT, UPDATE ON afritech.subscription_tiers TO authenticated;
REVOKE ALL ON afritech.subscription_tiers FROM anon;

CREATE OR REPLACE VIEW public.subscription_tier_catalogue
WITH (security_invoker = true) AS
  SELECT tier_name, display_name, monthly_price_zmw, monthly_price_usd,
         annual_price_zmw, student_limit, whatsapp_quota,
         is_publicly_listed, display_order, updated_at, updated_by
  FROM afritech.subscription_tiers;

COMMENT ON VIEW public.subscription_tier_catalogue IS
  'Read view over afritech.subscription_tiers. security_invoker — RLS applies to the caller.';

GRANT SELECT ON public.subscription_tier_catalogue TO authenticated;
REVOKE ALL ON public.subscription_tier_catalogue FROM anon;

-- ---------------------------------------------------------------------------
-- admin_update_tier — one named operation, not a free-form UPDATE
--
-- NULL means "leave unchanged" for every field, so the API can send a partial
-- patch without having to read the row first and echo values back — a
-- read-modify-write that would lose a concurrent edit.
--
-- A price of zero is allowed (a free tier is a real product decision); a
-- NEGATIVE price is not, and is refused rather than stored. `student_limit` and
-- `whatsapp_quota` treat NULL as "unlimited" per the existing schema, so they
-- cannot use NULL as their sentinel — `-1` is used instead and translated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_tier(
  p_tier_name        TEXT,
  p_monthly_zmw      NUMERIC DEFAULT NULL,
  p_monthly_usd      NUMERIC DEFAULT NULL,
  p_annual_zmw       NUMERIC DEFAULT NULL,
  p_student_limit    INT     DEFAULT NULL,
  p_whatsapp_quota   INT     DEFAULT NULL,
  p_publicly_listed  BOOLEAN DEFAULT NULL,
  p_actor            TEXT    DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, afritech
AS $$
BEGIN
  IF COALESCE(p_monthly_zmw, 0) < 0 OR COALESCE(p_monthly_usd, 0) < 0
     OR COALESCE(p_annual_zmw, 0) < 0 THEN
    RAISE EXCEPTION 'admin_update_tier: a price cannot be negative'
      USING ERRCODE = '23514';
  END IF;

  UPDATE afritech.subscription_tiers t
  SET monthly_price_zmw  = COALESCE(p_monthly_zmw, t.monthly_price_zmw),
      monthly_price_usd  = COALESCE(p_monthly_usd, t.monthly_price_usd),
      annual_price_zmw   = COALESCE(p_annual_zmw, t.annual_price_zmw),
      -- -1 is the "make this unlimited" sentinel; NULL still means "unchanged".
      student_limit      = CASE WHEN p_student_limit IS NULL THEN t.student_limit
                                WHEN p_student_limit < 0 THEN NULL
                                ELSE p_student_limit END,
      whatsapp_quota     = CASE WHEN p_whatsapp_quota IS NULL THEN t.whatsapp_quota
                                WHEN p_whatsapp_quota < 0 THEN NULL
                                ELSE p_whatsapp_quota END,
      is_publicly_listed = COALESCE(p_publicly_listed, t.is_publicly_listed),
      updated_by         = COALESCE(p_actor, t.updated_by),
      updated_at         = NOW()
  WHERE t.tier_name = p_tier_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_update_tier: no tier %, or refused', p_tier_name
      USING ERRCODE = '42501';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_tier(TEXT, NUMERIC, NUMERIC, NUMERIC, INT, INT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_tier(TEXT, NUMERIC, NUMERIC, NUMERIC, INT, INT, BOOLEAN, TEXT) TO authenticated;

DO $$
DECLARE v_bad INT;
BEGIN
  SELECT count(*) INTO v_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'afritech' AND c.relname = 'subscription_tiers'
    AND NOT (c.relrowsecurity AND c.relforcerowsecurity);

  IF v_bad > 0 THEN
    RAISE EXCEPTION '0098: subscription_tiers is exposed through a view without RLS on the base table';
  END IF;
END;
$$;

-- === MIGRATION END ===
