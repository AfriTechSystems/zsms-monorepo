-- ===========================================================================
-- Phase 2 — fee lifecycle, attendance, and results.
--
-- Spec: Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--       Official Documentation/01 Foundation Layer/RLS.md
--       Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-037
--
-- Two jobs, in this order:
--
--   1. Prove the fee lifecycle end to end — structure, generated records,
--      submitted payment, verification — and marks entry through to publishing.
--   2. Attack every one of those surfaces from a role that should not reach it.
--
-- The second is the larger half, deliberately. As in the Phase 1 suite, the
-- assertions that carry weight are the refusals.
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

SELECT plan(47);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
   'Alpha Academy', 'day', 'combined', 'LSK', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'ZM-NDL-0002', 'org_school_b',
   'Beta School',   'day', 'combined', 'NDL', 'active');

-- School A: two students in different classes, so a teacher scoped to one
-- cannot reach the other.
INSERT INTO public.students
  (id, student_id, school_id, first_name, last_name, grade_id, class_id, is_boarding, status)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'STU-ZM-LSK-0001-00001',
   '11111111-1111-1111-1111-111111111111', 'Alice', 'Alpha', 'grade_7', 'grade_7a', FALSE, 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'STU-ZM-LSK-0001-00002',
   '11111111-1111-1111-1111-111111111111', 'Amos',  'Alpha', 'grade_8', 'grade_8a', FALSE, 'active'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'STU-ZM-NDL-0002-00001',
   '22222222-2222-2222-2222-222222222222', 'Bella', 'Beta',  'grade_7', 'grade_7a', FALSE, 'active');

INSERT INTO public.school_subjects (id, school_id, subject_code, subject_name, level_type)
VALUES
  ('dddddddd-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'MAT', 'Mathematics', 'secondary'),
  ('dddddddd-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'ENG', 'English', 'secondary');

-- teacher_maths teaches MAT to grade_7a and nothing else.
INSERT INTO public.teacher_assignments
  (school_id, teacher_user_id, scope, class_id, subject_id, academic_year)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'user_teacher_maths',
   'subject', 'grade_7a', 'dddddddd-0000-0000-0000-000000000001',
   EXTRACT(YEAR FROM NOW())::TEXT);

INSERT INTO public.parents (id, clerk_user_id, phone_e164, full_name)
VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'user_parent_a', '+260977000001', 'Parent Alpha'),
  ('cccccccc-0000-0000-0000-000000000003', 'user_parent_c', '+260977000003', 'Parent Gamma'),
  ('cccccccc-0000-0000-0000-000000000002', 'user_parent_b', '+260977000002', 'Parent Beta');

INSERT INTO public.student_parent_links (student_id, parent_id, parent_user_id, is_active)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'user_parent_a', TRUE),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003', 'user_parent_c', TRUE),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'user_parent_b', TRUE);

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_claims JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims::TEXT, TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.rows_affected(p_sql TEXT)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE n INT;
BEGIN
  EXECUTE p_sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.accountant_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_acct_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:accountant"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.accountant_b() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_acct_b","o":{"id":"org_school_b","slg":"beta-school","rol":"org:accountant"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.principal_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_principal_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:principal"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.teacher_maths() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_teacher_maths","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:teacher"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.parent_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_parent_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:parent"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.parent_c() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_parent_c","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:parent"}}'::JSONB; $$;

-- ===========================================================================
-- SECTION A — the boundary is switched on for the new tables
-- ===========================================================================

SELECT ok(
  (SELECT bool_and(relrowsecurity AND relforcerowsecurity)
   FROM pg_class
   WHERE relname IN ('fee_structures','fee_records','payments','payment_gateways',
                     'attendance_records','exam_results','report_generation_jobs')
     AND relnamespace = 'public'::regnamespace),
  'every Phase 2 table has RLS both ENABLED and FORCED'
);

SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema = 'public'
     AND grantee IN ('authenticated','anon')
     AND privilege_type IN ('DELETE','TRUNCATE')
     AND table_name IN ('fee_structures','fee_records','payments','payment_gateways',
                        'attendance_records','exam_results','report_generation_jobs')),
  0,
  'no end-user role holds DELETE or TRUNCATE on any Phase 2 table'
);

-- This one failed on the suite's first run: Supabase's default grant had left
-- authenticated holding UPDATE on payments, which 0070's comment claimed it did
-- not. Fixed in 0076. Kept as an assertion so it cannot quietly return.
SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema='public' AND grantee='authenticated'
     AND table_name='payments' AND privilege_type='UPDATE'),
  0,
  'authenticated holds no UPDATE on payments — corrections are reversals, verification is a function'
);

SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema='public' AND grantee IN ('authenticated','anon')
     AND table_name='payments' AND privilege_type IN ('UPDATE','DELETE','TRUNCATE')),
  0,
  'payments exposes no mutating privilege beyond INSERT to any end-user role'
);

-- ===========================================================================
-- SECTION B — the fee lifecycle, end to end
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.accountant_a());

SELECT lives_ok(
  $$INSERT INTO public.fee_structures
      (school_id, academic_year, term_number, grade_id, student_type, fee_label, amount)
    VALUES ('11111111-1111-1111-1111-111111111111', '2026', 1, 'ALL', 'all', 'Tuition Fee', 1500.00)$$,
  'LIFECYCLE 1 accountant creates a fee structure'
);

SELECT is(
  (SELECT created_count FROM public.generate_fee_records('2026', 1, NOW() + INTERVAL '30 days')),
  2,
  'LIFECYCLE 2 generation creates one ledger line per active student (2), and none for school B'
);

-- Re-running must not double anyone's balance.
SELECT is(
  (SELECT created_count FROM public.generate_fee_records('2026', 1)),
  0,
  'LIFECYCLE 3 generation is idempotent — a second run creates nothing'
);

SELECT is(
  (SELECT status FROM public.fee_records
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'unpaid',
  'LIFECYCLE 4 a new fee record starts unpaid'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.parent_a());

SELECT lives_ok(
  $$INSERT INTO public.payments
      (school_id, fee_record_id, student_id, recorded_by_user_id, amount,
       payment_method, status, confirmation_checkbox_at)
    SELECT fr.school_id, fr.id, fr.student_id, 'user_parent_a', 500.00,
           'bank_deposit', 'pending_verification', NOW()
    FROM public.fee_records fr
    WHERE fr.student_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'LIFECYCLE 5 a parent submits a payment against their own child''s fee record'
);

RESET ROLE;

-- The submitted payment must not move the balance. This is the assertion that
-- makes "verification" mean something.
SELECT is(
  (SELECT amount_paid FROM public.fee_records
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0::NUMERIC(12,2),
  'LIFECYCLE 6 a PENDING payment does not reduce the balance'
);

SELECT is(
  (SELECT status FROM public.fee_records
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'unpaid',
  'LIFECYCLE 7 the fee record is still unpaid while the payment is pending'
);

/*
  `PAY-` while pending, not `REC-`.

  This assertion used to want `REC-` here, and `0211` deliberately changed that.
  A receipt is evidence that money was received; issuing one the moment a parent
  CLAIMS to have paid means the school hands out receipts for money nobody has
  confirmed. Five of 312 live payments were found holding exactly that.

  The two live in different columns, which is better than one column changing
  meaning: `submission_reference` carries `PAY-` from insert, and
  `receipt_number` stays NULL until verification fills it with `REC-`. The
  table's CHECK enforces the second half — `status <> 'verified' OR
  receipt_number IS NOT NULL`.

  Asserted at both points now: 8 and 8a here while pending, 8b after the
  accountant verifies at LIFECYCLE 9.
*/
SELECT matches(
  (SELECT submission_reference FROM public.payments LIMIT 1),
  '^PAY-ZM-LSK-0001-\d{6}$',
  'LIFECYCLE 8 a pending payment carries a PAY- submission reference'
);

-- And NO receipt number at all, which the table's own CHECK encodes:
-- `status <> 'verified' OR receipt_number IS NOT NULL`.
SELECT ok(
  (SELECT receipt_number IS NULL FROM public.payments LIMIT 1),
  'LIFECYCLE 8a a pending payment has no receipt number — nobody has confirmed the money'
);

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.accountant_a());

SELECT lives_ok(
  $$SELECT public.verify_payment((SELECT id FROM public.payments LIMIT 1), 'verified')$$,
  'LIFECYCLE 9 the accountant verifies the payment'
);

-- The receipt number proper, issued only now that somebody has confirmed the money.
SELECT matches(
  (SELECT receipt_number FROM public.payments LIMIT 1),
  '^REC-ZM-LSK-0001-\d{6}$',
  'LIFECYCLE 8b verification turns the reference into a receipt number'
);

RESET ROLE;

SELECT is(
  (SELECT amount_paid FROM public.fee_records
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  500.00::NUMERIC(12,2),
  'LIFECYCLE 10 verification moves the balance'
);

SELECT is(
  (SELECT status FROM public.fee_records
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'partial',
  'LIFECYCLE 11 a part payment against 1500 leaves the record partial'
);

SELECT ok(
  (SELECT verified_by = 'user_acct_a' AND verified_at IS NOT NULL
   FROM public.payments LIMIT 1),
  'LIFECYCLE 12 verification is attributed — who and when are both recorded'
);

-- ===========================================================================
-- SECTION C — attacks on fees
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.parent_a());

SELECT is(
  (SELECT count(*)::INT FROM public.fee_records),
  1,
  'parent A sees exactly their own child''s 1 fee record'
);

SELECT is(
  (SELECT count(*)::INT FROM public.fee_records
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0,
  'ATTACK parent A cannot see another child''s fees at the SAME school'
);

SELECT is(
  (SELECT count(*)::INT FROM public.payments
   WHERE recorded_by_user_id <> 'user_parent_a'),
  0,
  'ATTACK parent A cannot see payments belonging to other families'
);

SELECT throws_ok(
  $$SELECT public.verify_payment((SELECT id FROM public.payments LIMIT 1), 'verified')$$,
  '42501',
  NULL,
  'ATTACK a parent cannot verify their own payment'
);

-- A parent inserting a row that claims to be already verified would bypass the
-- entire workflow, so the policy pins status on insert.
SELECT throws_ok(
  $$INSERT INTO public.payments
      (school_id, fee_record_id, student_id, recorded_by_user_id, amount,
       payment_method, status, verified_by, verified_at)
    SELECT fr.school_id, fr.id, fr.student_id, 'user_parent_a', 999.00,
           'cash', 'verified', 'user_parent_a', NOW()
    FROM public.fee_records fr LIMIT 1$$,
  '42501',
  NULL,
  'ATTACK a parent cannot submit a payment that claims to be already verified'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.parent_c());

SELECT is(
  (SELECT count(*)::INT FROM public.fee_records
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'ATTACK parent C cannot read parent A''s child''s fee record'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.teacher_maths());

SELECT is(
  (SELECT count(*)::INT FROM public.fee_records),
  0,
  'ATTACK a teacher reaching a class does NOT thereby reach its fee records'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.accountant_b());

SELECT is(
  (SELECT count(*)::INT FROM public.fee_records),
  0,
  'ATTACK school B''s accountant cannot read school A fee records'
);

SELECT is(
  (SELECT count(*)::INT FROM public.payments),
  0,
  'ATTACK school B''s accountant cannot read school A payments'
);

SELECT throws_ok(
  $$INSERT INTO public.fee_structures
      (school_id, academic_year, term_number, grade_id, fee_label, amount)
    VALUES ('11111111-1111-1111-1111-111111111111', '2026', 2, 'ALL', 'Planted Fee', 1.00)$$,
  '42501',
  NULL,
  'ATTACK school B''s accountant cannot create a fee structure at school A'
);

SELECT throws_ok(
  $$SELECT public.verify_payment((SELECT id FROM public.payments LIMIT 1), 'verified')$$,
  'P0002',
  NULL,
  'ATTACK school B''s accountant cannot verify a school A payment (the row is invisible to them)'
);

RESET ROLE;

-- ===========================================================================
-- SECTION D — attendance, scoped by the ADR-037 model
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.teacher_maths());

SELECT lives_ok(
  $$INSERT INTO public.attendance_records
      (school_id, student_id, class_id, recorded_by_user_id, attendance_date,
       academic_year, term_number, status)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-000000000001', 'grade_7a', 'user_teacher_maths',
            CURRENT_DATE, '2026', 1, 'present')$$,
  'ATTENDANCE teacher marks the class they reach'
);

-- The assertion the brief called for.
SELECT throws_ok(
  $$INSERT INTO public.attendance_records
      (school_id, student_id, class_id, recorded_by_user_id, attendance_date,
       academic_year, term_number, status)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-000000000002', 'grade_8a', 'user_teacher_maths',
            CURRENT_DATE, '2026', 1, 'absent')$$,
  '42501',
  NULL,
  'ATTACK teacher CANNOT mark attendance for a class they do not teach'
);

SELECT is(
  (SELECT count(*)::INT FROM public.attendance_records WHERE class_id = 'grade_8a'),
  0,
  'ATTACK teacher cannot read attendance for a class they do not teach'
);

SELECT throws_ok(
  $$INSERT INTO public.attendance_records
      (school_id, student_id, class_id, recorded_by_user_id, attendance_date,
       academic_year, term_number, status)
    VALUES ('22222222-2222-2222-2222-222222222222',
            'bbbbbbbb-0000-0000-0000-000000000001', 'grade_7a', 'user_teacher_maths',
            CURRENT_DATE, '2026', 1, 'present')$$,
  '42501',
  NULL,
  'ATTACK teacher cannot mark attendance at another school'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.parent_a());

SELECT is(
  (SELECT count(*)::INT FROM public.attendance_records),
  1,
  'parent A sees their own child''s attendance'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.parent_c());

SELECT is(
  (SELECT count(*)::INT FROM public.attendance_records),
  0,
  'ATTACK parent C cannot read another child''s attendance at the same school'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.accountant_b());

SELECT is(
  (SELECT count(*)::INT FROM public.attendance_records),
  0,
  'ATTACK school B cannot read school A attendance'
);

RESET ROLE;

-- ===========================================================================
-- SECTION E — marks entry and publishing
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.teacher_maths());

SELECT lives_ok(
  $$INSERT INTO public.exam_results
      (school_id, student_id, class_id, academic_year, term_number,
       subject_code, subject_name, entered_by_user_id, marks_obtained, marks_total)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-000000000001', 'grade_7a', '2026', 1,
            'MAT', 'Mathematics', 'user_teacher_maths', 78.00, 100)$$,
  'MARKS teacher enters marks for the subject and class they teach'
);

