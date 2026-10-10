-- Migration: 0074_create_academic_rls.sql
-- Created: 2026-08-15
-- Description: RLS for attendance_records, exam_results, and
--              report_generation_jobs, plus teacher_teaches_subject().
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md
--                    Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-037

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- teacher_teaches_subject() — ADR-037 narrowed to one subject
-- ---------------------------------------------------------------------------
-- Attendance is a whole-class activity, so it uses teacher_reaches_class().
-- Marks are per subject, so they need the narrower question: does this teacher
-- teach THIS subject to THIS class?
--
-- A scope='class' teacher owns the class and therefore every subject taught in
-- it — that is what "owns the whole class" means, and it is why a primary
-- teacher can enter marks for all their subjects without a row per subject.
-- A scope='subject' teacher reaches only the subject they hold.
CREATE OR REPLACE FUNCTION public.teacher_teaches_subject(
  p_class_id     TEXT,
  p_subject_code TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.teacher_assignments ta
    LEFT JOIN public.school_subjects ss ON ss.id = ta.subject_id
    WHERE ta.teacher_user_id = public.get_user_id()
      AND ta.school_id       = public.current_school_uuid()
      AND ta.class_id        = p_class_id
      AND ta.is_active       = TRUE
      AND ta.academic_year   = EXTRACT(YEAR FROM NOW())::TEXT
      AND (
        ta.scope = 'class'
        OR (ta.scope = 'subject' AND ss.subject_code = p_subject_code)
      )
  );
$$;

COMMENT ON FUNCTION public.teacher_teaches_subject(TEXT, TEXT) IS
  'TRUE when the caller teaches this subject to this class. scope=class owns every subject in the class; scope=subject reaches only its own (ADR-037).';

GRANT EXECUTE ON FUNCTION public.teacher_teaches_subject(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- attendance_records
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_attendance" ON public.attendance_records;
CREATE POLICY "afritech_admin_all_attendance"
ON public.attendance_records FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "management_read_attendance" ON public.attendance_records;
CREATE POLICY "management_read_attendance"
ON public.attendance_records FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

DROP POLICY IF EXISTS "teacher_read_own_class_attendance" ON public.attendance_records;
CREATE POLICY "teacher_read_own_class_attendance"
ON public.attendance_records FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() = 'org:teacher'
  AND teacher_reaches_class(class_id)
);

DROP POLICY IF EXISTS "parent_read_own_child_attendance" ON public.attendance_records;
CREATE POLICY "parent_read_own_child_attendance"
ON public.attendance_records FOR SELECT
USING (is_linked_parent_of(student_id));

DROP POLICY IF EXISTS "student_read_own_attendance" ON public.attendance_records;
CREATE POLICY "student_read_own_attendance"
ON public.attendance_records FOR SELECT
USING (is_own_student_record(student_id));

-- Marking. A teacher may only mark classes they reach — at either scope.
DROP POLICY IF EXISTS "attendance_insert" ON public.attendance_records;
CREATE POLICY "attendance_insert"
ON public.attendance_records FOR INSERT
WITH CHECK (
  school_id = current_school_uuid()
  AND (
    (get_user_role() = 'org:teacher' AND teacher_reaches_class(class_id))
    OR get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
    OR has_permission_grant('attendance', 'write')
  )
);

-- Corrections. RLS enforces ownership of the record; the same-day window is an
-- application rule, since "today" is a business decision rather than a security
-- boundary.
DROP POLICY IF EXISTS "attendance_update" ON public.attendance_records;
CREATE POLICY "attendance_update"
ON public.attendance_records FOR UPDATE
USING (
  school_id = current_school_uuid()
  AND (
    (recorded_by_user_id = get_user_id() AND teacher_reaches_class(class_id))
    OR get_user_role() IN ('org:owner', 'org:principal')
    OR has_permission_grant('attendance', 'write')
  )
)
WITH CHECK (
  school_id = current_school_uuid()
  AND (
    (recorded_by_user_id = get_user_id() AND teacher_reaches_class(class_id))
    OR get_user_role() IN ('org:owner', 'org:principal')
    OR has_permission_grant('attendance', 'write')
  )
);
-- RLS.md's USING clause checks only recorded_by_user_id. teacher_reaches_class
-- is added because a teacher who is reassigned away from a class should not
-- keep edit rights over its register merely because they marked it once. The
-- WITH CHECK mirrors USING so a row cannot be edited into another class.

