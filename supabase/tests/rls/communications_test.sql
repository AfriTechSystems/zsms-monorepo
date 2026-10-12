-- ===========================================================================
-- Phase 3 — jobs, quotas, and communications.
--
-- Spec: Official Documentation/12 Communication System/WHATSAPP.md
--       Official Documentation/12 Communication System/MESSAGE_LOG.md
--       Official Documentation/01 Foundation Layer/RLS.md
--
-- The refusals that matter here are different in kind from earlier phases.
-- Cross-tenant reads are still tested, but the new risks are:
--
--   * a school sending beyond the quota AfriTech pays for;
--   * a user fabricating a delivery record, which is how a school would argue
--     a parent was warned when they were not;
--   * one user marking an announcement read on another's behalf.
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

SELECT plan(50);

-- ---------------------------------------------------------------------------
-- Fixtures
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
   '11111111-1111-1111-1111-111111111111', 'Alice', 'Alpha', 'grade_7', 'grade_7a', 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'STU-ZM-NDL-0002-00001',
   '22222222-2222-2222-2222-222222222222', 'Bella', 'Beta', 'grade_7', 'grade_7a', 'active');

INSERT INTO public.parents (id, clerk_user_id, phone_e164, full_name)
VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'user_parent_a', '+260977000001', 'Parent Alpha'),
  ('cccccccc-0000-0000-0000-000000000002', 'user_parent_b', '+260977000002', 'Parent Beta');

INSERT INTO public.student_parent_links (student_id, parent_id, parent_user_id, is_active)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'user_parent_a', TRUE),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'user_parent_b', TRUE);

CREATE OR REPLACE FUNCTION pg_temp.act_as(p JSONB) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', p::TEXT, TRUE); END; $$;

CREATE OR REPLACE FUNCTION pg_temp.owner_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_owner_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:owner"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.owner_b() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_owner_b","o":{"id":"org_school_b","slg":"beta-school","rol":"org:owner"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.teacher_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_teacher_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:teacher"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.accountant_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_accountant_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:accountant"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.parent_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_parent_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:parent"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.parent_b() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_parent_b","o":{"id":"org_school_b","slg":"beta-school","rol":"org:parent"}}'::JSONB; $$;

-- ===========================================================================
-- SECTION A — the boundary is on
-- ===========================================================================

SELECT ok(
  (SELECT bool_and(relrowsecurity AND relforcerowsecurity)
   FROM pg_class
   WHERE relname IN ('message_log','school_message_quotas','notification_templates',
                     'announcements','announcement_reads','generated_documents','job_runs')
     AND relnamespace = 'public'::regnamespace),
  'every Phase 3 table has RLS both ENABLED and FORCED'
);

SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema='public' AND grantee IN ('authenticated','anon')
     AND privilege_type IN ('DELETE','TRUNCATE')
     AND table_name IN ('message_log','school_message_quotas','notification_templates',
                        'announcements','announcement_reads','generated_documents','job_runs')),
  0,
  'no end-user role holds DELETE or TRUNCATE on any Phase 3 table'
);

-- A fabricated 'delivered' row is how a school would argue a parent was warned.
SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema='public' AND grantee IN ('authenticated','anon')
     AND table_name='message_log' AND privilege_type IN ('INSERT','UPDATE')),
  0,
  'no end-user role can INSERT or UPDATE message_log — delivery records cannot be forged'
);

SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema='public' AND grantee IN ('authenticated','anon')
     AND table_name='school_message_quotas' AND privilege_type IN ('INSERT','UPDATE')),
  0,
  'no end-user role can write school_message_quotas — usage cannot be reset to zero'
);

SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema='public' AND grantee IN ('authenticated','anon')
     AND table_name IN ('generated_documents','job_runs')
     AND privilege_type IN ('INSERT','UPDATE')),
  0,
  'no end-user role can write generated_documents or job_runs'
);

-- afritech pricing is AfriTech's commercial configuration.
-- REWRITTEN 2026-08-23. This assertion used to read "afritech is unreachable by
-- any end-user role", and it was true when written: 0082 revoked everything.
-- 0095/0097/0098 then deliberately granted `authenticated` SELECT/INSERT/UPDATE
-- on all four afritech tables so the admin dashboard could reach them through
-- `public` views, with RLS deciding who may actually read or write —
-- 0095's phrasing: "Privileges are the outer gate; RLS is the decision."
--
-- So the old assertion was asserting a design that had been superseded, and it
-- had to fail. Deleting it outright would have thrown away the part that still
-- matters, so it is replaced by the three invariants that DO hold now. The one
-- thing never to weaken: an outer gate is only safe if the inner one is armed,
-- which is why the RLS check below is not optional.

SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema='afritech' AND grantee = 'anon'),
  0,
  'anon holds no privilege on any afritech table — pricing is never public'
);

SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema='afritech' AND grantee = 'authenticated'
     AND privilege_type IN ('DELETE','TRUNCATE')),
  0,
  'authenticated can never DELETE or TRUNCATE afritech configuration'
);

SELECT ok(
  (SELECT bool_and(c.relrowsecurity AND c.relforcerowsecurity)
   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'afritech' AND c.relkind = 'r'),
  'every afritech table has RLS ENABLED and FORCED — the grants above are gated, not open'
);

-- The arrears VIEWS carried INSERT and UPDATE until 0089. fee_record_status is
-- a simple view over fee_records and therefore auto-updatable — an entire
-- write path nobody designed. Found by 0089's own verification step.
SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema='public' AND grantee IN ('authenticated','anon')
     AND table_name IN ('fee_record_status','student_fee_balance')
     AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')),
  0,
  'the derived views are read-only — no write path through an auto-updatable view'
);

-- The class-level assertion. Three separate migrations (0019, 0076, 0089) fixed
-- instances of one mechanism: Supabase grants ALL on new tables, and a
-- migration that only adds grants leaves the rest switched on. This checks the
-- whole schema at once rather than one table at a time.
SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants g
   WHERE g.table_schema='public' AND g.grantee IN ('authenticated','anon')
     AND g.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies p
       WHERE p.schemaname='public' AND p.tablename=g.table_name
         AND (p.cmd=g.privilege_type OR p.cmd='ALL')
     )),
  0,
  'no mutating privilege anywhere in public lacks a backing policy'
);

-- ===========================================================================
-- SECTION B — quota enforcement
-- ===========================================================================

-- Starter is seeded at 500. Drive it to the ceiling.
SELECT ok(
  (SELECT out_allowed FROM public.consume_message_quota('11111111-1111-1111-1111-111111111111','whatsapp',499)),
  'QUOTA a send within the tier ceiling is allowed'
);

SELECT ok(
  (SELECT out_allowed FROM public.consume_message_quota('11111111-1111-1111-1111-111111111111','whatsapp',1)),
  'QUOTA the 500th message is still allowed'
);

SELECT ok(
  NOT (SELECT out_allowed FROM public.consume_message_quota('11111111-1111-1111-1111-111111111111','whatsapp',1)),
  'ATTACK the 501st message is REFUSED — a school cannot send beyond its quota'
);

SELECT is(
  (SELECT out_reason FROM public.consume_message_quota('11111111-1111-1111-1111-111111111111','whatsapp',1)),
  'quota_exceeded',
  'QUOTA the refusal names its reason so the UI can explain it'
);

-- Email and SMS are billed per provider. Refusing the fallback because the
-- primary channel ran out would defeat the entire chain.
SELECT ok(
  (SELECT out_allowed FROM public.consume_message_quota('11111111-1111-1111-1111-111111111111','email',1)),
  'QUOTA email is not metered — the fallback still delivers after WhatsApp is exhausted'
);

SELECT ok(
  (SELECT out_allowed FROM public.consume_message_quota('11111111-1111-1111-1111-111111111111','sms',1)),
  'QUOTA sms is not metered'
);

-- Quota is per school. One school exhausting its allowance must not silence
-- another.
SELECT ok(
  (SELECT out_allowed FROM public.consume_message_quota('22222222-2222-2222-2222-222222222222','whatsapp',1)),
  'QUOTA school B is unaffected by school A exhausting its quota'
);

SELECT is(
  (SELECT messages_used FROM public.school_message_quotas
   WHERE school_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'QUOTA usage is tracked per school, not globally'
);

SELECT is(
  (SELECT out_quota_limit FROM public.consume_message_quota('22222222-2222-2222-2222-222222222222','whatsapp',1)),
  1500,
  'QUOTA the ceiling comes from the tier configuration, not a constant'
);

-- ===========================================================================
-- SECTION C — message_log isolation
-- ===========================================================================

SELECT public.record_message_dispatch(
  '11111111-1111-1111-1111-111111111111', 'whatsapp', 'fee_payment_confirmed',
  '+260977000001', NULL, 'user_parent_a', 'aaaaaaaa-0000-0000-0000-000000000001',
  'sent', NULL, FALSE, NULL, TRUE);
SELECT public.record_message_dispatch(
  '22222222-2222-2222-2222-222222222222', 'whatsapp', 'fee_payment_confirmed',
  '+260977000002', NULL, 'user_parent_b', 'bbbbbbbb-0000-0000-0000-000000000001',
  'sent', NULL, FALSE, NULL, TRUE);

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.owner_a());

