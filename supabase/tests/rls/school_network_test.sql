-- ===========================================================================
-- School Networks — a second-widest trust boundary, and a guard that once wasn't.
--
-- Spec: Official Documentation/01 Foundation Layer/DATABASE.md — school-group views
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- A network member reads aggregates for many schools at once. After AfriTech admin
-- that is the widest read in the system, so the assertions that matter most are the
-- ones about what a network CANNOT reach:
--
--   * a school in another network — the boundary the whole feature rests on;
--   * kwacha figures, when the network's `data_scope` or the member's role does not
--     permit them (while still seeing the collection RATE, which is a performance
--     figure and not an amount);
--   * the ability to attach a school. A network cannot enlarge itself: ownership of
--     a school is not something this system can verify, so attachment is AfriTech's
--     alone.
--
-- ## The guard that was not a guard
--
-- `is_afritech_admin()` returned NULL, not FALSE, for a session with no `o` claim —
-- three-valued logic. Harmless in the forty policies that use it, because
-- `USING (NULL)` filters a row exactly as `USING (FALSE)` would. Not harmless in
-- PL/pgSQL, where `IF NOT NULL THEN` does not execute its branch: the attach guard
-- was silently SKIPPED for precisely the callers who have no school organisation —
-- network members.
--
-- It was not exploitable, by accident: SECURITY INVOKER meant RLS then hid the
-- school and the caller got "School not found". A second accident preventing the
-- first is not a control, and the assertion below pins the error code rather than
-- merely asserting that something was thrown. A test checking only "it throws"
-- would have passed and left the hole in. `0121` fixes the helper at the root.
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

SELECT plan(19);

INSERT INTO public.schools
  (id, school_id, clerk_org_id, name, type, level, city_code, status, subscription_tier)
VALUES
 ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_a','Alpha Academy','day','combined','LSK','active','professional'),
 ('22222222-2222-2222-2222-222222222222','ZM-NDL-0002','org_b','Beta School','day','combined','NDL','active','starter'),
 -- Belongs to a DIFFERENT network. The control for the boundary assertion.
 ('33333333-3333-3333-3333-333333333333','ZM-KIT-0003','org_c','Outside School','day','combined','KIT','active','starter');

INSERT INTO public.students (id, student_id, school_id, first_name, last_name, grade_id, class_id)
VALUES
 ('aaaa0000-0000-0000-0000-000000000001','STU-A-1','11111111-1111-1111-1111-111111111111','A','One','grade_7','g7a'),
 ('aaaa0000-0000-0000-0000-000000000002','STU-A-2','11111111-1111-1111-1111-111111111111','A','Two','grade_7','g7a'),
 ('bbbb0000-0000-0000-0000-000000000001','STU-B-1','22222222-2222-2222-2222-222222222222','B','One','grade_4','g4a'),
 ('cccc0000-0000-0000-0000-000000000001','STU-C-1','33333333-3333-3333-3333-333333333333','C','One','grade_2','g2a');

INSERT INTO public.fee_structures (id, school_id, academic_year, term_number, grade_id, fee_label, amount)
VALUES
 ('ffff0000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111','2026',1,'grade_7','Tuition',1000),
 ('ffff0000-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222','2026',1,'grade_4','Tuition',500);

-- 2500 billed, 1500 collected across the network → 60%.
INSERT INTO public.fee_records
  (school_id, student_id, fee_structure_id, academic_year, term_number, fee_label,
   amount_due, amount_paid, due_date)
VALUES
 ('11111111-1111-1111-1111-111111111111','aaaa0000-0000-0000-0000-000000000001','ffff0000-0000-0000-0000-00000000000a','2026',1,'Tuition',1000,750,NOW()),
 ('11111111-1111-1111-1111-111111111111','aaaa0000-0000-0000-0000-000000000002','ffff0000-0000-0000-0000-00000000000a','2026',1,'Tuition',1000,250,NOW()),
 ('22222222-2222-2222-2222-222222222222','bbbb0000-0000-0000-0000-000000000001','ffff0000-0000-0000-0000-00000000000b','2026',1,'Tuition',500,500,NOW());

-- One present, one absent, one HOLIDAY. The holiday must not be a school day.
INSERT INTO public.attendance_records
  (school_id, student_id, class_id, academic_year, term_number, attendance_date, status, recorded_by_user_id)
VALUES
 ('11111111-1111-1111-1111-111111111111','aaaa0000-0000-0000-0000-000000000001','g7a','2026',1,CURRENT_DATE-1,'present','u'),
 ('11111111-1111-1111-1111-111111111111','aaaa0000-0000-0000-0000-000000000002','g7a','2026',1,CURRENT_DATE-1,'absent','u'),
 ('11111111-1111-1111-1111-111111111111','aaaa0000-0000-0000-0000-000000000001','g7a','2026',1,CURRENT_DATE-2,'holiday','u');

INSERT INTO public.school_networks (id, name, slug, data_scope) VALUES
 ('99990000-0000-0000-0000-000000000001','Sunrise Education','sunrise','financial_detail'),
 ('99990000-0000-0000-0000-000000000002','Rival Network','rival','aggregates_only');

