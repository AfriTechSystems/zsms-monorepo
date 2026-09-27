-- ===========================================================================
-- The student ceiling, and the pupil roll the school portal is built on.
--
-- Spec: Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--       Official Documentation/17 Integration and Pricing/PRICING.md
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--       Migrations 0101 (resolver + trigger) and 0102 (capacity view)
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- Three things are under test, and only the first is obvious:
--
--   1. The ceiling is ENFORCED. A school at its limit cannot enrol, whichever
--      way the row arrives — INSERT, an undone soft delete, or a withdrawn
--      pupil moved back to active. A ceiling that only watches INSERT is one
--      you get around by withdrawing a pupil and reinstating them.
--
--   2. The ceiling is READ FROM CONFIGURATION, not from a constant. The
--      assertions below change the tier's limit and change an override, and
--      require the resolver's answer to move with them. A hardcoded 200
--      anywhere in the resolution path fails these — which is the point, since
--      a hardcoded limit is invisible until a school hits it.
--
--   3. The ceiling does not become a new disclosure channel. The capacity view
--      is security_invoker, so School A must not learn School B's roll size
--      through it — a school's enrolment is commercially sensitive.
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

SELECT plan(41);

-- ---------------------------------------------------------------------------
-- Fixtures. Seeded as the superuser, which bypasses RLS — this is setup, not
-- an assertion.
--
-- Two schools on DIFFERENT tiers, so a tier change to one cannot silently
-- satisfy an assertion about the other.
-- ---------------------------------------------------------------------------

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status, subscription_tier)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
   'Alpha Academy', 'day', 'combined', 'LSK', 'active', 'starter'),
  ('22222222-2222-2222-2222-222222222222', 'ZM-NDL-0002', 'org_school_b',
   'Beta School',   'day', 'combined', 'NDL', 'active', 'growth');

-- A deliberately small ceiling for the school under test, so the boundary can
-- be reached in three rows rather than two hundred. The VALUE is fixture data;
-- what is under test is that the resolver reads whatever is here.
UPDATE afritech.subscription_tiers SET student_limit = 3 WHERE tier_name = 'starter';

INSERT INTO public.students
  (id, student_id, school_id, first_name, last_name, grade_id, class_id, status)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'STU-ZM-LSK-0001-00001',
   '11111111-1111-1111-1111-111111111111', 'Alice', 'Alpha', 'grade_7', 'grade_7a', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'STU-ZM-LSK-0001-00002',
   '11111111-1111-1111-1111-111111111111', 'Amos',  'Alpha', 'grade_8', 'grade_8a', 'active'),
  -- Graduated: on the books, NOT on the roll. If this counted, the school would
  -- already be full and half this suite would pass for the wrong reason.
  ('aaaaaaaa-0000-0000-0000-000000000003', 'STU-ZM-LSK-0001-00003',
   '11111111-1111-1111-1111-111111111111', 'Agnes', 'Alpha', 'grade_9', 'grade_9a', 'graduated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'STU-ZM-NDL-0002-00001',
   '22222222-2222-2222-2222-222222222222', 'Bella', 'Beta',  'grade_7', 'grade_7a', 'active');

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_claims JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims::TEXT, TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.owner_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_owner_a","o":{"id":"org_school_a","slg":"zm-lsk-0001","rol":"org:owner"}}'::JSONB;
$$;
CREATE OR REPLACE FUNCTION pg_temp.owner_b() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_owner_b","o":{"id":"org_school_b","slg":"zm-ndl-0002","rol":"org:owner"}}'::JSONB;
$$;
CREATE OR REPLACE FUNCTION pg_temp.accountant_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_acct_a","o":{"id":"org_school_a","slg":"zm-lsk-0001","rol":"org:accountant"}}'::JSONB;
$$;
CREATE OR REPLACE FUNCTION pg_temp.teacher_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_teacher_a","o":{"id":"org_school_a","slg":"zm-lsk-0001","rol":"org:teacher"}}'::JSONB;
$$;

