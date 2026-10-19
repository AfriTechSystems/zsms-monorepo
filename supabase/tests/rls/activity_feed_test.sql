-- ===========================================================================
-- recent_activity() and admin_platform_history() — 0267, 0268
--
-- `recent_activity()` is SECURITY INVOKER, so its own SQL is no evidence that it
-- is scoped. The only proof is running it as each audience and counting. Two
-- schools each get an audit row, and each school must see exactly its own.
--
-- This is the assertion the migration could not make: observing it needs a role
-- switch, and `0257` established that switching roles inside a migration leaves
-- the role switched and breaks the CLI's own migration-history insert.
-- ===========================================================================

BEGIN;
SELECT plan(11);

-- --- fixture ---------------------------------------------------------------

/*
  `city_code` is required, not optional: `set_province_from_city()` raises 22023 for a
  NULL city because a school with no province cannot appear in the public directory.
  Worth knowing when writing any schools fixture.
*/
INSERT INTO public.schools
  (id, school_id, clerk_org_id, name, type, level, city_code, status, subscription_tier)
VALUES
  ('aaaaaaaa-0267-4000-8000-000000000001', 'ZM-LSK-9267', 'org_activity_a',
   'Activity School A', 'day', 'combined', 'LSK', 'active', 'starter'),
  ('aaaaaaaa-0267-4000-8000-000000000002', 'ZM-NDL-9268', 'org_activity_b',
   'Activity School B', 'day', 'combined', 'NDL', 'active', 'starter');

INSERT INTO public.audit_logs (school_id, actor_user_id, action, table_name, record_id, new_values)
VALUES
  -- School A: a pupil enrolled by somebody else.
  ('aaaaaaaa-0267-4000-8000-000000000001', 'user_other_a', 'create', 'students',
   'bbbbbbbb-0267-4000-8000-000000000001', '{"first_name":"Chanda","grade_id":"7"}'::JSONB),
  -- School A: an action by the reader themselves, which must NOT appear.
  ('aaaaaaaa-0267-4000-8000-000000000001', 'user_reader_a', 'create', 'payments',
   'bbbbbbbb-0267-4000-8000-000000000002', '{"amount":"500.00"}'::JSONB),
  -- School B: must never be visible to A.
  ('aaaaaaaa-0267-4000-8000-000000000002', 'user_other_b', 'create', 'students',
   'bbbbbbbb-0267-4000-8000-000000000003', '{"first_name":"Mutale"}'::JSONB);

-- --- school A's principal --------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'user_reader_a', 'role', 'authenticated',
  'o', json_build_object('id', 'org_activity_a', 'rol', 'principal')
)::text, TRUE);

/*
  Scoped to `out_kind`, not a raw count of everything.

  Inserting a school writes its OWN audit row through `audit_row_change()`, so the
  fixture's reader legitimately sees that too. A bare `count(*) = 1` asserted the
  fixture rather than the function, and failed for the right reason the first time it
  ran — which is why the suite is worth running rather than only plan-counting.
*/
SELECT is(
  (SELECT count(*)::INT FROM public.recent_activity(50) WHERE out_kind = 'pupil'),
  1,
  'school A sees the pupil row somebody else created'
);

SELECT is(
  (SELECT out_title FROM public.recent_activity(50) WHERE out_kind = 'pupil'),
  'A pupil was enrolled',
  'the row reads as a sentence rather than "create on students"'
);

SELECT is(
  (SELECT count(*)::INT FROM public.recent_activity(50)
   WHERE out_title LIKE '%Mutale%' OR out_detail LIKE '%Mutale%'),
  0,
  'nothing of school B''s leaks into school A''s feed'
);

-- The reader's own payment row exists and is deliberately withheld.
SELECT is(
  (SELECT count(*)::INT FROM public.recent_activity(50) WHERE out_kind = 'money'),
  0,
  'the reader''s own action is excluded — a feed of your own work is a receipt, not news'
);

SELECT isnt(
  (SELECT out_detail FROM public.recent_activity(50) WHERE out_kind = 'pupil'),
  NULL,
  'the changed fields are named'
);

-- `unlike(text, text, text)` is not resolvable here, so assert the same property
-- as a boolean: the detail must not contain the pupil's name.
SELECT ok(
  (SELECT out_detail NOT LIKE '%Chanda%' FROM public.recent_activity(50)
   WHERE out_kind = 'pupil'),
  'the detail names FIELDS, never values — a dashboard must not repeat personal data'
);

-- A school may not read the platform history.
SELECT throws_ok(
  $$ SELECT * FROM public.admin_platform_history(90) $$,
  '42501',
  NULL,
  'a school principal cannot read platform-wide history'
);

RESET ROLE;

-- --- school B ---------------------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'user_reader_b', 'role', 'authenticated',
  'o', json_build_object('id', 'org_activity_b', 'rol', 'principal')
)::text, TRUE);

SELECT is(
  (SELECT count(*)::INT FROM public.recent_activity(50) WHERE out_kind = 'pupil'),
  1,
  'school B sees its OWN pupil row — the mirror image, which is what proves RLS scopes this'
);

SELECT is(
  (SELECT count(*)::INT FROM public.recent_activity(50)
   WHERE out_detail LIKE '%grade%'),
  0,
  'school B cannot see school A''s enrolment, which recorded a grade'
);

RESET ROLE;

-- --- the limit is bounded ---------------------------------------------------

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object(
  'sub', 'user_reader_a', 'role', 'authenticated',
  'o', json_build_object('id', 'org_activity_a', 'rol', 'principal')
)::text, TRUE);

SELECT lives_ok(
  $$ SELECT * FROM public.recent_activity(100000) $$,
  'an absurd limit is clamped rather than refused'
);

SELECT lives_ok(
  $$ SELECT * FROM public.recent_activity(0) $$,
  'a zero limit is clamped to at least one rather than erroring'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
