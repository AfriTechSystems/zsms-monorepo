-- ===========================================================================
-- Per-student pricing — the model switch, the bands, and the reachability rule.
--
-- Spec: Official Documentation/17 Integration and Pricing/PRICING.md
--       Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- `0124` built per-student pricing completely and gave it no way to turn on. Every tier sat on
-- `flat` from the day it was written, because `admin_update_tier()` does not take `pricing_model`
-- and nothing else could set it. `0138` added the switch and `0139` made it reachable.
--
-- The assertions fall into three groups, and the third is the one that would not have occurred to
-- me before it bit:
--
--   * **The money is right.** A school is charged the rate for the band its roll falls in, and a
--     roll no band covers produces NULL and a reason rather than a zero. Billing a school nothing
--     because a band is missing is the failure that loses real revenue silently.
--   * **The rules hold.** Bands may not overlap, an upper limit may not sit below its lower
--     limit, and only AfriTech may touch any of it.
--   * **The functions are REACHABLE.** `supabase/config.toml` exposes `public` alone, so a
--     function in `afritech` can be called from SQL and never by a route. Three had drifted there
--     — including one written the day before this suite. Asserted by name, because nothing else
--     catches it until a 404 in production.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(17);

-- ---------------------------------------------------------------------------
-- THE REACHABILITY ASSERTIONS. These are schema facts, not behaviour.
-- ---------------------------------------------------------------------------
/**
 * PostgREST resolves `rpc()` against the exposed schemas, which is `public` and nothing else. A
 * route calling a function that lives in `afritech` gets a 404 at runtime — it compiles, it
 * type-checks, and it fails only when a person clicks the button.
 *
 * Named individually rather than counted, so a failure says which one drifted.
 */
SELECT has_function('public', 'admin_set_tier_pricing_model',
  'admin_set_tier_pricing_model is in public, where a route can reach it');

SELECT has_function('public', 'admin_upsert_tier_price_band',
  'admin_upsert_tier_price_band is in public — there was NO band writer at all before it');

SELECT has_function('public', 'admin_delete_tier_price_band',
  'admin_delete_tier_price_band is in public, wrapping the afritech original from 0129');

SELECT has_function('public', 'admin_publish_prompt_template',
  'admin_publish_prompt_template is in public, though CLAUDE.md named the unreachable one');

-- ---------------------------------------------------------------------------
-- The switch.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_afritech", "role": "authenticated",
  "o": {"id": "org_afritech", "rol": "afritech:super_admin", "slg": "afritech-systems-admin"}
}';

SELECT is(
  (SELECT pricing_model FROM public.admin_set_tier_pricing_model('starter', 'per_student')),
  'per_student',
  'a tier can be switched to per-pupil pricing — which nothing could do before 0138'
);

/**
 * Switching with no bands is ALLOWED. The alternative forces an admin to invent a band to unlock
 * the screen that defines bands, and it is safe because the charge function reports an unpriced
 * school rather than billing it zero — asserted below.
 */
SELECT is(
  (SELECT band_count FROM public.admin_set_tier_pricing_model('starter', 'per_student')),
  0::bigint,
  '...with no bands yet, and the count comes back so a screen can say so'
);

SELECT throws_ok(
  $$ SELECT public.admin_set_tier_pricing_model('starter', 'hourly') $$,
  '22023',
  NULL,
  'an unknown pricing model is refused by name rather than by a raw check violation'
);

-- ---------------------------------------------------------------------------
-- The bands.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT public.admin_upsert_tier_price_band('starter', 1, 100, 12.00, 0.45) $$,
  'a band can be created'
);

SELECT lives_ok(
  -- NULL upper limit is the open-ended top band. Without one, a school that outgrows the highest
  -- band becomes unpriceable the day it does.
  $$ SELECT public.admin_upsert_tier_price_band('starter', 101, NULL, 9.00, 0.34) $$,
  'and an open-ended top band, which is what covers a school that keeps growing'
);

SELECT throws_ok(
  $$ SELECT public.admin_upsert_tier_price_band('starter', 50, 200, 5.00, 0.20) $$,
  '23514',
  NULL,
  'an overlapping band is refused — two prices for one roll size has no answer'
);

SELECT throws_ok(
  $$ SELECT public.admin_upsert_tier_price_band('starter', 600, 300, 5.00, 0.20) $$,
  '22023',
  NULL,
  'an upper limit below its lower limit is refused'
);

-- ---------------------------------------------------------------------------
-- THE MONEY.
-- ---------------------------------------------------------------------------
RESET ROLE;

INSERT INTO public.schools
  (id, school_id, clerk_org_id, name, type, level, city_code, status, subscription_tier)
VALUES ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
        'Alpha Academy', 'day', 'combined', 'LSK', 'active', 'starter');

-- 120 pupils falls in the 101+ band at K9.00.
INSERT INTO public.students (student_id, school_id, first_name, last_name, grade_id, class_id)
SELECT 'STU-ZM-LSK-0001-' || lpad(g::text, 5, '0'),
       '11111111-1111-1111-1111-111111111111', 'P' || g, 'S', 'grade_7', 'grade_7a'
FROM generate_series(1, 120) g;

SELECT is(
  (SELECT out_unit_price FROM public.school_subscription_charge(
     '11111111-1111-1111-1111-111111111111', 'ZMW')),
  9.00::numeric,
  'a school of 120 is priced from the 101-and-above band, not the first one'
);

SELECT is(
  (SELECT out_amount FROM public.school_subscription_charge(
     '11111111-1111-1111-1111-111111111111', 'ZMW')),
  1080.00::numeric,
  '...and charged 120 x K9.00 = K1,080'
);

-- ---------------------------------------------------------------------------
-- THE REVENUE HOLE. A roll no band covers must not be free.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_afritech", "role": "authenticated",
  "o": {"id": "org_afritech", "rol": "afritech:super_admin", "slg": "afritech-systems-admin"}
}';

SELECT lives_ok(
  $$ DO $do$
     DECLARE b RECORD;
     BEGIN
       FOR b IN SELECT id FROM public.tier_price_bands WHERE tier_name = 'starter' LOOP
         PERFORM public.admin_delete_tier_price_band(b.id);
       END LOOP;
     END $do$ $$,
  'the bands are removed, leaving a per-pupil tier with none'
);

SELECT is(
  (SELECT out_amount FROM public.school_subscription_charge(
     '11111111-1111-1111-1111-111111111111', 'ZMW')),
  NULL,
  'a school no band covers is UNPRICED — NULL, never zero, because zero is a real price'
);

SELECT isnt(
  (SELECT out_reason FROM public.school_subscription_charge(
     '11111111-1111-1111-1111-111111111111', 'ZMW')),
  NULL,
  '...and says why, so the hole is visible rather than surfacing as a missing invoice'
);

-- ---------------------------------------------------------------------------
-- Nobody else touches any of it.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_owner_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "owner", "slg": "alpha-academy"}
}';

SELECT throws_ok(
  $$ SELECT public.admin_upsert_tier_price_band('starter', 1, 10, 0.01, 0.01) $$,
  '42501',
  NULL,
  'a school owner cannot price their own tier'
);

SELECT * FROM finish();
ROLLBACK;
