-- Migration: 0012_create_parents_table.sql
-- Created: 2026-08-14
-- Description: Parent and guardian accounts. Platform-level, not school-level.
-- Related documents: Official Documentation/01 Foundation Layer/DATABASE.md — parents table
--                    Official Documentation/07 Student and Parent Modules/PARENT_LINKING.md
--
-- NOTE: this table has NO school_id. A parent may have children at several
-- schools; their school context comes entirely from student_parent_links. The
-- tenant boundary for parents is therefore enforced through that join, not
-- through a column on this table — see 0015.

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS public.parents (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  clerk_user_id     TEXT UNIQUE,
  -- Populated once the parent has logged in at least once. NULL for parents
  -- imported by a school who have never signed in.

  phone_e164        TEXT,
  -- Primary identity in the passwordless model. E.164, e.g. +260977123456.

  email             TEXT,
  full_name         TEXT,

  national_id       TEXT,
  -- Encrypted at the application layer. Loan pre-fill only.

  preferred_contact TEXT NOT NULL DEFAULT 'phone'
                    CHECK (preferred_contact IN ('phone', 'email', 'whatsapp')),

  whatsapp_opted_in BOOLEAN NOT NULL DEFAULT TRUE,

  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parents_phone
  ON public.parents(phone_e164) WHERE phone_e164 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parents_email
  ON public.parents(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parents_clerk
  ON public.parents(clerk_user_id) WHERE clerk_user_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_timestamp_on_parents ON public.parents;
CREATE TRIGGER update_timestamp_on_parents
  BEFORE UPDATE ON public.parents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON public.parents FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.parents TO authenticated;

-- RLS applied in 0016.

-- === MIGRATION END ===
