-- ===========================================================================
-- The attendance register — teaching scope in the place it is actually used.
--
-- Spec: Official Documentation/11 Attendance/ATTENDANCE.md
--       Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-037
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- `fees_attendance_results_test.sql` already asserts that a teacher cannot mark
-- a class they do not teach. This suite covers what the register SCREEN depends
-- on and that one does not: the record-shape rules that stop an attendance log
-- from quietly becoming useless.
--
--   * an excused absence must carry a reason, or it is indistinguishable from
--     an unexplained one the moment somebody asks in April;
--   * one row per pupil per day, so a correction replaces a record rather than
--     accumulating a second contradictory one;
--   * an accountant, who reads fees and the roll, reads no attendance at all.
--
-- The scope assertions are repeated here rather than cross-referenced, because
-- this is the file someone will open when the register misbehaves.
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

SELECT plan(12);

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
   'Alpha Academy', 'day', 'combined', 'LSK', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'ZM-NDL-0002', 'org_school_b',
   'Beta School',   'day', 'combined', 'NDL', 'active');

INSERT INTO public.students (id, student_id, school_id, first_name, last_name, grade_id, class_id)
VALUES
  ('aaaa0000-0000-0000-0000-000000000001', 'STU-ZM-LSK-0001-00001',
   '11111111-1111-1111-1111-111111111111', 'Alice', 'Alpha', 'grade_7', 'grade_7a'),
  ('aaaa0000-0000-0000-0000-000000000002', 'STU-ZM-LSK-0001-00002',
   '11111111-1111-1111-1111-111111111111', 'Amos',  'Alpha', 'grade_8', 'grade_8a');

-- One teacher, assigned to grade_7a and nothing else. Everything below turns on
-- that single row.
INSERT INTO public.teacher_assignments (school_id, teacher_user_id, scope, class_id, academic_year)
VALUES ('11111111-1111-1111-1111-111111111111', 'user_t7', 'class', 'grade_7a',
        EXTRACT(YEAR FROM NOW())::TEXT);

CREATE OR REPLACE FUNCTION pg_temp.act_as(p JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', p::TEXT, TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.who(p_org TEXT, p_role TEXT, p_sub TEXT)
RETURNS JSONB LANGUAGE SQL AS $$
  SELECT json_build_object('sub', p_sub,
    'o', json_build_object('id', p_org, 'slg', 'x', 'rol', p_role))::JSONB;
$$;

CREATE OR REPLACE FUNCTION pg_temp.mark(
  p_student UUID, p_class TEXT, p_by TEXT, p_date DATE, p_status TEXT, p_reason TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.attendance_records
    (school_id, student_id, class_id, recorded_by_user_id,
     attendance_date, academic_year, term_number, status, excuse_reason)
  VALUES ('11111111-1111-1111-1111-111111111111', p_student, p_class, p_by,
          p_date, '2026', 1, p_status, p_reason);
END;
$$;

SET LOCAL ROLE authenticated;

-- ===========================================================================
-- SECTION 1 — scope, at the point of marking
-- ===========================================================================

SELECT pg_temp.act_as(pg_temp.who('org_school_a', 'teacher', 'user_t7'));

SELECT lives_ok(
  $$SELECT pg_temp.mark('aaaa0000-0000-0000-0000-000000000001','grade_7a','user_t7',CURRENT_DATE,'present')$$,
  'REGISTER a teacher marks the class they are assigned to');

SELECT throws_ok(
  $$SELECT pg_temp.mark('aaaa0000-0000-0000-0000-000000000002','grade_8a','user_t7',CURRENT_DATE,'absent')$$,
  '42501', NULL,
  'ATTACK a teacher CANNOT mark a class they do not teach');

SELECT is(
  (SELECT count(*)::INT FROM public.students WHERE class_id = 'grade_8a'),
  0,
  'ATTACK a teacher cannot even see the pupils of a class they do not teach');

-- ===========================================================================
-- SECTION 2 — the record-shape rules the register depends on
-- ===========================================================================

-- An excused absence with no reason is an unexplained absence wearing a nicer
-- label. The CHECK is what stops the distinction being lost.
SELECT throws_ok(
  $$SELECT pg_temp.mark('aaaa0000-0000-0000-0000-000000000001','grade_7a','user_t7',CURRENT_DATE - 1,'excused')$$,
  '23514', NULL,
  'SHAPE an excused absence with no reason is refused');

SELECT lives_ok(
  $$SELECT pg_temp.mark('aaaa0000-0000-0000-0000-000000000001','grade_7a','user_t7',CURRENT_DATE - 1,'excused','Medical appointment')$$,
  'SHAPE an excused absence WITH a reason is accepted');

-- One row per pupil per day. A correction must replace the record, never sit
-- beside a contradictory one — which is why the API upserts rather than inserts.
SELECT throws_ok(
  $$SELECT pg_temp.mark('aaaa0000-0000-0000-0000-000000000001','grade_7a','user_t7',CURRENT_DATE,'absent')$$,
  '23505', NULL,
  'SHAPE a second row for the same pupil on the same day is refused');

-- The correction path the screen actually uses: the recorder amending their own
-- mark, which `attendance_update` admits.
SELECT lives_ok(
  $$UPDATE public.attendance_records SET status = 'late'
    WHERE student_id = 'aaaa0000-0000-0000-0000-000000000001' AND attendance_date = CURRENT_DATE$$,
  'CORRECTION the teacher who marked it can change it');

-- ===========================================================================
-- SECTION 3 — who this is none of
-- ===========================================================================

SELECT pg_temp.act_as(pg_temp.who('org_school_a', 'accountant', 'user_acct_a'));
SELECT is(
  (SELECT count(*)::INT FROM public.attendance_records),
  0,
  'ROLE an accountant reads fees and the roll, and no attendance at all');

SELECT pg_temp.act_as(pg_temp.who('org_school_b', 'owner', 'user_owner_b'));

SELECT is(
  (SELECT count(*)::INT FROM public.attendance_records),
  0,
  'ATTACK school B sees none of school A''s attendance');

SELECT throws_ok(
  $$SELECT pg_temp.mark('aaaa0000-0000-0000-0000-000000000001','grade_7a','user_owner_b',CURRENT_DATE - 2,'present')$$,
  '42501', NULL,
  'ATTACK school B cannot mark a register at school A');

RESET ROLE;

-- ---------------------------------------------------------------------------
-- `school_attendance_trend()` (0274) — the two properties its safety rests on.
--
-- It has no `school_id` clause of its own, deliberately: it is SECURITY INVOKER so
-- RLS scopes it, exactly as RLS scopes the single-day query the dashboard already
-- runs. A class teacher gets their classes and a head teacher gets the school,
-- without the function knowing what a teaching assignment is.
--
-- That makes `prosecdef = false` load-bearing rather than incidental. Flipped to
-- DEFINER — by somebody "optimising" it, or by a careless CREATE OR REPLACE — it
-- would return **every school's attendance to every caller**, and nothing else here
-- would notice, because the rows it reads are the same rows. This is the same guard
-- `0096` puts on the platform metrics functions and for the same reason.
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT p.prosecdef
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'school_attendance_trend'),
  FALSE,
  'school_attendance_trend() is SECURITY INVOKER, so RLS still scopes it'
);

SELECT ok(
  NOT (SELECT has_function_privilege('anon', p.oid, 'EXECUTE')
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'school_attendance_trend'),
  'and anon cannot call it'
);

SELECT * FROM finish();

ROLLBACK;
