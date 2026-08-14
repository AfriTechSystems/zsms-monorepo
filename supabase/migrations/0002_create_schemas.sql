-- Migration: 0002_create_schemas.sql
-- Created: 2026-08-14
-- Description: Creates the `private` and `afritech` schemas and the shared
--              set_updated_at() trigger function. Must run before any table in
--              those schemas is created.
-- Related documents: Official Documentation/01 Foundation Layer/DATABASE.md
--                    Official Documentation/05 Core Database and API Reference/MIGRATIONS.md

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------
-- ZSMS uses three schemas (DATABASE.md):
--   public   — application tables, RLS-protected, exposed via PostgREST
--   private  — loan PII, never exposed via PostgREST, Edge Functions only
--   afritech — platform configuration and pricing, service_role only

CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS afritech;

COMMENT ON SCHEMA private IS
  'Loan PII. Never exposed via PostgREST. Reachable only from Edge Functions holding the service role key (CONVENTIONS.md prohibition 9).';
COMMENT ON SCHEMA afritech IS
  'AfriTech platform configuration, pricing, and internal operations. service_role only.';

-- `private` is granted USAGE to authenticated so that SECURITY DEFINER helpers
-- owned by postgres can traverse it. No table privileges are granted here, so
-- USAGE alone confers no read access.
GRANT USAGE ON SCHEMA private  TO authenticated;
GRANT USAGE ON SCHEMA afritech TO service_role;

-- Deny-by-default for anonymous callers in both schemas.
REVOKE ALL ON SCHEMA private  FROM anon;
REVOKE ALL ON SCHEMA afritech FROM anon;

-- ---------------------------------------------------------------------------
-- Shared trigger function
-- ---------------------------------------------------------------------------
-- Every table carrying an updated_at column uses this one function rather than
-- redefining the same three lines per table.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'Sets updated_at to NOW() on UPDATE. Attached per table as update_timestamp_on_[table] (CONVENTIONS.md trigger naming).';

-- === MIGRATION END ===