INSERT INTO public.school_network_members (network_id, clerk_user_id, network_role, full_name) VALUES
 ('99990000-0000-0000-0000-000000000001','user_net_owner','owner','Net Owner'),
 ('99990000-0000-0000-0000-000000000001','user_net_viewer','viewer','Net Viewer'),
 ('99990000-0000-0000-0000-000000000002','user_rival_owner','owner','Rival Owner');

INSERT INTO public.school_network_schools (network_id, school_id) VALUES
 ('99990000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111'),
 ('99990000-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222'),
 ('99990000-0000-0000-0000-000000000002','33333333-3333-3333-3333-333333333333');

SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------------------
-- The network owner. Note: no `o` claim at all — a network member belongs to no
-- school organisation, which is the case that broke the guard.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"sub":"user_net_owner","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.network_school_summary()),
  2,
  'the owner sees exactly the two schools in their network'
);

SELECT is(
  (SELECT count(*)::int FROM public.network_school_summary()
    WHERE out_school_name = 'Outside School'),
  0,
  'THE BOUNDARY: never a school belonging to another network'
);

SELECT is(
  (SELECT out_pupils FROM public.network_school_summary()
    WHERE out_school_code = 'ZM-LSK-0001'),
  2,
  'pupil counts are correct per school'
);

SELECT is((SELECT out_schools FROM public.network_overview()), 2,
  'the overview counts schools');

SELECT is((SELECT out_pupils FROM public.network_overview()), 3,
  'and sums pupils across them');

SELECT is((SELECT out_fees_outstanding FROM public.network_overview()), 1000::numeric,
  'outstanding across the network is 2500 billed less 1500 collected');

SELECT is((SELECT out_collection_rate FROM public.network_overview()), 60,
  'collection rate is 1500/2500 = 60%');

SELECT is(
  (SELECT out_attendance_rate FROM public.network_school_summary()
    WHERE out_school_code = 'ZM-LSK-0001'),
  50,
  'attendance excludes the holiday — 1 present of 2 school days, not of 3'
);

-- ---------------------------------------------------------------------------
-- The viewer. Same network, narrower role.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"sub":"user_net_viewer","role":"authenticated"}';

SELECT ok(
  (SELECT bool_and(out_fees_outstanding IS NULL) FROM public.network_school_summary()),
  'a viewer sees no kwacha figures at all — NULL, never a misleading zero'
);

SELECT is(
  (SELECT out_collection_rate FROM public.network_school_summary()
    WHERE out_school_code = 'ZM-LSK-0001'),
  50,
  'but does see the collection RATE, which is performance and not an amount'
);

SELECT ok(
  NOT (SELECT out_can_manage FROM public.my_network_access()),
  'a viewer cannot manage members'
);

SELECT ok(
  (SELECT out_can_see_money FROM public.my_network_access()) = FALSE,
  'and resolves to no financial access, even though the network permits it'
);

-- ---------------------------------------------------------------------------
-- The rival network. Complete mutual invisibility.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"sub":"user_rival_owner","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.network_school_summary()),
  1,
  'the rival owner sees only their own one school'
);

SELECT is(
  (SELECT count(*)::int FROM public.network_school_summary()
    WHERE out_school_code IN ('ZM-LSK-0001','ZM-NDL-0002')),
  0,
  'and none of the other network''s schools'
);

-- ---------------------------------------------------------------------------
-- Somebody in no network. An empty set, not an error.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub":"user_plain","role":"authenticated",
  "o":{"id":"org_a","rol":"owner","slg":"alpha-academy"}}';

SELECT is(
  (SELECT count(*)::int FROM public.network_school_summary()),
  0,
  'a school owner in no network gets an empty set rather than an error'
);

-- ---------------------------------------------------------------------------
-- THE GUARD. Pinned to 42501 — the wrong code was the entire tell.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"sub":"user_net_owner","role":"authenticated"}';

SELECT is(public.is_afritech_admin(), FALSE,
  'is_afritech_admin() is FALSE and never NULL for a session with no organisation');

SELECT throws_ok(
  $$ SELECT public.attach_school_to_network(
       '99990000-0000-0000-0000-000000000001',
       '33333333-3333-3333-3333-333333333333') $$,
  '42501',
  NULL,
  'a network cannot enlarge itself — attachment is AfriTech''s alone'
);

SELECT throws_ok(
  $$ SELECT public.detach_school_from_network('11111111-1111-1111-1111-111111111111') $$,
  '42501',
  NULL,
  'nor detach one of its own'
);

-- ---------------------------------------------------------------------------
-- AfriTech can, and moving a school keeps the history.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub":"user_afritech","role":"authenticated",
  "o":{"id":"org_afritech","rol":"super_admin","slg":"afritech-systems-admin"}}';

SELECT lives_ok(
  $$ SELECT public.attach_school_to_network(
       '99990000-0000-0000-0000-000000000001',
       '33333333-3333-3333-3333-333333333333') $$,
  'AfriTech can attach a school, moving it from the rival network'
);

SELECT * FROM finish();
ROLLBACK;
