-- ===========================================================================
-- School provisioning and onboarding — the path that creates a customer.
--
-- Spec: Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md
--       Official Documentation/15 Super Admin and Platform/ONBOARDING.md
--
-- This suite exists because provisioning is the one act that MAKES a tenant. Everything else in
-- this database defends a boundary that already exists; `admin_create_school()` draws a new one.
-- Two consequences drive what is asserted here:
--
--   * **`clerk_org_id` IS the tenant.** Every RLS policy in the schema resolves through it, so the
--     assertions about attaching it — that it cannot be set twice, that it must look like a Clerk
--     id, that an unattached school is reachable by nobody — are tenancy assertions rather than
--     housekeeping.
--
--   * **`school_onboarding` holds AfriTech's private view of a customer.** `internal_notes` is
--     where "this school has missed two payments" lives. The suite proves a school owner cannot
--     read their own row, because the failure mode is not a crash but a quiet leak.
--
-- It also carries a regression guard for `0140`. That migration closed a real privilege escalation
-- — a school owner could set their own subscription tier — and `0142` reopened the grant list to
-- add `province_code`. Widening a column grant is exactly how such a fix gets undone.
--
-- ---------------------------------------------------------------------------
-- TWO THINGS THAT LOOK LIKE ASSERTIONS AND ARE NOT
-- ---------------------------------------------------------------------------
-- **An RLS-blocked UPDATE raises nothing.** It matches zero rows and reports success. So the test
-- that a school owner cannot write their own onboarding record counts affected rows through a
-- data-modifying CTE; `throws_ok` there would fail against correct behaviour.
--
-- **No temporary tables.** Referring to a created school through `CREATE TEMP TABLE` would need
-- TEMP privilege for `authenticated`, which is not something this suite should depend on. Schools
-- are looked up by their deterministic identifier instead, which also asserts the identifier.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(42);

-- ---------------------------------------------------------------------------
-- The catalogue.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT COUNT(*)::INT FROM afritech.onboarding_checklist_items WHERE is_active),
  14,
  'the catalogue holds all fourteen items ONBOARDING.md names — 0010 admitted ten'
);

SELECT ok(
  EXISTS (SELECT 1 FROM afritech.onboarding_checklist_items WHERE item_key = 'whatsapp_configured'),
  'including whatsapp_configured, which business rule 4 required and nothing ever added'
);

SELECT is(
  (SELECT SUM(weight)::INT FROM afritech.onboarding_checklist_items
    WHERE is_active AND category = 'critical'),
  60,
  'critical items weigh 60 in total, per the documented split'
);

SELECT is(
  (SELECT SUM(weight)::INT FROM afritech.onboarding_checklist_items WHERE is_active),
  100,
  '...and the whole catalogue weighs 100, so a fully set-up school can reach exactly 100%'
);

-- ---------------------------------------------------------------------------
-- An existing school, so the sequence has somewhere to continue from.
-- ---------------------------------------------------------------------------
INSERT INTO public.schools
  (id, school_id, clerk_org_id, name, type, level, city_code, province_code,
   status, subscription_tier)
VALUES ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
        'Alpha Academy', 'day', 'combined', 'LSK', 'LSK', 'active', 'starter');

-- ---------------------------------------------------------------------------
-- A school owner, who must not be able to create a school.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_owner_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "owner", "slg": "alpha-academy"}
}';

SELECT throws_ok(
  $$ SELECT * FROM public.admin_create_school(
       'Rogue School', 'day', 'primary', 'LSK', 'LSK',
       'Rogue', 'Owner', 'rogue@example.com') $$,
  '42501',
  NULL,
  'a school owner cannot create a school — provisioning mints a tenant'
);

SELECT throws_ok(
  $$ SELECT public.ensure_onboarding_checklist('11111111-1111-1111-1111-111111111111') $$,
  '42501',
  NULL,
  '...nor seed checklist rows, which is an operator act'
);

