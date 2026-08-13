-- Migration: 0001_rls_helper_functions.sql
-- Created: 2026-08-13
-- Description: Enables required extensions and creates the seven canonical RLS
--              helper functions that every subsequent RLS policy depends on.
--              This migration must run before any other migration.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md
--                    Official Documentation/05 Core Database and API Reference/MIGRATIONS.md
--                    Official Documentation/01 Foundation Layer/CONVENTIONS.md

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- Installed into the `extensions` schema, never `public`. pgtap alone creates
-- ~1,190 functions; in `public` those pollute the PostgREST surface and the
-- output of `supabase gen types typescript`.
--
-- Idempotent so staging and production — which start clean — get the same
-- result as zsms-dev, where both were enabled ahead of this migration.

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
COMMENT ON EXTENSION vector IS
  'pgvector — embeddings for the lesson planner knowledge base. See 18 AI Module/LESSON_PLANNER.md';

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
COMMENT ON EXTENSION pgtap IS
  'pgTAP — RLS policy test framework. See 16 Testing and Launch/TEST_STRATEGY.md Layer 2';

-- ---------------------------------------------------------------------------
-- RLS helper functions
-- ---------------------------------------------------------------------------
-- Created in `public` because RLS policies reference them unqualified and
-- `public` is on the search_path for the `authenticated` and `anon` roles.
--
-- has_permission_grant() reads public.staff_permission_grants and
-- public.schools, neither of which exists until migrations 0017 and 0003.
-- LANGUAGE SQL bodies are validated at CREATE time, so body checking is
-- disabled for this transaction. The function is not called until those
-- tables exist. Scope is LOCAL — it reverts at COMMIT.
SET LOCAL check_function_bodies = off;

-- Returns the Clerk organisation ID from the current session JWT.
-- This value equals the school's clerk_org_id and is the primary tenant key.
--
-- NOTE ON RETURN TYPE: this returns TEXT (the Clerk org ID), NOT the
-- schools.id UUID. Policies filter with `clerk_org_id = get_school_id()`, or
-- resolve to the internal UUID via
-- `(SELECT id FROM public.schools WHERE clerk_org_id = get_school_id())`.
CREATE OR REPLACE FUNCTION public.get_school_id()
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'o' ->> 'id',
    auth.jwt() ->> 'sub'
  )::TEXT;
$$;

-- Returns the user's Clerk role within their current organisation.
-- Canonical values per 02 Authentication and Identity/ROLES.md:
--   'org:owner' | 'org:principal' | 'org:admin' | 'org:accountant' |
--   'org:teacher' | 'org:staff' | 'org:parent' | 'org:student' | 'none'
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'o' ->> 'rol',
    'none'
  )::TEXT;
$$;

-- Returns the authenticated Clerk user ID (sub claim).
CREATE OR REPLACE FUNCTION public.get_user_id()
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
  SELECT auth.jwt() ->> 'sub';
$$;

-- Returns true only for AfriTech super admin accounts.
-- Super admins belong to the reserved 'afritech-systems-admin' organisation.
CREATE OR REPLACE FUNCTION public.is_afritech_admin()
RETURNS BOOLEAN
LANGUAGE SQL STABLE
AS $$
  SELECT (auth.jwt() -> 'o' ->> 'slg') = 'afritech-systems-admin';
$$;

-- Returns true when the current session is an impersonation session.
-- The 'act' claim is present only when a super admin is impersonating a user.
CREATE OR REPLACE FUNCTION public.is_impersonation_session()
RETURNS BOOLEAN
LANGUAGE SQL STABLE
AS $$
  SELECT (auth.jwt() -> 'act') IS NOT NULL;
$$;

-- Returns the real actor's user ID during an impersonation session.
-- Returns NULL when not in an impersonation session.
CREATE OR REPLACE FUNCTION public.get_actor_id()
RETURNS TEXT
LANGUAGE SQL STABLE
AS $$
  SELECT auth.jwt() -> 'act' ->> 'sub';
$$;

-- Checks whether the current user has an active explicit permission grant
-- for a specific action on a specific module. Used alongside base role checks
-- for the grant override system.
-- Depends on public.schools (0003) and public.staff_permission_grants (0017).
CREATE OR REPLACE FUNCTION public.has_permission_grant(
  p_module TEXT,
  p_action TEXT  -- 'read' | 'write' | 'delete'
)
RETURNS BOOLEAN
LANGUAGE SQL STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_permission_grants
    WHERE grantee_user_id = public.get_user_id()
      AND school_id = (
        SELECT id FROM public.schools WHERE clerk_org_id = public.get_school_id()
      )
      AND module = p_module
      AND action = p_action
      AND is_active = TRUE
      AND (expires_at IS NULL OR expires_at > NOW())
  );
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Helpers are STABLE and read only JWT claims (plus, for has_permission_grant,
-- RLS-protected tables). They are safe to expose to end-user roles.

GRANT EXECUTE ON FUNCTION public.get_school_id()            TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role()            TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_user_id()              TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_afritech_admin()        TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_impersonation_session() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_actor_id()             TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_permission_grant(TEXT, TEXT) TO authenticated;

-- === MIGRATION END ===
