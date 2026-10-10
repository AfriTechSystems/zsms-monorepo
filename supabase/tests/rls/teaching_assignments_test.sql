-- ===========================================================================
-- Teaching assignments — the table that decides which children a teacher sees.
--
-- Spec: Official Documentation/08 Staff Management/TEACHING_ASSIGNMENTS.md
--       Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-037
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- `teacher_assignments` does not look like a permissions table and is one.
-- `teacher_reaches_class()` reads it, and that predicate scopes the students a
-- teacher can select, the registers they can mark, and the marks they can
-- enter. A row written here widens somebody's reach into pupil records.
--
-- So the asymmetry matters more here than anywhere else in the product:
--
--   assignments:read   owner, principal, admin   (management_read_teacher_assignments)
--   assignments:write  owner, principal ONLY     (management_write_teacher_assignments)
--
-- Seeing the map is administration. Redrawing it is not. The final two
-- assertions close the obvious attack: a teacher writing their own row.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

-- pgTAP lives in the `extensions` schema (migration 0001), never in `public`. A
-- direct connection — which is what `pg_prove` makes, as `postgres` — has a
-- search_path of `"$user", public`, so `plan()` and `is()` would not resolve and this
-- suite would fail on its first line. `extra_search_path` in config.toml only covers
-- PostgREST, not psql or pg_prove.
--
-- `public` stays FIRST so every unqualified table name resolves exactly as before;
-- `extensions` is appended only so the assertion functions are found.
SET search_path TO public, extensions;

SELECT plan(13);

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
   'Alpha Academy', 'day', 'combined', 'LSK', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'ZM-NDL-0002', 'org_school_b',
   'Beta School',   'day', 'combined', 'NDL', 'active');

INSERT INTO public.school_subjects (id, school_id, subject_code, subject_name, level_type)
VALUES ('dddd0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'MAT', 'Mathematics', 'secondary');

INSERT INTO public.students (id, student_id, school_id, first_name, last_name, grade_id, class_id)
VALUES ('aaaa0000-0000-0000-0000-000000000001', 'STU-ZM-LSK-0001-00001',
        '11111111-1111-1111-1111-111111111111', 'Alice', 'Alpha', 'grade_7', 'grade_7a');

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_claims JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims::TEXT, TRUE);
END;
$$;

-- Bare role names, because that is the form Clerk's v2 token sends and `0105`
-- normalises. Testing the qualified form would test a token ZSMS never receives.
CREATE OR REPLACE FUNCTION pg_temp.who(p_org TEXT, p_role TEXT, p_sub TEXT)
RETURNS JSONB LANGUAGE SQL AS $$
  SELECT json_build_object('sub', p_sub,
    'o', json_build_object('id', p_org, 'slg', 'x', 'rol', p_role))::JSONB;
$$;

CREATE OR REPLACE FUNCTION pg_temp.assign(p_teacher TEXT, p_scope TEXT, p_class TEXT, p_subject UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.teacher_assignments
    (school_id, teacher_user_id, scope, class_id, subject_id, academic_year)
  VALUES ('11111111-1111-1111-1111-111111111111', p_teacher, p_scope, p_class, p_subject, '2026');
END;
$$;

SET LOCAL ROLE authenticated;

-- ===========================================================================
-- SECTION 1 — who may redraw the map
-- ===========================================================================

SELECT pg_temp.act_as(pg_temp.who('org_school_a', 'owner', 'user_owner_a'));
SELECT lives_ok(
  $$SELECT pg_temp.assign('user_t1', 'class', 'grade_7a', NULL)$$,
  'WRITE the owner can assign a teacher to a class');

SELECT pg_temp.act_as(pg_temp.who('org_school_a', 'principal', 'user_principal_a'));
SELECT lives_ok(
  $$SELECT pg_temp.assign('user_t2', 'subject', 'grade_7a', 'dddd0000-0000-0000-0000-000000000001')$$,
  'WRITE the principal can assign a teacher to a subject');

-- An administrator reads the map and cannot redraw it. This is the assertion
-- `lib/roles.ts` transcribes, and the one most likely to drift.
SELECT pg_temp.act_as(pg_temp.who('org_school_a', 'admin', 'user_admin_a'));
SELECT throws_ok(
  $$SELECT pg_temp.assign('user_t3', 'class', 'grade_8a', NULL)$$,
  '42501', NULL,
  'ATTACK an administrator CANNOT assign — seeing the map is not redrawing it');

-- The attack this table exists to refuse.
SELECT pg_temp.act_as(pg_temp.who('org_school_a', 'teacher', 'user_t1'));
SELECT throws_ok(
  $$SELECT pg_temp.assign('user_t1', 'class', 'grade_8a', NULL)$$,
  '42501', NULL,
  'ATTACK a teacher CANNOT widen their own reach by assigning themselves');

SELECT throws_ok(
  $$DELETE FROM public.teacher_assignments WHERE teacher_user_id = 'user_t2'$$,
  '42501', NULL,
  'ATTACK a teacher cannot remove a colleague''s assignment');

SELECT pg_temp.act_as(pg_temp.who('org_school_b', 'owner', 'user_owner_b'));
SELECT throws_ok(
  $$SELECT pg_temp.assign('user_planted', 'class', 'grade_7a', NULL)$$,
  '42501', NULL,
  'ATTACK school B cannot assign a teacher into school A');

-- ===========================================================================
-- SECTION 2 — who may see it
-- ===========================================================================

SELECT pg_temp.act_as(pg_temp.who('org_school_a', 'admin', 'user_admin_a'));
SELECT is((SELECT count(*)::INT FROM public.teacher_assignments), 2,
  'READ an administrator sees the school''s assignments');

SELECT pg_temp.act_as(pg_temp.who('org_school_a', 'accountant', 'user_acct_a'));
SELECT is((SELECT count(*)::INT FROM public.teacher_assignments), 0,
  'READ an accountant sees no assignments — teaching scope is not their business');

-- A teacher sees their own row and nobody else's, through
-- `teacher_read_own_teacher_assignments`.
SELECT pg_temp.act_as(pg_temp.who('org_school_a', 'teacher', 'user_t1'));
SELECT is((SELECT count(*)::INT FROM public.teacher_assignments), 1,
  'READ a teacher sees exactly their own assignment');

-- ===========================================================================
-- SECTION 3 — the predicate everything downstream depends on
-- ===========================================================================

SELECT ok(public.teacher_reaches_class('grade_7a'),
  'SCOPE an assigned teacher reaches their class');

SELECT ok(NOT public.teacher_reaches_class('grade_8a'),
  'SCOPE the same teacher does NOT reach a class they hold nothing in');

-- ===========================================================================
-- SECTION 4 — the two shapes cannot be mixed
--
-- ADR-037 admits `class` (whole class, no subject) and `subject` (one subject,
-- subject required). A row that mixes them would make `teacher_reaches_class()`
-- answer a question nobody asked.
-- ===========================================================================

SELECT pg_temp.act_as(pg_temp.who('org_school_a', 'owner', 'user_owner_a'));

SELECT throws_ok(
  $$SELECT pg_temp.assign('user_t4', 'class', 'grade_7a', 'dddd0000-0000-0000-0000-000000000001')$$,
  '23514', NULL,
  'CONSTRAINT a class assignment carrying a subject is refused');

SELECT throws_ok(
  $$SELECT pg_temp.assign('user_t5', 'subject', 'grade_7a', NULL)$$,
  '23514', NULL,
  'CONSTRAINT a subject assignment with no subject is refused');

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