-- Runs a write and returns the number of rows it affected. SECURITY INVOKER is
-- essential: the statement must execute as the role under test, so RLS applies
-- exactly as it would to that user's own query. (A blocked UPDATE affects zero
-- rows rather than raising — the row is invisible, not forbidden.)
CREATE OR REPLACE FUNCTION pg_temp.rows_affected(p_sql TEXT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Enrols one pupil as the CURRENT identity, returning nothing. Wrapped so the
-- assertions can talk about the attempt rather than the SQL.
CREATE OR REPLACE FUNCTION pg_temp.enrol(p_seq TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.students
    (student_id, school_id, first_name, last_name, grade_id, class_id)
  VALUES
    ('STU-ZM-LSK-0001-' || p_seq, '11111111-1111-1111-1111-111111111111',
     'New', 'Pupil', 'grade_7', 'grade_7a');
END;
$$;

-- ===========================================================================
-- SECTION 0 — the mechanism exists at all
--
-- These look like trivia and are not. Each one is a way the whole feature could
-- be silently absent while every behavioural test below still passed against
-- application code that had reimplemented the rule.
-- ===========================================================================

SELECT is(
  (SELECT count(*)::INT FROM pg_trigger
   WHERE tgrelid = 'public.students'::regclass
     AND tgname = 'enforce_student_limit_on_students'
     AND NOT tgisinternal),
  1,
  'the ceiling is enforced by a trigger on students, not by one caller'
);

SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE proname = 'school_student_limit'
     AND pronamespace = 'public'::regnamespace),
  'school_student_limit() is SECURITY DEFINER — it reads afritech on behalf of a school that cannot'
);

SELECT ok(
  (SELECT 'security_invoker=true' = ANY (c.reloptions)
   FROM pg_class c WHERE c.oid = 'public.school_capacity'::regclass),
  'school_capacity is security_invoker — the view is not a hole around RLS'
);

SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_name = 'school_capacity' AND grantee = 'anon'),
  0,
  'anon holds no privilege on school_capacity'
);

-- The override type must be admitted by the constraint, or the per-school
-- ceiling is unreachable no matter what the resolver does with it.
SELECT ok(
  (SELECT pg_get_constraintdef(oid) LIKE '%student_limit_override%'
   FROM pg_constraint
   WHERE conrelid = 'afritech.school_feature_overrides'::regclass
     AND conname = 'school_feature_overrides_override_type_check'),
  'student_limit_override is admitted by the override_type CHECK'
);

-- ===========================================================================
-- SECTION 1 — the ceiling is READ, not known
--
-- The strongest assertions in this file. Each changes configuration and
-- requires the resolved answer to follow. A constant anywhere in the path
-- fails them.
-- ===========================================================================

SELECT is(
  (SELECT student_limit FROM public.school_student_limit('11111111-1111-1111-1111-111111111111')),
  3,
  'CONFIG the resolver returns the tier limit as configured (3), not a compiled-in number'
);

SELECT is(
  (SELECT source FROM public.school_student_limit('11111111-1111-1111-1111-111111111111')),
  'tier',
  'CONFIG the resolver reports WHERE the ceiling came from'
);

UPDATE afritech.subscription_tiers SET student_limit = 9 WHERE tier_name = 'starter';

SELECT is(
  (SELECT student_limit FROM public.school_student_limit('11111111-1111-1111-1111-111111111111')),
  9,
  'CONFIG changing the tier limit changes the resolved ceiling, with nothing redeployed'
);

-- Different tier, unchanged: a resolver that ignored the school's tier and
-- returned "the limit" would pass the assertion above and fail this one.
SELECT is(
  (SELECT student_limit FROM public.school_student_limit('22222222-2222-2222-2222-222222222222')),
  500,
  'CONFIG a school on another tier is unaffected by that change'
);

UPDATE afritech.subscription_tiers SET student_limit = 3 WHERE tier_name = 'starter';

-- --- The per-school override outranks the tier -------------------------------

INSERT INTO afritech.school_feature_overrides
  (id, school_id, override_type, override_value, reason, granted_by)
VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'student_limit_override', '5', 'Suite fixture — per-school ceiling', 'test');

SELECT is(
  (SELECT student_limit FROM public.school_student_limit('11111111-1111-1111-1111-111111111111')),
  5,
  'CONFIG an active student_limit_override beats the tier'
);

SELECT is(
  (SELECT source FROM public.school_student_limit('11111111-1111-1111-1111-111111111111')),
  'school_override',
  'CONFIG the source says the answer came from the override'
);

-- Revoking restores the tier. Revoke, not delete — the row is the record that
-- the decision was made.
UPDATE afritech.school_feature_overrides SET is_active = FALSE
WHERE id = 'eeeeeeee-0000-0000-0000-000000000001';

SELECT is(
  (SELECT student_limit FROM public.school_student_limit('11111111-1111-1111-1111-111111111111')),
  3,
  'CONFIG revoking the override returns the school to its tier ceiling'
);

-- An EXPIRED override must not apply. An override that outlived its expiry is
-- how a term-long concession becomes permanent without anyone deciding to.
INSERT INTO afritech.school_feature_overrides
  (school_id, override_type, override_value, expires_at, reason, granted_by)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'student_limit_override', '99',
   NOW() - INTERVAL '1 day', 'Suite fixture — expired', 'test');

