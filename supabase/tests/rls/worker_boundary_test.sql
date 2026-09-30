-- ===========================================================================
-- Phase 3 — the worker access boundary.
--
-- Spec: Official Documentation/01 Foundation Layer/CONVENTIONS.md (prohibition 1,
--       as amended), DECISIONS.md ADR-042.
-- Migrations under test: 0090_create_worker_access_functions.sql
--                        0091_close_worker_direct_table_access.sql
--
-- Every other suite in this directory tests RLS. This one tests what happens
-- where RLS has been deliberately switched off.
--
-- ADR-042 permits a Railway worker to hold the service role key, which means
-- its connection bypasses every policy the other four suites verify. The
-- tenant boundary does not disappear — it moves into the `worker_*` functions,
-- each of which anchors its joins to one school internally. That relocation is
-- only as good as its tests, so this file asserts the same refusals against the
-- functions that tenant_isolation_test.sql asserts against the policies.
--
-- The fixture is built to be hostile to it: both schools have a student with
-- the SAME NAME in the SAME grade and class id. A join that loses its school
-- anchor produces two rows or the wrong parent, and nothing else in the data
-- would reveal the mistake.
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

SELECT plan(26);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status, subscription_tier)
VALUES
  ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_school_a','Alpha Academy','day','combined','LSK','active','starter'),
  ('22222222-2222-2222-2222-222222222222','ZM-NDL-0002','org_school_b','Beta School','day','combined','NDL','active','growth');

-- Same name, same grade, same class id, different school. See the header.
INSERT INTO public.students (id, student_id, school_id, first_name, last_name, grade_id, class_id, status)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','STU-ZM-LSK-0001-00001','11111111-1111-1111-1111-111111111111','Chanda','Mwale','grade_7','grade_7a','active'),
  ('bbbbbbbb-0000-0000-0000-000000000001','STU-ZM-NDL-0002-00001','22222222-2222-2222-2222-222222222222','Chanda','Mwale','grade_7','grade_7a','active');

INSERT INTO public.parents (id, clerk_user_id, phone_e164, email, full_name)
VALUES
  ('cccccccc-0000-0000-0000-000000000001','user_parent_a','+260977000001','a@example.test','Parent Alpha'),
  ('cccccccc-0000-0000-0000-000000000002','user_parent_b','+260977000002','b@example.test','Parent Beta');

INSERT INTO public.student_parent_links (student_id, parent_id, parent_user_id, is_active, is_primary)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','user_parent_a',TRUE,TRUE),
  ('bbbbbbbb-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002','user_parent_b',TRUE,TRUE);

INSERT INTO public.fee_structures (id, school_id, academic_year, term_number, grade_id, fee_label, amount)
VALUES
  ('eeeeeeee-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','2026',1,'ALL','Tuition Fee',1500.00),
  ('eeeeeeee-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','2026',1,'ALL','Tuition Fee',1500.00);

INSERT INTO public.fee_records (id, school_id, student_id, fee_structure_id, academic_year, term_number, fee_label, amount_due, due_date)
VALUES
  ('ffffffff-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001','2026',1,'Tuition Fee',1500.00, NOW() - INTERVAL '30 days'),
  ('ffffffff-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000002','2026',1,'Tuition Fee',1500.00, NOW() - INTERVAL '30 days');

INSERT INTO public.payments (id, school_id, fee_record_id, student_id, recorded_by_user_id, amount, payment_method, status, verified_by, verified_at)
VALUES
  ('99999999-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','ffffffff-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','user_acct_a',500.00,'cash','verified','user_acct_a',NOW());

INSERT INTO public.announcements (id, school_id, title, body, target_type, created_by, status, scheduled_at)
VALUES
  ('dddddddd-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Alpha notice','For Alpha parents only.','all_parents','user_owner_a','scheduled', NOW() - INTERVAL '1 minute');

-- One dispatch record for school A, queued. Section E updates it through
-- `worker_update_dispatch()` the way the fallback chain does after a provider
-- answers. Written through the function because `message_log` grants no INSERT
-- to anyone (0089).
SELECT public.record_message_dispatch(
  '11111111-1111-1111-1111-111111111111', 'whatsapp', 'fee_payment_confirmed',
  '+260977000001', NULL, 'user_parent_a', 'aaaaaaaa-0000-0000-0000-000000000001',
  'queued', NULL, FALSE, NULL, TRUE);

-- ===========================================================================
-- SECTION A — worker_payment_context()
--
-- This is the function behind the Phase 3 gate: it assembles everything the
-- receipt job needs from a payment id alone. A payload carries IDs only
-- (no PII, no amounts), so this function is the single point where a job
-- turns into a parent's phone number. If it can be made to return the wrong
-- school's guardian, a receipt for one family's money goes to another.
-- ===========================================================================

