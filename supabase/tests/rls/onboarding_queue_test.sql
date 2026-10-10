-- ===========================================================================
-- The onboarding task queue, and the 24-hour rule it exists to enforce.
--
-- Spec: Official Documentation/15 Super Admin and Platform/ONBOARDING.md
--
-- `ONBOARDING.md` calls the 24-hour outreach rule "the most important operational rule at AfriTech"
-- and hangs an escalation table off it. Nothing recorded a contact attempt, so there was no way to
-- know which schools had been called.
--
-- THE RULE IS DERIVED, AND THAT IS WHAT THIS SUITE MOSTLY TESTS.
--
-- The document implements it as a queued job firing 24 hours after registration. There is no Redis,
-- so instead `public.onboarding_queue` computes `outreach_overdue` from the first recorded contact
-- against registration time. The assertions therefore move `school_onboarding.created_at` backwards
-- and read the flag — which is only possible because nothing stores it. A scheduled job would need
-- the clock to actually pass.
--
-- Two properties matter beyond the arithmetic:
--
--   * **The window applies to self-registration only.** An AfriTech-created school was created by
--     somebody already talking to it, so a countdown on calling them back measures nothing.
--   * **A contact log cannot be edited.** No UPDATE, no DELETE, for anybody — the escalation table
--     hands consequences to a super admin based on these rows, and a note that can be rewritten
--     afterwards is not a record of what happened.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(25);

-- ---------------------------------------------------------------------------
-- Two schools: one self-registered, one AfriTech-created.
-- ---------------------------------------------------------------------------
INSERT INTO public.schools
  (id, school_id, clerk_org_id, name, type, level, city_code, province_code,
   status, subscription_tier, trial_ends_at)
VALUES
  ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_selfreg','Sunrise Academy',
   'day','combined','LSK','LSK','trial','starter', NOW() + INTERVAL '30 days'),
  ('22222222-2222-2222-2222-222222222222','ZM-LSK-0002','org_afritech_made','Pilot College',
   'day','combined','LSK','LSK','pending_verification','growth', NULL);

INSERT INTO public.school_onboarding
  (school_id, source, owner_first_name, owner_last_name, owner_email, created_by)
VALUES
  ('11111111-1111-1111-1111-111111111111','self_registration','Grace','Mwale',
   'grace@sunrise.example','user_grace'),
  ('22222222-2222-2222-2222-222222222222','afritech','John','Banda',
   'john@pilot.example','user_afritech');

-- ---------------------------------------------------------------------------
-- Defaults.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT task_status FROM public.school_onboarding
    WHERE school_id = '11111111-1111-1111-1111-111111111111'),
  'new',
  'a fresh registration starts as `new` — nobody has picked it up'
);

SELECT ok(
  NOT (SELECT outreach_overdue FROM public.onboarding_queue
        WHERE school_code = 'ZM-LSK-0001'),
  'and is not overdue in its first minute'
);

SELECT ok(
  (SELECT hours_to_contact BETWEEN 23 AND 24 FROM public.onboarding_queue
    WHERE school_code = 'ZM-LSK-0001'),
  '...with roughly twenty-four hours on the clock'
);

-- ---------------------------------------------------------------------------
-- The clock, moved rather than waited for.
-- ---------------------------------------------------------------------------
UPDATE public.school_onboarding SET created_at = NOW() - INTERVAL '25 hours'
 WHERE school_id = '11111111-1111-1111-1111-111111111111';

SELECT ok(
  (SELECT outreach_overdue FROM public.onboarding_queue WHERE school_code = 'ZM-LSK-0001'),
  'twenty-five hours with no contact recorded is overdue'
);

SELECT ok(
  NOT (SELECT outreach_escalated FROM public.onboarding_queue WHERE school_code = 'ZM-LSK-0001'),
  '...but not yet escalated — the super admin takes over at forty-eight'
);

SELECT ok(
  (SELECT hours_to_contact < 0 FROM public.onboarding_queue WHERE school_code = 'ZM-LSK-0001'),
  'and the countdown has gone negative, which is what sorts the worst breach to the top'
);

UPDATE public.school_onboarding SET created_at = NOW() - INTERVAL '50 hours'
 WHERE school_id = '11111111-1111-1111-1111-111111111111';

SELECT ok(
  (SELECT outreach_escalated FROM public.onboarding_queue WHERE school_code = 'ZM-LSK-0001'),
  'fifty hours escalates'
);

/**
 * THE EXEMPTION, and it is a judgement rather than an oversight.
 *
 * `Pilot College` was created by AfriTech, which means somebody at AfriTech was already talking to
 * the school when they typed its name in. A 24-hour clock on calling them back measures nothing, and
 * a red row against it would train an operator to ignore red rows.
 */
UPDATE public.school_onboarding SET created_at = NOW() - INTERVAL '50 hours'
 WHERE school_id = '22222222-2222-2222-2222-222222222222';

SELECT ok(
  NOT (SELECT outreach_overdue FROM public.onboarding_queue WHERE school_code = 'ZM-LSK-0002'),
  'an AfriTech-created school is never overdue, however long it sits'
);

