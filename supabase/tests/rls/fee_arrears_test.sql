-- ===========================================================================
-- Fee arrears — carry-forward, allocation, revision.
--
-- Spec: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-038
--       Official Documentation/01 Foundation Layer/RLS.md
--
-- Three things this suite exists to prove:
--
--   1. Debt carries across term AND academic-year boundaries, and survives a
--      student becoming transferred or graduated.
--   2. The derived views are RLS-safe. A view defaults to running with its
--      OWNER's privileges, which would hand every parent every family's
--      balance — so the security_invoker setting is attacked directly.
--   3. The model NEVER gates. An outstanding balance must not block publishing
--      results or any other action; gating is a future school-configured
--      setting, off by default.
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

SELECT plan(38);

-- ---------------------------------------------------------------------------
-- Fixtures — two schools, two families at school A, debt spanning two years
-- ---------------------------------------------------------------------------

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
   'Alpha Academy', 'day', 'combined', 'LSK', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'ZM-NDL-0002', 'org_school_b',
   'Beta School',   'day', 'combined', 'NDL', 'active');

INSERT INTO public.students
  (id, student_id, school_id, first_name, last_name, grade_id, class_id, status)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'STU-ZM-LSK-0001-00001',
   '11111111-1111-1111-1111-111111111111', 'Alice', 'Alpha', 'grade_7', 'grade_7a', 'active'),
  -- Deliberately graduated, still owing. Schools withhold certificates until
  -- cleared, so the balance must not vanish with the status change.
  ('aaaaaaaa-0000-0000-0000-000000000002', 'STU-ZM-LSK-0001-00002',
   '11111111-1111-1111-1111-111111111111', 'Amos',  'Alpha', 'grade_12', 'grade_12a', 'graduated'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'STU-ZM-NDL-0002-00001',
   '22222222-2222-2222-2222-222222222222', 'Bella', 'Beta',  'grade_7', 'grade_7a', 'active');

INSERT INTO public.parents (id, clerk_user_id, phone_e164, full_name)
VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'user_parent_a', '+260977000001', 'Parent Alpha'),
  ('cccccccc-0000-0000-0000-000000000003', 'user_parent_c', '+260977000003', 'Parent Gamma');

INSERT INTO public.student_parent_links (student_id, parent_id, parent_user_id, is_active)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'user_parent_a', TRUE),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003', 'user_parent_c', TRUE);

INSERT INTO public.fee_structures (id, school_id, academic_year, term_number, grade_id, fee_label, amount)
VALUES
  ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '2026', 3, 'ALL', 'Tuition Fee', 1000.00),
  ('eeeeeeee-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '2027', 1, 'ALL', 'Tuition Fee', 1200.00);

-- Alice: 2026 T3 overdue and unpaid, 2027 T1 not yet due.
INSERT INTO public.fee_records
  (id, school_id, student_id, fee_structure_id, academic_year, term_number,
   fee_label, amount_due, due_date)
VALUES
  ('ffffffff-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001',
   '2026', 3, 'Tuition Fee', 1000.00, NOW() - INTERVAL '40 days'),
  ('ffffffff-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000002',
   '2027', 1, 'Tuition Fee', 1200.00, NOW() + INTERVAL '20 days'),
  -- Amos graduated owing 800.
  ('ffffffff-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001',
   '2026', 3, 'Tuition Fee', 800.00, NOW() - INTERVAL '90 days');

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_claims JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', p_claims::TEXT, TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.accountant_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_acct_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:accountant"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.accountant_b() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_acct_b","o":{"id":"org_school_b","slg":"beta-school","rol":"org:accountant"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.principal_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_principal_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:principal"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.parent_a() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_parent_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:parent"}}'::JSONB; $$;
CREATE OR REPLACE FUNCTION pg_temp.parent_c() RETURNS JSONB LANGUAGE SQL AS $$
  SELECT '{"sub":"user_parent_c","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:parent"}}'::JSONB; $$;

-- ===========================================================================
-- SECTION A — carry-forward across term and year
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.accountant_a());

