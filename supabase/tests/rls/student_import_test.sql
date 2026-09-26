-- ===========================================================================
-- Bulk pupil import — atomicity, and identifiers that are never reused.
--
-- Spec: Official Documentation/07 Student and Parent Modules/STUDENTS.md
--       Official Documentation/01 Foundation Layer/CONVENTIONS.md — identifiers
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- Two claims carry the feature, and both are easy to believe without checking:
--
--   1. **All or nothing.** An import that fails on row 251 of 400 leaves a
--      half-filled roll, and the natural recovery — run it again — duplicates
--      the 250 that landed. So the suite deliberately puts a bad value in the
--      LAST row and then asserts the FIRST row is gone.
--
--   2. **An identifier is never reused.** `nextStudentId()` in the application
--      derives the sequence from `count(*)`, so a soft delete lowers the count
--      and the next pupil is minted with a withdrawn pupil's identifier —
--      `STU-…-00042` then names two children, one of them only in history, which
--      prohibition 8 guarantees is still there. `next_student_sequence()` takes
--      MAX of the suffix instead. The fixture soft-deletes pupil 00007 and
--      asserts the next is 00008, which a count-based implementation fails.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SELECT plan(9);

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_school_a',
        'Alpha Academy','day','combined','LSK','active');

INSERT INTO public.school_grade_levels
  (school_id, level_id, display_name, level_order, level_type, examination_type, is_active)
VALUES ('11111111-1111-1111-1111-111111111111','grade_7','Grade 7',7,'primary','internal',TRUE);

INSERT INTO public.school_custom_fields
  (id, school_id, field_key, label, field_type, options, sensitivity)
VALUES ('ccc00000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'house','House','select','["Red","Blue"]'::jsonb,'standard');

-- A WITHDRAWN pupil holding sequence 00007. The whole point of the first
-- assertion: a count of live rows would say the next sequence is 1.
INSERT INTO public.students
  (id, student_id, school_id, first_name, last_name, grade_id, class_id, is_deleted, deleted_at)
VALUES ('aaaa0000-0000-0000-0000-000000000007','STU-ZM-LSK-0001-00007',
        '11111111-1111-1111-1111-111111111111','Gone','Pupil','grade_7','grade_7a',TRUE,NOW());

SELECT is(
  public.next_student_sequence('11111111-1111-1111-1111-111111111111'),
  8,
  'next sequence is 8 from MAX of the suffix, not 1 from a count of live rows'
);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub":"user_prin_a","role":"authenticated",
  "o":{"id":"org_school_a","rol":"principal","slg":"alpha-academy"}}';

SELECT is(
  (SELECT created_count FROM public.import_students($json$[
    {"student":{"first_name":"Ann","last_name":"Banda","grade_id":"grade_7","class_id":"grade_7a"},
     "custom":[{"field_id":"ccc00000-0000-0000-0000-000000000001","value_text":"Red"}]},
    {"student":{"first_name":"Ben","last_name":"Chanda","grade_id":"grade_7","class_id":"grade_7a"},
     "custom":[]}
  ]$json$::jsonb)),
  2,
  'two pupils imported in one call'
);

SELECT is(
  (SELECT student_id FROM public.students WHERE first_name='Ann'),
  'STU-ZM-LSK-0001-00008',
  'identifiers continue past the withdrawn pupil rather than reusing its number'
);

SELECT is(
  (SELECT student_id FROM public.students WHERE first_name='Ben'),
  'STU-ZM-LSK-0001-00009',
  'and increment within a single import'
);

SELECT is(
  (SELECT value_text FROM public.student_custom_values v
     JOIN public.students s ON s.id = v.student_id
    WHERE s.first_name='Ann'),
  'Red',
  'the custom field value was written together with the pupil'
);

-- ---------------------------------------------------------------------------
-- ATOMICITY. The bad value is in the SECOND row; the FIRST must not survive.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT public.import_students($j$[
       {"student":{"first_name":"Good","last_name":"Row","grade_id":"grade_7","class_id":"grade_7a"},
        "custom":[]},
       {"student":{"first_name":"Bad","last_name":"Row","grade_id":"grade_7","class_id":"grade_7a"},
        "custom":[{"field_id":"ccc00000-0000-0000-0000-000000000001","value_text":"Purple"}]}
     ]$j$::jsonb) $$,
  '23514',
  NULL,
  'a value outside a select''s options aborts the import'
);

SELECT is(
  (SELECT count(*)::int FROM public.students WHERE first_name IN ('Good','Bad')),
  0,
  'ATOMICITY: the good row did not survive the failed import'
);

SELECT is(
  (SELECT count(*)::int FROM public.students
    WHERE school_id='11111111-1111-1111-1111-111111111111' AND is_deleted = FALSE),
  2,
  'the roll still holds only the two pupils that succeeded'
);

-- ---------------------------------------------------------------------------
-- Import is a pupil-record write, and follows `students:write`.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub":"user_tea_a","role":"authenticated",
  "o":{"id":"org_school_a","rol":"teacher","slg":"alpha-academy"}}';

SELECT throws_ok(
  $$ SELECT public.import_students($j$[
       {"student":{"first_name":"No","last_name":"Way","grade_id":"grade_7","class_id":"grade_7a"},
        "custom":[]}
     ]$j$::jsonb) $$,
  '42501',
  NULL,
  'a teacher cannot import pupils'
);

SELECT * FROM finish();
ROLLBACK;
