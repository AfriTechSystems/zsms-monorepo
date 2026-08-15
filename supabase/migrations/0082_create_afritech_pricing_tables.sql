-- Migration: 0082_create_afritech_pricing_tables.sql
-- Created: 2026-08-15
-- Description: The afritech configuration tables that drive tier-based limits —
--              starting with subscription_tiers, which carries the WhatsApp
--              quota ceiling Phase 3 enforces.
-- Related documents: Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--                    Official Documentation/05 Core Database and API Reference/SCHEMA.md
--                    Official Documentation/12 Communication System/WHATSAPP.md
--
-- WHY THIS APPEARS IN PHASE 3
-- ---------------------------
-- The `afritech` schema was created in 0002 and has been EMPTY ever since: the
-- pricing tables were specified in the migration block 0061–0065, which is void
-- (those numbers sort below the applied high-water mark — see MIGRATIONS.md).
--
-- Phase 3 is the first work that needs them. "WhatsApp quotas per tier, admin
-- controlled, never hardcoded" is not satisfiable while the tier ceilings exist
-- only as a table in a markdown file. consume_message_quota() reads
-- whatsapp_quota from here.
--
-- Only subscription_tiers is created now. feature_flags, tier_features, and
-- school_feature_overrides are not needed by Phase 3 and are left for the phase
-- that uses them — creating configuration tables nothing reads produces
-- config that drifts from reality unnoticed.
--
-- ACCESS: afritech is service_role only (0002). Nothing here is granted to
-- `authenticated`. Application code reads these values through SECURITY DEFINER
-- functions such as consume_message_quota(), which is why a school can be
-- subject to a ceiling it cannot read or alter.

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS afritech.subscription_tiers (
  tier_name            TEXT PRIMARY KEY
                       CHECK (tier_name IN ('starter', 'growth', 'professional', 'enterprise')),
  -- Matches the CHECK on public.schools.subscription_tier. The two must agree;
  -- a school on a tier with no row here would have no ceiling at all.

  display_name         TEXT NOT NULL,

  monthly_price_zmw    NUMERIC(12,2),
  monthly_price_usd    NUMERIC(12,2),
  annual_price_zmw     NUMERIC(12,2),
  -- NUMERIC, never FLOAT (prohibition 5).

  student_limit        INT,
  -- NULL = unlimited.

  whatsapp_quota       INT,
  -- Monthly WhatsApp messages on AfriTech's shared number.
  -- NULL = UNLIMITED, and that is a meaningful value rather than a missing one:
  -- Enterprise is uncapped, and a school on its own Meta number is governed by
  -- its own billing regardless of tier.

  is_publicly_listed   BOOLEAN NOT NULL DEFAULT TRUE,
  display_order        INT NOT NULL DEFAULT 0,

  updated_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE afritech.subscription_tiers IS
  'Database-driven tier configuration. Prices and quotas are edited here by a super admin, never hardcoded (ADR-031).';
COMMENT ON COLUMN afritech.subscription_tiers.whatsapp_quota IS
  'Monthly WhatsApp message ceiling. NULL means unlimited, not unset.';

DROP TRIGGER IF EXISTS update_timestamp_on_subscription_tiers ON afritech.subscription_tiers;
CREATE TRIGGER update_timestamp_on_subscription_tiers
  BEFORE UPDATE ON afritech.subscription_tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed from WHATSAPP.md's quota table. These are STARTING VALUES a super admin
-- edits, not constants — which is the entire point of the table existing.
INSERT INTO afritech.subscription_tiers
  (tier_name, display_name, whatsapp_quota, student_limit, display_order)
VALUES
  ('starter',      'Starter',        500, 150,  1),
  ('growth',       'Growth',        1500, 500,  2),
  ('professional', 'Professional',  4000, NULL, 3),
  ('enterprise',   'Enterprise',    NULL, NULL, 4)
ON CONFLICT (tier_name) DO NOTHING;

-- Deny by default. RLS is enabled with NO policies, so the table is unreachable
-- except to the service role and to SECURITY DEFINER functions owned by
-- postgres. That is deliberate: tier ceilings are AfriTech's commercial
-- configuration, and a school reading — let alone editing — its own ceiling
-- would be reading AfriTech's pricing model.
ALTER TABLE afritech.subscription_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.subscription_tiers FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON afritech.subscription_tiers FROM authenticated, anon;

-- === MIGRATION END ===