-- Required by the brief.
SELECT throws_ok(
  $$INSERT INTO public.exam_results
      (school_id, student_id, class_id, academic_year, term_number,
       subject_code, subject_name, entered_by_user_id, marks_obtained, marks_total)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-000000000002', 'grade_8a', '2026', 1,
            'MAT', 'Mathematics', 'user_teacher_maths', 90.00, 100)$$,
  '42501',
  NULL,
  'ATTACK teacher CANNOT enter marks for a class they do not teach'
);

-- Subject scope is narrower than class scope: this teacher reaches grade_7a for
-- MAT only, so ENG in the same class must be refused.
SELECT throws_ok(
  $$INSERT INTO public.exam_results
      (school_id, student_id, class_id, academic_year, term_number,
       subject_code, subject_name, entered_by_user_id, marks_obtained, marks_total)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-000000000001', 'grade_7a', '2026', 1,
            'ENG', 'English', 'user_teacher_maths', 65.00, 100)$$,
  '42501',
  NULL,
  'ATTACK subject teacher cannot enter marks for a DIFFERENT subject in a class they do reach'
);

SELECT throws_ok(
  $$UPDATE public.exam_results SET results_published = TRUE
    WHERE subject_code = 'MAT'$$,
  '42501',
  NULL,
  'ATTACK a teacher cannot publish results by flipping the flag on their own row'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.parent_a());

