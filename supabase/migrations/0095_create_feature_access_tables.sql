-- Migration: 0095_create_feature_access_tables.sql
-- Created: 2026-08-17
-- Description: The feature-access tables the pricing model has always assumed —
--              feature_flags, tier_features, school_feature_overrides — plus the
--              resolution function that reads them in one fixed order.
-- Related documents: Official Documentation/17 Integration and Pricing/PRICING.md
--                    Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--                    Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-014
--                    Official Documentation/01 Foundation Layer/DATABASE.md

-- === MIGRATION START ===

-- CLAUDE.md states, as one of the two decisions that shape everything else:
-- "Pricing and feature access are entirely database-driven. Four afritech-schema
-- tables (subscription_tiers, feature_flags, tier_features,
-- school_feature_overrides) drive everything."
--
-- **Three of those four did not exist.** `afritech` held `subscription_tiers`
-- and nothing else. This is the same pattern the repository has hit repeatedly —
-- `class_enrolments` referenced by four documents and defined by none, a fee
-- statement promised by GLOSSARY.md that nothing could produce — and it was
-- found the same way each time: by implementing against the document.
--
-- The DDL here is not invented. It is the definition in `PRICING.md`, adopted
-- as written, including the seed matrix. Where this migration adds anything
-- beyond that document it is called out in a comment.

-- ---------------------------------------------------------------------------
-- feature_flags — every toggleable feature in the product
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afritech.feature_flags (
  feature_key             TEXT PRIMARY KEY,
  display_name            TEXT NOT NULL,
  description             TEXT,
  category                TEXT NOT NULL
                          CHECK (category IN (
                            'core', 'academic', 'financial', 'communication',
                            'integration', 'api', 'document', 'analytics', 'enterprise'
                          )),
  monthly_addon_price_zmw NUMERIC(10,2),
  monthly_addon_price_usd NUMERIC(10,2),
  is_available_as_addon   BOOLEAN NOT NULL DEFAULT TRUE,
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  display_order           INT,
  updated_by              TEXT NOT NULL,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Not in PRICING.md, added here: a feature offered as a paid add-on with no
  -- price is a feature nobody can buy, and the failure is silent — the upgrade
  -- screen renders a blank cell rather than an error.
  CONSTRAINT feature_flag_addon_has_price CHECK (
    is_available_as_addon = FALSE OR monthly_addon_price_zmw IS NOT NULL
  )
);

COMMENT ON TABLE afritech.feature_flags IS
  'Every toggleable feature. Adding a feature to ZSMS means adding a row here (PRICING.md).';

-- ---------------------------------------------------------------------------
-- tier_features — the inclusion matrix
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afritech.tier_features (
  tier_name   TEXT NOT NULL,
  feature_key TEXT NOT NULL REFERENCES afritech.feature_flags(feature_key),
  is_included BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tier_name, feature_key)
);

COMMENT ON TABLE afritech.tier_features IS
  'Which features each tier includes. A super admin toggling a cell affects every school on that tier immediately.';

