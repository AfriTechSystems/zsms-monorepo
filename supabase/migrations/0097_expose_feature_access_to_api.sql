-- Migration: 0097_expose_feature_access_to_api.sql
-- Created: 2026-08-17
-- Description: Public read views and write functions over the afritech feature
--              tables, so the admin dashboard can reach them through PostgREST.
-- Related documents: Official Documentation/15 Super Admin and Platform/SUPERADMIN.md
--                    Official Documentation/17 Integration and Pricing/PRICING.md

-- === MIGRATION START ===

-- PostgREST exposes a configured list of schemas, and `afritech` is not on it —
-- deliberately, since it holds AfriTech's own commercial data. Rather than widen
-- that exposure (which would put every future afritech table one URL away from
-- the internet, opted *out* rather than in), this migration surfaces exactly the
-- three relations the admin dashboard needs.
--
-- **`security_invoker = true` on every view**, matching `student_fee_balance`
-- and `fee_record_status`. A view defaults to running with its *owner's* rights,
-- which would make each of these a hole straight through the RLS policies 0095
-- just established. With invoker rights the policies apply to the caller, so an
-- AfriTech admin sees the platform and a school sees the catalogue plus its own
-- exceptions — the same answer as querying the base tables, which is the point.

CREATE OR REPLACE VIEW public.feature_catalogue
WITH (security_invoker = true) AS
  SELECT feature_key, display_name, description, category,
         monthly_addon_price_zmw, monthly_addon_price_usd,
         is_available_as_addon, is_active, display_order, updated_at, updated_by
  FROM afritech.feature_flags;

COMMENT ON VIEW public.feature_catalogue IS
  'Read view over afritech.feature_flags for the API. security_invoker — RLS applies to the caller.';

CREATE OR REPLACE VIEW public.tier_feature_matrix
WITH (security_invoker = true) AS
  SELECT tier_name, feature_key, is_included, updated_at, updated_by
  FROM afritech.tier_features;

COMMENT ON VIEW public.tier_feature_matrix IS
  'Read view over afritech.tier_features for the API. security_invoker.';

CREATE OR REPLACE VIEW public.school_feature_exceptions
WITH (security_invoker = true) AS
  SELECT id, school_id, override_type, feature_key, override_value,
         expires_at, reason, ticket_ref, granted_by, is_active,
         created_at, revoked_at, revoked_by
  FROM afritech.school_feature_overrides;

COMMENT ON VIEW public.school_feature_exceptions IS
  'Read view over afritech.school_feature_overrides. security_invoker — a school sees only its own.';

GRANT SELECT ON public.feature_catalogue          TO authenticated;
GRANT SELECT ON public.tier_feature_matrix        TO authenticated;
GRANT SELECT ON public.school_feature_exceptions  TO authenticated;
REVOKE ALL ON public.feature_catalogue          FROM anon;
REVOKE ALL ON public.tier_feature_matrix        FROM anon;
REVOKE ALL ON public.school_feature_exceptions  FROM anon;

-- ---------------------------------------------------------------------------
-- Writes
--
-- Also SECURITY INVOKER. These are not privilege grants — they are a shape: one
-- named operation per thing an admin can actually do, so the API never issues a
-- free-form UPDATE against a pricing table. The authorisation still comes from
-- the 0095 policies and from nowhere else, which is what keeps the rule in one
-- place instead of two.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_tier_feature(
  p_tier TEXT, p_feature_key TEXT, p_included BOOLEAN, p_actor TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, afritech
AS $$
BEGIN
  INSERT INTO afritech.tier_features (tier_name, feature_key, is_included, updated_by)
  VALUES (p_tier, p_feature_key, p_included, p_actor)
  ON CONFLICT (tier_name, feature_key)
  DO UPDATE SET is_included = EXCLUDED.is_included,
                updated_by  = EXCLUDED.updated_by,
                updated_at  = NOW();

  -- Zero rows means the RLS policy refused. Reported rather than swallowed: a
  -- toggle that silently does nothing is how an admin believes they have
  -- granted a school something they have not.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_set_tier_feature: refused — AfriTech admin only'
      USING ERRCODE = '42501';
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_override(
  p_school_id UUID,
  p_override_type TEXT,
  p_feature_key TEXT,
  p_override_value TEXT,
  p_expires_at TIMESTAMPTZ,
  p_reason TEXT,
  p_ticket_ref TEXT,
  p_actor TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, afritech
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'admin_create_override: a reason is required'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO afritech.school_feature_overrides
    (school_id, override_type, feature_key, override_value, expires_at, reason, ticket_ref, granted_by)
  VALUES
    (p_school_id, p_override_type, NULLIF(p_feature_key, ''), NULLIF(p_override_value, ''),
     p_expires_at, btrim(p_reason), NULLIF(p_ticket_ref, ''), p_actor)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Revoking is an UPDATE, not a DELETE. An override is a support decision with an
-- actor and a reason attached; deleting the row deletes the only record that the
-- decision was ever made, which is exactly what an audit needs.
CREATE OR REPLACE FUNCTION public.admin_revoke_override(p_id UUID, p_actor TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, afritech
AS $$
BEGIN
  UPDATE afritech.school_feature_overrides
  SET is_active = FALSE, revoked_at = NOW(), revoked_by = p_actor
  WHERE id = p_id AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_revoke_override: no active override %, or refused', p_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_tier_feature(TEXT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_create_override(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_revoke_override(UUID, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_set_tier_feature(TEXT, TEXT, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_override(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_override(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_bad INT;
BEGIN
  -- Every view here must be invoker-rights. A definer view over an
  -- RLS-protected table is a hole that no policy can close.
  SELECT count(*) INTO v_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'v'
    AND c.relname IN ('feature_catalogue','tier_feature_matrix','school_feature_exceptions')
    AND COALESCE((SELECT option_value FROM pg_options_to_table(c.reloptions)
                   WHERE option_name = 'security_invoker'), 'false') <> 'true';

  IF v_bad > 0 THEN
    RAISE EXCEPTION '0097: % view(s) are not security_invoker — RLS would not apply to the caller', v_bad;
  END IF;

  -- And none of the admin write functions may be definer either.
  SELECT count(*) INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'admin\_%' AND p.prosecdef;

  IF v_bad > 0 THEN
    RAISE EXCEPTION '0097: % admin_* function(s) are SECURITY DEFINER — authorisation must stay in the 0095 policies', v_bad;
  END IF;
END;
$$;

-- === MIGRATION END ===
