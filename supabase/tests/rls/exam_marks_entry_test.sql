-- ===========================================================================
-- Mark entry — the write path ADR-041 depends on.
--
-- Spec: Official Documentation/11 Examinations and Results/
--       Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-041
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- `grading_scale_versioning_test.sql` proves a version keeps a grade
-- explainable. That is worth nothing if the write path fails to record the
-- version in the first place, so this suite covers `save_exam_marks()`:
--
--   * the letter and the version that explains it are written TOGETHER — the
--     single assertion 0108 exists for;
--   * an unmarked pupil is NULL and claims no version, because a version beside
--     a NULL letter would assert an explanation for a grade that does not exist;
--   * zero is a real mark and grades, because a child who sat the paper and
--     scored nothing is not the same as a child who was not examined, and
--     collapsing the two puts a fail on a sick pupil's report card;
--   * a mark above the paper total is a typing error, not a distinction;
--   * publication is the lock, and a teacher can neither publish nor edit past
--     it;
--   * a teacher cannot mark a subject nobody assigned them.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SELECT plan(11);

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
        'Alpha Academy', 'day', 'combined', 'LSK', 'active');

INSERT INTO public.students (id, student_id, school_id, first_name, last_name, grade_id, class_id)
VALUES
  ('aaaa0000-0000-0000-0000-000000000001', 'STU-ZM-LSK-0001-00001',
   '11111111-1111-1111-1111-111111111111', 'Alice', 'Alpha', 'grade_9', 'grade_9a'),
  ('aaaa0000-0000-0000-0000-000000000002', 'STU-ZM-LSK-0001-00002',
   '11111111-1111-1111-1111-111111111111', 'Amos', 'Banda', 'grade_9', 'grade_9a');

INSERT INTO public.school_grading_scales
  (id, school_id, scale_name, scale_type, grade_bands, pass_mark)
VALUES
  ('cccc0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'ECZ Secondary', 'letter',
   '[{"letter":"A","min":80,"max":100,"points":1},
     {"letter":"B","min":70,"max":79.99,"points":2},
     {"letter":"F","min":0,"max":69.99,"points":9}]'::jsonb,
   50);

INSERT INTO public.school_subjects
  (id, school_id, subject_code, subject_name, level_type, grading_scale_id)
VALUES
  ('bbbb0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'MATH', 'Mathematics', 'secondary', 'cccc0000-0000-0000-0000-000000000001');

-- The assignment that makes this teacher's marks legal.
--
-- `academic_year` must be the CURRENT calendar year as text, because
-- `teacher_teaches_subject()` (0074) compares against
-- `EXTRACT(YEAR FROM NOW())::TEXT` rather than taking a year parameter. Worth
-- knowing beyond this fixture: a school writing its year as '2026/2027' will
-- never match that predicate, so no teacher would pass the scope check. Noted
-- as a real latent issue rather than worked around here.
INSERT INTO public.teacher_assignments
  (school_id, teacher_user_id, scope, class_id, subject_id, academic_year, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'user_teacher_a', 'subject', 'grade_9a',
   'bbbb0000-0000-0000-0000-000000000001', EXTRACT(YEAR FROM NOW())::TEXT, TRUE);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_teacher_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "teacher", "slg": "alpha-academy"}
}';

-- ---------------------------------------------------------------------------
-- 1. A sheet saves every pupil, marked or not.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT saved_count FROM public.save_exam_marks(
     'grade_9a', 'MATH', 'Mathematics', EXTRACT(YEAR FROM NOW())::TEXT, 1, 100,
     '[{"student_id":"aaaa0000-0000-0000-0000-000000000001","marks_obtained":82},
       {"student_id":"aaaa0000-0000-0000-0000-000000000002","marks_obtained":null}]'::jsonb)),
  2,
  'both rows saved, including the unmarked pupil'
);

