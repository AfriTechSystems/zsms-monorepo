-- ===========================================================================
-- Staff access — the boundary the staff screen and the invitation API sit on.
--
-- Spec: Official Documentation/08 Staff Management/STAFF.md
--       Official Documentation/02 Authentication and Identity/ROLES.md
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- Group 3 introduces something no earlier screen had: a route that reaches
-- **outside** the database. `/api/school/staff` invites people through Clerk's
-- Backend API with the secret key, which has no permission model to fall back
-- on — ZSMS's org roles carry empty Clerk permission sets by decision. So for
-- the Clerk half, the role check in the route is the *only* thing standing
-- between an accountant and the ability to grant someone else access.
--
-- That check reads `lib/roles.ts`. The map in that file is a transcription of
-- the policies asserted below, and a transcription is a thing that drifts. This
-- suite is what makes the drift loud: every capability the staff screen relies
-- on is asserted here against the policy it claims to mirror.
--
--   staff:read   owner, principal, admin          (management_read_staff)
--   staff:write  owner, principal ONLY            (management_write_staff)
--
-- The asymmetry is the part worth testing. An administrator can SEE the staff
-- list and cannot CHANGE it, which is easy to get wrong in either direction and
-- impossible to notice from the screen alone.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SELECT plan(17);

-- ---------------------------------------------------------------------------
-- Fixtures. Seeded as the superuser, which bypasses RLS — setup, not assertion.
-- ---------------------------------------------------------------------------

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
   'Alpha Academy', 'day', 'combined', 'LSK', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'ZM-NDL-0002', 'org_school_b',
   'Beta School',   'day', 'combined', 'NDL', 'active');

INSERT INTO public.staff_members
  (id, school_id, clerk_user_id, first_name, last_name, employment_type)
