-- ===========================================================================
-- Phase 4 — per-school theming.
--
-- Spec: Official Documentation/01 Foundation Layer/DECISIONS.md ADR-043,
--       DESIGN_SYSTEM.md, DYNAMIC_CONFIG.md — School Branding.
-- Migrations under test: 0092_create_school_branding.sql
--                        0094_retune_branding_contrast_ground.sql
--
-- Three things are asserted here that nothing else can assert:
--
--  1. **The accessibility guardrail refuses.** `validateTheme()` in
--     packages/design-tokens gives a school a readable error at the API
--     boundary; these assertions prove the database refuses the same palettes
--     when that boundary is not in the path. A guardrail that only exists in
--     one of two writers is a guardrail that will eventually be walked past.
--
--  2. **The contrast maths agrees with the TypeScript.** Two implementations of
--     the WCAG luminance formula now exist — one in SQL for the constraint, one
--     in TS for the UI and the PDF renderer. The fixed ratios below are the
--     values `contrastRatio()` produces, so a divergence fails here rather than
--     appearing as a school whose theme the browser and the database disagree
--     about.
--
--  3. **The unauthenticated surface is narrow.** The parent login screen is
--     drawn before anyone has a session, so `school_branding_by_slug()` is
--     callable by `anon`. That is the only anon-reachable path into this data,
--     and these assertions pin exactly what it returns.
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

SELECT plan(38);

-- ---------------------------------------------------------------------------
-- Fixtures
--
-- Alpha is active and brands itself in maroon. Beta is active and unbranded —
-- it exercises the fallback path. Gamma is terminated, and must be invisible to
-- the login-screen function no matter what it has stored.
-- ---------------------------------------------------------------------------

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status, subscription_tier, logo_url)
VALUES
  ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_school_a','Alpha Academy','day','combined','LSK','active','starter', NULL),
  ('22222222-2222-2222-2222-222222222222','ZM-NDL-0002','org_school_b','Beta School','day','combined','NDL','active','growth','https://cdn.example.test/legacy-beta.png'),
  ('33333333-3333-3333-3333-333333333333','ZM-KIT-0003','org_school_c','Gamma College','day','combined','KIT','terminated','starter', NULL);

INSERT INTO public.school_branding (school_id, anchor_color, primary_color, logo_url, updated_by)
VALUES
  ('11111111-1111-1111-1111-111111111111','#5B1A1A','#B02E2E','https://cdn.example.test/alpha.png','user_owner_a'),
  ('33333333-3333-3333-3333-333333333333','#1A3A5B','#2E6EB0','https://cdn.example.test/gamma.png','user_owner_c');

-- Beta deliberately has no school_branding row at all. An absent row is the
-- normal state for a school that has not been through the branding step, and
-- it must resolve to the ZSMS default rather than to nothing.

-- ===========================================================================
-- SECTION A — the guardrail refuses, from a real school-owner seat
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"user_owner_b","o":{"id":"org_school_b","slg":"beta-school","rol":"org:owner"}}', TRUE);

-- Pale yellow measures 1.03:1 against the page it would be ink on. This is the
-- case the constraint exists for.
SELECT throws_ok(
  $$ INSERT INTO public.school_branding (school_id, anchor_color)
     VALUES ('22222222-2222-2222-2222-222222222222','#FFF9C4') $$,
  '23514',
  NULL,
  'GUARDRAIL an anchor colour far too light to be read as text is refused'
);

-- The near miss, and the one that changed in 0094. `#6E7690` measures 4.51:1
-- against white — it would have passed the original constraint — and 4.07:1
-- against the page it is actually drawn on. Refused, not warned about.
SELECT throws_ok(
  $$ INSERT INTO public.school_branding (school_id, anchor_color)
     VALUES ('22222222-2222-2222-2222-222222222222','#6E7690') $$,
  '23514',
  NULL,
  'GUARDRAIL an anchor that clears white but not the page is refused (0094)'
);

SELECT lives_ok(
  $$ INSERT INTO public.school_branding (school_id, anchor_color, primary_color)
     VALUES ('22222222-2222-2222-2222-222222222222','#1E2A3F','#3A8DDE') $$,
  'GUARDRAIL the ZSMS default palette is accepted'
);

