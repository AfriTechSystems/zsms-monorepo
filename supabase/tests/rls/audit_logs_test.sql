-- ===========================================================================
-- The audit trail — the two gates that could not pass, and the reasons they now can.
--
-- Spec: Official Documentation/01 Foundation Layer/DATABASE.md — public.audit_logs
--       Official Documentation/01 Foundation Layer/BUILD_SEQUENCE.md — Phase 0 and 3 gates
--       Official Documentation/01 Foundation Layer/COMPLIANCE.md
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- `BUILD_SEQUENCE.md` names two gates this table exists to satisfy, and both are asserted
-- here literally rather than paraphrased:
--
--   * Phase 0 — "`audit_logs` not updatable"
--   * Phase 3 — "Every financial event writes an immutable `audit_logs` row"
--
-- The interesting assertions are the ones about who CANNOT rewrite history. RLS is not
-- enough on its own, because **`service_role` bypasses RLS entirely** and a worker or a
-- future Edge Function holds that key. So immutability is a trigger, and this suite proves
-- it holds against `service_role` and against the table owner — the two callers a
-- policy-based design would silently permit.
--
-- The other half is that the trail must not become a second, less-protected copy of the
-- PII it describes. A school owner can read it, and it therefore must not contain an
-- identity number.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

-- pgTAP lives in `extensions` (migration 0001). A direct pg_prove connection has a
-- search_path of `"$user", public`, so `plan()` would not resolve. `public` stays first so
-- unqualified table names resolve as normal.
SET search_path TO public, extensions;

SELECT plan(22);

-- ---------------------------------------------------------------------------
-- Two schools, so the trail can be shown not to cross between them.
-- ---------------------------------------------------------------------------
INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
   'Alpha Academy', 'day', 'combined', 'LSK', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'ZM-NDL-0002', 'org_school_b',
   'Beta School', 'day', 'combined', 'NDL', 'active');

-- ---------------------------------------------------------------------------
-- The owner of Alpha enrols a pupil, carrying an identity number.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_owner_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "owner", "slg": "alpha-academy"}
}';

INSERT INTO public.students
  (id, student_id, school_id, first_name, last_name, grade_id, class_id, nrc_or_birth_cert)
VALUES
  ('aaaa0000-0000-0000-0000-000000000001', 'STU-ZM-LSK-0001-00001',
   '11111111-1111-1111-1111-111111111111', 'Aud', 'Itor', 'grade_7', 'grade_7a',
   '123456/78/9');

-- 1. The trigger fired without anybody asking it to. This is the property the whole design
--    rests on: no application path can skip it, including one written later by somebody who
--    has not read the migration.
SELECT is(
  (SELECT action FROM public.audit_logs
    WHERE record_id = 'aaaa0000-0000-0000-0000-000000000001' AND table_name = 'students'),
  'create',
  'enrolling a pupil writes an audit row, with nothing in the API asking for it'
);

-- 2. THE PII BOUNDARY. A school owner can read this trail, so an identity number must not
--    be sitting in it.
SELECT is(
  (SELECT new_values ->> 'nrc_or_birth_cert' FROM public.audit_logs
    WHERE record_id = 'aaaa0000-0000-0000-0000-000000000001'),
  '[REDACTED]',
  'the identity number is redacted — the trail is not a second copy of the PII'
);

-- 3. And the KEY survives, because "the identity number was changed" is exactly what an
--    investigation needs to know.
SELECT ok(
  (SELECT new_values ? 'nrc_or_birth_cert' FROM public.audit_logs
    WHERE record_id = 'aaaa0000-0000-0000-0000-000000000001'),
  'the column name is kept while only its value is replaced'
);

SELECT is(
  (SELECT actor_user_id FROM public.audit_logs
    WHERE record_id = 'aaaa0000-0000-0000-0000-000000000001'),
  'user_owner_a',
  'the acting user is recorded'
);

-- 4. An UPDATE records what changed and not the whole row — less data, less PII, and the
--    only question anybody asks of an audit row.
UPDATE public.students SET first_name = 'Audrey'
 WHERE id = 'aaaa0000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(new_values) k)
     FROM public.audit_logs
    WHERE record_id = 'aaaa0000-0000-0000-0000-000000000001' AND action = 'update'),
  'first_name',
  'an update records only the columns that actually changed'
);

