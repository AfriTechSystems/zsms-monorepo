-- Migration: 0122_network_schools_write_grants.sql
-- Created: 2026-09-27
-- Description: Grants the table privileges `attach_school_to_network()` needs, so
--              AfriTech can actually attach a school.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md
--
-- ===========================================================================
-- WHY THIS WAS MISSING
--
-- 0119 granted `SELECT` only on `school_network_schools`, reasoning that only
-- AfriTech writes it. That was right about who, and wrong about how: the writing
-- happens through `attach_school_to_network()`, which is SECURITY INVOKER — so it
-- runs with the CALLER's table privileges, and an AfriTech operator is
-- `authenticated` like everybody else. The grant was missing for the very role that
-- needs it.
--
-- Caught by the suite: the guard correctly let AfriTech through and Postgres then
-- refused the UPDATE. Two gates in the right order, with the outer one shut.
--
-- THE TWO GATES, BOTH DELIBERATE
--
-- Table privileges say what the ROLE may attempt; RLS says which ROWS. Granting
-- INSERT and UPDATE to `authenticated` widens nothing on its own, because
-- `afritech_admin_all_network_schools` is the only write policy on the table and it
-- requires `is_afritech_admin()`. A school owner with these privileges still writes
-- no rows.
--
-- DELETE is deliberately not granted. A detachment sets `is_active = FALSE` and
-- stamps `detached_at`, which is how the history of "this school used to be in that
-- network" survives — the same soft-retirement reasoning as everywhere else in this
-- schema.
-- ===========================================================================

-- === MIGRATION START ===

GRANT INSERT, UPDATE ON public.school_network_schools TO authenticated;

-- Networks themselves are written only by AfriTech, through the admin screens.
-- Same two-gate reasoning: the policy is the boundary, the grant is the door.
GRANT INSERT, UPDATE ON public.school_networks TO authenticated;

-- === MIGRATION END ===