SELECT is((SELECT count(*)::INT FROM public.message_log), 1,
  'owner A sees exactly their own school''s 1 message');

SELECT is(
  (SELECT count(*)::INT FROM public.message_log
   WHERE school_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'ATTACK owner A cannot read school B message logs'
);

SELECT is(
  (SELECT count(*)::INT FROM public.message_log WHERE recipient_phone = '+260977000002'),
  0,
  'ATTACK owner A cannot find another school''s parent by phone number'
);

SELECT is(
  (SELECT count(*)::INT FROM public.school_message_quotas
   WHERE school_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'ATTACK owner A cannot read school B''s quota usage'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.teacher_a());

-- A teacher can mark attendance; message history is management's view.
SELECT is((SELECT count(*)::INT FROM public.message_log), 0,
  'ATTACK a teacher cannot read the school message log');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.accountant_a());

/*
  `0257` widened `school_management_read_message_log` to admit the accountant.

  MESSAGE_LOG.md always said they could read it, and they are the person who most
  needs to: every fee reminder in this log is theirs to answer for, so a parent
  claiming they were never told is their question, not the principal's.

  The migration could only assert that the policy TEXT admits the role — a
  migration runs as a role RLS does not apply to, and two attempts to switch role
  inside it left the role switched when the block ended, breaking the CLI's own
  migration-history INSERT. Behaviour is asserted here, where the harness is built
  to switch identity and CI runs it against a database built from nothing.
*/
SELECT is((SELECT count(*)::INT FROM public.message_log
           WHERE school_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'the accountant can read their own school''s message log (0257)');

SELECT is((SELECT count(*)::INT FROM public.message_log
           WHERE school_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'ATTACK the accountant cannot read school B''s message log'
);

-- Widening a policy must not widen what it writes. Delivery records are the
-- provider's word, not a user's.
SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='message_log'
     AND grantee='authenticated' AND privilege_type IN ('INSERT','UPDATE')),
  0,
  'the accountant still cannot forge or alter a delivery record'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.parent_a());

SELECT is((SELECT count(*)::INT FROM public.message_log), 1,
  'parent A sees the message addressed to them');

SELECT is(
  (SELECT count(*)::INT FROM public.message_log WHERE recipient_user_id = 'user_parent_b'),
  0,
  'ATTACK parent A cannot read another parent''s messages'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.parent_b());

SELECT is(
  (SELECT count(*)::INT FROM public.message_log
   WHERE school_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'ATTACK a school B parent cannot read school A messages'
);

RESET ROLE;

-- ===========================================================================
-- SECTION D — templates
-- ===========================================================================

SELECT ok(
  (SELECT count(*) > 0 FROM public.resolve_notification_template(
     '11111111-1111-1111-1111-111111111111', 'fee_payment_confirmed', 'whatsapp', 'en')),
  'TEMPLATE a platform default resolves when the school has no override'
);

SELECT ok(
  NOT (SELECT is_school_override FROM public.resolve_notification_template(
     '11111111-1111-1111-1111-111111111111', 'fee_payment_confirmed', 'whatsapp', 'en')),
  'TEMPLATE the resolved default is marked as not a school override'
);

INSERT INTO public.notification_templates
  (school_id, template_key, channel, language_code, body, variables)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'fee_payment_confirmed', 'whatsapp', 'en',
   'Custom wording for Alpha Academy', ARRAY['amount']);

SELECT ok(
  (SELECT is_school_override FROM public.resolve_notification_template(
     '11111111-1111-1111-1111-111111111111', 'fee_payment_confirmed', 'whatsapp', 'en')),
  'TEMPLATE a school override wins over the platform default'
);

SELECT ok(
  NOT (SELECT is_school_override FROM public.resolve_notification_template(
     '22222222-2222-2222-2222-222222222222', 'fee_payment_confirmed', 'whatsapp', 'en')),
  'TEMPLATE school A''s override does not leak into school B''s resolution'
);

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.owner_a());

SELECT throws_ok(
  $$INSERT INTO public.notification_templates (school_id, template_key, channel, body)
    VALUES (NULL, 'planted_default', 'whatsapp', 'Planted platform default')$$,
  '42501',
  NULL,
  'ATTACK a school owner cannot author a PLATFORM default template'
);

SELECT throws_ok(
  $$INSERT INTO public.notification_templates (school_id, template_key, channel, body)
    VALUES ('22222222-2222-2222-2222-222222222222', 'planted', 'whatsapp', 'Planted at school B')$$,
  '42501',
  NULL,
  'ATTACK a school owner cannot author a template for another school'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.teacher_a());

