-- ===========================================================================
-- The Teacher Hub — the first owner-scoped table set in this schema.
--
-- Spec: Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md
--       Official Documentation/02 Authentication and Identity/ROLES.md
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- Every other suite here proves that school A cannot read school B. This one proves
-- something different and, for this product, more surprising:
--
--   * a teacher's resources are invisible to THEIR OWN SCHOOL — the principal of the
--     school a lesson plan was created at reads zero of them. Business rule 2 says plans
--     belong to the teacher and survive their leaving, which is only true if the school
--     never had access in the first place;
--   * the trial meter is not writable by the person it meters. A teacher who could set
--     `trial_resources_used` back to zero has an unlimited free product, so the grant is
--     column-level and this suite pins it;
--   * nobody can grant themselves a paid subscription. Payment is recorded by hand, so
--     activation is AfriTech's alone;
--   * five free resources EVER — subscribing and cancelling does not hand them back;
--   * a lapsed subscription blocks generation and keeps READ, which is the promise made
--     on the cancellation screen;
--   * a standalone teacher has no organisation, so `current_school_uuid()` is NULL and
--     every school-scoped policy in the schema denies. That is asserted rather than
--     assumed, because it is the entire reason no school data can leak into this product.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

-- pgTAP lives in `extensions` (migration 0001), never in `public`. A direct pg_prove
-- connection has a search_path of `"$user", public`, so `plan()` would not resolve and
-- this suite would fail on its first line. `public` stays FIRST so unqualified table
-- names resolve as normal; `extensions` is appended only for the assertion functions.
SET search_path TO public, extensions;

SELECT plan(24);

-- ---------------------------------------------------------------------------
-- Fixture. A school, its principal, and a teacher who is on its staff — so the
-- provenance stamp has somewhere legitimate to point.
-- ---------------------------------------------------------------------------
INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
        'Alpha Academy', 'day', 'combined', 'LSK', 'active');

INSERT INTO public.staff_members (school_id, clerk_user_id, first_name, last_name)
VALUES ('11111111-1111-1111-1111-111111111111', 'user_hub_teacher', 'Hub', 'Teacher');

-- ---------------------------------------------------------------------------
-- A standalone teacher. Note the claims: a `sub` and NO `o` at all. This is what
-- platform:teacher actually looks like, and it is why none of the 75 school-scoped
-- policies can match for them.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "user_hub_teacher", "role": "authenticated"}';

-- 1. Self-registration.
SELECT lives_ok(
  $$ INSERT INTO public.standalone_teacher_accounts
       (clerk_user_id, full_name, email, subjects, grade_levels)
     VALUES ('user_hub_teacher', 'Hub Teacher', 'hub@example.com',
             '{Mathematics}', '{Grade 9}') $$,
  'a teacher can register their own Hub account'
);

-- 2. And only their own. Registering as somebody else is the obvious first attack.
SELECT throws_ok(
  $$ INSERT INTO public.standalone_teacher_accounts (clerk_user_id, full_name, email)
     VALUES ('user_somebody_else', 'Not Me', 'other@example.com') $$,
  '42501',
  NULL,
  'a teacher cannot register an account owned by another user'
);

-- 3. The trial is configuration, not a literal. 5 comes from the plan row.
SELECT is(
  (SELECT allowance FROM public.teacher_hub_entitlement()),
  5,
  'the trial allowance is resolved from afritech.teacher_hub_plans, not hardcoded'
);

SELECT is(
  (SELECT may_generate FROM public.teacher_hub_entitlement()),
  true,
  'a fresh trial account may generate'
);

-- 4. THE METER. A teacher holds no privilege on the column that decides whether the
--    product is free for them.
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.standalone_teacher_accounts',
                           'trial_resources_used', 'UPDATE'),
  'a teacher cannot write their own trial counter — the grant is column-level'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.standalone_teacher_accounts',
                           'subscription_status', 'INSERT'),
  'self-registration cannot supply a subscription status'
);

