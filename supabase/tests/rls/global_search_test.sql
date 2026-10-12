-- ===========================================================================
-- Global search — the isolation the function never states itself.
--
-- Spec: migration `0266`
--       Official Documentation/01 Foundation Layer/RLS.md
--
-- `search_everything()` is SECURITY INVOKER and contains **no school clause of
-- any kind**. That is deliberate: RLS is the authorisation, so a teacher sees
-- only their assigned classes without the function knowing what a teaching
-- assignment is.
--
-- It also means the function's own SQL offers no evidence that it is safe. The
-- only way to know is to run it as each audience and look at what comes back,
-- which is what this suite does.
--
-- The migration asserts the one thing it honestly can — that the function is
-- still INVOKER — because a migration runs as a role RLS does not apply to, so
-- an unswitched count there would pass whatever the policies say.
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(9);

-- ---------------------------------------------------------------------------
-- Fixtures: two schools, each with a pupil whose surname the other shares.
--
-- The shared surname is the point. If both pupils were called something
-- different, a search could appear to be scoped while actually just failing to
-- match — the test would pass for the wrong reason.
-- ---------------------------------------------------------------------------

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status, subscription_tier)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
   'Alpha Academy', 'day', 'combined', 'LSK', 'active', 'starter'),
  ('22222222-2222-2222-2222-222222222222', 'ZM-NDL-0002', 'org_school_b',
   'Beta School',   'day', 'combined', 'NDL', 'active', 'growth');

INSERT INTO public.students (id, student_id, school_id, first_name, last_name, grade_id, class_id, status)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'STU-ZM-LSK-0001-00001',
   '11111111-1111-1111-1111-111111111111', 'Chanda', 'Mwansa', '7', '7A', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'STU-ZM-NDL-0002-00001',
   '22222222-2222-2222-2222-222222222222', 'Thandi', 'Mwansa', '7', '7A', 'active');

CREATE OR REPLACE FUNCTION pg_temp.act_as(p JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', p::TEXT, TRUE); END; $$;

CREATE OR REPLACE FUNCTION pg_temp.admin_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_admin_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:admin"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.admin_b() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_admin_b","o":{"id":"org_school_b","slg":"beta-school","rol":"org:admin"}}'::JSONB; $$;

-- ===========================================================================
-- SECTION A — the function is reachable and still INVOKER
-- ===========================================================================

SELECT ok(
  NOT (SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'search_everything'),
  'search_everything is SECURITY INVOKER — RLS is what scopes it'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.search_everything(TEXT, INT)', 'EXECUTE'),
  'a signed-in user may search'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.search_everything(TEXT, INT)', 'EXECUTE'),
  'ATTACK anon may not search'
);

-- ===========================================================================
-- SECTION B — school A
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.admin_a());

SELECT is(
  (SELECT count(*)::INT FROM public.search_everything('Mwansa', 20)
   WHERE out_kind = 'student'),
  1,
  'school A finds exactly one Mwansa — its own'
);

SELECT is(
  (SELECT out_title FROM public.search_everything('Mwansa', 20)
   WHERE out_kind = 'student'),
  'Chanda Mwansa',
  'and it is the right one'
);

/*
  The assertion the whole suite exists for.

  Both schools have a pupil surnamed Mwansa. The function has no school clause,
  so if RLS were not applying, this count would be 2.
*/
SELECT is(
  (SELECT count(*)::INT FROM public.search_everything('Mwansa', 50) r
   JOIN public.students st ON st.id::TEXT = r.out_id
   WHERE r.out_kind = 'student'
     AND st.school_id <> '11111111-1111-1111-1111-111111111111'),
  0,
  'ATTACK school A''s search returns no pupil belonging to school B'
);

-- A one-character query matches almost everything, so it is refused outright.
SELECT is(
  (SELECT count(*)::INT FROM public.search_everything('M', 50)),
  0,
  'a single-character query returns nothing rather than the whole roll'
);

RESET ROLE;

-- ===========================================================================
-- SECTION C — school B sees the mirror image
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.admin_b());

SELECT is(
  (SELECT out_title FROM public.search_everything('Mwansa', 20)
   WHERE out_kind = 'student'),
  'Thandi Mwansa',
  'school B finds its own Mwansa and not school A''s'
);

/*
  A soft-deleted pupil must not be findable. Search is how somebody would
  casually check whether a withdrawn pupil is "still in the system", and the
  answer the roll gives everywhere else is no.
*/
UPDATE public.students SET is_deleted = TRUE
WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::INT FROM public.search_everything('Mwansa', 20)
   WHERE out_kind = 'student'),
  0,
  'a soft-deleted pupil is not findable by search'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
