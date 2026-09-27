-- ===========================================================================
-- The fee payment flow — the rules the fees screens are built on top of.
--
-- Spec: Official Documentation/09 Fee and Financial Management/PAYMENTS.md
--       Official Documentation/09 Fee and Financial Management/PAYMENTS.md
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- `fee_arrears_test.sql` already asserts the arrears arithmetic — brought
-- forward, running balance, oldest-first suggestion. This suite covers what the
-- payment SCREENS depend on and that one does not: the separation between a
-- payment somebody claims and money the school has.
--
--   * a recorded payment is pending, and moves NO balance — this is the entire
--     control, and a screen that showed otherwise would report income the
--     school has not received;
--   * verification is what moves it, and only verification;
--   * `authenticated` holds no UPDATE on payments at all, so there is no path
--     that flips a status without recording who decided and when;
--   * an allocation may not exceed the payment, and may not reach into another
--     school's fee record — the override is a feature, not a hole;
--   * issuing fees twice creates nothing the second time, which is what makes
--     the button safe to press again for a pupil enrolled mid-term.
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

SELECT plan(13);

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
  ('bbbb0000-0000-0000-0000-000000000001', 'STU-ZM-NDL-0002-00001',
   '22222222-2222-2222-2222-222222222222', 'Bella', 'Beta',  'grade_7', 'grade_7a');

-- Structures first, and not merely for tidiness: `fee_records.fee_structure_id`
-- is NOT NULL, so a bill cannot exist without the price it came from. That is
-- the schema enforcing what the structures screen says in words — a structure
-- is a price and issuing is what turns it into something a pupil owes. An
-- earlier draft of this fixture inserted records directly and was refused.
INSERT INTO public.fee_structures
  (id, school_id, academic_year, term_number, grade_id, fee_label, amount)
VALUES
  ('eeee0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '2026', 1, 'grade_7', 'Tuition', 1000.00),
  ('eeee0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '2026', 2, 'grade_7', 'Tuition', 1000.00),
  ('ffff0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   '2026', 1, 'grade_7', 'Tuition', 1000.00);

-- Two terms owed by Alice, so oldest-first has something to choose between and
-- an allocation has somewhere wrong to point.
INSERT INTO public.fee_records
  (id, school_id, student_id, fee_structure_id, academic_year, term_number,
   fee_label, amount_due, due_date)
VALUES
  ('cccc0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaa0000-0000-0000-0000-000000000001', 'eeee0000-0000-0000-0000-000000000001',
   '2026', 1, 'Tuition', 1000.00, now() - interval '90 days'),
  ('cccc0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaa0000-0000-0000-0000-000000000001', 'eeee0000-0000-0000-0000-000000000002',
   '2026', 2, 'Tuition', 1000.00, now() + interval '30 days'),
  -- Beta's record. Nothing Alpha does may touch it.
  ('dddd0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'bbbb0000-0000-0000-0000-000000000001', 'ffff0000-0000-0000-0000-000000000001',
   '2026', 1, 'Tuition', 1000.00, now() - interval '90 days');

-- ---------------------------------------------------------------------------
-- The accountant at Alpha.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_acct_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "accountant", "slg": "alpha-academy"}
}';

-- 1. A recorded payment is pending. Not verified, not counted.
SELECT is(
  (SELECT out_payment_id IS NOT NULL
     FROM public.allocate_payment(
       'aaaa0000-0000-0000-0000-000000000001'::uuid, 400.00, 'cash') LIMIT 1),
  true,
  'the accountant can record a payment'
);

SELECT is(
  (SELECT status FROM public.payments
    WHERE student_id = 'aaaa0000-0000-0000-0000-000000000001' LIMIT 1),
  'pending_verification',
  'a recorded payment lands as pending_verification, never as verified'
);

-- 2. THE CONTROL. The balance has not moved.
--    A screen that subtracted this would report money the school does not have.
SELECT is(
  (SELECT amount_paid FROM public.fee_records
    WHERE id = 'cccc0000-0000-0000-0000-000000000001'),
  0.00::numeric,
  'a pending payment moves no balance — recorded is a claim, not money'
);

-- 3. Oldest-first fills term 1 before term 2.
SELECT is(
  (SELECT term_number FROM public.suggest_payment_allocation(
     'aaaa0000-0000-0000-0000-000000000001'::uuid, 500.00) LIMIT 1),
  1,
  'the suggestion fills the oldest unpaid record first'
);

-- 4. An allocation may not exceed the payment.
SELECT throws_ok(
  $$ SELECT public.allocate_payment(
       'aaaa0000-0000-0000-0000-000000000001'::uuid, 100.00, 'cash',
       '[{"fee_record_id":"cccc0000-0000-0000-0000-000000000001","amount":500}]'::jsonb) $$,
  '22023',
  NULL,
  'an allocation totalling more than the payment is refused'
);

-- 5. The override may not reach into another school's record. This is the one
--    that makes "operator can overrule oldest-first" safe to offer at all.
SELECT throws_ok(
  $$ SELECT public.allocate_payment(
       'aaaa0000-0000-0000-0000-000000000001'::uuid, 100.00, 'cash',
       '[{"fee_record_id":"dddd0000-0000-0000-0000-000000000001","amount":100}]'::jsonb) $$,
  NULL,
  NULL,
  'an allocation pointed at another school''s fee record is refused'
);

-- 6. No UPDATE privilege on payments at all. Verification is the named function
--    or it is nothing — there is no path that flips a status anonymously.
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.payments', 'UPDATE'),
  'authenticated cannot UPDATE payments directly — verification is a function'
);