SELECT throws_ok(
  $$INSERT INTO public.notification_templates (school_id, template_key, channel, body)
    VALUES ('11111111-1111-1111-1111-111111111111', 'teacher_planted', 'whatsapp', 'Planted by a teacher')$$,
  '42501',
  NULL,
  'ATTACK a teacher cannot change what every parent receives'
);

RESET ROLE;

-- ===========================================================================
-- SECTION E — announcements and read tracking
-- ===========================================================================

INSERT INTO public.announcements (id, school_id, title, body, target_type, created_by, status, sent_at)
VALUES
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Sports day', 'Sports day is on Friday.', 'all_parents', 'user_owner_a', 'sent', NOW()),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Draft notice', 'Not yet sent.', 'all_parents', 'user_owner_a', 'draft', NULL),
  ('dddddddd-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'Beta notice', 'School B only.', 'all_parents', 'user_owner_b', 'sent', NOW());

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.parent_a());

SELECT is((SELECT count(*)::INT FROM public.announcements), 1,
  'parent A sees exactly the one SENT announcement at their school');

SELECT is(
  (SELECT count(*)::INT FROM public.announcements WHERE status = 'draft'),
  0,
  'ATTACK a parent cannot read an unsent DRAFT announcement'
);

SELECT is(
  (SELECT count(*)::INT FROM public.announcements
   WHERE school_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'ATTACK a parent cannot read another school''s announcement'
);

SELECT lives_ok(
  $$INSERT INTO public.announcement_reads (school_id, announcement_id, reader_user_id, reader_type)
    VALUES ('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000001',
            'user_parent_a', 'parent')$$,
  'READ a parent can record their own read'
);

-- Marking a read on someone else's behalf would manufacture the exact record a
-- school relies on to claim a parent was informed.
SELECT throws_ok(
  $$INSERT INTO public.announcement_reads (school_id, announcement_id, reader_user_id, reader_type)
    VALUES ('11111111-1111-1111-1111-111111111111', 'dddddddd-0000-0000-0000-000000000001',
            'user_parent_b', 'parent')$$,
  '42501',
  NULL,
  'ATTACK a parent cannot mark an announcement read on another user''s behalf'
);

SELECT throws_ok(
  $$INSERT INTO public.announcements (school_id, title, body, target_type, created_by)
    VALUES ('11111111-1111-1111-1111-111111111111', 'Planted', 'By a parent', 'all_parents', 'user_parent_a')$$,
  '42501',
  NULL,
  'ATTACK a parent cannot create an announcement'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.owner_a());

SELECT throws_ok(
  $$INSERT INTO public.announcements (school_id, title, body, target_type, created_by)
    VALUES ('11111111-1111-1111-1111-111111111111', 'Forged', 'Attributed to someone else',
            'all_parents', 'user_someone_else')$$,
  '42501',
  NULL,
  'ATTACK an announcement cannot be attributed to another author'
);

SELECT throws_ok(
  $$INSERT INTO public.announcements (school_id, title, body, target_type, created_by)
    VALUES ('22222222-2222-2222-2222-222222222222', 'Planted', 'At school B',
            'all_parents', 'user_owner_a')$$,
  '42501',
  NULL,
  'ATTACK owner A cannot announce to school B'
);

RESET ROLE;

-- ===========================================================================
-- SECTION F — documents and job records
-- ===========================================================================

SELECT public.record_generated_document(
  '11111111-1111-1111-1111-111111111111', 'payment_receipt',
  'aaaaaaaa-0000-0000-0000-000000000001', NULL, '2026', 1, 'user_acct_a');
SELECT public.record_generated_document(
  '22222222-2222-2222-2222-222222222222', 'payment_receipt',
  'bbbbbbbb-0000-0000-0000-000000000001', NULL, '2026', 1, 'user_acct_b');
SELECT public.record_job_run(
  '11111111-1111-1111-1111-111111111111', 'generate-receipt', 'bull_1', 'payment', NULL);

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.owner_a());

SELECT is((SELECT count(*)::INT FROM public.generated_documents), 1,
  'owner A sees only their school''s generated documents');

SELECT is((SELECT count(*)::INT FROM public.job_runs), 1,
  'owner A sees only their school''s job runs');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.parent_a());

SELECT is((SELECT count(*)::INT FROM public.generated_documents), 1,
  'parent A sees the document about their own child');

SELECT is((SELECT count(*)::INT FROM public.job_runs), 0,
  'ATTACK a parent cannot read job runs — failure reasons are operational detail');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.owner_b());

SELECT is(
  (SELECT count(*)::INT FROM public.generated_documents
   WHERE school_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'ATTACK school B cannot read school A documents'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