-- 0140's fix, re-asserted because 0142 edited the very grant that carries it.
SELECT ok(
  has_column_privilege('authenticated', 'public.schools', 'province_code', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.schools', 'subscription_tier', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.schools', 'trial_ends_at', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.schools', 'status', 'UPDATE'),
  '0142 added province_code to the profile grant and did NOT reopen what 0140 closed'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.schools', 'city_code', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.schools', 'school_id', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.schools', 'clerk_org_id', 'UPDATE'),
  'and the identifier columns stay unwritable — school_id is inside every receipt number'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.onboarding_checklist_catalogue),
  14,
  'an ordinary school user reads the catalogue — their own setup screen renders from it'
);

SELECT throws_ok(
  $$ INSERT INTO afritech.onboarding_checklist_items
       (item_key, label, description, category, weight, sort_order)
     VALUES ('rogue', 'Rogue', 'Invented', 'optional', 99, 999) $$,
  '42501',
  NULL,
  '...and cannot add to it — the catalogue is AfriTech''s definition'
);

-- ---------------------------------------------------------------------------
-- AfriTech creates a school.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_afritech", "role": "authenticated",
  "o": {"id": "org_afritech", "rol": "afritech:super_admin", "slg": "afritech-systems-admin"}
}';

SELECT is(
  (SELECT school_id FROM public.admin_create_school(
     'Sunrise Academy', 'day', 'secondary', 'LSK', 'LSK',
     'Grace', 'Mwale', 'grace@sunrise.example', '+260977123456',
     'growth', 'Plot 1234, Great East Road', 'MOE/2019/4471',
     'Referred by Alpha Academy.')),
  'ZM-LSK-0002',
  'the identifier continues the per-city sequence — Alpha already holds 0001'
);

SELECT is(
  (SELECT owner_email || ' / ' || owner_first_name || ' ' || owner_last_name
     FROM public.school_onboarding
    WHERE school_id = (SELECT id FROM public.schools WHERE school_id = 'ZM-LSK-0002')),
  'grace@sunrise.example / Grace Mwale',
  'the invited owner is recorded — staff_members cannot hold them until they accept'
);

SELECT is(
  (SELECT status FROM public.schools WHERE school_id = 'ZM-LSK-0002'),
  'pending_verification',
  'an AfriTech-created school is pending_verification, never trial (business rule 3)'
);

SELECT ok(
  (SELECT trial_ends_at IS NULL FROM public.schools WHERE school_id = 'ZM-LSK-0002'),
  '...and gets no trial at all, per TRIAL.md business rule 1'
);

SELECT ok(
  (SELECT clerk_org_id LIKE 'pending\_%' FROM public.schools WHERE school_id = 'ZM-LSK-0002'),
  'the tenant key is a placeholder until Clerk answers — so nobody can reach it yet'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.onboarding_checklists c
     JOIN public.schools s ON s.id = c.school_id
    WHERE s.school_id = 'ZM-LSK-0002'),
  14,
  'all fourteen checklist items are created with the school'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.onboarding_checklists c
     JOIN public.schools s ON s.id = c.school_id
    WHERE s.school_id = 'ZM-LSK-0002' AND c.is_complete),
  0,
  '...none of them complete'
);

SELECT is(
  (SELECT completion_pct FROM public.school_onboarding_completion(
     (SELECT id FROM public.schools WHERE school_id = 'ZM-LSK-0002'))),
  0,
  'so completion starts at 0%'
);

-- A different city must not continue Lusaka's numbering.
SELECT is(
  (SELECT school_id || ' / ' || clerk_slug FROM public.admin_create_school(
     'Copper Trust School', 'boarding', 'primary', 'CBR', 'NDL',
     'John', 'Banda', 'john@copper.example')),
  'ZM-NDL-0001 / zm-ndl-0001',
  'a different city starts its own sequence, and the slug is that identifier lowercased'
);

-- ---------------------------------------------------------------------------
-- The province constraint.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ INSERT INTO public.schools
       (school_id, clerk_org_id, name, type, level, city_code, province_code, status)
     VALUES ('ZM-LSK-9999', 'org_bad', 'Bad', 'day', 'primary', 'LSK', 'XXX', 'active') $$,
  '23514',
  NULL,
  'an invented province code is refused'
);

