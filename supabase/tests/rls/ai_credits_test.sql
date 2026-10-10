-- ===========================================================================
-- AI credits — one wallet, one ledger, and the arithmetic that replaces a cron job.
--
-- Spec: Official Documentation/18 AI Module/AI_CAPTURE.md — Pricing
--       Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--       Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- The commercial model is an included monthly allowance plus purchased credits that expire
-- after 12 months. Those two promises look incompatible — an unused allowance must not roll
-- over, purchased credits must not vanish early — and the ledger keeps both only because of
-- how the two quantities are derived. So the arithmetic is what this suite mostly tests:
--
--   * allowance first, then purchased, so nobody pays for what they already had free;
--   * purchased lots drained SOONEST-EXPIRY first, which spends the credits about to be lost
--     rather than letting them die while newer ones are used;
--   * an expired lot stops counting **with no job having run** — correctness from arithmetic,
--     because a cron that fails silently leaves somebody holding credits they should not have;
--   * a refusal states the shortfall, because "insufficient credits" leaves a school guessing
--     how much to buy;
--   * nobody tops up their own wallet, since payment is recorded by hand;
--   * the ledger is append-only against EVERY caller including `service_role`, which
--     bypasses RLS — the same lesson as `0131`;
--   * and the Teacher Hub has exactly ONE meter now. A 14-argument call to
--     `create_teaching_resource()` — the old signature — must still be charged, because an
--     un-updated caller generating for free silently is worse than one that errors.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(29);

-- ---------------------------------------------------------------------------
-- A school on a tier that includes 10 credits a month.
-- ---------------------------------------------------------------------------
INSERT INTO public.schools
  (id, school_id, clerk_org_id, name, type, level, city_code, status, subscription_tier)
VALUES ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
        'Alpha Academy', 'day', 'combined', 'LSK', 'active', 'starter');

INSERT INTO afritech.tier_ai_allowances (tier_name, monthly_credits)
VALUES ('starter', 10)
ON CONFLICT (tier_name) DO UPDATE SET monthly_credits = 10;

INSERT INTO public.ai_credit_accounts (id, school_id)
VALUES ('aaaa0000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111');

-- 1. Prices are configuration, not literals.
SELECT is(
  (SELECT credits_per_action FROM afritech.ai_credit_prices
    WHERE feature_key = 'ai_lesson_planner'),
  1,
  'a lesson plan costs ONE credit — every arithmetic assertion below assumes it'
);

/**
 * That assertion is deliberately coupled to the seeded price, and pinned here rather than derived.
 *
 * Deriving it would let a price change pass silently while the behaviour it is supposed to prove
 * went untested. Pinning it means changing the seed fails HERE, with a message that explains
 * itself, instead of as a confusing off-by-N fifteen assertions later.
 *
 * `platform_incidents_test.sql` learned the same lesson the expensive way: it asserted a prompt
 * version of 1, `0137` seeded a prompt, and CI failed on a hidden assumption that the table was
 * empty. A test coupled to seeded data is fine — a test coupled to it *by accident* is not.
 */

-- A CSV import consumes no vision call, so charging a vision-priced credit for it would be
-- charging for a cost not incurred — stated as data rather than as a code branch.
SELECT ok(
  (SELECT credits_per_action FROM afritech.ai_credit_prices WHERE feature_key = 'ai_capture')
    > (SELECT credits_per_action FROM afritech.ai_credit_prices
        WHERE feature_key = 'ai_lesson_planner'),
  'a vision capture costs more than a text generation, because it costs more to serve'
);

-- ---------------------------------------------------------------------------
-- A teacher at Alpha, drawing on the school's wallet.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_teacher_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "teacher", "slg": "alpha-academy"}
}';

SELECT is(
  (SELECT total_available FROM public.ai_credit_balance('aaaa0000-0000-0000-0000-00000000000a')),
  10,
  'a fresh wallet on a tier including 10 credits has 10 available'
);

SELECT is(
  (SELECT allowance_period FROM public.ai_credit_balance('aaaa0000-0000-0000-0000-00000000000a')),
  'monthly',
  'a school allowance is monthly'
);

-- 2. Spending draws the allowance, and the cost side is recorded with it.
SELECT lives_ok(
  $$ SELECT public.ai_credit_consume('ai_lesson_planner', 1, 'claude-test', 120, 800, 0.0034) $$,
  'a teacher can spend a credit from the school wallet'
);

SELECT is(
  (SELECT allowance_used FROM public.ai_credit_balance('aaaa0000-0000-0000-0000-00000000000a')),
  1,
  'the allowance records the spend'
);

