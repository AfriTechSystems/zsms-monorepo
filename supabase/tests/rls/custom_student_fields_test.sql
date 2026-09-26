-- ===========================================================================
-- Custom student fields — the sensitivity split is the whole point.
--
-- Spec: Official Documentation/07 Student and Parent Modules/STUDENTS.md
--       Official Documentation/01 Foundation Layer/COMPLIANCE.md
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- A custom-field system is easy to build and easy to build dangerously. The
-- dangerous version is one JSONB column: it works immediately, and it makes a
-- pupil's medical condition exactly as readable as their house colour, because
-- no policy can reach inside a JSON document.
--
-- So the assertions that matter most are about who reads what:
--
--   * a teacher reads house and CANNOT read medical notes;
--   * the accountant cannot read medical notes either — minimisation is a rule
--     about who, not only about what;
--   * an admin may set standard fields and NOT sensitive ones;
--   * a teacher reads nothing at all for a pupil they do not teach, matching the
--     pupil record those values hang off.
--
-- And the rest keep the data meaningful:
--
--   * a custom field cannot shadow a real column (no second date_of_birth);
--   * a select only holds one of its own options, so an import cannot invent a
--     fourth house;
--   * a typed field refuses the wrong type;
--   * a key is immutable once created, because imports match on it, while the
--     label is freely editable — which is why the two are separate columns.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SELECT plan(18);

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status) VALUES
 ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_school_a','Alpha Academy','day','combined','LSK','active'),
 ('22222222-2222-2222-2222-222222222222','ZM-NDL-0002','org_school_b','Beta School','day','combined','NDL','active');

INSERT INTO public.students (id, student_id, school_id, first_name, last_name, grade_id, class_id) VALUES
 ('aaaa0000-0000-0000-0000-000000000001','STU-ZM-LSK-0001-00001','11111111-1111-1111-1111-111111111111','Alice','Alpha','grade_7','grade_7a'),
 -- A pupil in a class the teacher below does NOT teach.
 ('aaaa0000-0000-0000-0000-000000000002','STU-ZM-LSK-0001-00002','11111111-1111-1111-1111-111111111111','Ann','Other','grade_8','grade_8b'),
 ('bbbb0000-0000-0000-0000-000000000001','STU-ZM-NDL-0002-00001','22222222-2222-2222-2222-222222222222','Bella','Beta','grade_7','grade_7a');

-- scope='class' requires a NULL subject_id (teacher_assignment_scope_shape).
INSERT INTO public.teacher_assignments
  (school_id, teacher_user_id, scope, class_id, subject_id, academic_year, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','user_tea_a','class','grade_7a',NULL,
   EXTRACT(YEAR FROM NOW())::TEXT,TRUE);

INSERT INTO public.school_custom_fields
  (id, school_id, field_key, label, field_type, options, sensitivity)
VALUES
 ('ccc00000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
  'house','House','select','["Red","Blue","Green"]'::jsonb,'standard'),
 ('ccc00000-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111',
  'medical_notes','Medical notes','text','[]'::jsonb,'sensitive'),
 ('ccc00000-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111',
  'bus_fee','Bus fee','number','[]'::jsonb,'standard'),
 ('ddd00000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
  'house','House','select','["Lion"]'::jsonb,'standard');

-- ---------------------------------------------------------------------------
-- Definition guardrails.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ INSERT INTO public.school_custom_fields (school_id, field_key, label, field_type)
     VALUES ('11111111-1111-1111-1111-111111111111','date_of_birth','DOB','date') $$,
  '23514', NULL,
  'a custom field cannot shadow a standard pupil column'
);

SELECT throws_ok(
  $$ INSERT INTO public.school_custom_fields (school_id, field_key, label, field_type)
     VALUES ('11111111-1111-1111-1111-111111111111','shirt','Shirt','select') $$,
  '23514', NULL,
  'a select field with no options is refused — nobody could fill it in'
);

SELECT throws_ok(
  $$ INSERT INTO public.school_custom_fields (school_id, field_key, label, field_type)
     VALUES ('11111111-1111-1111-1111-111111111111','Bad Key!','X','text') $$,
  '23514', NULL,
  'a key that is not snake_case is refused'
);

SELECT throws_ok(
  $$ UPDATE public.school_custom_fields SET field_key='house_colour'
     WHERE id='ccc00000-0000-0000-0000-000000000001' $$,
  '23001', NULL,
  'a field key cannot be renamed — imports and integrations match on it'
);

SELECT lives_ok(
  $$ UPDATE public.school_custom_fields SET label='House colour'
     WHERE id='ccc00000-0000-0000-0000-000000000001' $$,
  'a label can be renamed freely — which is why key and label are separate'
);

-- ---------------------------------------------------------------------------
-- Values. Admin holds students:write, so it holds standard custom fields.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub":"user_adm_a","role":"authenticated",
  "o":{"id":"org_school_a","rol":"admin","slg":"alpha-academy"}}';