SELECT is(
  (public.worker_payment_context('99999999-0000-0000-0000-000000000001')->>'schoolId')::UUID,
  '11111111-1111-1111-1111-111111111111'::UUID,
  'WORKER payment context resolves to the payment''s own school'
);

SELECT is(
  public.worker_payment_context('99999999-0000-0000-0000-000000000001')->'student'->>'code',
  'STU-ZM-LSK-0001-00001',
  'WORKER the student is school A''s, not the identically named school B one'
);

SELECT is(
  public.worker_payment_context('99999999-0000-0000-0000-000000000001')->'parent'->>'userId',
  'user_parent_a',
  'WORKER the guardian is school A''s parent, not school B''s'
);

SELECT ok(
  public.worker_payment_context('99999999-0000-0000-0000-000000000001')->'parent'->>'phoneE164'
    <> '+260977000002',
  'ATTACK the context never yields another school''s parent phone number'
);

-- An unknown id must not produce a shell object the handler would treat as
-- real and then dispatch against.
SELECT ok(
  public.worker_payment_context('00000000-0000-0000-0000-000000000000') IS NULL,
  'WORKER an unknown payment returns NULL rather than an empty context'
);

-- ===========================================================================
-- SECTION B — worker_due_fee_reminders()
--
-- The cron runs unattended and, unlike a request, has no session identity to
-- constrain it. Its school scoping is a function argument, so the argument has
-- to be load-bearing.
-- ===========================================================================

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
  (SELECT count(*)::INT FROM public.worker_due_fee_reminders(NULL, 1, 7, 500) r
   WHERE r.out_school_id IN ('11111111-1111-1111-1111-111111111111',
                             '22222222-2222-2222-2222-222222222222')),
  2,
  'WORKER a platform-wide reminder run sees both schools'
);

SELECT is(
  (SELECT count(*)::INT FROM public.worker_due_fee_reminders('11111111-1111-1111-1111-111111111111', 1, 7, 500)),
  1,
  'WORKER a school-scoped run sees only that school'
);

SELECT is(
  (SELECT out_parent_phone FROM public.worker_due_fee_reminders('11111111-1111-1111-1111-111111111111', 1, 7, 500)),
  '+260977000001',
  'ATTACK a school-scoped run never returns another school''s parent'
);

-- 1500 charged, 500 verified. The reminder must quote the derived balance
-- (ADR-038) rather than the invoice amount, or it dunns a parent for money
-- they have already paid.
SELECT is(
  (SELECT out_arrears_amount FROM public.worker_due_fee_reminders('11111111-1111-1111-1111-111111111111', 1, 7, 500)),
  '1000.00',
  'WORKER arrears quoted net of the verified payment, from student_fee_balance'
);

SELECT lives_ok(
  $$ SELECT public.worker_mark_reminder_sent('ffffffff-0000-0000-0000-000000000001') $$,
  'WORKER a dispatched reminder can be marked sent'
);

-- The cooldown is the difference between a reminder and harassment.
SELECT is(
  (SELECT count(*)::INT FROM public.worker_due_fee_reminders('11111111-1111-1111-1111-111111111111', 1, 7, 500)),
  0,
  'WORKER the cooldown suppresses a repeat reminder inside the window'
);

SELECT is(
  (SELECT reminder_count FROM public.fee_records WHERE id = 'ffffffff-0000-0000-0000-000000000001'),
  1,
  'WORKER the reminder is counted, so escalation can be reasoned about later'
);

-- ===========================================================================
-- SECTION C — worker_announcement_recipients()
--
-- Deliberately takes NO school argument. Recipients are derived from the
-- announcement's own school, which makes "send school A's announcement to
-- school B's parents" unexpressible rather than merely unauthorised.
-- ===========================================================================

SELECT is(
  (SELECT count(*)::INT FROM public.worker_announcement_recipients('dddddddd-0000-0000-0000-000000000001', 2000)),
  1,
  'WORKER recipients come from the announcement''s own school only'
);

SELECT is(
  (SELECT out_user_id FROM public.worker_announcement_recipients('dddddddd-0000-0000-0000-000000000001', 2000)),
  'user_parent_a',
  'ATTACK a cron cannot fan school A''s announcement out to school B''s parents'
);

-- ===========================================================================
-- SECTION D — quota under bulk fan-out
--
-- communications_test.sql drives the ceiling one message at a time. A bulk
-- send is the case that actually breaks naive metering: an announcement to 300
-- parents asks for 300 units in one call, and the interesting question is what
-- happens when only some of them fit.
-- ===========================================================================

