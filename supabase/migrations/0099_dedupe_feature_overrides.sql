-- Migration: 0099_dedupe_feature_overrides.sql
-- Created: 2026-08-18
-- Description: Deactivates duplicate active feature overrides and adds the
--              partial unique index that prevents them recurring.
-- Related documents: Official Documentation/17 Integration and Pricing/PRICING.md
--                    Official Documentation/15 Super Admin and Platform/SUPERADMIN.md

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- Why
-- ---------------------------------------------------------------------------
-- `afritech.school_feature_overrides` had no uniqueness guard, so the same
-- school could hold several *active* overrides of the same type for the same
-- feature. `dev_seed.sql` ended with two identical copies of each of its two
-- overrides, purely because it was run twice.
--
-- The seed was not careless — it ends its INSERT with `ON CONFLICT DO NOTHING`.
-- That clause is the trap here: with no unique constraint to conflict *with*,
-- it is unreachable, and silently inserts a duplicate while reading like a
-- guard. This index is what makes that existing clause do the job it claims to.
--
-- The duplication is not merely untidy. `school_has_feature()` resolves with
-- EXISTS, so two identical grants and one grant resolve the same — but the
-- admin dashboard lists overrides individually and revokes them by id. An
-- operator who revokes the visible grant and sees access persist has been shown
-- an interface that lied to them, and the natural next conclusion is that the
-- resolver is broken. Uniqueness is what keeps "revoked" and "no longer in
-- force" the same statement.

-- ---------------------------------------------------------------------------
-- Step 1 — retire the duplicates
-- ---------------------------------------------------------------------------
-- Keeps the earliest row of each group, which is the one whose `created_at`
-- records when the decision was actually made.
--
-- Deactivated, never deleted. CONVENTIONS.md prohibition 8 covers students,
-- payments, and results specifically, but the reasoning carries: this table is
-- the audit record of a support decision, and an audit trail that can be
-- rewritten by a cleanup migration is not one. `revoked_by` names this
-- migration so the row explains itself.

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY school_id, override_type, feature_key, override_value
           ORDER BY created_at, id
         ) AS rn
  FROM afritech.school_feature_overrides
  WHERE is_active
)
UPDATE afritech.school_feature_overrides o
SET is_active  = FALSE,
    revoked_at = NOW(),
    revoked_by = 'migration:0099'
FROM ranked r
WHERE o.id = r.id
  AND r.rn > 1;

-- ---------------------------------------------------------------------------
-- Step 2 — prevent recurrence
-- ---------------------------------------------------------------------------
-- Partial, on `is_active`, because the history must stay: a school may be
-- granted a feature, have it revoked, and be granted it again, leaving three
-- rows of which exactly one is in force. A full unique constraint would forbid
-- that entirely legitimate sequence.
--
-- `override_value` is in the key so a tier override can be distinguished from a
-- later, different one. COALESCE because NULL never equals NULL in an index,
-- which would let two active NULL-valued rows through the very guard being
-- added here — the same subtlety that makes a NULL-yielding CHECK pass.

CREATE UNIQUE INDEX IF NOT EXISTS idx_school_feature_overrides_active_unique
  ON afritech.school_feature_overrides (
    school_id,
    override_type,
    COALESCE(feature_key, ''),
    COALESCE(override_value, '')
  )
  WHERE is_active;

COMMENT ON INDEX afritech.idx_school_feature_overrides_active_unique IS
  'At most one active override per school per (type, feature, value). Partial on is_active so grant/revoke/grant history is preserved. See migration 0099.';

-- ---------------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------------
-- Asserts the outcome rather than trusting the two statements above. A
-- migration that reports success while leaving duplicates behind is worse than
-- one that fails, because the index creation would then be the thing that
-- errored and the dedupe would look like it worked.

DO $$
DECLARE
  dupes INTEGER;
BEGIN
  SELECT count(*) INTO dupes
  FROM (
    SELECT school_id, override_type, COALESCE(feature_key, ''), COALESCE(override_value, '')
    FROM afritech.school_feature_overrides
    WHERE is_active
    GROUP BY 1, 2, 3, 4
    HAVING count(*) > 1
  ) d;

  IF dupes > 0 THEN
    RAISE EXCEPTION 'Deduplication failed: % group(s) still hold multiple active overrides.', dupes;
  END IF;
END $$;

-- === MIGRATION END ===