-- ---------------------------------------------------------------------------
-- exam_results
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_results" ON public.exam_results;
CREATE POLICY "afritech_admin_all_results"
ON public.exam_results FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "management_read_results" ON public.exam_results;
CREATE POLICY "management_read_results"
ON public.exam_results FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

DROP POLICY IF EXISTS "teacher_read_own_subject_results" ON public.exam_results;
CREATE POLICY "teacher_read_own_subject_results"
ON public.exam_results FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() = 'org:teacher'
  AND teacher_teaches_subject(class_id, subject_code)
);

-- Parents and students see results only after publication. An unpublished mark
-- is a draft.
DROP POLICY IF EXISTS "parent_read_published_results" ON public.exam_results;
CREATE POLICY "parent_read_published_results"
ON public.exam_results FOR SELECT
USING (
  is_linked_parent_of(student_id)
  AND results_published = TRUE
);

DROP POLICY IF EXISTS "student_read_own_results" ON public.exam_results;
CREATE POLICY "student_read_own_results"
ON public.exam_results FOR SELECT
USING (
  is_own_student_record(student_id)
  AND results_published = TRUE
);

DROP POLICY IF EXISTS "teacher_insert_results" ON public.exam_results;
CREATE POLICY "teacher_insert_results"
ON public.exam_results FOR INSERT
WITH CHECK (
  school_id = current_school_uuid()
  AND (
    (get_user_role() = 'org:teacher' AND teacher_teaches_subject(class_id, subject_code))
    OR get_user_role() IN ('org:owner', 'org:principal')
    OR has_permission_grant('results', 'write')
  )
  -- Marks cannot be inserted already published. Publication is the principal's
  -- act (publish_results in 0075), not something a teacher can assert.
  AND results_published = FALSE
);

-- Teachers edit their own marks only while unpublished. The publication lock is
-- in the USING clause, so it is enforced by the database rather than trusted to
-- the application — RLS.md left it to the application layer, which would make
-- the lock bypassable by any direct PostgREST call.
DROP POLICY IF EXISTS "teacher_update_unpublished_results" ON public.exam_results;
CREATE POLICY "teacher_update_unpublished_results"
ON public.exam_results FOR UPDATE
USING (
  school_id = current_school_uuid()
  AND results_published = FALSE
  AND (
    (get_user_role() = 'org:teacher' AND teacher_teaches_subject(class_id, subject_code))
    OR get_user_role() IN ('org:owner', 'org:principal')
    OR has_permission_grant('results', 'write')
  )
)
WITH CHECK (
  school_id = current_school_uuid()
  -- A teacher must not be able to publish by flipping the flag on their own row.
  -- Only owner and principal may set results_published through this policy;
  -- the intended route is publish_results() in 0075.
  AND (
    results_published = FALSE
    OR get_user_role() IN ('org:owner', 'org:principal')
  )
);

-- ---------------------------------------------------------------------------
-- report_generation_jobs
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_report_jobs" ON public.report_generation_jobs;
CREATE POLICY "afritech_admin_all_report_jobs"
ON public.report_generation_jobs FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "management_read_report_jobs" ON public.report_generation_jobs;
CREATE POLICY "management_read_report_jobs"
ON public.report_generation_jobs FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

DROP POLICY IF EXISTS "management_write_report_jobs" ON public.report_generation_jobs;
CREATE POLICY "management_write_report_jobs"
ON public.report_generation_jobs FOR ALL
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal')
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal')
);

-- === MIGRATION END ===