-- THE MARGIN COLUMN. Without the real cost on the row, margin is a hope rather than a number.
/**
 * Selected by `model_name`, NOT by `ORDER BY created_at DESC LIMIT 1`.
 *
 * `NOW()` is fixed for the whole transaction, so every row inserted by this suite carries an
 * identical `created_at` and cannot be ordered by it. An earlier draft ordered that way and
 * failed intermittently against rows with no cost — the assertion was wrong, not the column.
 *
 * Read as the ACCOUNTANT, because the ledger's SELECT policy excludes teachers: a school's
 * line-by-line AI spending is budget information, not everyone's business.
 */
SET LOCAL request.jwt.claims TO '{
  "sub": "user_acct_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "accountant", "slg": "alpha-academy"}
}';

SELECT is(
  (SELECT cost_usd FROM public.ai_credit_ledger
    WHERE account_id = 'aaaa0000-0000-0000-0000-00000000000a'
      AND model_name = 'claude-test'),
  0.003400::numeric,
  'the model cost is recorded on the ledger row, so margin per feature is measurable'
);

-- The policy that made the lot assertions below need a different reader. A teacher spends
-- from the wallet and is told its balance, but does not get the school's spending history.
SET LOCAL request.jwt.claims TO '{
  "sub": "user_teacher_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "teacher", "slg": "alpha-academy"}
}';

SELECT is(
  (SELECT count(*)::int FROM public.ai_credit_ledger),
  0,
  'a teacher reads no ledger rows — they spend from the wallet without seeing who else did'
);

-- 3. An idempotency key must not charge twice. A worker redelivery is not a second sale.
SELECT lives_ok(
  $$ SELECT public.ai_credit_consume('ai_lesson_planner', 1, NULL, NULL, NULL, NULL, 'job-abc') $$,
  'a keyed consumption succeeds'
);

SELECT lives_ok(
  $$ SELECT public.ai_credit_consume('ai_lesson_planner', 1, NULL, NULL, NULL, NULL, 'job-abc') $$,
  'and repeating the same key succeeds rather than erroring'
);

SELECT is(
  (SELECT allowance_used FROM public.ai_credit_balance('aaaa0000-0000-0000-0000-00000000000a')),
  2,
  '...but charges nothing the second time — a retried job is not a second sale'
);

-- 4. Exhaust the allowance, and check the refusal is useful.
SELECT lives_ok(
  $$ DO $do$
     DECLARE i INT;
     BEGIN
       FOR i IN 1..8 LOOP PERFORM public.ai_credit_consume('ai_lesson_planner', 1); END LOOP;
     END $do$ $$,
  'the rest of the allowance spends'
);

SELECT is(
  (SELECT total_available FROM public.ai_credit_balance('aaaa0000-0000-0000-0000-00000000000a')),
  0,
  'the wallet is empty at 10 of 10'
);

-- The message carries the numbers. "Insufficient credits" alone leaves a school guessing.
SELECT throws_like(
  $$ SELECT public.ai_credit_consume('ai_lesson_planner', 1) $$,
  '%1 needed, 0 available%',
  'a refusal states the shortfall rather than saying only that it failed'
);

-- 5. Nobody buys their own credits — payment is recorded by hand, as everywhere else here.
SELECT throws_ok(
  $$ SELECT public.ai_credit_topup('aaaa0000-0000-0000-0000-00000000000a', 'starter_50') $$,
  '42501',
  NULL,
  'a teacher cannot top up their own school wallet'
);

-- Note the shape: an UPDATE a policy refuses raises NOTHING — the USING clause matches no
-- rows and the statement reports zero affected. The same trap `teacher_hub_test.sql` records,
-- and worth repeating because asserting a throw here would fail while the security holds.
SELECT lives_ok(
  $$ UPDATE afritech.ai_credit_prices SET credits_per_action = 0
      WHERE feature_key = 'ai_lesson_planner' $$,
  'a teacher editing the AI price raises no error — an RLS-blocked UPDATE is silent'
);

SELECT is(
  (SELECT credits_per_action FROM afritech.ai_credit_prices
    WHERE feature_key = 'ai_lesson_planner'),
  1,
  '...and changes nothing, so AI cannot be made free by the people paying for it'
);

-- ---------------------------------------------------------------------------
-- Two purchased lots with different expiries, inserted rather than adjusted — because the
-- ledger refuses UPDATE to everybody, which is itself asserted below.
-- ---------------------------------------------------------------------------
RESET ROLE;

INSERT INTO public.ai_credit_ledger
  (id, account_id, reason, credits, expires_at, actor_user_id, metadata)
VALUES
  ('bbbb0000-0000-0000-0000-00000000000b', 'aaaa0000-0000-0000-0000-00000000000a',
   'topup', 5, NOW() + INTERVAL '10 days', 'system:test', '{"ref":"soon"}'::jsonb),
  ('cccc0000-0000-0000-0000-00000000000c', 'aaaa0000-0000-0000-0000-00000000000a',
   'topup', 5, NOW() + INTERVAL '300 days', 'system:test', '{"ref":"far"}'::jsonb);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_teacher_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "teacher", "slg": "alpha-academy"}
}';