SELECT is(
  (SELECT old_values ->> 'first_name' FROM public.audit_logs
    WHERE record_id = 'aaaa0000-0000-0000-0000-000000000001' AND action = 'update'),
  'Aud',
  'and keeps the previous value, which is what makes it an audit rather than a log'
);

-- 5. An UPDATE that changes nothing is not an event. Logging it would bury the real ones.
UPDATE public.students SET first_name = 'Audrey'
 WHERE id = 'aaaa0000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM public.audit_logs
    WHERE record_id = 'aaaa0000-0000-0000-0000-000000000001' AND action = 'update'),
  1,
  'an update that changes no value writes no row'
);

-- 6. A removal is a flag in this repository — nothing hard-deletes a pupil — so the trail
--    must name it as a deletion rather than as one more update among many.
UPDATE public.students SET is_deleted = TRUE
 WHERE id = 'aaaa0000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*)::int FROM public.audit_logs
    WHERE record_id = 'aaaa0000-0000-0000-0000-000000000001' AND action = 'soft_delete'),
  1,
  'a soft delete is recorded as soft_delete, not as a generic update'
);

-- ---------------------------------------------------------------------------
-- Nobody writes to this table directly.
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.audit_logs', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.audit_logs', 'DELETE'),
  'authenticated holds no INSERT, UPDATE or DELETE — a row arrives via a definer function or not at all'
);

-- ---------------------------------------------------------------------------
-- PHASE 0 GATE: "audit_logs not updatable". Asserted for every caller that could
-- plausibly try, including the two a policy-only design would let through.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ UPDATE public.audit_logs SET action = 'tampered' WHERE table_name = 'students' $$,
  '42501',
  NULL,
  'a school owner cannot rewrite the trail'
);

SELECT throws_ok(
  $$ DELETE FROM public.audit_logs WHERE table_name = 'students' $$,
  '42501',
  NULL,
  'a school owner cannot delete from the trail'
);

-- THE ONE THAT JUSTIFIES A TRIGGER OVER A POLICY. `service_role` bypasses RLS, so every
-- policy on this table is invisible to it — and a worker holds that key.
SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$ UPDATE public.audit_logs SET action = 'tampered' WHERE table_name = 'students' $$,
  '42501',
  NULL,
  'service_role cannot rewrite the trail, though it bypasses every policy on the table'
);

SELECT throws_ok(
  $$ DELETE FROM public.audit_logs WHERE table_name = 'students' $$,
  '42501',
  NULL,
  'service_role cannot delete from the trail'
);

-- A statement-level trigger, because TRUNCATE is not a row operation — without it, one
-- statement would empty the whole trail while every row-level guard watched.
SELECT throws_ok(
  $$ TRUNCATE public.audit_logs $$,
  '42501',
  NULL,
  'TRUNCATE is refused too — a row trigger alone would not have caught it'
);

RESET ROLE;

-- Not even the table owner, whom FORCE ROW LEVEL SECURITY would also not stop from
-- mutating (it constrains reads and writes against policies, and the owner has none here).
SELECT throws_ok(
  $$ UPDATE public.audit_logs SET action = 'tampered' WHERE table_name = 'students' $$,
  '42501',
  NULL,
  'the table owner cannot rewrite the trail either'
);

-- ---------------------------------------------------------------------------
-- Who may read it. Leadership only, and only their own school.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_owner_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "owner", "slg": "alpha-academy"}
}';

SELECT ok(
  (SELECT count(*) FROM public.audit_logs
    WHERE school_id = '11111111-1111-1111-1111-111111111111') > 0,
  'the owner reads their own school''s trail'
);

-- A teacher must not. These rows carry before-and-after values across marks and fees.
SET LOCAL request.jwt.claims TO '{
  "sub": "user_teacher_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "teacher", "slg": "alpha-academy"}
}';

SELECT is(
  (SELECT count(*)::int FROM public.audit_logs),
  0,
  'a teacher reads none of it — the trail carries every mark and fee change in the school'
);

-- Nor an accountant, though they generate most of the financial rows in it. Creating an
-- event and being entitled to read the whole history of events are different things.
SET LOCAL request.jwt.claims TO '{
  "sub": "user_acct_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "accountant", "slg": "alpha-academy"}
}';

SELECT is(
  (SELECT count(*)::int FROM public.audit_logs),
  0,
  'an accountant reads none of it either — writing events is not reading the history'
);

