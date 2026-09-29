-- ===========================================================================
-- School status enforcement — the lifecycle table, finally binding.
--
-- Spec: Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md
--       Official Documentation/06 School and Tenant Management/TRIAL.md
--
-- `SCHOOL_SETUP.md` has said since April that a `trial_expired` or `suspended` school reads and
-- does not write. Until `0149` nothing honoured it: a school whose subscription had lapsed enrolled
-- pupils and recorded payments exactly as freely as one that paid.
--
-- WHAT THIS SUITE IS REALLY TESTING IS THAT THE GUARD CANNOT BE WALKED AROUND.
--
-- The enforcement is a trigger rather than a RESTRICTIVE policy for one reason: on Supabase the
-- `postgres` role carries BYPASSRLS, and every SECURITY DEFINER function in this schema is owned
-- by it. A policy would be invisible to `save_exam_marks()`, `import_students()` and
-- `verify_payment()` — the busiest write paths in the product — and to every worker, since
-- `service_role` bypasses RLS by design.
--
-- So the assertions below are deliberately made from the **superuser seat this file runs in**, not
-- from an `authenticated` session. If the guard held only for ordinary users it would be
-- decorative, and a test that switched role first would never notice.
--
-- The AFTER-not-BEFORE choice is asserted too. `0103` found that a BEFORE trigger raising a
-- message about tenant state speaks before RLS has decided whether the caller may hear it.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(21);

-- ---------------------------------------------------------------------------
-- Four schools, one per interesting status. All created writable, because a
-- school that has never been writable cannot have acquired the data whose fate
-- this suite is about.
-- ---------------------------------------------------------------------------
INSERT INTO public.schools
  (id, school_id, clerk_org_id, name, type, level, city_code, province_code, status, subscription_tier)
VALUES
  ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_live',    'Live Academy',
   'day','combined','LSK','LSK','active','starter'),
  ('22222222-2222-2222-2222-222222222222','ZM-LSK-0002','org_lapsed',  'Lapsed Trial School',
   'day','combined','LSK','LSK','active','starter'),
  ('33333333-3333-3333-3333-333333333333','ZM-NDL-0001','org_susp',    'Suspended School',
   'day','combined','NDL','CBR','active','growth'),
  ('44444444-4444-4444-4444-444444444444','ZM-KIT-0001','org_pending', 'Awaiting Verification',
   'day','combined','KIT','CBR','pending_verification','starter');

INSERT INTO public.school_grade_levels
  (school_id, level_id, display_name, level_order, level_type, examination_type, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','grade_9','Grade 9',9,'secondary','internal',TRUE),
  ('22222222-2222-2222-2222-222222222222','grade_9','Grade 9',9,'secondary','internal',TRUE),
  ('33333333-3333-3333-3333-333333333333','grade_9','Grade 9',9,'secondary','internal',TRUE);

INSERT INTO public.students (id, student_id, school_id, first_name, last_name, grade_id)
VALUES
  ('aaaa0000-0000-0000-0000-000000000001','STU-ZM-LSK-0001-00001',
   '11111111-1111-1111-1111-111111111111','Alice','Live','grade_9'),
  ('aaaa0000-0000-0000-0000-000000000002','STU-ZM-LSK-0002-00001',
   '22222222-2222-2222-2222-222222222222','Bruce','Lapsed','grade_9'),
  ('aaaa0000-0000-0000-0000-000000000003','STU-ZM-NDL-0001-00001',
   '33333333-3333-3333-3333-333333333333','Carol','Susp','grade_9');

-- Now the statuses move, which is the order a real school reaches them in.
UPDATE public.schools SET status = 'trial_expired'
 WHERE id = '22222222-2222-2222-2222-222222222222';
UPDATE public.schools SET status = 'suspended'
 WHERE id = '33333333-3333-3333-3333-333333333333';

-- ---------------------------------------------------------------------------
-- The helper.
-- ---------------------------------------------------------------------------
SELECT ok(
  public.school_can_write('11111111-1111-1111-1111-111111111111'),
  'an active school may be written to'
);

SELECT ok(
  public.school_can_write('44444444-4444-4444-4444-444444444444'),
  'so may one awaiting verification — "limited" is documented contradictorily and not enforced'
);

SELECT ok(
  NOT public.school_can_write('22222222-2222-2222-2222-222222222222'),
  'a school whose trial lapsed may not'
);

SELECT ok(
  NOT public.school_can_write('33333333-3333-3333-3333-333333333333'),
  'nor a suspended one'
);

/**
 * NULL is TRUE, and this is load-bearing rather than a nicety.
 *
 * `teaching_resources` and `ai_credit_accounts` carry a nullable `school_id` because a standalone
 * Teacher Hub user has no school at all. If NULL resolved to FALSE, every standalone teacher in
 * the product would be locked out of their own work by a rule about school subscriptions.
 */
SELECT ok(
  public.school_can_write(NULL::uuid),
  'and a row with no school at all is writable — a standalone teacher has no school status'
);

SELECT ok(
  NOT public.school_can_write('99999999-9999-9999-9999-999999999999'),
  'a school_id matching no school is refused rather than waved through'
);

-- ---------------------------------------------------------------------------
-- The guard itself, from the seat that would bypass a policy.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ INSERT INTO public.students (student_id, school_id, first_name, last_name, grade_id)
     VALUES ('STU-ZM-LSK-0001-00002','11111111-1111-1111-1111-111111111111',
             'Dara','Live','grade_9') $$,
  'the active school enrols a pupil'
);