/**
 * `trial_expired` is new in 0142, and the route to it is the point.
 *
 * `status` is not in the column grant `0140` left behind, and an AfriTech administrator is an
 * `authenticated` user like any other — so even they cannot write it directly. It changes through
 * `admin_update_school_commercial()` or not at all.
 */
SELECT is(
  (SELECT status FROM public.admin_update_school_commercial(
     '11111111-1111-1111-1111-111111111111', p_status => 'trial_expired')),
  'trial_expired',
  'trial_expired is accepted — the sixth status the lifecycle always named'
);

SELECT throws_ok(
  $$ UPDATE public.schools SET status = 'active' WHERE school_id = 'ZM-LSK-0001' $$,
  '42501',
  NULL,
  '...and not even AfriTech writes status directly — the column grant binds them too'
);

-- ---------------------------------------------------------------------------
-- Attaching the Clerk organisation.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  format($$ SELECT public.admin_attach_clerk_org(%L, 'not-a-clerk-id') $$,
         (SELECT id FROM public.schools WHERE school_id = 'ZM-LSK-0002')),
  '22023',
  NULL,
  'a value that is not a Clerk organisation id is refused'
);

SELECT ok(
  (SELECT public.admin_attach_clerk_org(
     (SELECT id FROM public.schools WHERE school_id = 'ZM-LSK-0002'), 'org_sunrise')),
  'the real organisation id attaches'
);

SELECT is(
  (SELECT clerk_org_id FROM public.schools WHERE school_id = 'ZM-LSK-0002'),
  'org_sunrise',
  '...and becomes the tenant key'
);

/**
 * THE ASSERTION THAT MATTERS MOST IN THIS FILE.
 *
 * Repointing a provisioned school at another organisation would hand every pupil, payment and
 * result it holds to whoever controls that organisation. It is one UPDATE of one column, and it is
 * the entire tenancy boundary.
 */
SELECT throws_ok(
  format($$ SELECT public.admin_attach_clerk_org(%L, 'org_somebody_else') $$,
         (SELECT id FROM public.schools WHERE school_id = 'ZM-LSK-0002')),
  '42710',
  NULL,
  'a second attach is refused — repointing clerk_org_id transfers the whole tenant'
);

-- ---------------------------------------------------------------------------
-- Verification and activation.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  format($$ SELECT * FROM public.admin_activate_school(%L, '   ') $$,
         (SELECT id FROM public.schools WHERE school_id = 'ZM-LSK-0002')),
  '22023',
  NULL,
  'activation with a blank note is refused — the note IS the verification record'
);

SELECT throws_ok(
  format($$ SELECT * FROM public.admin_activate_school(%L, 'Spoke to the head teacher.') $$,
         (SELECT id FROM public.schools WHERE school_id = 'ZM-NDL-0001')),
  '55000',
  NULL,
  'and a school with no Clerk organisation cannot be activated at all'
);

SELECT is(
  (SELECT status FROM public.admin_activate_school(
     (SELECT id FROM public.schools WHERE school_id = 'ZM-LSK-0002'),
     'Spoke to Grace Mwale on +260977123456. Confirmed the address and the ministry number.')),
  'active',
  'with an organisation and a note, the school activates'
);

SELECT ok(
  (SELECT verification_note IS NOT NULL AND activated_at IS NOT NULL
     FROM public.school_onboarding
    WHERE school_id = (SELECT id FROM public.schools WHERE school_id = 'ZM-LSK-0002')),
  '...and the call is recorded against the onboarding row'
);

-- ---------------------------------------------------------------------------
-- Discarding.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  format($$ SELECT public.admin_discard_unprovisioned_school(%L) $$,
         (SELECT id FROM public.schools WHERE school_id = 'ZM-LSK-0002')),
  '55000',
  NULL,
  'a provisioned school cannot be discarded — it may hold records prohibition 8 protects'
);

SELECT ok(
  (SELECT public.admin_discard_unprovisioned_school(
     (SELECT id FROM public.schools WHERE school_id = 'ZM-NDL-0001'))),
  'one whose organisation was never created can be'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.schools WHERE school_id = 'ZM-NDL-0001'),
  0,
  '...and it is gone, along with its checklist rows'
);