SELECT is(
  (SELECT purchased_expiring_90d FROM public.ai_credit_balance('aaaa0000-0000-0000-0000-00000000000a')),
  5,
  'only the lot inside 90 days is flagged as expiring — what a school should be told to spend'
);

-- 6. FIFO BY EXPIRY. Spend 6 across the two lots.
SELECT lives_ok(
  $$ DO $do$
     DECLARE i INT;
     BEGIN
       FOR i IN 1..6 LOOP PERFORM public.ai_credit_consume('ai_lesson_planner', 1); END LOOP;
     END $do$ $$,
  'six credits spend across two lots'
);

/**
 * Read as the ACCOUNTANT. As the teacher these two assertions saw zero rows, which made the
 * first one — expecting zero — pass for entirely the wrong reason. A vacuous pass in a suite
 * about money is worse than a failure, because it reports a property nobody verified.
 */
SET LOCAL request.jwt.claims TO '{
  "sub": "user_acct_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "accountant", "slg": "alpha-academy"}
}';

SELECT is(
  (SELECT COALESCE(SUM(credits), 0)::int FROM public.ai_credit_ledger
    WHERE id = 'bbbb0000-0000-0000-0000-00000000000b'
       OR lot_id = 'bbbb0000-0000-0000-0000-00000000000b'),
  0,
  'the SOONEST-expiring lot is drained first — the credits about to be lost are spent'
);

SELECT is(
  (SELECT COALESCE(SUM(credits), 0)::int FROM public.ai_credit_ledger
    WHERE id = 'cccc0000-0000-0000-0000-00000000000c'
       OR lot_id = 'cccc0000-0000-0000-0000-00000000000c'),
  4,
  '...and only the remainder comes from the lot with 300 days left'
);

-- 7. EXPIRY WITHOUT A JOB. An already-dead lot never counts.
RESET ROLE;
INSERT INTO public.ai_credit_ledger
  (account_id, reason, credits, expires_at, actor_user_id, metadata)
VALUES ('aaaa0000-0000-0000-0000-00000000000a', 'topup', 7, NOW() - INTERVAL '1 day',
        'system:test', '{"ref":"dead"}'::jsonb);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_teacher_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "teacher", "slg": "alpha-academy"}
}';

SELECT is(
  (SELECT purchased_available FROM public.ai_credit_balance('aaaa0000-0000-0000-0000-00000000000a')),
  4,
  'an expired lot adds nothing to the balance, with no scheduled job having run'
);

SELECT is(
  (SELECT purchased_expired FROM public.ai_credit_balance('aaaa0000-0000-0000-0000-00000000000a')),
  7,
  '...and is still reportable as expired rather than silently gone'
);

-- 8. Append-only, against the two callers a policy would not stop.
SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$ UPDATE public.ai_credit_ledger SET credits = 9999 WHERE reason = 'topup' $$,
  '42501',
  NULL,
  'service_role cannot edit the credit ledger, though it bypasses every policy'
);

SELECT throws_ok(
  $$ DELETE FROM public.ai_credit_ledger WHERE reason = 'topup' $$,
  '42501',
  NULL,
  'service_role cannot delete from it either'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- THE HUB HAS ONE METER. A standalone teacher on the trial.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "user_hub_t", "role": "authenticated"}';

INSERT INTO public.standalone_teacher_accounts (clerk_user_id, full_name, email)
VALUES ('user_hub_t', 'Hub Teacher', 'hub@example.com');

SELECT is(
  (SELECT allowance FROM public.teacher_hub_entitlement()),
  5,
  'the trial''s five free resources are now a five-credit LIFETIME allowance'
);

/**
 * The old 14-argument call, as `0130` defined it.
 *
 * It is not an error: the new signature's defaults absorb it, so PostgREST and SQL both
 * resolve it to the metered version. That is the outcome worth asserting — a caller nobody
 * remembered to update gets CHARGED rather than quietly generating for free, which is why
 * the 14-argument function was dropped rather than left beside the new one.
 */
SELECT lives_ok(
  $$ SELECT public.create_teaching_resource(
       'lesson_plan', 'Old caller', 'Mathematics', 'Grade 9', 'Topic', 'ecz',
       '{}'::jsonb, 'template', '1.0.0', 40, 'core', '{}'::jsonb, NULL, NULL) $$,
  'a 14-argument call still works, resolving to the metered version'
);

SELECT is(
  (SELECT remaining FROM public.teacher_hub_entitlement()),
  4,
  '...and it was charged — an un-updated caller does not generate for free'
);

SELECT is(
  (SELECT trial_resources_used FROM public.standalone_teacher_accounts
    WHERE clerk_user_id = 'user_hub_t'),
  0,
  'the old counter is no longer written: the ledger is the only meter'
);

SELECT * FROM finish();
ROLLBACK;
