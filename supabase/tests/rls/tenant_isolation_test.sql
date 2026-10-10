-- ===========================================================================
-- Multi-tenant isolation — the Phase 1 gate.
--
-- Spec: Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--       Official Documentation/01 Foundation Layer/RLS.md
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- Tests that confirm School A can read School A prove almost nothing: a table
-- with RLS disabled entirely passes every one of them. The assertions that
-- carry weight are the ones where School A actively attempts to read, modify,
-- enrol into, or delete School B's records and is refused. Those are the
-- majority of what follows.
--
-- How identity is simulated: the helpers in migration 0001 read auth.jwt(),
-- which resolves to current_setting('request.jwt.claims'). Setting that GUC and
-- switching to the `authenticated` role reproduces exactly what PostgREST does
-- with a real Clerk token — the same code path, not an approximation.
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

-- An explicit plan, not no_plan(): if a section stops executing, the count
-- mismatch fails the run. A security suite that silently runs fewer assertions
-- than intended is worse than one that fails loudly.
SELECT plan(73);

-- ---------------------------------------------------------------------------
-- Fixtures. Seeded as the superuser, which bypasses RLS — this is setup, not
-- an assertion. Fixed UUIDs keep the assertions below readable.
-- ---------------------------------------------------------------------------

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
   'Alpha Academy', 'day', 'combined', 'LSK', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'ZM-NDL-0002', 'org_school_b',
   'Beta School',   'day', 'combined', 'NDL', 'active');

INSERT INTO public.students
  (id, student_id, school_id, first_name, last_name, grade_id, class_id, clerk_user_id)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'STU-ZM-LSK-0001-00001',
   '11111111-1111-1111-1111-111111111111', 'Alice', 'Alpha', 'grade_7', 'grade_7a', 'user_student_a'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'STU-ZM-LSK-0001-00002',
   '11111111-1111-1111-1111-111111111111', 'Amos',  'Alpha', 'grade_8', 'grade_8a', NULL),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'STU-ZM-LSK-0001-00003',
   '11111111-1111-1111-1111-111111111111', 'Bertha','Alpha', 'grade_9', 'grade_9b', NULL),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'STU-ZM-NDL-0002-00001',
   '22222222-2222-2222-2222-222222222222', 'Bella', 'Beta',  'grade_7', 'grade_7a', NULL);

INSERT INTO public.staff_members
  (id, school_id, clerk_user_id, first_name, last_name, employment_type)
VALUES
  ('aaaaaaaa-1111-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'user_teacher_a', 'Tendai', 'Teacher', 'full_time'),
  ('aaaaaaaa-1111-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'user_teacher_subject', 'Mutale', 'Subject', 'full_time'),
  ('aaaaaaaa-1111-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'user_teacher_both', 'Chanda', 'Both', 'full_time'),
  ('bbbbbbbb-1111-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'user_teacher_b', 'Bwalya', 'Teacher', 'full_time');

INSERT INTO public.school_subjects
  (id, school_id, subject_code, subject_name, level_type, is_core)
VALUES
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'MAT', 'Mathematics', 'secondary', TRUE);

INSERT INTO public.class_subjects
  (school_id, class_id, subject_id, academic_year)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'grade_8a',
   'dddddddd-0000-0000-0000-000000000001', EXTRACT(YEAR FROM NOW())::TEXT);

-- The three teacher shapes ADR-037 exists to express, all at one school and all
-- resolved by the same predicate:
--   teacher_a       — scope 'class'   on grade_7a          (primary model)
--   teacher_subject — scope 'subject' on grade_8a only     (secondary model)
--   teacher_both    — scope 'class' on grade_9b AND
--                     scope 'subject' on grade_8a          (mixed)
INSERT INTO public.teacher_assignments
  (school_id, teacher_user_id, scope, class_id, subject_id, academic_year)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'user_teacher_a',
   'class',   'grade_7a', NULL, EXTRACT(YEAR FROM NOW())::TEXT),
  ('11111111-1111-1111-1111-111111111111', 'user_teacher_subject',
   'subject', 'grade_8a', 'dddddddd-0000-0000-0000-000000000001', EXTRACT(YEAR FROM NOW())::TEXT),
  ('11111111-1111-1111-1111-111111111111', 'user_teacher_both',
   'class',   'grade_9b', NULL, EXTRACT(YEAR FROM NOW())::TEXT),
  ('11111111-1111-1111-1111-111111111111', 'user_teacher_both',
   'subject', 'grade_8a', 'dddddddd-0000-0000-0000-000000000001', EXTRACT(YEAR FROM NOW())::TEXT);

INSERT INTO public.parents (id, clerk_user_id, phone_e164, full_name)
VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'user_parent_a', '+260977000001', 'Parent Alpha'),
  ('cccccccc-0000-0000-0000-000000000002', 'user_parent_b', '+260977000002', 'Parent Beta');