SELECT is(
  (SELECT outstanding FROM public.student_fee_balance
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2200.00::NUMERIC(12,2),
  'CARRY debt spans the 2026/2027 year boundary — 1000 + 1200 in one balance'
);

SELECT is(
  (SELECT arrears_amount FROM public.student_fee_balance
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1000.00::NUMERIC(12,2),
  'CARRY arrears counts only the overdue portion, not the whole balance'
);

SELECT ok(
  (SELECT is_overdue FROM public.student_fee_balance
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'CARRY the overdue flag is set from the 2026 record'
);

SELECT ok(
  (SELECT days_overdue BETWEEN 39 AND 41 FROM public.student_fee_balance
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'CARRY days_overdue is derived from the oldest unpaid due date'
);

SELECT is(
  (SELECT records_overdue FROM public.student_fee_balance
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'CARRY only the past-due record counts as overdue'
);

-- A graduated student's debt is exactly the case schools care about.
SELECT is(
  (SELECT outstanding FROM public.student_fee_balance
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  800.00::NUMERIC(12,2),
  'CARRY a GRADUATED student''s balance survives the status change'
);

SELECT is(
  (SELECT student_status FROM public.student_fee_balance
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'graduated',
  'CARRY the balance row carries the student status, so a bursar sees why it is listed'
);

-- ===========================================================================
-- SECTION B — the statement reads like a ledger
-- ===========================================================================

SELECT ok(
  (SELECT count(*) > 0 FROM public.fee_statement('aaaaaaaa-0000-0000-0000-000000000001')),
  'STATEMENT returns ledger rows for a student the caller may see'
);

SELECT is(
  (SELECT running_balance FROM public.fee_statement('aaaaaaaa-0000-0000-0000-000000000001')
   ORDER BY entry_date DESC, entry_type DESC LIMIT 1),
  2200.00::NUMERIC(12,2),
  'STATEMENT the closing running balance equals the outstanding total'
);

SELECT ok(
  (SELECT bool_or(entry_type = 'brought_forward')
   FROM public.fee_statement('aaaaaaaa-0000-0000-0000-000000000001', CURRENT_DATE - 5, CURRENT_DATE + 30)),
  'STATEMENT a windowed statement opens with a computed Balance brought forward'
);

SELECT is(
  (SELECT running_balance
   FROM public.fee_statement('aaaaaaaa-0000-0000-0000-000000000001', CURRENT_DATE - 5, CURRENT_DATE + 30)
   WHERE entry_type = 'brought_forward'),
  1000.00::NUMERIC(12,2),
  'STATEMENT brought-forward equals the prior term still owed'
);

-- 0077 ordered by entry_date alone. A term's charges are all written in one
-- statement, so they shared a timestamp and the closing balance varied between
-- identical calls. Fixed in 0081 by dating charges at due_date and ordering on
-- a complete key. A statement that reads differently each time is not a
-- financial document.
SELECT is(
  (SELECT count(DISTINCT rb)::INT
   FROM (
     SELECT (SELECT running_balance
             FROM public.fee_statement('aaaaaaaa-0000-0000-0000-000000000001')
             ORDER BY entry_date DESC, entry_type DESC LIMIT 1) AS rb
     FROM generate_series(1, 8)
   ) t),
  1,
  'STATEMENT repeated calls return one and only one closing balance'
);

SELECT is(
  (SELECT string_agg(running_balance::TEXT, ',' ORDER BY entry_date, entry_type)
   FROM public.fee_statement('aaaaaaaa-0000-0000-0000-000000000001')),
  '1000.00,2200.00',
  'STATEMENT the ledger accumulates oldest-due first'
);

RESET ROLE;

-- ===========================================================================
-- SECTION C — the views are RLS-safe
--
-- A view runs as its OWNER unless security_invoker is set. If that setting were
-- missing, every assertion below would leak another family's money.
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.parent_a());

SELECT is(
  (SELECT count(*)::INT FROM public.student_fee_balance),
  1,
  'RLS parent A sees exactly one balance row — their own child'
);

SELECT is(
  (SELECT student_id FROM public.student_fee_balance),
  'aaaaaaaa-0000-0000-0000-000000000001'::UUID,
  'RLS the visible balance is theirs'
);

SELECT is(
  (SELECT count(*)::INT FROM public.student_fee_balance
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0,
  'ATTACK parent A cannot see another child''s balance at the SAME school'
);

SELECT is(
  (SELECT count(*)::INT FROM public.fee_record_status
   WHERE student_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  0,
  'ATTACK parent A cannot see another child''s per-record status'
);

SELECT is(
  (SELECT count(*)::INT FROM public.fee_statement('aaaaaaaa-0000-0000-0000-000000000002')),
  0,
  'ATTACK parent A gets an empty statement for another family''s child'
);

SELECT is(
  (SELECT count(*)::INT FROM public.suggest_payment_allocation(
     'aaaaaaaa-0000-0000-0000-000000000002', 500.00)),
  0,
  'ATTACK parent A gets no allocation suggestion for another family''s child'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.accountant_b());

SELECT is(
  (SELECT count(*)::INT FROM public.student_fee_balance),
  0,
  'ATTACK school B sees no school A balances through the view'
);

SELECT is(
  (SELECT count(*)::INT FROM public.fee_record_status),
  0,
  'ATTACK school B sees no school A record statuses through the view'
);

RESET ROLE;

-- ===========================================================================
-- SECTION D — lump-sum allocation
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.accountant_a());

-- 1500 against 1000 (overdue) then 1200: oldest-first fills the old debt first.
SELECT is(
  (SELECT suggested FROM public.suggest_payment_allocation(
     'aaaaaaaa-0000-0000-0000-000000000001', 1500.00)
   ORDER BY due_date LIMIT 1),
  1000.00::NUMERIC(12,2),
  'ALLOCATE oldest-first fills the overdue 2026 record first'
);

SELECT is(
  (SELECT suggested FROM public.suggest_payment_allocation(
     'aaaaaaaa-0000-0000-0000-000000000001', 1500.00)
   ORDER BY due_date DESC LIMIT 1),
  500.00::NUMERIC(12,2),
  'ALLOCATE the remainder flows to the next record, not beyond the payment'
);

SELECT is(
  (SELECT count(*)::INT FROM public.allocate_payment(
     'aaaaaaaa-0000-0000-0000-000000000001', 1500.00, 'bank_deposit')),
  2,
  'ALLOCATE a lump sum becomes one pending payment per record'
);

-- The bursar override: clear the CURRENT term so a child can sit an exam, while
-- an older disputed amount deliberately stays open.
SELECT is(
  (SELECT out_fee_record_id FROM public.allocate_payment(
     'aaaaaaaa-0000-0000-0000-000000000001', 200.00, 'cash',
     '[{"fee_record_id":"ffffffff-0000-0000-0000-000000000002","amount":200.00}]'::JSONB)),
  'ffffffff-0000-0000-0000-000000000002'::UUID,
  'ALLOCATE an explicit override targets the newer term, leaving the disputed debt alone'
);

/*
  Paying into someone else's ledger is the attack this guard exists for.

  The guard is real and this assertion only started running once `0232` fixed
  `allocate_payment`'s other branch — until then the suite died before reaching
  it. What it got wrong is the code: the function raises `22023`, not `42501`.

  `22023` is the better answer and the expectation is corrected rather than the
  function. An accountant IS entitled to touch both pupils' records; what they
  may not do is put this pupil's payment against that pupil's bill. That is an
  incoherent pair of arguments, not a privilege they lack — and `42501` renders
  as FORBIDDEN, which would tell them to ask for access they already have.

  It also keeps "not found" and "not permitted" as one answer: a fee record in
  another SCHOOL is hidden by RLS, so the LEFT JOIN finds nothing and the same
  `22023` comes back. Neither reveals whether the row exists.
*/
SELECT throws_ok(
  $$SELECT public.allocate_payment(
      'aaaaaaaa-0000-0000-0000-000000000001', 100.00, 'cash',
      '[{"fee_record_id":"ffffffff-0000-0000-0000-000000000003","amount":100.00}]'::JSONB)$$,
  '22023',
  NULL,
  'ATTACK allocation cannot target another student''s fee record'
);

SELECT throws_ok(
  $$SELECT public.allocate_payment(
      'aaaaaaaa-0000-0000-0000-000000000001', 100.00, 'cash',
      '[{"fee_record_id":"ffffffff-0000-0000-0000-000000000001","amount":900.00}]'::JSONB)$$,
  '22023',
  NULL,
  'ATTACK allocations totalling more than the payment are refused'
);

-- ===========================================================================
-- SECTION E — revision
-- ===========================================================================

SELECT is(
  (SELECT revised_count FROM public.revise_fee_records(
     '2027', 1, 'Tuition Fee', 1300.00, 'Board approved mid-year adjustment')),
  1,
  'REVISE an issued term fee can be corrected — the gap generate_fee_records left'
);

SELECT is(
  (SELECT amount_due FROM public.fee_records
   WHERE id = 'ffffffff-0000-0000-0000-000000000002'),
  1300.00::NUMERIC(12,2),
  'REVISE the amount is updated on the issued record'
);

SELECT is(
  (SELECT count(*)::INT FROM public.fee_record_revisions
   WHERE fee_record_id = 'ffffffff-0000-0000-0000-000000000002'),
  1,
  'REVISE the change is audited with old and new amounts'
);

SELECT throws_ok(
  $$SELECT public.revise_fee_records('2027', 1, 'Tuition Fee', 1300.00, '')$$,
  '23514',
  NULL,
  'ATTACK a revision without a reason is refused'
);

-- ---------------------------------------------------------------------------
-- The money-integrity guard.
--
-- This was implemented in 0079 but had NO test until it was added here — the
-- suite covered only the missing-reason branch. Cutting a fee below what has
-- already been verified as paid would manufacture a credit the school never
-- agreed to, and on a settled record would silently reopen it.
-- ---------------------------------------------------------------------------

-- Alice's 2026 T3 record: give it a verified payment of 900 against 1000.
INSERT INTO public.payments
  (school_id, fee_record_id, student_id, recorded_by_user_id, amount,
   payment_method, status, verified_by, verified_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 'user_acct_a', 900.00,
   'cash', 'verified', 'user_acct_a', NOW());

SELECT throws_ok(
  $$SELECT public.revise_fee_records('2026', 3, 'Tuition Fee', 500.00,
      'Attempt to cut the fee below what has been paid')$$,
  '23514',
  NULL,
  'GUARD revise_fee_records REFUSES to drop a fee below verified payments'
);

SELECT is(
  (SELECT amount_due FROM public.fee_records
   WHERE id = 'ffffffff-0000-0000-0000-000000000001'),
  1000.00::NUMERIC(12,2),
  'GUARD the amount is unchanged after the refusal'
);

-- The refusal is checked before any write, so a batch spanning several students
-- is refused whole rather than applied to the ones that happened to qualify.
SELECT is(
  (SELECT count(*)::INT FROM public.fee_record_revisions
   WHERE fee_record_id = 'ffffffff-0000-0000-0000-000000000001'),
  0,
  'GUARD the refusal is atomic — no audit row is written for a refused revision'
);

SELECT is(
  (SELECT revised_count FROM public.revise_fee_records(
     '2026', 3, 'Tuition Fee', 950.00, 'Board approved reduction, above amount paid')),
  2,
  'GUARD a revision at or above the paid amount is allowed'
);

SELECT is(
  (SELECT status FROM public.fee_records
   WHERE id = 'ffffffff-0000-0000-0000-000000000001'),
  'partial',
  'GUARD status is re-derived after revision — 900 paid of 950 is partial'
);

RESET ROLE;

-- ===========================================================================
-- SECTION F — the model never gates
--
-- Alice has 2200 outstanding, 1000 of it overdue. Publishing must still work.
-- If this ever fails, someone has wired arrears into an enforcement path, and
-- that is a per-school setting rather than system behaviour (ADR-038).
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT pg_temp.act_as(pg_temp.principal_a());

SELECT lives_ok(
  $$SELECT public.publish_results('2026', 3)$$,
  'NO-GATE results publish normally while the student is in arrears'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::INT FROM information_schema.role_table_grants
   WHERE table_schema='public' AND grantee IN ('authenticated','anon')
     AND table_name='fee_record_revisions'
     AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')),
  0,
  'the revision audit trail cannot be written or erased by any end-user role'
);

SELECT * FROM finish();

ROLLBACK;