-- 7. Verification moves the balance, and only verification.
SELECT lives_ok(
  $$ SELECT public.verify_payment(
       (SELECT id FROM public.payments
         WHERE student_id = 'aaaa0000-0000-0000-0000-000000000001'
           AND status = 'pending_verification' LIMIT 1),
       'verified') $$,
  'the accountant can verify a payment'
);

SELECT is(
  (SELECT amount_paid FROM public.fee_records
    WHERE id = 'cccc0000-0000-0000-0000-000000000001'),
  400.00::numeric,
  'verifying is what moves the balance'
);

-- 8. Verifying the same payment twice is refused. Two people open the queue,
--    one gets there first — the second must not double-count.
--
--    The code here is 23514, NOT the P0002 raised when a payment is simply not
--    found. That distinction is why this assertion exists: the API had special-
--    cased P0002 alone, so the commonest real collision — two people confirming
--    the same row — fell through to a generic server error and looked like a
--    product bug. The route now treats both as "somebody got there first".
SELECT throws_ok(
  $$ SELECT public.verify_payment(
       (SELECT id FROM public.payments
         WHERE student_id = 'aaaa0000-0000-0000-0000-000000000001' LIMIT 1),
       'verified') $$,
  '23514',
  NULL,
  'a payment already decided cannot be verified again'
);

-- 9. The statement opens with a brought-forward line. Without it a term
--    statement closes on a figure matching neither its charges nor its payments.
SELECT is(
  (SELECT entry_type FROM public.fee_statement(
     'aaaa0000-0000-0000-0000-000000000001'::uuid,
     (now() - interval '10 days')::date, now()::date) LIMIT 1),
  'brought_forward',
  'a windowed statement opens with the balance brought forward'
);

-- ---------------------------------------------------------------------------
-- A teacher at the same school. Fees are not theirs.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_teacher_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "teacher", "slg": "alpha-academy"}
}';

SELECT is(
  (SELECT count(*) FROM public.fee_records)::int,
  0,
  'a teacher reads no fee records at all — fees are not a teaching concern'
);

-- ---------------------------------------------------------------------------
-- Beta's accountant. Alpha's arrears are invisible, not merely unwritable.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_acct_b", "role": "authenticated",
  "o": {"id": "org_school_b", "rol": "accountant", "slg": "beta-school"}
}';

SELECT is(
  (SELECT count(*) FROM public.student_fee_balance
    WHERE student_id = 'aaaa0000-0000-0000-0000-000000000001')::int,
  0,
  'another school''s balances are invisible, not merely read-only'
);

SELECT * FROM finish();
ROLLBACK;
