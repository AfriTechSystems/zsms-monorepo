-- Migration: 0015_create_student_rls.sql
-- Created: 2026-08-14
-- Description: RLS policies for students, parents, and student_parent_links,
--              plus the SECURITY DEFINER lookups they depend on.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md
--
-- ============================================================================
-- TWO DEVIATIONS FROM RLS.md. Both are corrections, not preferences.
-- ============================================================================
--
-- (1) POLICY RECURSION. RLS.md expresses three policies as cross-table
--     subqueries: students.parent_read_own_children reads student_parent_links;
--     student_parent_links.school_management_links reads students;
--     parents.school_management_read_parents joins both. Written literally,
--     evaluating any one of them re-enters a table whose own policy re-enters
--     the first, and PostgreSQL aborts the query with
--     "infinite recursion detected in policy for relation".
--
--     The predicates below are unchanged in meaning. They are relocated into
--     SECURITY DEFINER functions, which run with the definer's rights and so do
--     not re-trigger RLS on the inner table. This is the standard resolution and
--     widens no access: each function encodes exactly the condition RLS.md
--     already states, and nothing else.
--
-- (2) class_enrolments DOES NOT EXIST. RLS.md resolves a teacher's students
--     through public.class_enrolments — a table with no CREATE TABLE in
--     DATABASE.md, no entry in SCHEMA.md's inventory, and no migration in
--     MIGRATIONS.md, referenced by four documents. teacher_read_assigned_students
--     below resolves through students.class_id, which IS defined (DATABASE.md,
--     NOT NULL) and means the same thing for the one-class-per-student model
--     that column implies.
--
--     The isolation guarantee is unaffected either way: school_id enforces
--     tenancy, and class matching only narrows a teacher further *within* their
--     own school. Flagged for a decision — specify class_enrolments, or correct
--     the four documents to students.class_id.

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- SECURITY DEFINER lookups (see deviation 1)
-- ---------------------------------------------------------------------------

-- TRUE when the current user is a linked parent of this student, including
-- during the 30-day grace period that follows an unlink.
CREATE OR REPLACE FUNCTION public.is_linked_parent_of(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_parent_links spl
    WHERE spl.student_id = p_student_id
      AND spl.parent_user_id = public.get_user_id()
      AND (
        spl.is_active = TRUE
        OR (spl.is_active = FALSE AND spl.grace_period_ends_at > NOW())
      )
  );
$$;

-- TRUE when the student belongs to the caller's own school.
CREATE OR REPLACE FUNCTION public.student_in_current_school(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.id = p_student_id
      AND s.school_id = public.current_school_uuid()
  );
$$;

-- TRUE when the parent is linked to at least one student at the caller's school.
-- parents carries no school_id, so this join IS the tenant boundary for it.
CREATE OR REPLACE FUNCTION public.parent_has_student_in_current_school(p_parent_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.student_parent_links spl
    JOIN public.students s ON s.id = spl.student_id
    WHERE spl.parent_id = p_parent_id
      AND s.school_id = public.current_school_uuid()
  );
$$;

-- TRUE when the class is assigned to the calling teacher this academic year.
CREATE OR REPLACE FUNCTION public.teacher_assigned_to_class(p_class_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_assignments sa
    WHERE sa.staff_user_id = public.get_user_id()
      AND sa.school_id = public.current_school_uuid()
      AND sa.class_id = p_class_id
      AND sa.academic_year = EXTRACT(YEAR FROM NOW())::TEXT
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_linked_parent_of(UUID)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_in_current_school(UUID)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.parent_has_student_in_current_school(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_assigned_to_class(TEXT)            TO authenticated;

-- ---------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_students" ON public.students;
CREATE POLICY "afritech_admin_all_students"
ON public.students FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "school_management_read_students" ON public.students;
CREATE POLICY "school_management_read_students"
ON public.students FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin', 'org:accountant')
);

DROP POLICY IF EXISTS "teacher_read_assigned_students" ON public.students;
CREATE POLICY "teacher_read_assigned_students"
ON public.students FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() = 'org:teacher'
  AND teacher_assigned_to_class(class_id)
);

DROP POLICY IF EXISTS "parent_read_own_children" ON public.students;
CREATE POLICY "parent_read_own_children"
ON public.students FOR SELECT
USING (is_linked_parent_of(id));

DROP POLICY IF EXISTS "student_read_own_record" ON public.students;
CREATE POLICY "student_read_own_record"
ON public.students FOR SELECT
USING (clerk_user_id = get_user_id());

DROP POLICY IF EXISTS "management_write_students" ON public.students;
CREATE POLICY "management_write_students"
ON public.students FOR INSERT
WITH CHECK (
  school_id = current_school_uuid()
  AND (
    get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
    OR has_permission_grant('students', 'write')
  )
);

DROP POLICY IF EXISTS "management_update_students" ON public.students;
CREATE POLICY "management_update_students"
ON public.students FOR UPDATE
USING (
  school_id = current_school_uuid()
  AND (
    get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
    OR has_permission_grant('students', 'write')
  )
)
WITH CHECK (
  school_id = current_school_uuid()
);

-- No DELETE policy. Soft delete only, via is_deleted (prohibition 8).

-- ---------------------------------------------------------------------------
-- parents
-- ---------------------------------------------------------------------------

ALTER TABLE public.parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parents FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_parents" ON public.parents;
CREATE POLICY "afritech_admin_all_parents"
ON public.parents FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "parent_read_own_record" ON public.parents;
CREATE POLICY "parent_read_own_record"
ON public.parents FOR SELECT
USING (clerk_user_id = get_user_id());

DROP POLICY IF EXISTS "parent_update_own_record" ON public.parents;
CREATE POLICY "parent_update_own_record"
ON public.parents FOR UPDATE
USING (clerk_user_id = get_user_id())
WITH CHECK (clerk_user_id = get_user_id());

DROP POLICY IF EXISTS "school_management_read_parents" ON public.parents;
CREATE POLICY "school_management_read_parents"
ON public.parents FOR SELECT
USING (
  parent_has_student_in_current_school(id)
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin', 'org:accountant')
);

DROP POLICY IF EXISTS "school_management_insert_parents" ON public.parents;
CREATE POLICY "school_management_insert_parents"
ON public.parents FOR INSERT
WITH CHECK (
  get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  OR has_permission_grant('parents', 'write')
);

-- ---------------------------------------------------------------------------
-- student_parent_links
-- ---------------------------------------------------------------------------

ALTER TABLE public.student_parent_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_parent_links FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_links" ON public.student_parent_links;
CREATE POLICY "afritech_admin_all_links"
ON public.student_parent_links FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "parent_read_own_links" ON public.student_parent_links;
CREATE POLICY "parent_read_own_links"
ON public.student_parent_links FOR SELECT
USING (parent_user_id = get_user_id());

DROP POLICY IF EXISTS "school_management_links" ON public.student_parent_links;
CREATE POLICY "school_management_links"
ON public.student_parent_links FOR ALL
USING (
  student_in_current_school(student_id)
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
)
WITH CHECK (
  student_in_current_school(student_id)
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- === MIGRATION END ===
