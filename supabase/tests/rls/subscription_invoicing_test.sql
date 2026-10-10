-- ===========================================================================
-- Subscription invoicing — what AfriTech charges a school, and what it cannot do.
--
-- Spec: Official Documentation/17 Integration and Pricing/PRICING.md
--       Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-041 (the basis lesson)
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- ## The failure that looks like success
--
-- The dangerous bug in per-student billing is a school whose roll falls outside every
-- configured band. The naive implementation sums nothing, issues a K0 invoice, and
-- the billing run reports success — so the school is never chased and the revenue is
-- gone silently. `THE ZERO TRAP` below is that case: 80 pupils on a tier whose bands
-- stop at 50. It must refuse, and it must create no invoice at all.
--
-- ## An invoice carries its own basis
--
-- ADR-041's lesson applied to money. The pupil count, the unit price, the tier and
-- the tax rate are stored ON the invoice, because bands get repriced and VAT moves,
-- and "why was I charged K1,392 in October" is a question a school will ask in
-- March. Nothing about a historical invoice is ever recomputed from current
-- configuration.
--
-- ## School money and AfriTech money are different money
--
-- `public.payments` is a parent paying a school. These tables are a school paying
-- AfriTech. The suite asserts that a school owner reads NOTHING from
-- `afritech.invoices` directly — the schema is off PostgREST — while still seeing
-- its own bills through `my_school_invoices()`. Conflating the two ledgers would
-- make every revenue report afterwards untrustworthy.
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

SELECT plan(20);

INSERT INTO afritech.subscription_tiers
  (tier_name, display_name, monthly_price_zmw, monthly_price_usd, annual_price_zmw,
   student_limit, whatsapp_quota, pricing_model)
VALUES
  ('ps_plan', 'Per pupil', 0, 0, 0, NULL, 2000, 'per_student'),
  -- Bands deliberately stop at 50, so a larger school has no band. This tier exists
  -- only to prove the zero trap is closed.
  ('ps_gap', 'Per pupil (incomplete bands)', 0, 0, 0, NULL, 2000, 'per_student');

INSERT INTO afritech.tier_student_price_bands
  (tier_name, min_students, max_students, price_per_student_zmw, price_per_student_usd)
VALUES
  ('ps_plan', 0,   100,  15, 0.60),
  ('ps_plan', 101, NULL, 12, 0.48),
  ('ps_gap',  0,   50,   15, 0.60);

INSERT INTO public.schools
  (id, school_id, clerk_org_id, name, type, level, city_code, status, subscription_tier)
VALUES
 ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_a','Alpha','day','combined','LSK','active','ps_plan'),
 ('44444444-4444-4444-4444-444444444444','ZM-LSK-0004','org_d','Gap School','day','combined','LSK','active','ps_gap');

INSERT INTO public.students (student_id, school_id, first_name, last_name, grade_id, class_id)
SELECT 'STU-A-'||g,'11111111-1111-1111-1111-111111111111','P','One','grade_1','g1a'
FROM generate_series(1,80) g;

INSERT INTO public.students (student_id, school_id, first_name, last_name, grade_id, class_id)
SELECT 'STU-D-'||g,'44444444-4444-4444-4444-444444444444','P','Gap','grade_1','g1a'
FROM generate_series(1,80) g;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub":"user_afritech","role":"authenticated",
  "o":{"id":"org_af","rol":"super_admin","slg":"afritech-systems-admin"}}';

-- ---------------------------------------------------------------------------
-- Generation, and the basis.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT total FROM afritech.generate_school_invoice(
     '11111111-1111-1111-1111-111111111111','2026-10-01','2026-10-31','ZMW',16)),
  1392.00::numeric,
  '80 pupils x K15 = K1200, plus 16% = K1392'
);

SELECT is((SELECT student_count FROM afritech.invoices LIMIT 1), 80,
  'THE BASIS: the pupil count is stored on the invoice, not recomputed later');

SELECT is((SELECT unit_price FROM afritech.invoices LIMIT 1), 15.00::numeric,
  'and the unit price that produced it, so a reband cannot rewrite history');

SELECT is((SELECT tax_rate FROM afritech.invoices LIMIT 1), 16.00::numeric,
  'and the tax rate that applied, so a VAT change cannot either');

SELECT is((SELECT status FROM afritech.invoices LIMIT 1), 'draft',
  'an invoice starts as a draft — AfriTech''s working state');