SELECT is(
  (SELECT student_limit FROM public.school_student_limit('11111111-1111-1111-1111-111111111111')),
  3,
  'CONFIG an expired override is ignored'
);

-- 'unlimited' is a value, not a missing one.
INSERT INTO afritech.school_feature_overrides
  (id, school_id, override_type, override_value, reason, granted_by)
VALUES
  ('eeeeeeee-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'student_limit_override', 'unlimited', 'Suite fixture — uncapped', 'test');

SELECT ok(
  (SELECT is_unlimited FROM public.school_student_limit('11111111-1111-1111-1111-111111111111')),
  'CONFIG the literal unlimited resolves to is_unlimited, not to zero'
);

SELECT ok(
  (SELECT NOT at_capacity FROM public.school_student_capacity('11111111-1111-1111-1111-111111111111')),
  'CONFIG an uncapped school is never at capacity'
);

UPDATE afritech.school_feature_overrides SET is_active = FALSE
WHERE id = 'eeeeeeee-0000-0000-0000-000000000002';

-- A value the resolver could not interpret must be refused at write time
-- rather than guessed at when a pupil is being enrolled.
SELECT throws_ok(
  $$INSERT INTO afritech.school_feature_overrides
      (school_id, override_type, override_value, reason, granted_by)
    VALUES ('11111111-1111-1111-1111-111111111111', 'student_limit_override',
            'plenty', 'nonsense', 'test')$$,
  '23514', NULL,
  'CONFIG a non-numeric ceiling is refused by the CHECK, not stored'
);

-- ===========================================================================
-- SECTION 2 — what counts toward the ceiling
--
-- The commercial rule: pupils on the roll. Counting leavers would make every
-- school's usage rise forever, so a school would eventually be billed a tier
-- upgrade for pupils who left years ago.
-- ===========================================================================

SELECT is(
  (SELECT current_count FROM public.school_student_capacity('11111111-1111-1111-1111-111111111111')),
  2,
  'COUNT a graduated pupil does not occupy a place'
);

UPDATE public.students SET status = 'on_leave'
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';

SELECT is(
  (SELECT current_count FROM public.school_student_capacity('11111111-1111-1111-1111-111111111111')),
  2,
  'COUNT an on-leave pupil DOES occupy a place — they are still enrolled'
);

UPDATE public.students SET status = 'active'
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';

UPDATE public.students SET is_deleted = TRUE, deleted_at = NOW()
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';

SELECT is(
  (SELECT current_count FROM public.school_student_capacity('11111111-1111-1111-1111-111111111111')),
  1,
  'COUNT a soft-deleted pupil does not occupy a place'
);

UPDATE public.students SET is_deleted = FALSE, deleted_at = NULL
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';

SELECT is(
  (SELECT remaining FROM public.school_student_capacity('11111111-1111-1111-1111-111111111111')),
  1,
  'COUNT remaining is the ceiling less the roll (3 - 2), not less the row count'
);

-- ===========================================================================
-- SECTION 3 — enforcement, as the roles that actually enrol
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.owner_a());

-- Baseline: the boundary is not simply closed to everyone.
SELECT lives_ok(
  $$SELECT pg_temp.enrol('00010')$$,
  'BASELINE the owner can enrol while a place remains'
);

SELECT ok(
  (SELECT at_capacity FROM public.school_student_capacity('11111111-1111-1111-1111-111111111111')),
  'BASELINE that enrolment filled the last place'
);

SELECT throws_ok(
  $$SELECT pg_temp.enrol('00011')$$,
  'ZS001', NULL,
  'ATTACK enrolling past the ceiling is refused with the ceiling error code'
);

-- A full school must not become a school that cannot be administered. Asserted
-- here, before anything else changes, so it is testing a genuinely full roll.
SELECT lives_ok(
  $$UPDATE public.students SET first_name = 'Alicia'
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  'editing an already-enrolled pupil is never blocked by a full roll'
);

-- --- Escape route 1: withdraw, take the place, reinstate ---------------------

SELECT lives_ok(
  $$UPDATE public.students SET status = 'withdrawn'
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'withdrawing a pupil is allowed and frees a place'
);

SELECT lives_ok(
  $$SELECT pg_temp.enrol('00012')$$,
  'the freed place can be used'
);

SELECT throws_ok(
  $$UPDATE public.students SET status = 'active'
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'ZS001', NULL,
  'ATTACK reinstating a withdrawn pupil at a full school is refused — the ceiling is not escapable by withdraw-then-reinstate'
);

-- --- Escape route 2: soft delete, take the place, undelete -------------------
--
-- A separate route with a separate column. The first draft of this suite tried
-- to undelete a pupil who had only been *withdrawn*, which is a no-op — it
-- passed nothing and proved nothing. The pupil has to actually be soft-deleted
-- first, and the freed place actually taken, or the assertion below is vacuous.