-- A pale primary would leave the button's own edge invisible against the page —
-- WCAG 1.4.11, 3:1.
SELECT throws_ok(
  $$ UPDATE public.school_branding SET primary_color = '#9FD3FF'
     WHERE school_id = '22222222-2222-2222-2222-222222222222' $$,
  '23514',
  NULL,
  'GUARDRAIL a primary colour too pale to be a button fill is refused'
);

SELECT throws_ok(
  $$ UPDATE public.school_branding SET anchor_color = '#GGGGGG'
     WHERE school_id = '22222222-2222-2222-2222-222222222222' $$,
  '23514',
  NULL,
  'GUARDRAIL a malformed hex value is refused by the format constraint'
);

-- The format constraint carries the malformed case on its own. Without it the
-- contrast CHECK would evaluate to NULL and pass, which is the failure mode
-- this assertion exists to keep closed.
SELECT lives_ok(
  $$ UPDATE public.school_branding SET anchor_color = '#5b1a1a'
     WHERE school_id = '22222222-2222-2222-2222-222222222222' $$,
  'GUARDRAIL lowercase hex is accepted — schools paste colours in both cases'
);

SELECT throws_ok(
  $$ UPDATE public.school_branding SET logo_url = 'http://cdn.example.test/x.png'
     WHERE school_id = '22222222-2222-2222-2222-222222222222' $$,
  '23514',
  NULL,
  'GUARDRAIL a non-HTTPS logo URL is refused'
);

RESET ROLE;

-- Undo section A so the later sections see Beta unbranded again.
DELETE FROM public.school_branding WHERE school_id = '22222222-2222-2222-2222-222222222222';

-- ===========================================================================
-- SECTION B — the SQL contrast maths matches packages/design-tokens
-- ===========================================================================

SELECT is(
  round(public.wcag_contrast_ratio('#F1F3FA','#1E2A3F')::NUMERIC, 4),
  12.9895::NUMERIC,
  'MATHS the ZSMS anchor on the page ground is 12.9895:1, as contrastRatio() computes it'
);

-- The tightest number in the shipped default: brand blue clears the 3:1 fill
-- threshold on the page by 0.13. If the page ground is ever lightened or the
-- brand blue changed, this is the assertion that notices.
SELECT is(
  round(public.wcag_contrast_ratio('#3A8DDE','#F1F3FA')::NUMERIC, 4),
  3.1335::NUMERIC,
  'MATHS the ZSMS primary on the page ground is 3.1335:1, as contrastRatio() computes it'
);

-- Both halves of the 0094 worked example, pinned. The gap between these two
-- numbers IS the reason the ground moved.
SELECT is(
  round(public.wcag_contrast_ratio('#FFFFFF','#6E7690')::NUMERIC, 4),
  4.5092::NUMERIC,
  'MATHS #6E7690 clears 4.5:1 against white — the measurement 0092 would have made'
);

SELECT is(
  round(public.wcag_contrast_ratio('#F1F3FA','#6E7690')::NUMERIC, 4),
  4.0671::NUMERIC,
  'MATHS #6E7690 falls to 4.0671:1 against the page — the measurement that binds'
);

SELECT is(
  round(public.wcag_contrast_ratio('#000000','#FFFFFF')::NUMERIC, 2),
  21.00::NUMERIC,
  'MATHS black on white is the 21:1 ceiling'
);

SELECT is(
  round(public.wcag_contrast_ratio('#FFFFFF','#FFFFFF')::NUMERIC, 2),
  1.00::NUMERIC,
  'MATHS a colour against itself is the 1:1 floor'
);

-- NULL rather than an exception, because this is called from a CHECK: an
-- exception would report a format problem as a contrast problem.
SELECT is(
  public.wcag_contrast_ratio('not-a-colour','#FFFFFF'),
  NULL,
  'MATHS a malformed colour yields NULL rather than raising'
);

-- ===========================================================================
-- SECTION C — tenant isolation
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"user_owner_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:owner"}}', TRUE);