SELECT is((SELECT invoice_number FROM afritech.invoices LIMIT 1), 'INV-2026-000001',
  'numbered from MAX of the suffix, so a void never reissues a number');

SELECT is((SELECT count(*)::int FROM afritech.invoice_lines), 1,
  'with a subscription line a school can check the arithmetic of');

-- ---------------------------------------------------------------------------
-- The lifecycle.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT afritech.record_invoice_payment(
       (SELECT id FROM afritech.invoices LIMIT 1), 500, 'bank_transfer') $$,
  '23514', NULL,
  'a payment cannot be recorded against a draft — nobody pays a bill they were not sent'
);

SELECT is(
  (SELECT status FROM afritech.issue_invoice((SELECT id FROM afritech.invoices LIMIT 1))),
  'issued',
  'issuing moves it to issued'
);

SELECT afritech.record_invoice_payment(
  (SELECT id FROM afritech.invoices LIMIT 1), 392, 'mobile_money', 'MTN-ABC123');

SELECT is((SELECT status FROM afritech.invoices LIMIT 1), 'part_paid',
  'a partial payment gives part_paid');

SELECT is((SELECT amount_paid FROM afritech.invoices LIMIT 1), 392.00::numeric,
  'and amount_paid is derived by trigger, never written by hand');

SELECT afritech.record_invoice_payment(
  (SELECT id FROM afritech.invoices LIMIT 1), 1000, 'bank_transfer', 'FNB-999');

SELECT is((SELECT status FROM afritech.invoices LIMIT 1), 'paid',
  'paying the balance gives paid');

SELECT ok((SELECT paid_at IS NOT NULL FROM afritech.invoices LIMIT 1),
  'and stamps paid_at');

SELECT throws_ok(
  $$ SELECT afritech.generate_school_invoice(
       '11111111-1111-1111-1111-111111111111','2026-10-01','2026-10-31','ZMW',16) $$,
  '23505', NULL,
  'one invoice per school per period — re-running a month is safe'
);

-- ---------------------------------------------------------------------------
-- THE ZERO TRAP.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT afritech.generate_school_invoice(
       '44444444-4444-4444-4444-444444444444','2026-10-01','2026-10-31','ZMW',16) $$,
  '23514', NULL,
  'THE ZERO TRAP: 80 pupils with bands only to 50 is refused, never billed zero'
);

SELECT is(
  (SELECT count(*)::int FROM afritech.invoices
    WHERE school_id = '44444444-4444-4444-4444-444444444444'),
  0,
  'and no invoice was created for it at all'
);

SELECT throws_ok(
  $$ SELECT afritech.void_invoice((SELECT id FROM afritech.invoices LIMIT 1), 'mistake') $$,
  '23514', NULL,
  'a paid invoice cannot be voided — a paid bill is corrected with a credit note'
);

-- ---------------------------------------------------------------------------
-- Gateway foundation: the idempotency key.
-- ---------------------------------------------------------------------------
SELECT afritech.generate_school_invoice(
  '11111111-1111-1111-1111-111111111111','2026-11-01','2026-11-30','ZMW',16);
SELECT afritech.issue_invoice(
  (SELECT id FROM afritech.invoices WHERE period_start = '2026-11-01'));

INSERT INTO afritech.invoice_payments
  (invoice_id, amount, method, gateway_name, gateway_reference, status)
VALUES ((SELECT id FROM afritech.invoices WHERE period_start = '2026-11-01'),
        100, 'gateway', 'airtel', 'TX-777', 'confirmed');

SELECT throws_ok(
  $$ INSERT INTO afritech.invoice_payments
       (invoice_id, amount, method, gateway_name, gateway_reference, status)
     VALUES ((SELECT id FROM afritech.invoices WHERE period_start = '2026-11-01'),
             100, 'gateway', 'airtel', 'TX-777', 'confirmed') $$,
  '23505', NULL,
  'GATEWAY: a retried webhook cannot credit a school twice — a constraint, not care'
);

-- ---------------------------------------------------------------------------
-- The two ledgers stay apart.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub":"user_owner_a","role":"authenticated",
  "o":{"id":"org_a","rol":"owner","slg":"alpha"}}';

SELECT is((SELECT count(*)::int FROM afritech.invoices), 0,
  'a school owner reads nothing from the afritech table directly');

SELECT is((SELECT count(*)::int FROM public.my_school_invoices()), 2,
  'but sees its own issued invoices through the function — drafts excluded');

SELECT * FROM finish();
ROLLBACK;
