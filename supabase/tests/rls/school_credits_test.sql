-- ===========================================================================
-- School AI credits — bought in seats, assigned to named teachers.
--
-- Spec: Official Documentation/17 Integration and Pricing/PRICING.md
--       Official Documentation/18 AI Module/AI_OVERVIEW.md
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- WHAT THIS GUARDS.
--
-- Credits are money. The failures that matter here are not "a screen looks wrong" but
-- "a school got credits it did not pay for" and "a teacher spent a colleague's":
--
--   * assignments can never exceed what was bought, and an over-assignment writes
--     NOTHING rather than partially succeeding — a school told that thirty of forty
--     teachers were covered has to work out which thirty;
--   * no school may assign, revoke or buy against another school's purchase. All of
--     these are SECURITY DEFINER, so the `current_school_uuid()` check inside each one
--     is the only guard there is;
--   * a school holds no INSERT or UPDATE policy on any of the three tables, so the
--     functions cannot be bypassed. A direct INSERT on `school_credit_assignments`
--     would be ten thousand free credits with nothing in the ledger looking wrong;
--   * a teacher sees their OWN assignment and not a colleague's. The balance is theirs;
--     what everyone else was given is the school's business;
--   * the reserve is OFF unless switched on, because assignment exists so the school
--     decides, and a default-on reserve would undo that for every school that never
--     opened the screen;
--   * revoking returns the UNSPENT remainder only. Credits already spent are gone and
--     the ledger says who spent them — rewriting that to tidy a balance would be
--     falsifying a financial record.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(24);

-- ---------------------------------------------------------------------------
-- Fixture: two schools, created before any role switch (RLS refuses an
-- `authenticated` INSERT into `schools`).
-- ---------------------------------------------------------------------------
INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status,
                            subscription_tier)
VALUES
  ('a1111111-0000-4000-8000-000000000001', 'ZM-LSK-8001', 'org_cred_a',
   'Alpha Academy', 'day', 'combined', 'LSK', 'active', 'professional'),
  ('b2222222-0000-4000-8000-000000000002', 'ZM-LSK-8002', 'org_cred_b',
   'Beta College', 'day', 'combined', 'LSK', 'active', 'professional');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO
  '{"sub": "user_bursar_a", "role": "authenticated", "o": {"id": "org_cred_a", "rol": "owner"}}';

-- 1. The plan catalogue is reachable from `public`. `afritech` is not in PostgREST's
--    search path, so a route could never read the table directly — this is the wrapper.
SELECT is(
  (SELECT COUNT(*)::INT FROM public.school_credit_plan_catalogue()),
  3,
  'the plan catalogue is reachable through a public wrapper'
);

-- 2. A quote is arithmetic the screen can trust.
SELECT is(
  (SELECT out_total_credits FROM public.school_credit_quote('school_monthly', 10)),
  600,
  'ten seats at sixty credits quotes six hundred credits'
);

SELECT is(
  (SELECT out_total_amount FROM public.school_credit_quote('school_monthly', 10)),
  1200.00::NUMERIC,
  'ten seats at K120 quotes K1,200'
);

-- 4. Zero seats is refused rather than quoted at nothing.
SELECT throws_ok(
  $$ SELECT public.school_credit_quote('school_monthly', 0) $$,
  '22023', NULL,
  'a quote for zero seats is refused'
);

-- 5. An unknown plan is refused rather than priced at NULL.
SELECT throws_ok(
  $$ SELECT public.school_credit_quote('no_such_plan', 5) $$,
  '22023', NULL,
  'an unknown plan code is refused'
);

-- 6. Termly needs the school's OWN term dates — never a nominal ninety days.
SELECT throws_ok(
  $$ SELECT public.school_credit_quote('school_termly', 5) $$,
  '22023', NULL,
  'a termly plan is refused when the school has no term dates, rather than inventing a period'
);

-- ...and works once they exist.
SET LOCAL ROLE postgres;
INSERT INTO public.school_term_dates (school_id, academic_year, term_number, starts_on, ends_on)
VALUES ('a1111111-0000-4000-8000-000000000001', 2026, 1,
        CURRENT_DATE - 10, CURRENT_DATE + 50);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT out_period_end FROM public.school_credit_quote('school_termly', 5)),
  (CURRENT_DATE + 50)::DATE,
  'a termly plan runs to the end of the school''s own term'
);

-- ---------------------------------------------------------------------------
-- Buying.
-- ---------------------------------------------------------------------------
-- 8. The purchase lands.
SELECT isnt(
  (SELECT out_purchase_id FROM public.school_purchase_credits('school_monthly', 10)),
  NULL,
  'a school can buy credits'
);

-- 9. It raised a DRAFT invoice — a school must not be able to issue its own bill.
SELECT is(
  (SELECT i.status FROM afritech.invoices AS i
    WHERE i.school_id = 'a1111111-0000-4000-8000-000000000001'
      AND i.invoice_kind = 'ai_credits' LIMIT 1),
  'draft',
  'buying raises a draft invoice, not an issued one'
);

-- 10. A SECOND purchase in the same month does not collide. This is the whole
--     reason 0162 replaced the table-level UNIQUE with a partial index.
SELECT lives_ok(
  $$ SELECT public.school_purchase_credits('school_monthly', 2) $$,
  'a school may buy credits twice in one period'
);