-- Another school's leadership sees nothing, so the trail is tenant-isolated like everything
-- else rather than being a back door into a neighbour's record.
SET LOCAL request.jwt.claims TO '{
  "sub": "user_owner_b", "role": "authenticated",
  "o": {"id": "org_school_b", "rol": "owner", "slg": "beta-school"}
}';

/*
  Not "sees nothing" — "sees nothing of SCHOOL A's".

  This asserted a count of zero, which was right when it was written and stopped
  being right once `schools` itself gained an audit trigger: creating Beta writes
  a row attributed to Beta, and Beta's owner is entitled to read it. A count of
  zero was therefore testing the absence of Beta's own history, not isolation
  from Alpha's.

  Asking the question the title always meant is both true and stronger — a later
  row legitimately belonging to Beta no longer breaks it, and a leak from Alpha
  still does.
*/
SELECT is(
  (SELECT count(*)::int FROM public.audit_logs
    WHERE school_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'another school''s owner reads nothing — the trail is tenant-isolated'
);

-- ---------------------------------------------------------------------------
-- PHASE 3 GATE: "every financial event writes an immutable audit_logs row".
-- ---------------------------------------------------------------------------
-- The fixture is built as Beta's OWNER, not its accountant: enrolling a pupil and setting a
-- price are not an accountant's to do, and an earlier draft of this suite was refused by the
-- very policies the rest of the repository asserts. The accountant takes over for the
-- payment, which IS theirs.
SET LOCAL request.jwt.claims TO '{
  "sub": "user_owner_b", "role": "authenticated",
  "o": {"id": "org_school_b", "rol": "owner", "slg": "beta-school"}
}';

INSERT INTO public.students (id, student_id, school_id, first_name, last_name, grade_id, class_id)
VALUES ('bbbb0000-0000-0000-0000-000000000001', 'STU-ZM-NDL-0002-00001',
        '22222222-2222-2222-2222-222222222222', 'Fin', 'Ance', 'grade_7', 'grade_7a');

INSERT INTO public.fee_structures
  (id, school_id, academic_year, term_number, grade_id, fee_label, amount)
VALUES ('eeee0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
        '2026', 1, 'grade_7', 'Tuition', 1000.00);

INSERT INTO public.fee_records
  (id, school_id, student_id, fee_structure_id, academic_year, term_number,
   fee_label, amount_due, due_date)
VALUES ('ffff0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
        'bbbb0000-0000-0000-0000-000000000001', 'eeee0000-0000-0000-0000-000000000001',
        '2026', 1, 'Tuition', 1000.00, now());

SET LOCAL request.jwt.claims TO '{
  "sub": "user_acct_b", "role": "authenticated",
  "o": {"id": "org_school_b", "rol": "accountant", "slg": "beta-school"}
}';

SELECT lives_ok(
  $$ SELECT public.allocate_payment(
       'bbbb0000-0000-0000-0000-000000000001'::uuid, 500.00, 'cash') $$,
  'the accountant records a payment'
);

/**
 * Read back as the OWNER, not as the accountant who made the payment.
 *
 * An earlier draft asserted this while still acting as the accountant and failed — because
 * test 18 above says an accountant reads none of the trail, and that is deliberate. The row
 * was written correctly; the reader was wrong. Worth recording, because the tempting fix was
 * to widen the SELECT policy to make a failing test pass, which would have handed every
 * accountant the full history of marks and fees in their school.
 *
 * It also demonstrates the separation the trail exists for: the person who performs a
 * financial act cannot read the record of it, so they cannot check what it says about them.
 */
SET LOCAL request.jwt.claims TO '{
  "sub": "user_owner_b", "role": "authenticated",
  "o": {"id": "org_school_b", "rol": "owner", "slg": "beta-school"}
}';

SELECT is(
  (SELECT count(*)::int FROM public.audit_logs
    WHERE table_name = 'payments' AND school_id = '22222222-2222-2222-2222-222222222222'),
  1,
  'recording a payment writes an audit row — the Phase 3 gate, which nothing satisfied before'
);

SELECT is(
  (SELECT actor_user_id FROM public.audit_logs
    WHERE table_name = 'payments' AND school_id = '22222222-2222-2222-2222-222222222222'),
  'user_acct_b',
  'and it names the accountant who did it, readable by leadership but not by them'
);

SELECT * FROM finish();
ROLLBACK;