SELECT ok(
  has_column_privilege('authenticated', 'public.standalone_teacher_accounts',
                       'full_name', 'UPDATE'),
  'a teacher can still edit their own profile — the restriction is precise, not blanket'
);

-- 5. No DELETE anywhere. The invariant 0129 had to restore twice.
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.teaching_resources', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.standalone_teacher_accounts', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'afritech.teacher_hub_plans', 'DELETE'),
  'no DELETE privilege on any Teacher Hub table — removal is a flag'
);

-- 6. Provenance cannot be falsified after the fact.
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.teaching_resources', 'content', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.teaching_resources',
                               'generator_name', 'UPDATE'),
  'generated content and its generator are not editable — the provenance cannot be made to lie'
);

-- 7. The stamp must be earned. This teacher IS staff at Alpha, so it is allowed.
SELECT lives_ok(
  $$ SELECT public.create_teaching_resource(
       'lesson_plan', 'Simultaneous Equations', 'Mathematics', 'Grade 9',
       'Simultaneous Equations', 'ecz', '{"objectives":["solve a pair"]}'::jsonb,
       'template', '1.0.0', 40, 'core', '{}'::jsonb, NULL,
       '11111111-1111-1111-1111-111111111111'::uuid) $$,
  'a resource can be stamped with a school the teacher actually belongs to'
);

-- 8. And not with one they do not. A plan stamped with a school somebody never taught at
--    would be a false record, and `school_id` is read as provenance by a human.
SELECT throws_ok(
  $$ SELECT public.create_teaching_resource(
       'quiz', 'Borrowed', 'Mathematics', 'Grade 9', 'Algebra', 'ecz', '{}'::jsonb,
       'template', '1.0.0', NULL, NULL, '{}'::jsonb, NULL,
       '22222222-2222-2222-2222-222222222222'::uuid) $$,
  '42501',
  NULL,
  'a resource cannot be stamped with a school the teacher does not belong to'
);

-- 9. Exhaust the trial. Four more takes it to five.
SELECT lives_ok(
  $$ DO $do$
     DECLARE i INT;
     BEGIN
       FOR i IN 1..4 LOOP
         PERFORM public.create_teaching_resource(
           'lesson_plan', 'Plan ' || i, 'Mathematics', 'Grade 9', 'Topic ' || i,
           'ecz', '{}'::jsonb, 'template', '1.0.0');
       END LOOP;
     END $do$ $$,
  'the remaining four trial resources generate'
);

SELECT is(
  (SELECT reason FROM public.teacher_hub_entitlement()),
  'trial_exhausted',
  'the fifth resource exhausts the trial, and the reason says so rather than a bare false'
);

-- 10. The sixth is refused.
SELECT throws_ok(
  $$ SELECT public.create_teaching_resource(
       'quiz', 'Sixth', 'Mathematics', 'Grade 9', 'Over', 'ecz', '{}'::jsonb,
       'template', '1.0.0') $$,
  '42501',
  NULL,
  'a sixth resource on an exhausted trial is refused'
);

-- 11. Nobody buys their own subscription. Payment is recorded by hand, so a teacher-
--     callable activation would make the paid product free to anyone who found it.
SELECT throws_ok(
  $$ SELECT public.teacher_hub_activate_subscription('user_hub_teacher', 'monthly', NULL) $$,
  '42501',
  NULL,
  'a teacher cannot grant themselves a paid subscription'
);

-- 12. A teacher cannot reprice the product either.
--
--     Note the shape of this pair, which is NOT the shape of the assertions above it: an
--     UPDATE blocked by a policy raises NOTHING. The USING clause simply matches no rows
--     and the statement reports zero affected. Asserting a throw here would fail, and
--     more usefully: any screen that issues an UPDATE must check the row count, because
--     "refused" and "matched nothing" are the same answer over the wire.
SELECT lives_ok(
  $$ UPDATE afritech.teacher_hub_plans SET price = 1.00 WHERE plan_code = 'monthly' $$,
  'a teacher repricing a plan raises no error — an RLS-blocked UPDATE is silent'
);