SELECT is(
  (SELECT count(*)::INT FROM public.exam_results),
  0,
  'ATTACK parent cannot see UNPUBLISHED marks'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.teacher_maths());

SELECT throws_ok(
  $$SELECT public.publish_results('2026', 1)$$,
  '42501',
  NULL,
  'ATTACK a teacher cannot call publish_results'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.principal_a());

SELECT is(
  (SELECT public.publish_results('2026', 1)),
  1,
  'PUBLISH the principal publishes the entered mark'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.parent_a());

SELECT is(
  (SELECT count(*)::INT FROM public.exam_results),
  1,
  'PUBLISH the parent can now see the published result'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.teacher_maths());

-- Publication is the lock, and it is enforced in the policy rather than the
-- application — otherwise any direct PostgREST call would bypass it.
SELECT is(
  pg_temp.rows_affected(
    $$UPDATE public.exam_results SET marks_obtained = 99 WHERE subject_code = 'MAT'$$),
  0,
  'ATTACK teacher cannot edit a mark after publication'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.accountant_b());

SELECT is(
  (SELECT count(*)::INT FROM public.exam_results),
  0,
  'ATTACK school B cannot read school A results'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(
  '{"sub":"user_afritech","o":{"id":"org_afritech","slg":"afritech-systems-admin","rol":"org:owner"}}'::JSONB);

-- afritech_admin_all_payments is FOR ALL, so it covers UPDATE. Only the absence
-- of the table privilege stops an in-place edit — which is the whole point of
-- 0076, and the reason payments stay immutable for everyone.
SELECT throws_ok(
  $$UPDATE public.payments SET amount = 1$$,
  '42501',
  NULL,
  'ATTACK even the AfriTech super admin cannot edit a payment in place'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
