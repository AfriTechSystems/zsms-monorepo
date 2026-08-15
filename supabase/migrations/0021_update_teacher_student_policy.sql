-- Migration: 0021_update_teacher_student_policy.sql
-- Created: 2026-08-15
-- Description: Repoints teacher_read_assigned_students at the scope-based
--              teaching-assignment model, and marks staff_assignments superseded.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-037
--                    Official Documentation/01 Foundation Layer/RLS.md — students table
--
-- 0016 resolved teacher reach through staff_assignments, matching class_id
-- directly. That is correct only where a class has one teacher. Under ADR-037
-- the predicate becomes teacher_reaches_class(), which returns TRUE for an
-- assignment at EITHER scope — so a form teacher and a subject teacher are the
-- same lookup, and neither is special-cased.
--
-- The visible behaviour change: a teacher who previously saw a class only by
-- holding a staff_assignments row now needs a teacher_assignments row. Both
-- tables are empty on zsms-dev, and no environment beyond dev has these
-- migrations, so there is no data to carry across. A backfill would be required
-- before this reached an environment holding real assignments.

-- === MIGRATION START ===

DROP POLICY IF EXISTS "teacher_read_assigned_students" ON public.students;
CREATE POLICY "teacher_read_assigned_students"
ON public.students FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() = 'org:teacher'
  AND teacher_reaches_class(class_id)
);

-- teacher_assigned_to_class() was the 0016 stopgap and is now unreachable.
-- Dropped rather than left in place: a second, subtly different way to answer
-- "which students may this teacher see" is exactly how the wrong predicate ends
-- up in a future policy.
DROP FUNCTION IF EXISTS public.teacher_assigned_to_class(TEXT);

-- ---------------------------------------------------------------------------
-- staff_assignments — superseded, retained
-- ---------------------------------------------------------------------------
-- teacher_assignments expresses everything staff_assignments did:
-- is_class_teacher = TRUE becomes scope='class', and a class/subject pairing
-- becomes scope='subject'. Nothing reads staff_assignments for authorisation
-- any more.
--
-- The table is NOT dropped here. Dropping is irreversible and needs explicit
-- human approval, and the honest state today is "superseded, unused, still
-- present". It should be removed in a dedicated migration once ASSIGNMENTS.md
-- and the timetable module are confirmed to reference teacher_assignments only.
COMMENT ON TABLE public.staff_assignments IS
  'SUPERSEDED by public.teacher_assignments (ADR-037). No longer used for authorisation. Retained pending an explicit drop migration; do not add new references.';

-- === MIGRATION END ===
