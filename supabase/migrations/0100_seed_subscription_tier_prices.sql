-- Migration: 0100_seed_subscription_tier_prices.sql
-- Created: 2026-08-18
-- Description: Backfills the documented tier prices, which were never seeded,
--              and makes the price columns NOT NULL so a priceless tier cannot
--              be created again.
-- Related documents: Official Documentation/17 Integration and Pricing/PRICING.md
--                    Official Documentation/01 Foundation Layer/DECISIONS.md (ADR-031)

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- Why
-- ---------------------------------------------------------------------------
-- `afritech.subscription_tiers` has held four rows since `0082`, seeded with
-- their WhatsApp quotas and student ceilings — and with **no prices at all**.
-- The seed's column list simply omitted them:
--
--   INSERT INTO afritech.subscription_tiers
--     (tier_name, display_name, whatsapp_quota, student_limit, display_order)
--
-- The gap survived because nothing read the prices until the pricing screen was
-- built. It then rendered every tier as "K 0/month" with empty inputs, which is
-- how it was found — by looking at it, not by reading anything.
--
-- ADR-031 makes the database the price list. A price list with no prices is not
-- a subtle defect: the public pricing page reads these same rows, so it would
-- have advertised four free tiers.
--
-- The figures are PRICING.md's, verbatim, from its *Subscription Tiers* table.
-- They are the specification, not a commercial judgement made here.

UPDATE afritech.subscription_tiers AS t
SET monthly_price_zmw = v.monthly_zmw,
    monthly_price_usd = v.monthly_usd,
    annual_price_zmw  = v.annual_zmw
FROM (
  VALUES
    ('starter',       600.00,   22.00,  6480.00),
    ('growth',       1100.00,   40.00, 11880.00),
    ('professional', 2000.00,   73.00, 21600.00),
    ('enterprise',   3000.00,  109.00, 32400.00)
) AS v(tier_name, monthly_zmw, monthly_usd, annual_zmw)
WHERE t.tier_name = v.tier_name
  -- Only fills the gap. A price a super admin has already set through the
  -- admin panel is theirs, and a migration that overwrote it would silently
  -- undo a deliberate commercial decision on every deploy.
  AND (t.monthly_price_zmw IS NULL OR t.monthly_price_usd IS NULL OR t.annual_price_zmw IS NULL);

-- ---------------------------------------------------------------------------
-- Make the gap unrepresentable
-- ---------------------------------------------------------------------------
-- PRICING.md's DDL declares all three NOT NULL; `0082` created them nullable,
-- which is precisely what let a tier exist without a price. Aligning the schema
-- with the document is what stops this recurring — a fifth tier added later
-- cannot now be saved without a price.
--
-- NULL stays meaningful for `student_limit` and `whatsapp_quota`, where it
-- means *unlimited* rather than *unset*. Those are deliberately left alone.

ALTER TABLE afritech.subscription_tiers
  ALTER COLUMN monthly_price_zmw SET NOT NULL,
  ALTER COLUMN monthly_price_usd SET NOT NULL,
  ALTER COLUMN annual_price_zmw  SET NOT NULL;

COMMENT ON COLUMN afritech.subscription_tiers.monthly_price_zmw IS
  'Required. NULL is not "free" — a tier without a price is unsellable, and the public pricing page reads this column directly. See migration 0100.';

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- The ALTER above would already fail on a NULL, so this asserts the thing the
-- ALTER cannot: that the values landed on the right rows rather than merely
-- landing.

DO $$
DECLARE
  starter_zmw NUMERIC;
  tiers_priced INTEGER;
BEGIN
  SELECT monthly_price_zmw INTO starter_zmw
  FROM afritech.subscription_tiers WHERE tier_name = 'starter';

  SELECT count(*) INTO tiers_priced
  FROM afritech.subscription_tiers WHERE monthly_price_zmw > 0;

  IF starter_zmw IS DISTINCT FROM 600.00 THEN
    RAISE EXCEPTION 'Starter monthly price is %, expected 600.00 per PRICING.md.', starter_zmw;
  END IF;

  IF tiers_priced <> 4 THEN
    RAISE EXCEPTION 'Expected 4 priced tiers, found %.', tiers_priced;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- NOT corrected here, deliberately
-- ---------------------------------------------------------------------------
-- PRICING.md and the seeded data also disagree about two **ceilings**:
--
--   | Tier         | PRICING.md students | Seeded (0082) |
--   |--------------|---------------------|---------------|
--   | Starter      | 200                 | 150           |
--   | Professional | 1,000               | NULL (unlimited) |
--
-- Those are left as they are. A price is inert until someone is invoiced; a
-- student ceiling is enforced, so raising or lowering one changes whether a
-- real school can enrol its next pupil. Which document is authoritative is a
-- commercial question, not a migration. Tracked in CLAUDE.md.

-- === MIGRATION END ===