-- ---------------------------------------------------------------------------
-- Who may record a contact.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_owner", "role": "authenticated",
  "o": {"id": "org_selfreg", "rol": "owner", "slg": "zm-lsk-0001"}
}';

SELECT throws_ok(
  $$ SELECT * FROM public.admin_record_onboarding_contact(
       '11111111-1111-1111-1111-111111111111', 'spoke', 'I called myself.') $$,
  '42501',
  NULL,
  'a school owner cannot record outreach against their own school'
);

/**
 * And cannot read the queue at all. `school_onboarding` has no school-side policy, so the view —
 * `security_invoker`, joining through it — returns nothing rather than a filtered row. Worth
 * asserting because the notes in a contact log are internal judgements about the school.
 */
SELECT is(
  (SELECT COUNT(*)::INT FROM public.onboarding_queue),
  0,
  '...and sees no queue at all — outreach notes are AfriTech''s internal record'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.school_onboarding_contacts),
  0,
  'nor the contact log directly'
);

-- ---------------------------------------------------------------------------
-- AfriTech works the queue.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_manager", "role": "authenticated",
  "o": {"id": "org_afritech", "rol": "afritech:regional_manager", "slg": "afritech-systems-admin"}
}';

SELECT is(
  (SELECT COUNT(*)::INT FROM public.onboarding_queue),
  2,
  'AfriTech sees every school in the queue'
);

/**
 * A note is required, except where there was nobody to quote. `no_answer` with no note is the whole
 * of what happened; `spoke` with no note leaves the next person ringing the same school with
 * nothing to go on. Enforced by a CHECK on the table, so a direct RPC cannot skip it.
 */
SELECT throws_ok(
  $$ SELECT * FROM public.admin_record_onboarding_contact(
       '11111111-1111-1111-1111-111111111111', 'spoke', '   ') $$,
  '23514',
  NULL,
  'recording "spoke" with no note is refused — the next caller has only this'
);

SELECT is(
  (SELECT out_task_status FROM public.admin_record_onboarding_contact(
     '11111111-1111-1111-1111-111111111111', 'no_answer')),
  'in_progress',
  'but "no answer" needs none, and the first contact moves the task off `new`'
);

SELECT ok(
  NOT (SELECT outreach_overdue FROM public.onboarding_queue WHERE school_code = 'ZM-LSK-0001'),
  'and recording an attempt clears the overdue flag — the rule is about the FIRST attempt'
);

SELECT is(
  (SELECT contact_attempts::INT FROM public.onboarding_queue WHERE school_code = 'ZM-LSK-0001'),
  1,
  'the attempt is counted'
);

SELECT lives_ok(
  $$ SELECT * FROM public.admin_record_onboarding_contact(
       '11111111-1111-1111-1111-111111111111', 'call_scheduled',
       'Reached Grace. Onboarding call booked for Thursday 10am.', 'phone',
       NOW() + INTERVAL '2 days') $$,
  'a second attempt is recorded alongside the first, not over it'
);

SELECT is(
  (SELECT contact_attempts::INT FROM public.onboarding_queue WHERE school_code = 'ZM-LSK-0001'),
  2,
  '...so the log grows'
);

SELECT ok(
  (SELECT next_follow_up_at IS NOT NULL FROM public.onboarding_queue
    WHERE school_code = 'ZM-LSK-0001'),
  'and a booked follow-up surfaces on the row'
);

/**
 * `not_interested` is the school's answer rather than AfriTech's judgement, so it carries straight
 * across to the task state. The escalation table treats it as terminal with quarterly re-outreach.
 */
SELECT is(
  (SELECT out_task_status FROM public.admin_record_onboarding_contact(
     '22222222-2222-2222-2222-222222222222', 'not_interested',
     'Head teacher says they have just signed with another provider.')),
  'not_interested',
  'an outcome of "not interested" sets the task state to match'
);

-- ---------------------------------------------------------------------------
-- The log is a record, not a working document.
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.school_onboarding_contacts', 'UPDATE'),
  'nobody may edit a recorded contact — correct one by adding another'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.school_onboarding_contacts', 'DELETE'),
  'and nobody may delete one — a super admin escalates on the strength of these rows'
);

-- ---------------------------------------------------------------------------
-- Assignment, and the rule that nothing closes itself.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT out_assigned_to FROM public.admin_set_onboarding_task(
     '11111111-1111-1111-1111-111111111111', 'assigned', 'user_manager')),
  'user_manager',
  'a task is assigned to a person'
);

/**
 * Business rule 2: "onboarding tasks are never automatically closed — a human must mark them as
 * Complete or Converted." So `complete` is only ever reachable through this function, and a school
 * reaching 100% setup does not close its own task.
 */
SELECT is(
  (SELECT out_task_status FROM public.admin_set_onboarding_task(
     '11111111-1111-1111-1111-111111111111', 'complete')),
  'complete',
  'and closed only by a person — business rule 2'
);

SELECT ok(
  (SELECT converted FROM public.onboarding_queue WHERE school_code = 'ZM-LSK-0001') IS FALSE,
  'while `converted` stays derived from the school''s status, not from the task state'
);

SELECT * FROM finish();
ROLLBACK;