SELECT is(
  (SELECT price FROM afritech.teacher_hub_plans WHERE plan_code = 'monthly'),
  300.00::numeric,
  '...and changes nothing: the price is exactly as seeded'
);

-- 13. No school data, at all. `current_school_uuid()` is NULL without an organisation
--     claim, so every school-scoped policy in the schema denies. Asserted, not assumed.
SELECT is(
  (SELECT count(*) FROM public.students)::int,
  0,
  'a standalone teacher reads no pupils — no organisation claim, so no school scope'
);

-- ---------------------------------------------------------------------------
-- A DIFFERENT standalone teacher. Owner-scoping means neighbours see nothing.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"sub": "user_hub_other", "role": "authenticated"}';

SELECT is(
  (SELECT count(*) FROM public.teaching_resources)::int,
  0,
  'another teacher reads none of the first teacher''s resources'
);

SELECT is(
  (SELECT count(*) FROM public.standalone_teacher_accounts)::int,
  0,
  'another teacher cannot even see that the first account exists'
);

-- ---------------------------------------------------------------------------
-- THE HEADLINE. The principal of Alpha Academy — the school those resources are
-- stamped with — reads zero of them.
--
-- This is the opposite of every other table in the schema, where a principal sees
-- everything carrying their school_id. `school_id` here is provenance, not an access
-- path, and business rule 2 is only true if that holds.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_principal_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "principal", "slg": "alpha-academy"}
}';

SELECT is(
  (SELECT count(*) FROM public.teaching_resources
    WHERE school_id = '11111111-1111-1111-1111-111111111111')::int,
  0,
  'the principal of the school a lesson plan was made at reads NONE of it — plans belong to the teacher'
);

-- ---------------------------------------------------------------------------
-- AfriTech records a payment that has actually arrived.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_afritech", "role": "authenticated",
  "o": {"id": "org_afritech", "rol": "afritech:super_admin", "slg": "afritech-systems-admin"}
}';

SELECT lives_ok(
  $$ SELECT public.teacher_hub_activate_subscription('user_hub_teacher', 'monthly', NULL) $$,
  'AfriTech can record a received payment and activate the subscription'
);

/**
 * 14. FIVE FREE RESOURCES EVER — asserted through the LEDGER, not the counter.
 *
 * This assertion used to read `trial_resources_used` and expect 5. `0133` retired that column:
 * the AI credit ledger is the single meter, and `create_teaching_resource()` no longer writes
 * the counter at all. CI caught the stale assertion on the first run after that change.
 *
 * The rule itself is unchanged and is now enforced more strongly than a counter could. The five
 * trial spends are allowance-funded rows in an append-only ledger, so they cannot be reset —
 * and the assertions below prove the consequence: even if an account were put back onto the
 * trial plan, the allowance reads as already spent.
 */
SELECT is(
  (SELECT allowance_used FROM public.ai_credit_balance(
     (SELECT id FROM public.ai_credit_accounts WHERE owner_user_id = 'user_hub_teacher'))),
  5,
  'the five trial spends are still recorded after subscribing — an append-only ledger cannot be reset'
);

-- Forced back onto the trial plan as postgres. Not a product path — there is no code that does
-- this — which is exactly why it is the right way to test the rule: it is the strongest attack
-- available, and the allowance still reads as spent.
RESET ROLE;
UPDATE public.standalone_teacher_accounts
   SET plan_code = 'trial', subscription_status = 'trial', subscription_ends_at = NULL
 WHERE clerk_user_id = 'user_hub_teacher';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "user_hub_teacher", "role": "authenticated"}';

SELECT is(
  (SELECT remaining FROM public.teacher_hub_entitlement()),
  0,
  'and putting the account back on the trial plan grants nothing — five free resources EVER'
);

SELECT * FROM finish();
ROLLBACK;