SELECT throws_ok(
  $$ INSERT INTO public.students (student_id, school_id, first_name, last_name, grade_id)
     VALUES ('STU-ZM-LSK-0002-00002','22222222-2222-2222-2222-222222222222',
             'Eve','Lapsed','grade_9') $$,
  'ZS002',
  NULL,
  'the lapsed-trial school cannot — and this session is a superuser, so no policy is involved'
);

SELECT throws_ok(
  $$ INSERT INTO public.students (student_id, school_id, first_name, last_name, grade_id)
     VALUES ('STU-ZM-NDL-0001-00002','33333333-3333-3333-3333-333333333333',
             'Femi','Susp','grade_9') $$,
  'ZS002',
  NULL,
  'nor the suspended one'
);

SELECT throws_ok(
  $$ UPDATE public.students SET first_name = 'Renamed'
      WHERE school_id = '33333333-3333-3333-3333-333333333333' $$,
  'ZS002',
  NULL,
  'an UPDATE to a suspended school is refused, not silently ignored'
);

SELECT throws_ok(
  $$ DELETE FROM public.school_grade_levels
      WHERE school_id = '33333333-3333-3333-3333-333333333333' $$,
  'ZS002',
  NULL,
  '...and so is a DELETE'
);

-- Reads are untouched, deliberately. A school must be able to see and export its own records
-- after the money stops — TRIAL.md business rule 6.
SELECT is(
  (SELECT COUNT(*)::INT FROM public.students
    WHERE school_id = '33333333-3333-3333-3333-333333333333'),
  1,
  'but reading a suspended school is untouched — its data is still theirs to see and export'
);

-- ---------------------------------------------------------------------------
-- Coverage. The trigger is attached by discovery, so the assertions are too.
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT COUNT(*) FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname LIKE 'enforce_school_writable_%') >= 75,
  'the guard is attached to at least twenty-five tables, three triggers each'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'payments' AND t.tgname LIKE 'enforce_school_writable_%'
  ),
  'payments is guarded — a lapsed school must not keep recording money'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'exam_results' AND t.tgname LIKE 'enforce_school_writable_%'
  ),
  'and exam_results'
);

/**
 * The exclusions, asserted by name rather than left to be inferred.
 *
 * `audit_logs` is the one that matters. An audit trail that stops recording when a school is
 * suspended is not an audit trail — the suspension itself, and anything done around it, is
 * precisely what a later investigation would want.
 */
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'audit_logs' AND t.tgname LIKE 'enforce_school_writable_%'
  ),
  'audit_logs is NOT guarded — it must keep recording a school it has just suspended'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'schools' AND t.tgname LIKE 'enforce_school_writable_%'
  ),
  'nor schools itself — the status lives there and must stay changeable'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
     WHERE c.relname = 'message_log' AND t.tgname LIKE 'enforce_school_writable_%'
  ),
  'nor message_log — the "your subscription has lapsed" message must still be recorded as sent'
);

/**
 * AFTER, not BEFORE. `0103`'s rule: a trigger whose message describes tenant state must let RLS
 * decide entitlement first, or it tells a stranger about another school's commercial standing.
 */
SELECT ok(
  (SELECT bool_and(t.tgtype & 2 = 0) FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname LIKE 'enforce_school_writable_%' AND NOT t.tgisinternal),
  'every one of them is AFTER — a BEFORE trigger would name a tenant''s standing before RLS ruled'
);

SELECT ok(
  (SELECT bool_and(t.tgtype & 1 = 0) FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
    WHERE t.tgname LIKE 'enforce_school_writable_%' AND NOT t.tgisinternal),
  'and statement-level, so a four-hundred-pupil import resolves the status once, not four hundred times'
);

-- ---------------------------------------------------------------------------
-- AfriTech is not blocked. They are the ones who fix it.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_afritech", "role": "authenticated",
  "o": {"id": "org_afritech", "rol": "afritech:super_admin", "slg": "afritech-systems-admin"}
}';

SELECT ok(
  public.school_can_write('33333333-3333-3333-3333-333333333333'),
  'AfriTech writes to a suspended school — acting on schools in every state is what the states are for'
);

SELECT * FROM finish();
ROLLBACK;