/**
 * The number IS handed out again, which is the opposite of the intuitive guess and is why it is
 * asserted rather than left to be discovered.
 *
 * `get_next_school_sequence()` is MAX+1 over the rows that exist, and the discard deleted one.
 * That is correct here: the discarded school was never reachable, so `ZM-NDL-0001` was never
 * issued to anybody, never printed on a receipt and never embedded in a pupil number. Business
 * rule 1 makes an identifier permanent for the school that HOLDS it — it does not reserve a
 * number nobody ever used.
 */
SELECT is(
  (SELECT school_id FROM public.admin_create_school(
     'Second Ndola School', 'day', 'primary', 'CBR', 'NDL',
     'Mary', 'Phiri', 'mary@ndola.example')),
  'ZM-NDL-0001',
  'and the number is reused — it was never issued to anybody'
);

-- ---------------------------------------------------------------------------
-- Completion arithmetic, against ONBOARDING.md's weights.
-- ---------------------------------------------------------------------------
UPDATE public.onboarding_checklists
   SET is_complete = TRUE, completed_at = NOW()
 WHERE school_id = (SELECT id FROM public.schools WHERE school_id = 'ZM-LSK-0002')
   AND item_key IN ('school_profile', 'grade_structure');

SELECT is(
  (SELECT completion_pct FROM public.school_onboarding_completion(
     (SELECT id FROM public.schools WHERE school_id = 'ZM-LSK-0002'))),
  20,
  'school_profile (8) + grade_structure (12) = 20% of a 100-weight catalogue'
);

SELECT is(
  (SELECT critical_pct FROM public.school_onboarding_completion(
     (SELECT id FROM public.schools WHERE school_id = 'ZM-LSK-0002'))),
  33,
  '...and 20 of the 60 critical weight, which rounds to 33%'
);

SELECT is(
  (SELECT items_complete FROM public.school_onboarding_completion(
     (SELECT id FROM public.schools WHERE school_id = 'ZM-LSK-0002'))),
  2,
  'with two of fourteen steps done'
);

-- ---------------------------------------------------------------------------
-- What a school may NOT see about itself.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_owner_sunrise", "role": "authenticated",
  "o": {"id": "org_sunrise", "rol": "owner", "slg": "sunrise-academy"}
}';

/**
 * `internal_notes` is AfriTech's private view of a customer — why a discount was given, that they
 * are slow to pay, what the regional manager thought after the call. A school reading its own row
 * would read all of it, so there is no school-side policy on this table at all.
 */
SELECT is(
  (SELECT COUNT(*)::INT FROM public.school_onboarding),
  0,
  'a school owner cannot read their own onboarding record — internal_notes lives there'
);

/**
 * And cannot write one. Counted rather than thrown: an UPDATE blocked by RLS matches zero rows and
 * reports success, so `throws_ok` here would fail against correct behaviour.
 */
SELECT is(
  (WITH attempted AS (
     UPDATE public.school_onboarding SET verification_note = 'Verified by me' RETURNING 1
   ) SELECT COUNT(*)::INT FROM attempted),
  0,
  '...and an UPDATE touches nothing — RLS denies by matching no rows, silently'
);

-- Their own checklist, however, IS theirs — 0010 already said so, and the setup screen needs it.
SELECT is(
  (SELECT COUNT(*)::INT FROM public.onboarding_checklists),
  14,
  'but they do see their own checklist'
);

SELECT is(
  (SELECT completion_pct FROM public.school_onboarding_completion(
     (SELECT id FROM public.schools WHERE school_id = 'ZM-LSK-0002'))),
  20,
  '...and their own completion, through the same invoker-rights function AfriTech uses'
);

SELECT lives_ok(
  $$ UPDATE public.onboarding_checklists SET is_complete = TRUE
      WHERE item_key = 'logo' $$,
  'and an owner ticks their own items — management_write_onboarding (0010) permits it'
);

SELECT * FROM finish();
ROLLBACK;
