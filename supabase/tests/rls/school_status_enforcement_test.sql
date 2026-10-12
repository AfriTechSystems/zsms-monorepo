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

SELECT plan(28);

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
  ('11111111-1111-1111-1111-111111111111','grade_9','Grade 9',9,'junior_secondary','internal',TRUE),
  ('22222222-2222-2222-2222-222222222222','grade_9','Grade 9',9,'junior_secondary','internal',TRUE),
  ('33333333-3333-3333-3333-333333333333','grade_9','Grade 9',9,'junior_secondary','internal',TRUE);

INSERT INTO public.students
  (id, student_id, school_id, first_name, last_name, grade_id, class_id)
VALUES
  ('aaaa0000-0000-0000-0000-000000000001','STU-ZM-LSK-0001-00001',
   '11111111-1111-1111-1111-111111111111','Alice','Live','grade_9','grade_9a'),
  ('aaaa0000-0000-0000-0000-000000000002','STU-ZM-LSK-0002-00001',
   '22222222-2222-2222-2222-222222222222','Bruce','Lapsed','grade_9','grade_9a'),
  ('aaaa0000-0000-0000-0000-000000000003','STU-ZM-NDL-0001-00001',
   '33333333-3333-3333-3333-333333333333','Carol','Susp','grade_9','grade_9a');

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
  'so may one awaiting verification — its configuration is open, which is the point of letting it in'
);

/**
 * THE "LIMITED" WRITE, RESOLVED IN 0153.
 *
 * `SCHOOL_SETUP.md` and `ONBOARDING.md` contradicted each other about what limited means. Settled in
 * favour of the stricter reading, and not because one document is older: `pending_verification` means
 * AfriTech has not yet confirmed the school is real, and letting it load pupil records means
 * accepting several hundred children's names and dates of birth from a party nobody has checked.
 * AfriTech is the processor for that data under the ZDPA from the moment it lands.
 *
 * So `school_can_enrol()` is stricter than `school_can_write()` by exactly one status.
 */
SELECT ok(
  NOT public.school_can_enrol('44444444-4444-4444-4444-444444444444'),
  'but an unverified school may NOT enrol a pupil — it holds no verified claim to that data'
);

SELECT ok(
  public.school_can_enrol('11111111-1111-1111-1111-111111111111'),
  '...while an active school may'
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
  $$ INSERT INTO public.students
       (student_id, school_id, first_name, last_name, grade_id, class_id)
     VALUES ('STU-ZM-LSK-0001-00002','11111111-1111-1111-1111-111111111111',
             'Dara','Live','grade_9','grade_9a') $$,
  'the active school enrols a pupil'
);

SELECT throws_ok(
  $$ INSERT INTO public.students
       (student_id, school_id, first_name, last_name, grade_id, class_id)
     VALUES ('STU-ZM-LSK-0002-00002','22222222-2222-2222-2222-222222222222',
             'Eve','Lapsed','grade_9','grade_9a') $$,
  'ZS002',
  NULL,
  'the lapsed-trial school cannot — and this session is a superuser, so no policy is involved'
);

SELECT throws_ok(
  $$ INSERT INTO public.students
       (student_id, school_id, first_name, last_name, grade_id, class_id)
     VALUES ('STU-ZM-NDL-0001-00002','33333333-3333-3333-3333-333333333333',
             'Femi','Susp','grade_9','grade_9a') $$,
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

/**
 * Configuration stays open to the unverified school, and that is the whole reason for admitting it:
 * it sets itself up while AfriTech verifies it, which is what makes the verification call short.
 */
SELECT lives_ok(
  $$ INSERT INTO public.school_grade_levels
       (school_id, level_id, display_name, level_order, level_type, examination_type, is_active)
     VALUES ('44444444-4444-4444-4444-444444444444','grade_1','Grade 1',1,'primary','internal',TRUE) $$,
  'an unverified school configures its grade levels freely — no personal data is involved'
);

SELECT throws_ok(
  $$ INSERT INTO public.students
       (student_id, school_id, first_name, last_name, grade_id, class_id)
     VALUES ('STU-ZM-KIT-0001-00001','44444444-4444-4444-4444-444444444444',
             'Unverified','Pupil','grade_1','grade_1a') $$,
  'ZS003',
  NULL,
  '...but enrolling a child is refused until AfriTech has activated it'
);

/**
 * AND THE TWO GUARDS MUST NOT SPEAK OVER EACH OTHER.
 *
 * `students` carries both `0149`'s write guard (ZS002) and `0153`'s enrolment guard (ZS003).
 * PostgreSQL fires same-event triggers in NAME order, and `can_enrol` sorts before `writable` — so
 * `0153` reached a suspended school first and told it to await a verification call that was never
 * going to happen, when what it needed to hear was that its subscription had lapsed.
 *
 * `0154` narrows the enrolment message to `pending_verification` alone. The assertions above for the
 * lapsed and suspended schools expect ZS002 and are what caught this; this one pins the reason, so a
 * future third guard on this table cannot quietly take the sentence back.
 */
SELECT ok(
  (SELECT bool_and(present) FROM (
     SELECT EXISTS (
       SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = 'students' AND NOT t.tgisinternal AND t.tgname = expected
     ) AS present
       FROM unnest(ARRAY[
         'enforce_school_can_enrol_on_insert_on_students',
         'enforce_school_can_enrol_on_update_on_students',
         'enforce_school_writable_on_insert_on_students',
         'enforce_school_writable_on_update_on_students',
         'enforce_school_writable_on_delete_on_students'
       ]) AS expected
   ) checks),
  'students carries both guards by name — asserted individually, not counted, since the count also '
  'catches the pupil-ceiling trigger and would move whenever anything else is added'
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

-- ---------------------------------------------------------------------------
-- The guard must cover EVERY school-scoped table, not the ones 0149 could see.
--
-- `0149` iterates the catalogue at migration time, so a table created afterwards has
-- no guard — and the omission has no symptom, because the writes simply succeed.
-- Fourteen tables had drifted out of coverage before `0270` looked. These two
-- assertions are what stops the fifteenth doing the same quietly.
-- ---------------------------------------------------------------------------

SELECT is(
  (SELECT count(*)::INT FROM public.unguarded_school_tables()),
  0,
  'every school-scoped table has a write guard, or a documented exemption'
);

SELECT is(
  (SELECT string_agg(out_table_name, ', ') FROM public.unguarded_school_tables()),
  NULL,
  'and if one does not, this names it'
);

SELECT * FROM finish();
ROLLBACK;