INSERT INTO public.student_parent_links
  (student_id, parent_id, parent_user_id, relationship, is_active)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001',
   'user_parent_a', 'mother', TRUE),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002',
   'user_parent_b', 'father', TRUE);

INSERT INTO public.staff_permission_grants
  (school_id, grantee_user_id, grantor_user_id, module, action, reason)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'user_teacher_a', 'user_owner_a',
   'students', 'write', 'Covering enrolment while the registrar is on leave');

-- ---------------------------------------------------------------------------
-- Identity helper. Mirrors what PostgREST sets per request.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_claims JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims::TEXT, TRUE);
END;
$$;

-- Runs a write and returns the number of rows it affected.
--
-- Needed because PostgreSQL rejects a data-modifying CTE anywhere but the top
-- level, so `is((WITH x AS (UPDATE ...) SELECT count(*) FROM x), 0, ...)` is a
-- syntax error rather than a test. SECURITY INVOKER is essential: the statement
-- must execute as the role under test, so RLS applies exactly as it would to
-- that user's own query.
CREATE OR REPLACE FUNCTION pg_temp.rows_affected(p_sql TEXT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.owner_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_owner_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:owner"}}'::JSONB;
$$;
CREATE OR REPLACE FUNCTION pg_temp.owner_b() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_owner_b","o":{"id":"org_school_b","slg":"beta-school","rol":"org:owner"}}'::JSONB;
$$;
CREATE OR REPLACE FUNCTION pg_temp.teacher_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_teacher_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:teacher"}}'::JSONB;
$$;
CREATE OR REPLACE FUNCTION pg_temp.teacher_subject() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_teacher_subject","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:teacher"}}'::JSONB;
$$;
CREATE OR REPLACE FUNCTION pg_temp.teacher_both() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_teacher_both","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:teacher"}}'::JSONB;
$$;
CREATE OR REPLACE FUNCTION pg_temp.parent_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_parent_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:parent"}}'::JSONB;
$$;
CREATE OR REPLACE FUNCTION pg_temp.parent_b() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_parent_b","o":{"id":"org_school_b","slg":"beta-school","rol":"org:parent"}}'::JSONB;
$$;
CREATE OR REPLACE FUNCTION pg_temp.student_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_student_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:student"}}'::JSONB;
$$;
CREATE OR REPLACE FUNCTION pg_temp.afritech_admin() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_afritech","o":{"id":"org_afritech","slg":"afritech-systems-admin","rol":"org:owner"}}'::JSONB;
$$;

-- ===========================================================================
-- SECTION 0 — the boundary is actually switched on
-- ===========================================================================

SELECT ok(
  (SELECT bool_and(relrowsecurity AND relforcerowsecurity)
   FROM pg_class
   WHERE relname IN ('schools','students','parents','student_parent_links',
                     'staff_members','staff_requests','class_subjects','teacher_assignments',
                     'school_permissions','staff_permission_grants')
     AND relnamespace = 'public'::regnamespace),
  'every core table has RLS both ENABLED and FORCED'
);

SELECT is(
  (SELECT count(*)::INT FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'students' AND cmd = 'DELETE'),
  0,
  'students has NO DELETE policy — hard delete is impossible, not merely discouraged'
);

SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'students'
     AND grantee = 'authenticated' AND privilege_type = 'DELETE'),
  0,
  'authenticated holds no DELETE privilege on students'
);

SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND grantee = 'anon'
     AND table_name IN ('schools','students','parents','staff_members')),
  0,
  'anon holds no privilege of any kind on the core tables'
);

-- ===========================================================================
-- SECTION 1 — School A owner. Baseline, then the attacks.
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.owner_a());

-- Baseline: the boundary is not simply closed to everyone.
SELECT is((SELECT count(*)::INT FROM public.students), 3,
  'BASELINE owner A sees exactly their own 3 students');
SELECT is((SELECT count(*)::INT FROM public.schools), 1,
  'BASELINE owner A sees exactly 1 school row');
SELECT is((SELECT school_id FROM public.schools), 'ZM-LSK-0001',
  'BASELINE the school owner A sees is their own');

-- --- READ attacks -----------------------------------------------------------

SELECT is(
  (SELECT count(*)::INT FROM public.students
   WHERE school_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'ATTACK owner A filtering explicitly for school B students gets nothing'
);

SELECT is(
  (SELECT count(*)::INT FROM public.students
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  0,
  'ATTACK owner A addressing a known school B student UUID directly gets nothing'
);

SELECT is(
  (SELECT count(*)::INT FROM public.students
   WHERE student_id = 'STU-ZM-NDL-0002-00001'),
  0,
  'ATTACK owner A addressing a school B student by human-readable ID gets nothing'
);

SELECT is(
  (SELECT count(*)::INT FROM public.schools
   WHERE clerk_org_id = 'org_school_b'),
  0,
  'ATTACK owner A cannot read school B''s school record'
);

SELECT is(
  (SELECT count(*)::INT FROM public.staff_members
   WHERE school_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'ATTACK owner A cannot read school B staff'
);

SELECT is(
  (SELECT count(*)::INT FROM public.teacher_assignments
   WHERE school_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'ATTACK owner A cannot read school B teaching assignments'
);

SELECT is(
  (SELECT count(*)::INT FROM public.student_parent_links
   WHERE student_id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  0,
  'ATTACK owner A cannot read school B parent links'
);

SELECT is(
  (SELECT count(*)::INT FROM public.parents
   WHERE clerk_user_id = 'user_parent_b'),
  0,
  'ATTACK owner A cannot read a parent linked only to school B'
);

SELECT is(
  (SELECT count(*)::INT FROM public.staff_permission_grants
   WHERE school_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'ATTACK owner A cannot read school B permission grants'
);

-- A join is a favourite way around a naive filter. It must not be one here.
SELECT is(
  (SELECT count(*)::INT
   FROM public.students s
   JOIN public.schools sc ON sc.id = s.school_id
   WHERE sc.clerk_org_id = 'org_school_b'),
  0,
  'ATTACK owner A cannot reach school B students by joining through schools'
);

-- Aggregates leak counts even when rows stay hidden, if the boundary is wrong.
SELECT is(
  (SELECT count(*)::INT FROM public.students WHERE grade_id = 'grade_7'),
  1,
  'ATTACK a cross-school aggregate counts only school A''s grade_7 student, not school B''s'
);

-- --- WRITE attacks ----------------------------------------------------------

SELECT is(
  pg_temp.rows_affected($$UPDATE public.students SET last_name = 'Hijacked'
     WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'$$),
  0,
  'ATTACK owner A UPDATE of a school B student affects 0 rows'
);

SELECT is(
  pg_temp.rows_affected($$UPDATE public.students SET is_deleted = TRUE
     WHERE school_id = '22222222-2222-2222-2222-222222222222'$$),
  0,
  'ATTACK owner A cannot soft-delete school B students'
);

SELECT is(
  pg_temp.rows_affected($$UPDATE public.schools SET name = 'Seized'
     WHERE clerk_org_id = 'org_school_b'$$),
  0,
  'ATTACK owner A cannot rename school B'
);

SELECT is(
  pg_temp.rows_affected($$UPDATE public.staff_members SET is_active = FALSE
     WHERE school_id = '22222222-2222-2222-2222-222222222222'$$),
  0,
  'ATTACK owner A cannot deactivate school B staff'
);

-- Writing INTO another tenant must be refused outright, not silently dropped.
SELECT throws_ok(
  $$INSERT INTO public.students
      (student_id, school_id, first_name, last_name, grade_id, class_id)
    VALUES ('STU-ZM-NDL-0002-09999', '22222222-2222-2222-2222-222222222222',
            'Planted', 'Record', 'grade_7', 'grade_7a')$$,
  '42501',
  NULL,
  'ATTACK owner A enrolling a student INTO school B is rejected (42501)'
);

SELECT throws_ok(
  $$INSERT INTO public.staff_members
      (school_id, clerk_user_id, first_name, last_name)
    VALUES ('22222222-2222-2222-2222-222222222222', 'user_planted', 'Planted', 'Staff')$$,
  '42501',
  NULL,
  'ATTACK owner A adding staff INTO school B is rejected (42501)'
);

SELECT throws_ok(
  $$INSERT INTO public.staff_permission_grants
      (school_id, grantee_user_id, grantor_user_id, module, action, reason)
    VALUES ('22222222-2222-2222-2222-222222222222', 'user_owner_a', 'user_owner_a',
            'students', 'write', 'privilege escalation attempt')$$,
  '42501',
  NULL,
  'ATTACK owner A granting themselves permissions at school B is rejected (42501)'
);

-- Forging the grantor is an audit-trail attack, not a tenancy one.
SELECT throws_ok(
  $$INSERT INTO public.staff_permission_grants
      (school_id, grantee_user_id, grantor_user_id, module, action, reason)
    VALUES ('11111111-1111-1111-1111-111111111111', 'user_owner_a', 'user_someone_else',
            'students', 'write', 'forged grantor')$$,
  '42501',
  NULL,
  'ATTACK owner A cannot attribute a grant they issued to another grantor'
);

-- Hard deletes are impossible even inside one's own tenant.
SELECT throws_ok(
  $$DELETE FROM public.students WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501',
  NULL,
  'ATTACK owner A cannot hard-delete even their OWN student (prohibition 8)'
);

-- Moving one's own record into another tenant is the subtlest write attack, and
-- it fails differently from the others. USING passes — the row IS visible to
-- this caller — so the statement is not filtered to zero rows. It is WITH CHECK
-- that rejects the post-update row, and that raises 42501. An `is(..., 0)`
-- assertion here would be testing for the wrong failure mode entirely.
SELECT throws_ok(
  $$UPDATE public.students
      SET school_id = '22222222-2222-2222-2222-222222222222'
      WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501',
  NULL,
  'ATTACK owner A cannot reassign their own student INTO school B'
);

-- Confirm the row really did not move.
RESET ROLE;
SELECT is(
  (SELECT school_id FROM public.students WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111'::UUID,
  'VERIFY the student remains at school A after the reassignment attempt'
);

-- ===========================================================================
-- SECTION 2 — the mirror image. School B must be equally confined.
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.owner_b());

SELECT is((SELECT count(*)::INT FROM public.students), 1,
  'BASELINE owner B sees exactly their own 1 student');

SELECT is(
  (SELECT count(*)::INT FROM public.students
   WHERE school_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'ATTACK owner B cannot read school A students — isolation is symmetric'
);

SELECT is(
  (SELECT count(*)::INT FROM public.staff_permission_grants),
  0,
  'ATTACK owner B cannot see school A''s permission grants'
);

SELECT is(
  pg_temp.rows_affected($$UPDATE public.students SET last_name = 'Hijacked'
     WHERE school_id = '11111111-1111-1111-1111-111111111111'$$),
  0,
  'ATTACK owner B cannot modify school A students'
);

RESET ROLE;

-- ===========================================================================
-- SECTION 3 — teachers are confined WITHIN their own school too
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.teacher_a());

SELECT is(
  (SELECT count(*)::INT FROM public.students),
  1,
  'BASELINE teacher A sees only the 1 student in their assigned class'
);

SELECT is(
  (SELECT first_name FROM public.students),
  'Alice',
  'BASELINE the visible student is the one in grade_7a'
);

SELECT is(
  (SELECT count(*)::INT FROM public.students
   WHERE class_id = 'grade_8a'),
  0,
  'ATTACK teacher A cannot read a student in an unassigned class at their OWN school'
);

SELECT is(
  (SELECT count(*)::INT FROM public.students
   WHERE school_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'ATTACK teacher A cannot read school B students'
);

SELECT is(
  (SELECT count(*)::INT FROM public.staff_members
   WHERE school_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'ATTACK teacher A cannot read school B staff'
);

-- The grant system must widen access only where it was granted.
SELECT ok(
  has_permission_grant('students', 'write'),
  'GRANT teacher A holds the students:write grant issued to them'
);

SELECT ok(
  NOT has_permission_grant('fees', 'write'),
  'GRANT teacher A does NOT hold a fees:write grant they were never given'
);

SELECT throws_ok(
  $$INSERT INTO public.students
      (student_id, school_id, first_name, last_name, grade_id, class_id)
    VALUES ('STU-ZM-NDL-0002-08888', '22222222-2222-2222-2222-222222222222',
            'Planted', 'ByTeacher', 'grade_7', 'grade_7a')$$,
  '42501',
  NULL,
  'ATTACK a students:write grant at school A does NOT permit writing into school B'
);

RESET ROLE;

-- ===========================================================================
-- SECTION 3B — the scope-based teaching model (ADR-037)
--
-- The point of the model is that one predicate covers a primary school, a
-- secondary school, and the mixed case without branching on school type. These
-- assertions check both scopes reach what they should, and — the ones that
-- matter — that neither scope reaches further than it should.
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.teacher_subject());

SELECT is(
  (SELECT count(*)::INT FROM public.students),
  1,
  'SCOPE subject-teacher sees exactly the 1 student in the class they teach'
);

SELECT is(
  (SELECT first_name FROM public.students),
  'Amos',
  'SCOPE the visible student is the one in grade_8a, the class they teach'
);

-- The assertion the model exists for.
SELECT is(
  (SELECT count(*)::INT FROM public.students WHERE class_id = 'grade_7a'),
  0,
  'ATTACK subject-teacher CANNOT see students in a class they do not teach'
);

SELECT is(
  (SELECT count(*)::INT FROM public.students WHERE class_id = 'grade_9b'),
  0,
  'ATTACK subject-teacher cannot see a class owned by another teacher at scope=class'
);

SELECT ok(
  teacher_reaches_class('grade_8a'),
  'SCOPE teacher_reaches_class is TRUE for the class they hold a subject in'
);

SELECT ok(
  NOT teacher_reaches_class('grade_7a'),
  'SCOPE teacher_reaches_class is FALSE for a class they hold nothing in'
);

-- A teacher who could staff themselves could grant themselves any class's
-- students, so the write policy — not just the read policy — is load-bearing.
SELECT throws_ok(
  $$INSERT INTO public.teacher_assignments
      (school_id, teacher_user_id, scope, class_id, subject_id, academic_year)
    VALUES ('11111111-1111-1111-1111-111111111111', 'user_teacher_subject',
            'class', 'grade_7a', NULL, EXTRACT(YEAR FROM NOW())::TEXT)$$,
  '42501',
  NULL,
  'ATTACK a teacher cannot assign themselves to a class they do not teach'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.teacher_both());

SELECT is(
  (SELECT count(*)::INT FROM public.students),
  2,
  'SCOPE mixed teacher sees both classes they reach — one by class, one by subject'
);

SELECT is(
  (SELECT count(*)::INT FROM public.students WHERE class_id = 'grade_7a'),
  0,
  'ATTACK mixed teacher still cannot see a class they hold no assignment for'
);

SELECT ok(
  teacher_reaches_class('grade_9b') AND teacher_reaches_class('grade_8a'),
  'SCOPE both scopes resolve through the same predicate for one teacher'
);

RESET ROLE;

-- The scope field and the subject column cannot disagree. A scope='subject' row
-- with no subject would read as "teaches the whole class" to the predicate.
SELECT throws_ok(
  $$INSERT INTO public.teacher_assignments
      (school_id, teacher_user_id, scope, class_id, subject_id, academic_year)
    VALUES ('11111111-1111-1111-1111-111111111111', 'user_teacher_a',
            'subject', 'grade_7a', NULL, '2026')$$,
  '23514',
  NULL,
  'CONSTRAINT scope=subject without a subject_id is rejected'
);

SELECT throws_ok(
  $$INSERT INTO public.teacher_assignments
      (school_id, teacher_user_id, scope, class_id, subject_id, academic_year)
    VALUES ('11111111-1111-1111-1111-111111111111', 'user_teacher_a',
            'class', 'grade_7a', 'dddddddd-0000-0000-0000-000000000001', '2026')$$,
  '23514',
  NULL,
  'CONSTRAINT scope=class carrying a subject_id is rejected'
);

-- ===========================================================================
-- SECTION 4 — parents see their own child and nothing else
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.parent_a());

SELECT is((SELECT count(*)::INT FROM public.students), 1,
  'BASELINE parent A sees exactly their own 1 child');

SELECT is((SELECT first_name FROM public.students), 'Alice',
  'BASELINE the visible child is theirs');

SELECT is(
  (SELECT count(*)::INT FROM public.students
   WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0,
  'ATTACK parent A cannot read another child at the SAME school'
);

SELECT is(
  (SELECT count(*)::INT FROM public.students
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  0,
  'ATTACK parent A cannot read a child at school B'
);

SELECT is(
  (SELECT count(*)::INT FROM public.parents WHERE clerk_user_id = 'user_parent_b'),
  0,
  'ATTACK parent A cannot read another parent''s record'
);

SELECT is(
  (SELECT count(*)::INT FROM public.student_parent_links
   WHERE parent_user_id = 'user_parent_b'),
  0,
  'ATTACK parent A cannot read another parent''s links'
);

SELECT is(
  pg_temp.rows_affected($$UPDATE public.students SET last_name = 'Changed'
     WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$),
  0,
  'ATTACK parent A has read access to their child but CANNOT modify the record'
);

RESET ROLE;

-- ===========================================================================
-- SECTION 5 — a student sees only themselves
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.student_a());

SELECT is((SELECT count(*)::INT FROM public.students), 1,
  'BASELINE student A sees exactly 1 record');

SELECT is((SELECT student_id FROM public.students), 'STU-ZM-LSK-0001-00001',
  'BASELINE the record student A sees is their own');

SELECT is(
  (SELECT count(*)::INT FROM public.students
   WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0,
  'ATTACK student A cannot read a classmate at their own school'
);

RESET ROLE;

-- ===========================================================================
-- SECTION 6 — AfriTech super admin crosses tenants BY DESIGN
--
-- Included so the suite proves the boundary is a boundary and not a blanket
-- deny: if these fail, the earlier passes might mean nothing is readable at all.
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.afritech_admin());

SELECT ok(is_afritech_admin(), 'the afritech-systems-admin slug resolves to super admin');

-- SCOPED TO THE FIXTURES 2026-08-23. This used to count every row in the table,
-- which is only correct on an empty database — true under `pg_prove` against a
-- fresh local instance, false the moment the suite is run against `zsms-dev`,
-- where the seed adds six schools. The assertion then failed for a reason that
-- has nothing to do with what it is testing, and a suite that fails for
-- irrelevant reasons is one people stop reading.
--
-- Scoping to the fixture ids keeps exactly what matters — the super admin
-- crosses the tenant boundary that every other role in this file cannot — while
-- making the result independent of whatever else lives in the database.
SELECT is(
  (SELECT count(*)::INT FROM public.schools
   WHERE id IN ('11111111-1111-1111-1111-111111111111',
                '22222222-2222-2222-2222-222222222222')),
  2,
  'super admin sees BOTH schools — cross-tenant access is intentional here');

SELECT is(
  (SELECT count(*)::INT FROM public.students
   WHERE school_id IN ('11111111-1111-1111-1111-111111111111',
                       '22222222-2222-2222-2222-222222222222')),
  4,
  'super admin sees all students across both schools');

RESET ROLE;

-- ===========================================================================
-- SECTION 7 — an unauthenticated session sees nothing
-- ===========================================================================

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT count(*) FROM public.students$$,
  '42501',
  NULL,
  'ATTACK anon cannot read students at all — privilege denied before RLS is consulted'
);
RESET ROLE;

-- ===========================================================================
-- SECTION 8 — hard deletes are structurally impossible
--
-- Added after the first run of this suite caught the gap. Supabase's default
-- privileges grant ALL on new public tables to `authenticated`; migrations
-- 0003–0018 added SELECT/INSERT/UPDATE without revoking the inherited DELETE.
-- RLS still blocked it on `students` (no DELETE policy), but policies written
-- FOR ALL — afritech_admin_all_students, management_write_staff,
-- school_management_links — do cover DELETE, so on those paths the privilege
-- was live. Migration 0019 removes it; these assertions keep it removed.
-- ===========================================================================

-- One table is allowed, BY NAME rather than by raising the count.
--
-- `staff_custom_role_assignments` (0228) records that somebody currently holds a
-- custom role. Removing them from it is a DELETE, and that is the right shape: it
-- is a join row asserting a present fact, not a historical record. Prohibition 8
-- names students, fee records, payments and exam results — none of which this is —
-- and `audit_row_change()` is attached, so the removal is recorded even though the
-- row is not.
--
-- Named rather than counted on purpose: a count of 1 would let the NEXT inherited
-- DELETE through silently, which is the whole failure this section exists to catch.
-- `0231` revoked nine such grants that had accumulated since `0019`.
SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND grantee IN ('authenticated', 'anon')
     AND privilege_type IN ('DELETE', 'TRUNCATE')
     AND table_name <> 'staff_custom_role_assignments'),
  0,
  'no DELETE or TRUNCATE privilege exists anywhere in public for end-user roles'
);

/*
  No policy may be dead code.

  RLS does not imply a GRANT — Postgres checks the privilege first — so a table
  with policies and nothing granted to `authenticated` refuses every read while
  looking protected. This repository hit that seven times (`0212`, `0218`, two in
  `0233`, three in `0234`), and each fix was correct without making the next
  occurrence visible.

  `tables_with_dead_policies()` (0234) asks the question, so the eighth fails here
  rather than reaching a school as "permission denied" on a screen that should work.
*/
SELECT is(
  (SELECT count(*)::INT FROM public.tables_with_dead_policies()),
  0,
  'no public table has policies it has granted nobody the privilege to exercise'
);

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.owner_a());

SELECT throws_ok(
  $$DELETE FROM public.staff_members WHERE id = 'aaaaaaaa-1111-0000-0000-000000000001'$$,
  '42501', NULL,
  'ATTACK owner A cannot hard-delete staff through the FOR ALL policy'
);

SELECT throws_ok(
  $$DELETE FROM public.student_parent_links WHERE parent_user_id = 'user_parent_a'$$,
  '42501', NULL,
  'ATTACK owner A cannot hard-delete parent links through the FOR ALL policy'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.afritech_admin());

-- The strongest role in the system is still bound by prohibition 8.
SELECT throws_ok(
  $$DELETE FROM public.students WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'ATTACK even the AfriTech super admin cannot hard-delete a student'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::INT FROM public.students
   WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'VERIFY the student row survived every delete attempt in this suite'
);

SELECT * FROM finish();

ROLLBACK;