SELECT ok(
  (SELECT out_allowed FROM public.consume_message_quota('11111111-1111-1111-1111-111111111111','whatsapp',300)),
  'QUOTA a 300-recipient fan-out within the ceiling is allowed in one call'
);

-- 300 of 500 used. A second 300 does not fit.
SELECT ok(
  NOT (SELECT out_allowed FROM public.consume_message_quota('11111111-1111-1111-1111-111111111111','whatsapp',300)),
  'ATTACK a bulk send that would breach the ceiling is refused'
);

-- All-or-nothing is the point. A partial burn would leave the school billed
-- for messages nobody received, and the worker with no way to know which
-- recipients were covered.
SELECT is(
  (SELECT messages_used FROM public.school_message_quotas
   WHERE school_id = '11111111-1111-1111-1111-111111111111'
     AND billing_period = to_char(NOW() AT TIME ZONE 'UTC','YYYY-MM')),
  300,
  'QUOTA a refused bulk send consumes nothing — no partial burn'
);

-- Crossing 80% during a bulk send must fire once, not once per recipient.
SELECT ok(
  (SELECT out_crossed_80 FROM public.consume_message_quota('11111111-1111-1111-1111-111111111111','whatsapp',101)),
  'QUOTA the 80% warning fires on the bulk call that crosses it'
);

SELECT ok(
  NOT (SELECT out_crossed_80 FROM public.consume_message_quota('11111111-1111-1111-1111-111111111111','whatsapp',1)),
  'QUOTA the 80% warning does not fire twice'
);

-- ===========================================================================
-- SECTION E — the grant boundary
--
-- ADR-042's condition: these functions are reachable by service_role and by
-- nothing else. A `worker_*` function executable by `authenticated` would be a
-- documented, fully privileged hole straight through every policy in this
-- directory.
-- ===========================================================================

SELECT is(
  (SELECT count(*)::INT
   FROM information_schema.routine_privileges
   WHERE routine_schema = 'public'
     AND routine_name LIKE 'worker\_%'
     AND grantee IN ('authenticated','anon','PUBLIC')),
  0,
  'ATTACK no worker_* function is executable by authenticated, anon, or PUBLIC'
);

/**
 * Positive counterpart: the lockdown must not have locked out the worker too.
 *
 * Compared against the TOTAL rather than a literal. This assertion read `9` and broke the moment
 * `0157` added two more worker functions — failing for a reason that had nothing to do with the
 * boundary it guards, which is the worst kind of test to inherit: it demands attention and then turns
 * out to want a number bumped.
 *
 * The property that matters is not how many there are. It is that **every** one of them is reachable
 * by the worker, which stays true however many get added.
 */
SELECT is(
  (SELECT count(DISTINCT p.proname)::INT
     FROM pg_proc p
     JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND starts_with(p.proname, 'worker_')
      AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')),
  0,
  'WORKER every worker_* function is executable by service_role, however many there are'
);

-- 0091 removed the last three direct table statements from apps/workers. The
-- message_log UPDATE was the one that mattered: an unanchored write by id, on a
-- connection with no policies. It now goes through a function that sets the
-- terminal timestamps itself.
SELECT lives_ok(
  $$ SELECT public.worker_update_dispatch(
       (SELECT id FROM public.message_log
        WHERE school_id = '11111111-1111-1111-1111-111111111111' LIMIT 1),
       'sent', 'wamid.TEST', NULL) $$,
  'WORKER a provider result can be recorded against a message_log row'
);

SELECT ok(
  (SELECT sent_at IS NOT NULL AND failed_at IS NULL
   FROM public.message_log
   WHERE school_id = '11111111-1111-1111-1111-111111111111' LIMIT 1),
  'WORKER sent stamps sent_at and leaves failed_at alone'
);

-- The timestamps are derived from the status inside the function, so a worker
-- cannot claim a message was delivered when the provider refused it.
SELECT throws_ok(
  $$ SELECT public.worker_update_dispatch(
       '00000000-0000-0000-0000-000000000000', 'sent', NULL, NULL) $$,
  'P0002',
  NULL,
  'WORKER updating a message_log row that does not exist raises rather than silently succeeding'
);

SELECT is(
  public.worker_school_branding('11111111-1111-1111-1111-111111111111')->>'schoolCode',
  'ZM-LSK-0001',
  'WORKER school branding resolves the document header for one school'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"user_owner_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:owner"}}', TRUE);

-- The catalog check above proves the grant is absent; this proves the absence
-- is enforced, from the seat of a school owner — the highest-privileged
-- end-user role there is.
SELECT throws_ok(
  $$ SELECT public.worker_payment_context('99999999-0000-0000-0000-000000000001') $$,
  '42501',
  NULL,
  'ATTACK a school owner calling a worker function is refused by the executor'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