SELECT is(
  (SELECT graded_count FROM public.save_exam_marks(
     'grade_9a', 'MATH', 'Mathematics', EXTRACT(YEAR FROM NOW())::TEXT, 1, 100,
     '[{"student_id":"aaaa0000-0000-0000-0000-000000000001","marks_obtained":82},
       {"student_id":"aaaa0000-0000-0000-0000-000000000002","marks_obtained":null}]'::jsonb)),
  1,
  'saved and graded are reported separately — only the marked pupil was graded'
);

-- ---------------------------------------------------------------------------
-- 2. THE REASON 0108 EXISTS. The letter and its explanation land together.
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT grade_letter = 'A' AND grading_scale_version_id IS NOT NULL
     FROM public.exam_results
    WHERE student_id = 'aaaa0000-0000-0000-0000-000000000001'
      AND subject_code = 'MATH'),
  'the grade and the scale version that explains it are both present'
);

-- ---------------------------------------------------------------------------
-- 3. Unmarked is NULL, and asserts no explanation.
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT marks_obtained IS NULL
      AND grade_letter IS NULL
      AND grading_scale_version_id IS NULL
     FROM public.exam_results
    WHERE student_id = 'aaaa0000-0000-0000-0000-000000000002'),
  'an unmarked pupil is null, not zero, and claims no scale version'
);

-- ---------------------------------------------------------------------------
-- 4. Zero is a mark. This is the one that keeps a sick pupil off a fail list.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT public.save_exam_marks(
       'grade_9a', 'MATH', 'Mathematics', EXTRACT(YEAR FROM NOW())::TEXT, 1, 100,
       '[{"student_id":"aaaa0000-0000-0000-0000-000000000002","marks_obtained":0}]'::jsonb) $$,
  'a mark of zero can be entered'
);

SELECT is(
  (SELECT grade_letter FROM public.exam_results
    WHERE student_id = 'aaaa0000-0000-0000-0000-000000000002'),
  'F',
  'zero grades as F — a child who scored nothing is not a child who was not examined'
);

-- ---------------------------------------------------------------------------
-- 5. A correction replaces rather than accumulates.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.exam_results
    WHERE student_id = 'aaaa0000-0000-0000-0000-000000000001'
      AND subject_code = 'MATH'),
  1,
  're-saving corrects the one row rather than adding a contradictory second'
);

-- ---------------------------------------------------------------------------
-- 6. A mark above the paper total is a typing error.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT public.save_exam_marks(
       'grade_9a', 'MATH', 'Mathematics', EXTRACT(YEAR FROM NOW())::TEXT, 1, 100,
       '[{"student_id":"aaaa0000-0000-0000-0000-000000000001","marks_obtained":150}]'::jsonb) $$,
  '23514',
  NULL,
  'a mark above the paper total is refused'
);

-- ---------------------------------------------------------------------------
-- 7. Scope. A teacher marks what they were assigned and nothing else.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT public.save_exam_marks(
       'grade_9a', 'ENG', 'English', EXTRACT(YEAR FROM NOW())::TEXT, 1, 100,
       '[{"student_id":"aaaa0000-0000-0000-0000-000000000001","marks_obtained":50}]'::jsonb) $$,
  '42501',
  NULL,
  'a teacher cannot mark a subject nobody assigned them'
);

SELECT throws_ok(
  $$ SELECT public.publish_results(EXTRACT(YEAR FROM NOW())::TEXT, 1, 'grade_9a') $$,
  '42501',
  NULL,
  'a teacher cannot publish — publication is the head''s act'
);

-- ---------------------------------------------------------------------------
-- 8. Publication is the lock.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_principal_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "principal", "slg": "alpha-academy"}
}';
SELECT public.publish_results(EXTRACT(YEAR FROM NOW())::TEXT, 1, 'grade_9a');

SET LOCAL request.jwt.claims TO '{
  "sub": "user_teacher_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "teacher", "slg": "alpha-academy"}
}';

SELECT throws_ok(
  $$ SELECT public.save_exam_marks(
       'grade_9a', 'MATH', 'Mathematics', EXTRACT(YEAR FROM NOW())::TEXT, 1, 100,
       '[{"student_id":"aaaa0000-0000-0000-0000-000000000001","marks_obtained":99}]'::jsonb) $$,
  '42501',
  NULL,
  'a published sheet cannot be re-saved — a correction must be deliberate'
);

SELECT * FROM finish();
ROLLBACK;
