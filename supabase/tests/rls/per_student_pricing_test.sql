-- ===========================================================================
-- Per-student pricing — bands, the ceiling interaction, and tiers as data.
--
-- Spec: Official Documentation/17 Integration and Pricing/PRICING.md
--       Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-014, ADR-040
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- ## Tiers were not data, despite two documents saying they were
--
-- `CLAUDE.md` and `PRICING.md` both state pricing is entirely database-driven and a
-- tier must never be hardcoded. Both `afritech.subscription_tiers.tier_name` and
-- `public.schools.subscription_tier` nonetheless carried
-- `CHECK (... IN ('starter','growth','professional','enterprise'))`, so the set of
-- plans AfriTech could sell was fixed in DDL in two places. Found by trying to add
-- the per-student plan this work exists for and being refused by a constraint.
--
-- The first assertion is simply that a new tier can be created. It would have
-- failed before `0125`.
--
-- ## A typo used to remove a school's enrolment ceiling
--
-- `tier_override` in `school_feature_overrides` was free text. A misspelling
-- resolved to no tier, and `school_student_limit()` reads "tier not found" as
-- UNLIMITED — deliberately, so an AfriTech configuration gap cannot lock a school's
-- enrolment. Correct for a missing tier; wrong for a typo, because the typo was
-- ours and the consequence was an uncapped school nobody meant to uncap.
--
-- ## A missing band must not bill zero
--
-- The dangerous failure in per-student pricing is a roll outside every band: the
-- naive implementation sums nothing and issues a K0 invoice that looks like a
-- successful billing run. The resolver returns a NULL amount and a stated reason
-- instead, so the invoice run can refuse.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SELECT plan(15);

-- Creating a tier at all is the first assertion: this is DDL-free plan creation.
INSERT INTO afritech.subscription_tiers
  (tier_name, display_name, monthly_price_zmw, monthly_price_usd, annual_price_zmw,
   student_limit, whatsapp_quota, pricing_model)
VALUES ('growth_ps', 'Growth (per pupil)', 0, 0, 0, 250, 2000, 'per_student');

SELECT ok(TRUE, 'a brand-new tier can be created as data, with no migration');

-- Bands: K15 up to 100 pupils, K12 to 300, K9 above. A volume discount expressed
-- per pupil, which is what "a fee depending on number of students" means.
INSERT INTO afritech.tier_student_price_bands
  (tier_name, min_students, max_students, price_per_student_zmw, price_per_student_usd)
VALUES
  ('growth_ps', 0,   100,  15, 0.60),
  ('growth_ps', 101, 300,  12, 0.48),
  ('growth_ps', 301, NULL,  9, 0.36);

INSERT INTO public.schools
  (id, school_id, clerk_org_id, name, type, level, city_code, status, subscription_tier)
VALUES
 ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_a','Small School','day','combined','LSK','active','growth_ps'),
 ('22222222-2222-2222-2222-222222222222','ZM-NDL-0002','org_b','Big School','day','combined','NDL','active','growth_ps'),
 ('33333333-3333-3333-3333-333333333333','ZM-KIT-0003','org_c','Flat School','day','combined','KIT','active','starter');

SELECT ok(TRUE, 'and a school can be put on it');

-- 80 pupils lands in band 1; 150 in band 2. Two bands exercised, not one.
INSERT INTO public.students (student_id, school_id, first_name, last_name, grade_id, class_id)
SELECT 'STU-A-'||g,'11111111-1111-1111-1111-111111111111','P','One','grade_1','g1a'
FROM generate_series(1,80) g;

INSERT INTO public.students (student_id, school_id, first_name, last_name, grade_id, class_id)
SELECT 'STU-B-'||g,'22222222-2222-2222-2222-222222222222','P','Two','grade_1','g1a'
FROM generate_series(1,150) g;

