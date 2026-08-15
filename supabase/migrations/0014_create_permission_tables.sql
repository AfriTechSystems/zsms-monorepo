-- Migration: 0014_create_permission_tables.sql
-- Created: 2026-08-14
-- Description: School-level permission defaults and the explicit, audited,
--              time-bounded permission grant table.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md — staff_permission_grants
--                    Official Documentation/02 Authentication and Identity/PERMISSIONS.md
--
-- ORDERING CORRECTION. MIGRATIONS.md originally scheduled these tables at 0017,
-- after the student RLS (0014) and staff RLS (0016) migrations. That ordering
-- cannot work: those policies call has_permission_grant(), which reads
-- public.staff_permission_grants. Any policy evaluation before the table exists
-- raises "relation does not exist" — the tenant boundary would fail closed on
-- every query rather than enforce correctly.
--
-- The permission tables therefore move ahead of the policies that depend on
-- them. The revised order is recorded in MIGRATIONS.md:
--   0014 permission tables · 0015 staff tables · 0016 student RLS
--   0017 staff RLS · 0018 permission RLS

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- school_permissions — per-school role defaults
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_permissions (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id    UUID NOT NULL REFERENCES public.schools(id),

  role         TEXT NOT NULL,
  -- An org:* role, or a school_custom_roles.role_name for custom roles.

  module       TEXT NOT NULL,

  can_view     BOOLEAN NOT NULL DEFAULT FALSE,
  can_create   BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit     BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete   BOOLEAN NOT NULL DEFAULT FALSE,
  can_export   BOOLEAN NOT NULL DEFAULT FALSE,

  updated_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, role, module)
);

CREATE INDEX IF NOT EXISTS idx_school_permissions_school
  ON public.school_permissions(school_id, role);

DROP TRIGGER IF EXISTS update_timestamp_on_school_permissions ON public.school_permissions;
CREATE TRIGGER update_timestamp_on_school_permissions
  BEFORE UPDATE ON public.school_permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- staff_permission_grants — explicit grants beyond the base role
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_permission_grants (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id        UUID NOT NULL REFERENCES public.schools(id),

  grantee_user_id  TEXT NOT NULL,
  grantor_user_id  TEXT NOT NULL,

  module           TEXT NOT NULL,
  action           TEXT NOT NULL
                   CHECK (action IN ('read', 'write', 'delete')),

  scope_detail     TEXT,

  reason           TEXT NOT NULL,
  -- Mandatory. A grant without a recorded reason is not auditable, and this
  -- table is the audit trail for every permission that exceeds a base role.

  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at       TIMESTAMPTZ,
  -- NULL means manual revocation only.

  granted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at       TIMESTAMPTZ,
  revoked_by       TEXT
);

COMMENT ON TABLE public.staff_permission_grants IS
  'Explicit, audited, time-bounded permission grants. Read by has_permission_grant() from every policy that supports grant overrides.';

CREATE INDEX IF NOT EXISTS idx_grants_grantee
  ON public.staff_permission_grants(grantee_user_id, school_id, is_active);
CREATE INDEX IF NOT EXISTS idx_grants_expiry
  ON public.staff_permission_grants(expires_at) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_grants_school
  ON public.staff_permission_grants(school_id);

REVOKE ALL ON public.school_permissions        FROM anon;
REVOKE ALL ON public.staff_permission_grants   FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.school_permissions      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.staff_permission_grants TO authenticated;

-- RLS is ENABLED here, but the policies land in 0018.
--
-- Enabling it now rather than alongside the policies is deliberate. A table with
-- RLS enabled and no policies denies everything, so the window between this
-- migration and 0018 fails closed. Deferring the ALTER to 0018 instead would
-- leave staff_permission_grants — the table that decides who may exceed their
-- role — readable by every authenticated user for the length of that window.
ALTER TABLE public.school_permissions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_permissions      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.staff_permission_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_permission_grants FORCE  ROW LEVEL SECURITY;

-- === MIGRATION END ===
