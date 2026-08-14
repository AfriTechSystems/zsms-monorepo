-- Migration: 0015_create_staff_tables.sql
-- Created: 2026-08-14
-- Description: Staff profiles, class/subject assignments, and pending
--              self-registration requests.
-- Related documents: Official Documentation/01 Foundation Layer/DATABASE.md — staff tables
--                    Official Documentation/08 Staff Management/STAFF.md
--
-- ORDERING: these tables precede the student RLS in 0016 because
-- teacher_read_assigned_students resolves a teacher's classes through
-- staff_assignments. The SECURITY DEFINER helper that encodes that lookup is
-- LANGUAGE SQL, whose body is validated at CREATE time — so the table must
-- already exist when 0016 runs.

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- staff_members
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_members (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id           UUID NOT NULL REFERENCES public.schools(id),

  clerk_user_id       TEXT NOT NULL,
  -- One person at two schools has two rows here but one Clerk account.

  staff_number        TEXT,

  first_name          TEXT NOT NULL,
  last_name           TEXT NOT NULL,
  phone_e164          TEXT,
  email               TEXT,
  photo_url           TEXT,
  department          TEXT,

  employment_type     TEXT NOT NULL DEFAULT 'full_time'
                      CHECK (employment_type IN (
                        'full_time', 'part_time', 'contract', 'volunteer'
                      )),

  join_date           DATE,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, clerk_user_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_school  ON public.staff_members(school_id);
CREATE INDEX IF NOT EXISTS idx_staff_clerk   ON public.staff_members(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_staff_active  ON public.staff_members(school_id, is_active);

DROP TRIGGER IF EXISTS update_timestamp_on_staff_members ON public.staff_members;
CREATE TRIGGER update_timestamp_on_staff_members
  BEFORE UPDATE ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- staff_assignments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_assignments (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID NOT NULL REFERENCES public.schools(id),

  staff_user_id     TEXT NOT NULL,
  -- Clerk user ID of the teacher.

  class_id          TEXT NOT NULL,
  -- class_id = 'ALL' means the teacher covers this subject across every class
  -- (e.g. a specialist music teacher).

  subject_code      TEXT NOT NULL,

  is_class_teacher  BOOLEAN NOT NULL DEFAULT FALSE,

  academic_year     TEXT NOT NULL,
  term_number       INT,
  -- NULL means the assignment covers every term in the academic year.

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, staff_user_id, class_id, subject_code, academic_year)
);

COMMENT ON TABLE public.staff_assignments IS
  'Drives teacher scoping. teacher_read_assigned_students narrows a teacher to these classes within their own school.';

CREATE INDEX IF NOT EXISTS idx_assignments_school ON public.staff_assignments(school_id);
CREATE INDEX IF NOT EXISTS idx_assignments_staff  ON public.staff_assignments(staff_user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_class  ON public.staff_assignments(school_id, class_id);

-- ---------------------------------------------------------------------------
-- staff_requests
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_requests (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id        UUID NOT NULL REFERENCES public.schools(id),

  clerk_user_id    TEXT NOT NULL,
  -- Has a ZSMS account but is NOT yet a Clerk Organisation member.

  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  phone_e164       TEXT,
  email            TEXT,

  role_requested   TEXT NOT NULL,
  subjects         TEXT[],
  message          TEXT,

  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected')),

  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ,
  rejection_reason TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_requests_school
  ON public.staff_requests(school_id, status);

REVOKE ALL ON public.staff_members     FROM anon;
REVOKE ALL ON public.staff_assignments FROM anon;
REVOKE ALL ON public.staff_requests    FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.staff_members     TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.staff_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.staff_requests    TO authenticated;

-- RLS is ENABLED here and the policies land in 0017. Enabled now so the gap
-- fails closed rather than open — see the same reasoning in 0014.
ALTER TABLE public.staff_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_members     FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.staff_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_assignments FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.staff_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_requests    FORCE  ROW LEVEL SECURITY;

-- === MIGRATION END ===