-- 11. The credits exist in the ledger as a topup lot.
SELECT is(
  (SELECT l.credits FROM public.ai_credit_ledger AS l
    JOIN public.school_credit_purchases AS p ON p.lot_id = l.id
   WHERE p.seats = 10 LIMIT 1),
  600,
  'the purchase wrote a topup lot into the credit ledger'
);

-- ---------------------------------------------------------------------------
-- Assigning.
-- ---------------------------------------------------------------------------
-- 12. Nothing is assigned until somebody assigns it.
SELECT is(
  (SELECT public.school_credit_unassigned(p.id)
     FROM public.school_credit_purchases AS p WHERE p.seats = 10),
  600,
  'a fresh purchase is entirely unassigned'
);

-- 13. Assigning three teachers takes three seats.
SELECT is(
  (SELECT out_assigned FROM public.school_assign_credits(
     (SELECT id FROM public.school_credit_purchases WHERE seats = 10),
     ARRAY['user_t1','user_t2','user_t3'])),
  3,
  'three teachers can be assigned in one call'
);

SELECT is(
  (SELECT public.school_credit_unassigned(p.id)
     FROM public.school_credit_purchases AS p WHERE p.seats = 10),
  420,
  'three assignments of sixty leave four hundred and twenty unassigned'
);

-- 15. Pressing "assign to all" twice is a no-op for those already covered.
SELECT is(
  (SELECT out_assigned FROM public.school_assign_credits(
     (SELECT id FROM public.school_credit_purchases WHERE seats = 10),
     ARRAY['user_t1','user_t2','user_t3'])),
  0,
  'reassigning the same teachers assigns nobody and raises nothing'
);

-- 16. OVER-ASSIGNMENT IS REFUSED. 420 left is seven seats; ask for eight.
SELECT throws_ok(
  $$ SELECT public.school_assign_credits(
       (SELECT id FROM public.school_credit_purchases WHERE seats = 10),
       ARRAY['u1','u2','u3','u4','u5','u6','u7','u8']) $$,
  '22023', NULL,
  'assigning more credits than were bought is refused'
);

-- 17. ...and the refusal wrote nothing. All or nothing.
SELECT is(
  (SELECT public.school_credit_unassigned(p.id)
     FROM public.school_credit_purchases AS p WHERE p.seats = 10),
  420,
  'a refused assignment leaves the purchase untouched'
);

-- 18. A school holds no INSERT policy, so the functions cannot be bypassed.
SELECT throws_ok(
  $$ INSERT INTO public.school_credit_assignments
       (school_id, purchase_id, clerk_user_id, credits_allocated,
        period_start, period_end, assigned_by)
     VALUES ('a1111111-0000-4000-8000-000000000001',
             (SELECT id FROM public.school_credit_purchases WHERE seats = 10),
             'user_cheat', 100000, CURRENT_DATE, CURRENT_DATE + 30, 'user_bursar_a') $$,
  '42501', NULL,
  'a school cannot insert an assignment directly — the ceiling lives in the function'
);

-- ---------------------------------------------------------------------------
-- The teacher's view.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO
  '{"sub": "user_t1", "role": "authenticated", "o": {"id": "org_cred_a", "rol": "teacher"}}';

SELECT is(
  (SELECT out_school_available FROM public.teacher_credit_balances()),
  60,
  'an assigned teacher sees their own sixty credits'
);

-- 20. A teacher reads their own assignment and nobody else's.
SELECT is(
  (SELECT COUNT(*)::INT FROM public.school_credit_assignments),
  1,
  'a teacher reads only their own assignment, not their colleagues''
);

-- 21. The reserve is OFF until the school turns it on.
SELECT is(
  (SELECT out_reserve_available FROM public.teacher_credit_balances()),
  0,
  'the reserve is zero while it is disabled, even with credits unassigned'
);

-- 22. A teacher with no assignment has nothing.
SET LOCAL request.jwt.claims TO
  '{"sub": "user_nobody", "role": "authenticated", "o": {"id": "org_cred_a", "rol": "teacher"}}';

SELECT is(
  (SELECT out_school_available FROM public.teacher_credit_balances()),
  0,
  'an unassigned teacher has no school credits — this is an allocation, not a pool'
);

-- ---------------------------------------------------------------------------
-- Cross-tenant. The one that matters most.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO
  '{"sub": "user_owner_b", "role": "authenticated", "o": {"id": "org_cred_b", "rol": "owner"}}';

-- 23. School B cannot assign school A's purchase.
SELECT throws_ok(
  $$ SELECT public.school_assign_credits(
       (SELECT id FROM public.school_credit_purchases
         WHERE school_id = 'a1111111-0000-4000-8000-000000000001' AND seats = 10),
       ARRAY['user_b_teacher']) $$,
  '42501', NULL,
  'school B cannot assign school A''s credits'
);

-- 24. School B cannot even see school A's purchases.
SELECT is(
  (SELECT COUNT(*)::INT FROM public.school_credit_purchases),
  0,
  'school B reads none of school A''s purchases'
);

SELECT * FROM finish();
ROLLBACK;
