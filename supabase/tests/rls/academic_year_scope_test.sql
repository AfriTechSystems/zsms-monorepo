-- ===========================================================================
-- Academic-year matching in teaching scope — regression suite for 0109.
--
-- Spec: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-037, ADR-040
--       Official Documentation/01 Foundation Layer/RLS.md
--
-- WHAT THIS PROTECTS
--
-- `teacher_reaches_class()` and `teacher_teaches_subject()` both compared
-- `teacher_assignments.academic_year` to `EXTRACT(YEAR FROM NOW())::TEXT`. The
-- column is TEXT precisely so a school can write its year the way it writes it,
-- and Zambian schools write both '2026' and '2026/2027'. For a school using the
-- second form the comparison was '2026/2027' = '2026' — false for every
-- assignment, every teacher, all year.
--
-- The result was total, not partial: no teacher could enter a mark, and no
-- teacher could mark a register either. Both functions carried the same line.
--
-- These assertions exist so the bare-year assumption cannot come back. The one
-- that would have caught it originally is the straddling-label case — the
-- previous marks fixture only passed because it was written with a bare year,
-- which is the tell that got this found.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SELECT plan(9);

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_school_a',
        'Alpha Academy','day','combined','LSK','active');

INSERT INTO public.students (id, student_id, school_id, first_name, last_name, grade_id, class_id)
VALUES ('aaaa0000-0000-0000-0000-000000000001','STU-ZM-LSK-0001-00001',
        '11111111-1111-1111-1111-111111111111','Alice','Alpha','grade_9','grade_9a');

INSERT INTO public.school_grading_scales
  (id, school_id, scale_name, scale_type, grade_bands, pass_mark)
VALUES ('cccc0000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'ECZ','letter',
        '[{"letter":"A","min":80,"max":100,"points":1},
          {"letter":"F","min":0,"max":79.99,"points":9}]'::jsonb, 50);

INSERT INTO public.school_subjects
  (id, school_id, subject_code, subject_name, level_type, grading_scale_id)
VALUES ('bbbb0000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'MATH','Mathematics','secondary','cccc0000-0000-0000-0000-000000000001');

-- THE STRADDLING FORM. This is the value that used to lock everyone out.
INSERT INTO public.teacher_assignments
  (school_id, teacher_user_id, scope, class_id, subject_id, academic_year, is_active)
VALUES ('11111111-1111-1111-1111-111111111111','user_teacher_a','subject','grade_9a',
        'bbbb0000-0000-0000-0000-000000000001',
        EXTRACT(YEAR FROM NOW())::TEXT || '/' || (EXTRACT(YEAR FROM NOW())+1)::TEXT,
        TRUE);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub":"user_teacher_a","role":"authenticated",
  "o":{"id":"org_school_a","rol":"teacher","slg":"alpha-academy"}}';

-- ---------------------------------------------------------------------------
-- The label helper.
-- ---------------------------------------------------------------------------
SELECT ok(
  public.academic_year_is_current(
    EXTRACT(YEAR FROM NOW())::TEXT || '/' || (EXTRACT(YEAR FROM NOW())+1)::TEXT),
  'a straddling year label is current'
);

SELECT ok(
  public.academic_year_is_current(EXTRACT(YEAR FROM NOW())::TEXT),
  'a bare year label is still current'
);

SELECT ok(
  public.academic_year_is_current(
    (EXTRACT(YEAR FROM NOW())-1)::TEXT || '/' || EXTRACT(YEAR FROM NOW())::TEXT),
  'the closing half of last year''s straddling label is also current'
);

SELECT ok(
  NOT public.academic_year_is_current('2019/2020'),
  'a year long past is not current'
);

SELECT ok(
  NOT public.academic_year_is_current(NULL),
  'a null year is not current rather than an error'
);

SELECT ok(
  public.academic_years_match('2026', '2026/2027'),
  'a bare year and a straddling label that contains it are the same year'
);

-- ---------------------------------------------------------------------------
-- THE REGRESSION. Both scope functions, which both carried the bug.
-- ---------------------------------------------------------------------------
SELECT ok(
  public.teacher_teaches_subject('grade_9a','MATH'),
  'a straddling-year assignment grants marks scope'
);

SELECT ok(
  public.teacher_reaches_class('grade_9a'),
  'and attendance scope, which had the identical bug'
);

SELECT is(
  (SELECT saved_count FROM public.save_exam_marks(
     'grade_9a','MATH','Mathematics',
     EXTRACT(YEAR FROM NOW())::TEXT || '/' || (EXTRACT(YEAR FROM NOW())+1)::TEXT,
     1, 100,
     '[{"student_id":"aaaa0000-0000-0000-0000-000000000001","marks_obtained":85}]'::jsonb)),
  1,
  'a teacher at a school using 2026/2027 can actually enter a mark'
);

SELECT * FROM finish();
ROLLBACK;
