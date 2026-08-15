-- Migration: 0020_create_teaching_assignment_tables.sql
-- Created: 2026-08-15
-- Description: The scope-based teaching-assignment model — class_subjects and
--              teacher_assignments — plus the SECURITY DEFINER helper that
--              resolves teacher reach for RLS.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-037
--                    Official Documentation/01 Foundation Layer/RLS.md
--                    Official Documentation/08 Staff Management/ASSIGNMENTS.md
--
-- WHY THIS EXISTS
-- ---------------
-- Four documents resolved a teacher's students through `public.class_enrolments`,
-- a table that was never defined anywhere. Migration 0016 worked around it by
-- matching students.class_id directly, which is correct for a primary school
-- (one teacher owns one class) but wrong for a secondary school, where a subject
-- teacher reaches many classes and a class reaches many teachers.
--
-- This replaces the gap with a model that expresses both without branching on
-- school type — see ADR-037. The shape of a school is data, not a code path.

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- class_subjects — which subjects are taught to which class
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.class_subjects (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id      UUID NOT NULL REFERENCES public.schools(id),

  class_id       TEXT NOT NULL,
  -- The same class identifier carried by students.class_id. Deliberately TEXT
  -- and not a foreign key: classes are a naming convention per school, not a
  -- registry, and DATABASE.md defines students.class_id the same way.

  subject_id     UUID NOT NULL REFERENCES public.school_subjects(id),

  academic_year  TEXT NOT NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, class_id, subject_id, academic_year)
);

COMMENT ON TABLE public.class_subjects IS
  'Which subjects are taught to which class in a given academic year. The curriculum side of the teaching model; teacher_assignments is the staffing side.';

CREATE INDEX IF NOT EXISTS idx_class_subjects_school_class
  ON public.class_subjects(school_id, class_id, academic_year);
CREATE INDEX IF NOT EXISTS idx_class_subjects_subject
  ON public.class_subjects(subject_id);

DROP TRIGGER IF EXISTS update_timestamp_on_class_subjects ON public.class_subjects;
CREATE TRIGGER update_timestamp_on_class_subjects
  BEFORE UPDATE ON public.class_subjects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- teacher_assignments — what a teacher teaches, at one of two scopes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.teacher_assignments (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id        UUID NOT NULL REFERENCES public.schools(id),

  teacher_user_id  TEXT NOT NULL,
  -- Clerk user ID. Matches staff_members.clerk_user_id at this school.

  scope            TEXT NOT NULL
                   CHECK (scope IN ('class', 'subject')),
  -- 'class'   — the teacher owns the whole class (primary model, form teacher).
  -- 'subject' — the teacher teaches ONE subject to ONE class (secondary model).
  --
  -- A teacher may hold any number of rows of either scope, including both at
  -- once: a secondary teacher who also acts as form teacher for one class has
  -- one 'class' row and several 'subject' rows. Nothing in the schema or the
  -- policies needs to know which kind of school this is.

  class_id         TEXT NOT NULL,
  -- Set for BOTH scopes — every assignment reaches exactly one class. That is
  -- what makes the RLS predicate a single lookup rather than a branch.

  subject_id       UUID REFERENCES public.school_subjects(id),
  -- NULL for scope='class'; required for scope='subject'.

  academic_year    TEXT NOT NULL,
  term_number      INT,
  -- NULL means the assignment covers every term in the academic year.

  is_active        BOOLEAN NOT NULL DEFAULT TRUE,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The scope field and the subject column must agree. Without this a row could
  -- claim scope='subject' with no subject, and the RLS predicate would silently
  -- widen that teacher to the whole class.
  CONSTRAINT teacher_assignment_scope_shape CHECK (
    (scope = 'class'   AND subject_id IS NULL)
    OR
    (scope = 'subject' AND subject_id IS NOT NULL)
  )
);

COMMENT ON TABLE public.teacher_assignments IS
  'Scope-based teaching assignments (ADR-037). scope=class owns a whole class; scope=subject teaches one subject to one class. Supersedes staff_assignments.';
COMMENT ON COLUMN public.teacher_assignments.scope IS
  'class | subject. Both carry class_id, so teacher reach is one lookup regardless of school type.';

-- Partial unique indexes rather than one table constraint: a UNIQUE over a
-- nullable subject_id would not deduplicate scope='class' rows at all, because
-- PostgreSQL treats NULLs as distinct.
CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_assignments_class_scope
  ON public.teacher_assignments(school_id, teacher_user_id, class_id, academic_year)
  WHERE scope = 'class';

CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_assignments_subject_scope
  ON public.teacher_assignments(school_id, teacher_user_id, class_id, subject_id, academic_year)
  WHERE scope = 'subject';

CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher
  ON public.teacher_assignments(teacher_user_id, school_id, academic_year) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_class
  ON public.teacher_assignments(school_id, class_id, academic_year) WHERE is_active;

DROP TRIGGER IF EXISTS update_timestamp_on_teacher_assignments ON public.teacher_assignments;
CREATE TRIGGER update_timestamp_on_teacher_assignments
  BEFORE UPDATE ON public.teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- teacher_reaches_class() — the single predicate behind teacher RLS
-- ---------------------------------------------------------------------------
-- Returns TRUE when the calling teacher holds ANY active assignment reaching
-- this class, at either scope. Both scopes carry class_id, so no branch on
-- scope is needed here — adding a third scope later changes this function only
-- if the new scope does not resolve to a class.
--
-- SECURITY DEFINER for the same reason as the 0016 helpers: the students policy
-- reads teacher_assignments, whose own policies read students, and PostgreSQL
-- aborts mutually-recursive policy evaluation.
CREATE OR REPLACE FUNCTION public.teacher_reaches_class(p_class_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teacher_assignments ta
    WHERE ta.teacher_user_id = public.get_user_id()
      AND ta.school_id       = public.current_school_uuid()
      AND ta.class_id        = p_class_id
      AND ta.is_active       = TRUE
      AND ta.academic_year   = EXTRACT(YEAR FROM NOW())::TEXT
  );
$$;

COMMENT ON FUNCTION public.teacher_reaches_class(TEXT) IS
  'TRUE when the calling teacher holds any active assignment reaching this class, at either scope (ADR-037).';

GRANT EXECUTE ON FUNCTION public.teacher_reaches_class(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.class_subjects       FROM anon;
REVOKE ALL ON public.teacher_assignments  FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.class_subjects      TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.teacher_assignments TO authenticated;
-- 0019 revoked DELETE/TRUNCATE by default privilege, but state it explicitly so
-- these two tables do not depend on that having been applied first.
REVOKE DELETE, TRUNCATE ON public.class_subjects      FROM authenticated, anon;
REVOKE DELETE, TRUNCATE ON public.teacher_assignments FROM authenticated, anon;

ALTER TABLE public.class_subjects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_subjects      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_assignments FORCE  ROW LEVEL SECURITY;

-- class_subjects ------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_class_subjects" ON public.class_subjects;
CREATE POLICY "afritech_admin_all_class_subjects"
ON public.class_subjects FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Readable by any member of the school: the curriculum for a class is not
-- sensitive, and timetable and results views need it.
DROP POLICY IF EXISTS "school_staff_read_class_subjects" ON public.class_subjects;
CREATE POLICY "school_staff_read_class_subjects"
ON public.class_subjects FOR SELECT
USING (school_id = current_school_uuid());

DROP POLICY IF EXISTS "management_write_class_subjects" ON public.class_subjects;
CREATE POLICY "management_write_class_subjects"
ON public.class_subjects FOR ALL
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- teacher_assignments -------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_teacher_assignments" ON public.teacher_assignments;
CREATE POLICY "afritech_admin_all_teacher_assignments"
ON public.teacher_assignments FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "management_read_teacher_assignments" ON public.teacher_assignments;
CREATE POLICY "management_read_teacher_assignments"
ON public.teacher_assignments FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- A teacher reads their own assignments, so the app can show them their classes.
DROP POLICY IF EXISTS "teacher_read_own_teacher_assignments" ON public.teacher_assignments;
CREATE POLICY "teacher_read_own_teacher_assignments"
ON public.teacher_assignments FOR SELECT
USING (teacher_user_id = get_user_id());

-- Owner and principal staff the timetable. A teacher must never write their own
-- assignment row: teacher reach is derived from this table, so self-assignment
-- would be self-granted access to another class's students.
DROP POLICY IF EXISTS "management_write_teacher_assignments" ON public.teacher_assignments;
CREATE POLICY "management_write_teacher_assignments"
ON public.teacher_assignments FOR ALL
USING (
  school_id = current_school_uuid()
  AND (
    get_user_role() IN ('org:owner', 'org:principal')
    OR has_permission_grant('assignments', 'write')
  )
)
WITH CHECK (
  school_id = current_school_uuid()
  AND (
    get_user_role() IN ('org:owner', 'org:principal')
    OR has_permission_grant('assignments', 'write')
  )
);

-- === MIGRATION END ===