SELECT lives_ok(
  $$ INSERT INTO public.student_custom_values (school_id, student_id, field_id, value_text)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'aaaa0000-0000-0000-0000-000000000001',
             'ccc00000-0000-0000-0000-000000000001','Blue') $$,
  'an admin can set a standard value'
);

SELECT lives_ok(
  $$ INSERT INTO public.student_custom_values (school_id, student_id, field_id, value_text)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'aaaa0000-0000-0000-0000-000000000002',
             'ccc00000-0000-0000-0000-000000000001','Red') $$,
  'and for a pupil in any class — admin is not class-scoped'
);

SELECT throws_ok(
  $$ UPDATE public.student_custom_values SET value_text='Purple'
     WHERE student_id='aaaa0000-0000-0000-0000-000000000001'
       AND field_id='ccc00000-0000-0000-0000-000000000001' $$,
  '23514', NULL,
  'a select refuses a value that is not one of its options'
);

SELECT throws_ok(
  $$ INSERT INTO public.student_custom_values (school_id, student_id, field_id, value_text)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'aaaa0000-0000-0000-0000-000000000001',
             'ccc00000-0000-0000-0000-000000000003','Yellow') $$,
  '23514', NULL,
  'a number field refuses text'
);

-- THE SPLIT, on the write side.
SELECT throws_ok(
  $$ INSERT INTO public.student_custom_values (school_id, student_id, field_id, value_text)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'aaaa0000-0000-0000-0000-000000000001',
             'ccc00000-0000-0000-0000-000000000002','Asthma') $$,
  '42501', NULL,
  'an admin cannot write a sensitive field'
);

SET LOCAL request.jwt.claims TO '{
  "sub":"user_prin_a","role":"authenticated",
  "o":{"id":"org_school_a","rol":"principal","slg":"alpha-academy"}}';

SELECT lives_ok(
  $$ INSERT INTO public.student_custom_values (school_id, student_id, field_id, value_text)
     VALUES ('11111111-1111-1111-1111-111111111111',
             'aaaa0000-0000-0000-0000-000000000001',
             'ccc00000-0000-0000-0000-000000000002','Asthma - inhaler in office') $$,
  'the principal can write a sensitive field'
);

SELECT is(
  (SELECT count(*)::int FROM public.student_custom_values
    WHERE field_id='ccc00000-0000-0000-0000-000000000002'),
  1,
  'the principal reads it back'
);

-- ---------------------------------------------------------------------------
-- THE SPLIT, on the read side. This is what a JSONB column could not do.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub":"user_tea_a","role":"authenticated",
  "o":{"id":"org_school_a","rol":"teacher","slg":"alpha-academy"}}';

SELECT is(
  (SELECT count(*)::int FROM public.student_custom_values
    WHERE student_id='aaaa0000-0000-0000-0000-000000000001'
      AND field_id='ccc00000-0000-0000-0000-000000000001'),
  1,
  'a teacher reads a standard field for a pupil they teach'
);

SELECT is(
  (SELECT count(*)::int FROM public.student_custom_values
    WHERE student_id='aaaa0000-0000-0000-0000-000000000002'),
  0,
  'a teacher reads nothing for a pupil in a class they do not teach'
);

SELECT is(
  (SELECT count(*)::int FROM public.student_custom_values
    WHERE field_id='ccc00000-0000-0000-0000-000000000002'),
  0,
  'a teacher CANNOT read a sensitive field — the reason this design exists'
);

SET LOCAL request.jwt.claims TO '{
  "sub":"user_acc_a","role":"authenticated",
  "o":{"id":"org_school_a","rol":"accountant","slg":"alpha-academy"}}';

SELECT is(
  (SELECT count(*)::int FROM public.student_custom_values
    WHERE field_id='ccc00000-0000-0000-0000-000000000002'),
  0,
  'the accountant cannot read medical data either — minimisation is about who'
);

-- ---------------------------------------------------------------------------
-- Tenancy.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub":"user_prin_b","role":"authenticated",
  "o":{"id":"org_school_b","rol":"principal","slg":"beta-school"}}';

SELECT throws_ok(
  $$ INSERT INTO public.student_custom_values (school_id, student_id, field_id, value_text)
     VALUES ('22222222-2222-2222-2222-222222222222',
             'bbbb0000-0000-0000-0000-000000000001',
             'ccc00000-0000-0000-0000-000000000001','Blue') $$,
  '23514', NULL,
  'a pupil cannot be attached to another school''s field definition'
);

SELECT is(
  (SELECT count(*)::int FROM public.student_custom_values
    WHERE school_id='11111111-1111-1111-1111-111111111111'),
  0,
  'another school''s custom values are invisible, not merely read-only'
);

SELECT * FROM finish();
ROLLBACK;