SELECT is(
  (SELECT anchor_color FROM public.school_branding
    WHERE school_id = '11111111-1111-1111-1111-111111111111'),
  '#5B1A1A',
  'TENANT a school reads its own branding'
);

SELECT is_empty(
  $$ SELECT school_id FROM public.school_branding
      WHERE school_id = '33333333-3333-3333-3333-333333333333' $$,
  'TENANT Alpha cannot read Gamma branding'
);

SELECT throws_ok(
  $$ INSERT INTO public.school_branding (school_id, anchor_color)
     VALUES ('33333333-3333-3333-3333-333333333333','#1A1A1A') $$,
  '42501',
  NULL,
  'ATTACK Alpha cannot insert branding for another school'
);

-- Not an error — RLS filters the row out, so the UPDATE simply matches nothing.
-- That silence is the danger: an UPDATE that quietly affects zero rows looks
-- identical to one that worked. So the write is attempted here and its absence
-- of effect is asserted below from a seat that can see both schools.
--
-- (It cannot be folded into the assertion itself: Postgres refuses a
-- data-modifying CTE anywhere but the top level, so `WITH u AS (UPDATE …)`
-- inside `is()` is a syntax error, not a passing test.)
UPDATE public.school_branding SET anchor_color = '#000000'
 WHERE school_id = '33333333-3333-3333-3333-333333333333';

RESET ROLE;

SELECT is(
  (SELECT anchor_color FROM public.school_branding
    WHERE school_id = '33333333-3333-3333-3333-333333333333'),
  '#1A3A5B',
  'ATTACK Gamma branding is unchanged after Alpha attempts to overwrite it'
);

-- ===========================================================================
-- SECTION D — who may read, and who may write
--
-- Reading is deliberately wider than most configuration: a parent, a student,
-- and a teacher all render the theme, so all of them need the row. Writing is
-- management only — a brand change is visible to every family at the school.
-- ===========================================================================

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"user_parent_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:parent"}}', TRUE);

SELECT is(
  (SELECT primary_color FROM public.school_branding
    WHERE school_id = '11111111-1111-1111-1111-111111111111'),
  '#B02E2E',
  'ROLE a parent reads the school branding — the portal cannot render without it'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"user_teacher_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:teacher"}}', TRUE);

SELECT is(
  (SELECT count(*)::INT FROM public.school_branding
    WHERE school_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'ROLE a teacher reads the school branding'
);

-- Same attempt-then-verify shape as Section C, and for the same reason.
UPDATE public.school_branding SET primary_color = '#111111'
 WHERE school_id = '11111111-1111-1111-1111-111111111111';
RESET ROLE;

SELECT is(
  (SELECT primary_color FROM public.school_branding
    WHERE school_id = '11111111-1111-1111-1111-111111111111'),
  '#B02E2E',
  'ROLE a teacher cannot change the school brand'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"user_acct_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:accountant"}}', TRUE);

-- An accountant handles money, not identity. Included explicitly because it is
-- the role most likely to be granted "admin-ish" powers by mistake.
UPDATE public.school_branding SET primary_color = '#222222'
 WHERE school_id = '11111111-1111-1111-1111-111111111111';
RESET ROLE;

SELECT is(
  (SELECT primary_color FROM public.school_branding
    WHERE school_id = '11111111-1111-1111-1111-111111111111'),
  '#B02E2E',
  'ROLE an accountant cannot change the school brand'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"user_owner_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:owner"}}', TRUE);

UPDATE public.school_branding SET primary_color = '#7A2E2E'
 WHERE school_id = '11111111-1111-1111-1111-111111111111';
RESET ROLE;

-- The positive case matters as much as the refusals: four assertions that a
-- write is blocked prove nothing if the table is simply unwritable.
SELECT is(
  (SELECT primary_color FROM public.school_branding
    WHERE school_id = '11111111-1111-1111-1111-111111111111'),
  '#7A2E2E',
  'ROLE an owner can change the school brand'
);

-- ===========================================================================
-- SECTION E — the unauthenticated login-screen surface
-- ===========================================================================

