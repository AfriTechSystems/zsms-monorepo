-- Migration: 0128_price_band_select_grant.sql
-- Created: 2026-09-27
-- Description: Grants the SELECT that `subscription_tier_catalogue` needs to read
--              price bands, now that the view is security_invoker.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md
--
-- ===========================================================================
-- THE SAME TRAP, TWICE
--
-- 0124 created `afritech.tier_student_price_bands` with RLS restricting it to
-- AfriTech and **no grant to `authenticated`**, reasoning that the `afritech` schema
-- is not exposed to PostgREST so nobody needs table privileges on it.
--
-- That reasoning holds for direct access and fails for a `security_invoker` view. The
-- point of `security_invoker` is that the view runs as the CALLER — which is exactly
-- what makes it safe, because RLS still applies — and therefore the caller needs
-- SELECT on the table underneath. An AfriTech operator is `authenticated` like
-- everybody else, so `subscription_tier_catalogue` failed with "permission denied for
-- table tier_student_price_bands" for the one role meant to use it.
--
-- This is the second time in this session: 0122 granted INSERT/UPDATE that
-- `attach_school_to_network()` needed for the same reason, a SECURITY INVOKER
-- function running with the caller's privileges.
--
-- **The rule, stated so it stops recurring:** table privileges say what a ROLE may
-- attempt; RLS says which ROWS it gets. Anything reached through a
-- `security_invoker` view or a `SECURITY INVOKER` function needs BOTH, and the grant
-- widens nothing on its own — the policy is still the boundary.
--
-- The alternative would be making the view `security_definer`, and that is the wrong
-- fix: the view would then bypass RLS entirely and every authenticated user would
-- read every tier's commercial terms. A missing grant fails loudly; a definer view
-- fails silently and in the dangerous direction.
-- ===========================================================================

-- === MIGRATION START ===

GRANT SELECT ON afritech.tier_student_price_bands TO authenticated;
REVOKE ALL   ON afritech.tier_student_price_bands FROM anon;

-- Writing bands stays with AfriTech through the admin screen, and the policy from
-- 0124 is what enforces it. The grant only lets the attempt reach the policy.
GRANT INSERT, UPDATE, DELETE ON afritech.tier_student_price_bands TO authenticated;

-- === MIGRATION END ===