-- ---------------------------------------------------------------------------
-- school_feature_overrides — the exception mechanism
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afritech.school_feature_overrides (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id      UUID NOT NULL REFERENCES public.schools(id),
  override_type  TEXT NOT NULL
                 CHECK (override_type IN (
                   'grant_feature', 'revoke_feature',
                   'extend_subscription', 'extend_trial', 'tier_override'
                 )),
  feature_key    TEXT REFERENCES afritech.feature_flags(feature_key),
  override_value TEXT,
  expires_at     TIMESTAMPTZ,
  reason         TEXT NOT NULL,
  ticket_ref     TEXT,
  granted_by     TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at     TIMESTAMPTZ,
  revoked_by     TEXT,

  -- PRICING.md describes which types need a feature_key in prose. Stated as a
  -- constraint instead: a `grant_feature` row with a NULL feature_key grants
  -- nothing, and would sit in the table looking like a resolved support ticket.
  CONSTRAINT override_shape CHECK (
    (override_type IN ('grant_feature', 'revoke_feature') AND feature_key IS NOT NULL)
    OR (override_type IN ('extend_subscription', 'extend_trial', 'tier_override') AND feature_key IS NULL)
  ),
  CONSTRAINT tier_override_has_value CHECK (
    override_type <> 'tier_override' OR override_value IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_school_feature_overrides_school
  ON afritech.school_feature_overrides(school_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_school_feature_overrides_lookup
  ON afritech.school_feature_overrides(school_id, feature_key) WHERE is_active;

COMMENT ON TABLE afritech.school_feature_overrides IS
  'Per-school exceptions. Every row carries a reason and an actor — this is the table a support decision is audited from.';

DROP TRIGGER IF EXISTS update_timestamp_on_feature_flags ON afritech.feature_flags;
CREATE TRIGGER update_timestamp_on_feature_flags
  BEFORE UPDATE ON afritech.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS update_timestamp_on_tier_features ON afritech.tier_features;
CREATE TRIGGER update_timestamp_on_tier_features
  BEFORE UPDATE ON afritech.tier_features
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed — the matrix exactly as PRICING.md defines it
-- ---------------------------------------------------------------------------
INSERT INTO afritech.feature_flags
  (feature_key, display_name, category, monthly_addon_price_zmw, is_available_as_addon, display_order, updated_by)
VALUES
  ('timetable',          'Timetable Builder',           'academic',      100.00, TRUE,  1,  'system'),
  ('loan_module',        'Finance (Loan Referral)',     'financial',     275.00, TRUE,  2,  'system'),
  ('integrations',       'Accounting & CRM Connectors', 'integration',   200.00, TRUE,  3,  'system'),
  ('api_read',           'API Read Access',             'api',           138.00, TRUE,  4,  'system'),
  ('api_write',          'API Write Access',            'api',           275.00, TRUE,  5,  'system'),
  ('api_full',           'Full API Access',             'api',           550.00, TRUE,  6,  'system'),
  ('custom_template',    'Custom Document Template',    'document',      NULL,   FALSE, 7,  'system'),
  ('advanced_analytics', 'Advanced Analytics',          'analytics',     100.00, TRUE,  8,  'system'),
  ('per_absence_alerts', 'Per-Absence WhatsApp Alerts', 'communication', NULL,   FALSE, 9,  'system'),
  ('white_label',        'White Label Portal',          'enterprise',    300.00, TRUE,  10, 'system'),
  ('payroll',            'Payroll Module (Phase 3)',    'financial',     200.00, TRUE,  11, 'system'),
  ('inventory',          'Inventory Module (Phase 3)',  'financial',     150.00, TRUE,  12, 'system'),
  ('marketplace',        'Marketplace Access (Phase 3)','financial',     NULL,   FALSE, 13, 'system')
ON CONFLICT (feature_key) DO NOTHING;

INSERT INTO afritech.tier_features (tier_name, feature_key, is_included, updated_by) VALUES
  ('starter', 'timetable',          FALSE, 'system'),
  ('starter', 'loan_module',        FALSE, 'system'),
  ('starter', 'integrations',       FALSE, 'system'),
  ('starter', 'api_read',           FALSE, 'system'),
  ('starter', 'custom_template',    FALSE, 'system'),
  ('starter', 'advanced_analytics', FALSE, 'system'),
  ('starter', 'white_label',        FALSE, 'system'),
  ('starter', 'per_absence_alerts', TRUE,  'system'),

  ('growth', 'timetable',           TRUE,  'system'),
  ('growth', 'loan_module',         FALSE, 'system'),
  ('growth', 'integrations',        FALSE, 'system'),
  ('growth', 'api_read',            TRUE,  'system'),
  ('growth', 'custom_template',     FALSE, 'system'),
  ('growth', 'advanced_analytics',  TRUE,  'system'),
  ('growth', 'white_label',         FALSE, 'system'),
  ('growth', 'per_absence_alerts',  TRUE,  'system'),

  ('professional', 'timetable',          TRUE,  'system'),
  ('professional', 'loan_module',        TRUE,  'system'),
  ('professional', 'integrations',       TRUE,  'system'),
  ('professional', 'api_read',           TRUE,  'system'),
  ('professional', 'api_write',          TRUE,  'system'),
  ('professional', 'custom_template',    TRUE,  'system'),
  ('professional', 'advanced_analytics', TRUE,  'system'),
  ('professional', 'white_label',        FALSE, 'system'),
  ('professional', 'per_absence_alerts', TRUE,  'system'),

  ('enterprise', 'timetable',          TRUE, 'system'),
  ('enterprise', 'loan_module',        TRUE, 'system'),
  ('enterprise', 'integrations',       TRUE, 'system'),
  ('enterprise', 'api_read',           TRUE, 'system'),
  ('enterprise', 'api_write',          TRUE, 'system'),
  ('enterprise', 'api_full',           TRUE, 'system'),
  ('enterprise', 'custom_template',    TRUE, 'system'),
  ('enterprise', 'advanced_analytics', TRUE, 'system'),
  ('enterprise', 'white_label',        TRUE, 'system'),
  ('enterprise', 'per_absence_alerts', TRUE, 'system')
ON CONFLICT (tier_name, feature_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
--
-- The matrix and the flag list are *product* facts, not tenant data — a school
-- needs to read them to render its own upgrade screen, and they contain no
-- other school's information. Overrides are different: a row names a school,
-- a reason, and a support ticket, so a school sees only its own.
--
-- Nothing here is writable by anyone but an AfriTech admin. A school that could
-- write `tier_features` could grant itself the enterprise tier.
-- ---------------------------------------------------------------------------
REVOKE ALL ON afritech.feature_flags            FROM anon, authenticated;
REVOKE ALL ON afritech.tier_features            FROM anon, authenticated;
REVOKE ALL ON afritech.school_feature_overrides FROM anon, authenticated;

GRANT USAGE ON SCHEMA afritech TO authenticated;
GRANT SELECT ON afritech.feature_flags            TO authenticated;
GRANT SELECT ON afritech.tier_features            TO authenticated;
GRANT SELECT ON afritech.school_feature_overrides TO authenticated;
GRANT INSERT, UPDATE ON afritech.feature_flags            TO authenticated;
GRANT INSERT, UPDATE ON afritech.tier_features            TO authenticated;
GRANT INSERT, UPDATE ON afritech.school_feature_overrides TO authenticated;
-- INSERT/UPDATE are granted at the table level but gated to AfriTech admins by
-- the policies below. Privileges are the outer gate; RLS is the decision.

ALTER TABLE afritech.feature_flags            ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.feature_flags            FORCE  ROW LEVEL SECURITY;
ALTER TABLE afritech.tier_features            ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.tier_features            FORCE  ROW LEVEL SECURITY;
ALTER TABLE afritech.school_feature_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.school_feature_overrides FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_feature_flags" ON afritech.feature_flags;
CREATE POLICY "afritech_admin_all_feature_flags"
ON afritech.feature_flags FOR ALL
USING (public.is_afritech_admin())
WITH CHECK (public.is_afritech_admin());

DROP POLICY IF EXISTS "authenticated_read_feature_flags" ON afritech.feature_flags;
CREATE POLICY "authenticated_read_feature_flags"
ON afritech.feature_flags FOR SELECT
USING (is_active);

DROP POLICY IF EXISTS "afritech_admin_all_tier_features" ON afritech.tier_features;
CREATE POLICY "afritech_admin_all_tier_features"
ON afritech.tier_features FOR ALL
USING (public.is_afritech_admin())
WITH CHECK (public.is_afritech_admin());

DROP POLICY IF EXISTS "authenticated_read_tier_features" ON afritech.tier_features;
CREATE POLICY "authenticated_read_tier_features"
ON afritech.tier_features FOR SELECT
USING (TRUE);

DROP POLICY IF EXISTS "afritech_admin_all_overrides" ON afritech.school_feature_overrides;
CREATE POLICY "afritech_admin_all_overrides"
ON afritech.school_feature_overrides FOR ALL
USING (public.is_afritech_admin())
WITH CHECK (public.is_afritech_admin());

-- A school sees its own exceptions and no one else's. `reason` and `ticket_ref`
-- are internal notes about that school, which it is entitled to; another
-- school's are not its business.
DROP POLICY IF EXISTS "school_reads_own_overrides" ON afritech.school_feature_overrides;
CREATE POLICY "school_reads_own_overrides"
ON afritech.school_feature_overrides FOR SELECT
USING (school_id = public.current_school_uuid());

-- ---------------------------------------------------------------------------
-- school_has_feature() — the resolution order, in one place
--
-- DYNAMIC_CONFIG.md is explicit that this order is *fixed logic, not
-- configuration*: "a configurable order means a support agent can accidentally
-- make a revoke lose to a grant." So it lives here as a function rather than as
-- a query each caller assembles.
--
--   1. active revoke override   → FALSE, unconditionally
--   2. active grant override    → TRUE
--   3. active tier override     → evaluate the matrix against the overridden tier
--   4. the school's own tier    → the matrix
--
-- Revoke is checked first and wins outright. That is the safe direction: a
-- revoke exists because someone decided a school must NOT have something, and a
-- later grant that silently overturns it is how a suspended school keeps a
-- feature it was cut off from.
--
-- **Step 4 of the documented five is absent, deliberately.** The published order
-- is revoke → grant → tier override → *module subscription* → tier matrix, and
-- there is no module-subscription table in this schema. Rather than pretend, the
-- step is omitted and named here; when per-module billing is built it slots in
-- between the tier override and the matrix.
--
-- SECURITY DEFINER: the function reads `schools` and the afritech tables on
-- behalf of a caller who may legitimately read neither directly. It answers one
-- boolean about one school and one feature, and takes the school id from the
-- caller — so a caller can ask about a school it does not own. That is
-- intentional and safe: the answer is a product fact ("does school X have the
-- timetable"), not tenant data, and the admin dashboard needs exactly this.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_has_feature(p_school_id UUID, p_feature_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, afritech
AS $$
DECLARE
  v_tier TEXT;
  v_override TEXT;
  v_included BOOLEAN;
BEGIN
  -- 1. Revoke wins outright.
  IF EXISTS (
    SELECT 1 FROM afritech.school_feature_overrides
    WHERE school_id = p_school_id
      AND feature_key = p_feature_key
      AND override_type = 'revoke_feature'
      AND is_active
      AND (expires_at IS NULL OR expires_at > NOW())
  ) THEN
    RETURN FALSE;
  END IF;

  -- 2. Grant.
  IF EXISTS (
    SELECT 1 FROM afritech.school_feature_overrides
    WHERE school_id = p_school_id
      AND feature_key = p_feature_key
      AND override_type = 'grant_feature'
      AND is_active
      AND (expires_at IS NULL OR expires_at > NOW())
  ) THEN
    RETURN TRUE;
  END IF;

  -- 3. Tier override, else the school's actual tier.
  SELECT o.override_value INTO v_override
  FROM afritech.school_feature_overrides o
  WHERE o.school_id = p_school_id
    AND o.override_type = 'tier_override'
    AND o.is_active
    AND (o.expires_at IS NULL OR o.expires_at > NOW())
  ORDER BY o.created_at DESC
  LIMIT 1;

  IF v_override IS NOT NULL THEN
    v_tier := v_override;
  ELSE
    SELECT s.subscription_tier INTO v_tier FROM public.schools s WHERE s.id = p_school_id;
  END IF;

  IF v_tier IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 4. The matrix. A feature with no row for this tier is NOT included —
  -- absence means "not sold with this tier", never "unspecified, allow it".
  SELECT tf.is_included INTO v_included
  FROM afritech.tier_features tf
  WHERE tf.tier_name = v_tier AND tf.feature_key = p_feature_key;

  RETURN COALESCE(v_included, FALSE);
END;
$$;

COMMENT ON FUNCTION public.school_has_feature(UUID, TEXT) IS
  'Feature access for one school. Fixed order: revoke > grant > tier override > tier matrix (DYNAMIC_CONFIG.md).';

REVOKE ALL ON FUNCTION public.school_has_feature(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.school_has_feature(UUID, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM afritech.feature_flags;
  IF v_count < 13 THEN
    RAISE EXCEPTION '0095: % feature flags seeded, expected 13', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM afritech.tier_features;
  IF v_count < 34 THEN
    RAISE EXCEPTION '0095: % tier_features rows seeded, expected 34', v_count;
  END IF;

  -- Every tier named in the schools CHECK constraint must appear in the matrix,
  -- or a school on that tier silently resolves every feature to FALSE.
  SELECT count(*) INTO v_count
  FROM (VALUES ('starter'),('growth'),('professional'),('enterprise')) AS t(name)
  WHERE NOT EXISTS (SELECT 1 FROM afritech.tier_features tf WHERE tf.tier_name = t.name);

  IF v_count > 0 THEN
    RAISE EXCEPTION '0095: % subscription tier(s) have no feature matrix rows', v_count;
  END IF;

  -- The three tables must all be policed. A new afritech table without RLS is
  -- the same defect as a new public one (CONVENTIONS.md prohibition 4).
  SELECT count(*) INTO v_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'afritech'
    AND c.relname IN ('feature_flags','tier_features','school_feature_overrides')
    AND c.relrowsecurity AND c.relforcerowsecurity;

  IF v_count <> 3 THEN
    RAISE EXCEPTION '0095: only % of 3 feature tables have RLS enabled and forced', v_count;
  END IF;
END;
$$;

-- === MIGRATION END ===