SELECT lives_ok(
  $$UPDATE public.students SET is_deleted = TRUE, deleted_at = NOW()
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  'soft-deleting a pupil is allowed and frees a place'
);

SELECT lives_ok(
  $$SELECT pg_temp.enrol('00013')$$,
  'the place freed by the soft delete can be used'
);

SELECT throws_ok(
  $$UPDATE public.students SET is_deleted = FALSE, deleted_at = NULL
    WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002'$$,
  'ZS001', NULL,
  'ATTACK undoing a soft delete at a full school is refused for the same reason'
);

-- ===========================================================================
-- SECTION 4 — roles, as the portal's nav claims them
--
-- lib/roles.ts hides affordances a role lacks. These assert the policies that
-- the map is transcribed from, so the two cannot drift apart unnoticed.
-- ===========================================================================

SELECT pg_temp.act_as(pg_temp.accountant_a());

SELECT ok(
  (SELECT count(*) FROM public.students) > 0,
  'ROLE the accountant CAN read the roll — they bill against it'
);

SELECT is(
  pg_temp.rows_affected($$UPDATE public.students SET first_name = 'Nope'
                          WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003'$$),
  0,
  'ROLE the accountant CANNOT edit a pupil'
);

-- 42501, not ZS001. The school is full at this point, so this assertion is also
-- checking the ORDER of the two refusals: a role that may not enrol must be
-- told that, not told the school's plan limit. Before 0103 the ceiling ran
-- first and answered ZS001 here.
SELECT throws_ok(
  $$SELECT pg_temp.enrol('00020')$$,
  '42501', NULL,
  'ROLE the accountant CANNOT enrol a pupil — and is told THAT, not the plan limit'
);

SELECT pg_temp.act_as(pg_temp.teacher_a());

SELECT is(
  (SELECT count(*)::INT FROM public.students),
  0,
  'ROLE a teacher with no assignment sees no pupils at all'
);

SELECT throws_ok(
  $$SELECT pg_temp.enrol('00021')$$,
  '42501', NULL,
  'ROLE a teacher CANNOT enrol a pupil'
);

-- ===========================================================================
-- SECTION 5 — the ceiling is not a new disclosure channel
--
-- A school's enrolment is commercially sensitive. The capacity view exists to
-- let one screen render one school's roll, not to let schools count each other.
-- ===========================================================================

SELECT pg_temp.act_as(pg_temp.owner_a());

SELECT is(
  (SELECT count(*)::INT FROM public.school_capacity),
  1,
  'ISOLATION school A sees exactly one row in school_capacity — its own'
);

SELECT is(
  (SELECT count(*)::INT FROM public.school_capacity
   WHERE school_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'ATTACK school A filtering school_capacity for school B gets nothing'
);

SELECT pg_temp.act_as(pg_temp.owner_b());

SELECT is(
  (SELECT current_count FROM public.school_capacity),
  1,
  'ISOLATION school B sees its OWN roll, not school A''s'
);

SELECT is(
  (SELECT student_limit FROM public.school_capacity),
  500,
  'ISOLATION school B resolves its own tier ceiling'
);

-- THE REGRESSION TEST FOR 0103.
--
-- School A is full at this point. School B attempts to enrol into it. The
-- answer must be `42501` — "not permitted" — and nothing else.
--
-- Under 0101's BEFORE trigger this returned `ZS001: This school has reached its
-- plan limit of 3 enrolled pupils`, disclosing to another tenant that School A
-- exists, that it is full, and the exact ceiling AfriTech has configured for it.
-- A BEFORE ROW trigger runs ahead of the RLS WITH CHECK, so the ceiling spoke
-- before anyone had established the caller could write there at all.
SELECT throws_ok(
  $$INSERT INTO public.students
      (student_id, school_id, first_name, last_name, grade_id, class_id)
    VALUES ('STU-ZM-LSK-0001-09999', '11111111-1111-1111-1111-111111111111',
            'Cross', 'Tenant', 'grade_7', 'grade_7a')$$,
  '42501', NULL,
  'ATTACK school B enrolling INTO school A is refused by the tenant policy, not by the ceiling'
);

RESET ROLE;

-- The trigger must not have quietly eaten a row along the way.
SELECT is(
  (SELECT count(*)::INT FROM public.students
   WHERE school_id = '11111111-1111-1111-1111-111111111111'),
  6,
  'VERIFY nothing was hard-deleted along the way — every row this suite touched still exists'
);

SELECT * FROM finish();

ROLLBACK;