VALUES
  ('aaaa1111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'user_teacher_a', 'Tendai', 'Teacher', 'full_time'),
  ('bbbb1111-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'user_teacher_b', 'Bwalya', 'Teacher', 'full_time');

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_claims JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims::TEXT, TRUE);
END;
$$;

-- Claims are written in Clerk's BARE form (`owner`, not `org:owner`), because
-- that is what Clerk's v2 session token actually sends and what `0105`
-- normalises. Asserting against the qualified form here would test a token
-- shape the product does not receive.
CREATE OR REPLACE FUNCTION pg_temp.at_a(p_role TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT json_build_object(
    'sub', 'user_' || p_role || '_a',
    'o', json_build_object('id','org_school_a','slg','zm-lsk-0001','rol',p_role))::JSONB;
$$;
CREATE OR REPLACE FUNCTION pg_temp.at_b(p_role TEXT) RETURNS JSONB LANGUAGE SQL AS $$
  SELECT json_build_object(
    'sub', 'user_' || p_role || '_b',
    'o', json_build_object('id','org_school_b','slg','zm-ndl-0002','rol',p_role))::JSONB;
$$;

CREATE OR REPLACE FUNCTION pg_temp.add_staff(p_school UUID, p_user TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.staff_members (school_id, clerk_user_id, first_name, last_name)
  VALUES (p_school, p_user, 'New', 'Colleague');
END;
$$;

SET LOCAL ROLE authenticated;

-- ===========================================================================
-- SECTION 1 — staff:read, exactly as lib/roles.ts claims it
-- ===========================================================================

SELECT pg_temp.act_as(pg_temp.at_a('owner'));
SELECT is((SELECT count(*)::INT FROM public.staff_members), 1,
  'READ owner sees the school''s staff');

SELECT pg_temp.act_as(pg_temp.at_a('principal'));
SELECT is((SELECT count(*)::INT FROM public.staff_members), 1,
  'READ principal sees the school''s staff');

SELECT pg_temp.act_as(pg_temp.at_a('admin'));
SELECT is((SELECT count(*)::INT FROM public.staff_members), 1,
  'READ administrator sees the school''s staff');

-- The asymmetry. An accountant reads pupils and fees and NOT the staff list;
-- getting this wrong hands salary-adjacent records to the wrong desk.
SELECT pg_temp.act_as(pg_temp.at_a('accountant'));
SELECT is((SELECT count(*)::INT FROM public.staff_members), 0,
  'READ accountant CANNOT see the staff list');

SELECT pg_temp.act_as(pg_temp.at_a('parent'));
SELECT is((SELECT count(*)::INT FROM public.staff_members), 0,
  'READ a parent CANNOT see the staff list');

-- A teacher sees their OWN record and nobody else's (staff_read_own_record).
SELECT pg_temp.act_as(
  '{"sub":"user_teacher_a","o":{"id":"org_school_a","slg":"zm-lsk-0001","rol":"teacher"}}'::JSONB);
SELECT is((SELECT count(*)::INT FROM public.staff_members), 1,
  'READ a teacher sees exactly one row — their own record');
SELECT is((SELECT clerk_user_id FROM public.staff_members), 'user_teacher_a',
  'READ the row a teacher sees is theirs');

-- ===========================================================================
-- SECTION 2 — staff:write is owner and principal ONLY
--
-- This is the boundary the invitation API's role check mirrors. If an
-- administrator gains write here, `can(role, 'staff:write')` in lib/roles.ts is
-- wrong and an administrator can invite people through Clerk — a grant no
-- policy would ever have allowed on the database side.
-- ===========================================================================

SELECT pg_temp.act_as(pg_temp.at_a('owner'));
SELECT lives_ok(
  $$SELECT pg_temp.add_staff('11111111-1111-1111-1111-111111111111', 'user_new_owner')$$,
  'WRITE the owner can add a staff record');

SELECT pg_temp.act_as(pg_temp.at_a('principal'));
SELECT lives_ok(
  $$SELECT pg_temp.add_staff('11111111-1111-1111-1111-111111111111', 'user_new_principal')$$,
  'WRITE the principal can add a staff record');

SELECT pg_temp.act_as(pg_temp.at_a('admin'));
SELECT throws_ok(
  $$SELECT pg_temp.add_staff('11111111-1111-1111-1111-111111111111', 'user_new_admin')$$,
  '42501', NULL,
  'ATTACK an administrator CANNOT add staff — they read the list, they do not change it');

SELECT pg_temp.act_as(pg_temp.at_a('accountant'));
SELECT throws_ok(
  $$SELECT pg_temp.add_staff('11111111-1111-1111-1111-111111111111', 'user_new_acct')$$,
  '42501', NULL,
  'ATTACK an accountant CANNOT add staff');

SELECT pg_temp.act_as(pg_temp.at_a('teacher'));
SELECT throws_ok(
  $$SELECT pg_temp.add_staff('11111111-1111-1111-1111-111111111111', 'user_new_teacher')$$,
  '42501', NULL,
  'ATTACK a teacher CANNOT add a colleague');

-- ===========================================================================
-- SECTION 3 — the tenant boundary still holds over all of it
-- ===========================================================================

SELECT pg_temp.act_as(pg_temp.at_b('owner'));

SELECT is(
  (SELECT count(*)::INT FROM public.staff_members
   WHERE school_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'ATTACK school B''s owner cannot read school A''s staff');

SELECT throws_ok(
  $$SELECT pg_temp.add_staff('11111111-1111-1111-1111-111111111111', 'user_planted')$$,
  '42501', NULL,
  'ATTACK school B''s owner cannot plant staff at school A');

-- A teacher at B must not reach A's record even though the id is guessable.
SELECT pg_temp.act_as(
  '{"sub":"user_teacher_b","o":{"id":"org_school_b","slg":"zm-ndl-0002","rol":"teacher"}}'::JSONB);
SELECT is(
  (SELECT count(*)::INT FROM public.staff_members
   WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  0,
  'ATTACK a teacher at school B cannot address school A''s staff row directly');

-- ===========================================================================
-- SECTION 4 — a staff record is never destroyed
--
-- Removing someone from the organisation revokes their Clerk access. The
-- employment record, and everything referencing it, is a school record that
-- outlives the person's account.
-- ===========================================================================

SELECT pg_temp.act_as(pg_temp.at_a('owner'));
SELECT throws_ok(
  $$DELETE FROM public.staff_members WHERE id = 'aaaa1111-0000-0000-0000-000000000001'$$,
  '42501', NULL,
  'ATTACK even the school owner cannot hard-delete a staff record');

RESET ROLE;

SELECT is(
  (SELECT count(*)::INT FROM public.staff_members
   WHERE id = 'aaaa1111-0000-0000-0000-000000000001'),
  1,
  'VERIFY the staff row survived every delete attempt in this suite');

SELECT * FROM finish();

ROLLBACK;