SELECT is(
  (SELECT out_student_count FROM public.school_subscription_charge(
     '11111111-1111-1111-1111-111111111111')),
  80,
  'the charge is based on the roll as it stands — the agreed snapshot basis'
);

SELECT is(
  (SELECT out_unit_price FROM public.school_subscription_charge(
     '11111111-1111-1111-1111-111111111111')),
  15.00::numeric,
  '80 pupils falls in the 0-100 band at K15'
);

SELECT is(
  (SELECT out_amount FROM public.school_subscription_charge(
     '11111111-1111-1111-1111-111111111111')),
  1200.00::numeric,
  '80 x K15 = K1200'
);

SELECT is(
  (SELECT out_unit_price FROM public.school_subscription_charge(
     '22222222-2222-2222-2222-222222222222')),
  12.00::numeric,
  '150 pupils falls in the 101-300 band at K12 — the band boundary works'
);

SELECT is(
  (SELECT out_amount FROM public.school_subscription_charge(
     '22222222-2222-2222-2222-222222222222')),
  1800.00::numeric,
  '150 x K12 = K1800'
);

SELECT is(
  (SELECT out_unit_price FROM public.school_subscription_charge(
     '11111111-1111-1111-1111-111111111111', 'USD')),
  0.60::numeric,
  'the USD band price resolves too — PRICING.md commits to both currencies'
);

-- ---------------------------------------------------------------------------
-- Flat tiers are untouched.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT out_pricing_model FROM public.school_subscription_charge(
     '33333333-3333-3333-3333-333333333333')),
  'flat',
  'a flat tier is still flat — pricing model is per tier, not global'
);

-- ---------------------------------------------------------------------------
-- THE CEILING INTERACTION. student_limit is 250 on this tier and irrelevant.
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT is_unlimited FROM public.school_student_limit(
     '11111111-1111-1111-1111-111111111111')),
  'a per-student tier has no enrolment ceiling — paying per pupil then being '
  'blocked from enrolling one would be charging for growth and preventing it'
);

SELECT is(
  (SELECT source FROM public.school_student_limit(
     '11111111-1111-1111-1111-111111111111')),
  'per_student_pricing',
  'and the resolver says why, rather than reporting an unexplained unlimited'
);

-- Precedence preserved: an operator who pins a cap is still honoured, so "a
-- negotiated cap on a per-student plan" needs no further migration.
INSERT INTO afritech.school_feature_overrides
  (school_id, override_type, override_value, reason, granted_by, is_active)
VALUES ('11111111-1111-1111-1111-111111111111','student_limit_override','500',
        'negotiated cap','u',TRUE);

SELECT is(
  (SELECT student_limit FROM public.school_student_limit(
     '11111111-1111-1111-1111-111111111111')),
  500,
  'an explicit per-school cap still overrides per-student pricing'
);

-- ---------------------------------------------------------------------------
-- Configuration that would produce an unexplainable bill.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ INSERT INTO afritech.tier_student_price_bands
       (tier_name,min_students,max_students,price_per_student_zmw,price_per_student_usd)
     VALUES ('growth_ps',50,200,10,0.4) $$,
  '23514',
  NULL,
  'overlapping bands are refused — otherwise a price depends on row order'
);

SELECT throws_ok(
  $$ INSERT INTO public.schools
       (school_id, clerk_org_id, name, type, level, city_code, status, subscription_tier)
     VALUES ('ZM-XXX-9999','org_x','Bad','day','combined','LSK','active','platinum') $$,
  '23503',
  NULL,
  'a school cannot be put on a tier that does not exist'
);

SELECT throws_ok(
  $$ INSERT INTO afritech.school_feature_overrides
       (school_id, override_type, override_value, reason, granted_by, is_active)
     VALUES ('33333333-3333-3333-3333-333333333333','tier_override','profesional','typo','u',TRUE) $$,
  '23503',
  NULL,
  'a mistyped tier override is refused rather than silently granting unlimited pupils'
);

SELECT * FROM finish();
ROLLBACK;