SELECT is(
  (SELECT count(*)::INT FROM information_schema.table_privileges
    WHERE table_schema = 'public' AND table_name = 'school_branding' AND grantee = 'anon'),
  0,
  'ANON holds no privilege on school_branding — the function is the only path'
);

SET LOCAL ROLE anon;

SELECT throws_ok(
  $$ SELECT anchor_color FROM public.school_branding $$,
  '42501',
  NULL,
  'ANON reading the branding table directly is refused by the executor'
);

SELECT is(
  public.school_branding_by_slug('zm-lsk-0001')->>'anchorColor',
  '#5B1A1A',
  'LOGIN the login screen resolves a school brand with no session'
);

SELECT is(
  public.school_branding_by_slug('ZM-LSK-0001')->>'schoolName',
  'Alpha Academy',
  'LOGIN the slug is case-insensitive — a parent typing it will not match case'
);

-- Beta has no branding row. The function must still answer, so the login page
-- shows the school name and the ZSMS default rather than a blank frame.
SELECT is(
  public.school_branding_by_slug('zm-ndl-0002')->>'schoolName',
  'Beta School',
  'LOGIN an unbranded school still resolves, for the ZSMS-default fallback'
);

SELECT is(
  public.school_branding_by_slug('zm-ndl-0002')->>'anchorColor',
  NULL,
  'LOGIN an unbranded school returns a null colour, not a fabricated one'
);

-- schools.logo_url predates school_branding; a school onboarded before 0092
-- keeps its logo.
SELECT is(
  public.school_branding_by_slug('zm-ndl-0002')->>'logoUrl',
  'https://cdn.example.test/legacy-beta.png',
  'LOGIN the legacy schools.logo_url is used when no branding row exists'
);

SELECT is(
  public.school_branding_by_slug('zm-kit-0003'),
  NULL,
  'LOGIN a terminated school is invisible, branding row notwithstanding'
);

SELECT is(
  public.school_branding_by_slug('zm-xxx-9999'),
  NULL,
  'LOGIN an unknown slug returns nothing'
);

-- Pinned so that adding a column to `schools` cannot widen an anon-readable
-- surface by accident.
SELECT is(
  (SELECT count(*)::INT FROM jsonb_object_keys(public.school_branding_by_slug('zm-lsk-0001'))),
  5,
  'LOGIN exactly five keys are exposed to anon — name, two colours, two logos'
);

SELECT is(
  (SELECT bool_and(k IN ('schoolName','anchorColor','primaryColor','logoUrl','iconUrl'))
     FROM jsonb_object_keys(public.school_branding_by_slug('zm-lsk-0001')) AS k),
  TRUE,
  'LOGIN no key beyond the branding five reaches an unauthenticated caller'
);

RESET ROLE;

-- ===========================================================================
-- SECTION F — worker_school_branding(), extended for themed documents
--
-- A receipt or report card must be drawn in the school's colours, or a parent
-- sees a themed portal and an unthemed PDF of the same money.
-- ===========================================================================

SELECT is(
  public.worker_school_branding('11111111-1111-1111-1111-111111111111')->>'anchorColor',
  '#5B1A1A',
  'WORKER the document renderer receives the school brand colours'
);

-- 0091 shipped five keys and callers read them by name. The 0092 replacement
-- must be additive.
SELECT is(
  public.worker_school_branding('11111111-1111-1111-1111-111111111111')->>'schoolCode',
  'ZM-LSK-0001',
  'WORKER the 0091 document-header keys survive the 0092 replacement'
);

SELECT is(
  public.worker_school_branding('22222222-2222-2222-2222-222222222222')->>'logoUrl',
  'https://cdn.example.test/legacy-beta.png',
  'WORKER a school with no branding row still gets its legacy logo'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"user_owner_a","o":{"id":"org_school_a","slg":"alpha-academy","rol":"org:owner"}}', TRUE);

SELECT throws_ok(
  $$ SELECT public.worker_school_branding('11111111-1111-1111-1111-111111111111') $$,
  '42501',
  NULL,
  'ATTACK a school owner calling the worker branding function is refused (ADR-042)'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
