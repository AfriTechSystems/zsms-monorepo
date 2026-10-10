-- ===========================================================================
-- Self-registration — the one path that creates a tenant for an arbitrary caller.
--
-- Spec: Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md → Path 2
--       Official Documentation/06 School and Tenant Management/TRIAL.md
--
-- Everything else in this schema defends a boundary that already exists. `admin_create_school()`
-- draws a new one behind `is_afritech_admin()`. `register_school()` draws a new one for **anybody
-- with an account**, which makes its guards the outer wall of the product:
--
--   * not callable by `anon` at all — a verified email is the substitute for the rate limiter
--     Upstash Redis would provide, and Upstash does not exist yet;
--   * one open trial per person, against `school_onboarding.created_by`;
--   * `attach_own_registered_school()` scoped to the caller's OWN school and only while it still
--     holds a placeholder, so the provisioning window closes after one use and is never open for
--     somebody else's school;
--   * both consents timestamped, because a checkbox that leaves no row behind is not evidence.
--
-- The assertion that matters most is the cross-tenant one near the end: a registered owner must not
-- be able to attach a Clerk organisation to a school that is not theirs. That single column is the
-- entire tenancy boundary — repointing it hands over every pupil, payment and result a school holds.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(26);

-- ---------------------------------------------------------------------------
-- An existing school, so the per-city sequence has somewhere to continue from.
-- ---------------------------------------------------------------------------
INSERT INTO public.schools
  (id, school_id, clerk_org_id, name, type, level, city_code, province_code,
   status, subscription_tier)
VALUES ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_incumbent',
        'Incumbent Academy','day','combined','LSK','LSK','active','starter');

-- ---------------------------------------------------------------------------
-- Privileges. `anon` must not be able to reach any of this.
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon',
    'public.register_school(text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE'),
  'anon cannot call register_school — a verified email is what stands in for a rate limiter'
);

SELECT ok(
  has_function_privilege('authenticated',
    'public.register_school(text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE'),
  '...and an authenticated caller can, holding no org role, because they have no school yet'
);

SELECT ok(
  NOT has_function_privilege('anon',
    'public.attach_own_registered_school(uuid,text)', 'EXECUTE'),
  'nor can anon finish somebody else''s provisioning'
);

/**
 * The same hole existed on every `admin_` function, and for the same reason: PostgreSQL grants
 * EXECUTE on a new function to PUBLIC, and `anon` inherits it. Each of them was safe only because
 * each remembered to call `is_afritech_admin()` first — which is a worse position than not being
 * reachable. `0151` revoked the PUBLIC grant across the set.
 */
SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_create_school(text,text,text,text,text,text,'
    || 'text,text,text,text,text,text,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_activate_school(uuid,text)', 'EXECUTE'),
  'and 0151 closed the same inherited grant on the admin_ functions'
);

-- ---------------------------------------------------------------------------
-- An authenticated visitor with no organisation at all.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{"sub": "user_grace", "role": "authenticated"}';

SELECT is(
  (SELECT current_school_uuid()),
  NULL,
  'a registering visitor resolves to no school — every tenant policy denies them'
);

/**
 * THE REGISTRATION ITSELF, AND WHY ITS RETURN VALUE HAS TO BE CAPTURED.
 *
 * `register_school()` returns the new school's id, and that return value is the ONLY way the caller
 * learns it. They cannot look it up: `clerk_org_id` is still a placeholder, so
 * `school_staff_read_own_school` matches nothing for them and their own school is invisible. The
 * API route works for exactly this reason — it uses what the function returned.
 *
 * Stashed in a transaction-local GUC because pgTAP assertions are separate statements and this
 * suite has no temporary table to lean on.
 */
SELECT set_config(
  'zsms.reg_school_id',
  (SELECT out_id::TEXT FROM public.register_school(
     'Sunrise Academy', 'day', 'secondary', 'LSK', 'LSK',
     'Grace', 'Mwale', 'grace@sunrise.example', '+260977123456', 'word_of_mouth')),
  TRUE
);

/**
 * And that invisibility asserted rather than merely described. It is the reason the route reloads
 * the whole page on success instead of soft-navigating: the session was minted before the
 * organisation existed, so it carries no `o` claim and the portal would render correctly empty.
 */
SELECT is(
  (SELECT COUNT(*)::INT FROM public.schools),
  0,
  'the registrant cannot yet see the school they just created — the tenant key is a placeholder'
);

-- Superuser, to check what was actually written.
RESET ROLE;

SELECT is(
  (SELECT school_id FROM public.schools
    WHERE id = current_setting('zsms.reg_school_id')::UUID),
  'ZM-LSK-0002',
  'the identifier continues the per-city sequence'
);

SELECT is(
  (SELECT status FROM public.schools
    WHERE id = current_setting('zsms.reg_school_id')::UUID),
  'trial',
  'self-registration produces `trial`, never `pending_verification` (business rule 3)'
);

-- Asserted as a range, not an equality: the point is the interval, not the millisecond.
SELECT ok(
  (SELECT trial_ends_at > NOW() + INTERVAL '29 days'
             AND trial_ends_at < NOW() + INTERVAL '31 days'
     FROM public.schools WHERE id = current_setting('zsms.reg_school_id')::UUID),
  '...with a thirty-day trial, per TRIAL.md'
);

SELECT is(
  (SELECT subscription_tier FROM public.schools
    WHERE id = current_setting('zsms.reg_school_id')::UUID),
  'starter',
  '...on Starter, which is the only tier a trial may take'
);

SELECT ok(
  (SELECT clerk_org_id LIKE 'pending\_%' FROM public.schools
    WHERE id = current_setting('zsms.reg_school_id')::UUID),
  'and a placeholder tenant key, which is why the row above was invisible'
);

SELECT is(
  (SELECT source FROM public.school_onboarding
    WHERE school_id = current_setting('zsms.reg_school_id')::UUID),
  'self_registration',
  'the onboarding record knows which path brought this school in'
);

/**
 * Consent, as data. `SCHOOL_SETUP.md` step 3 requires both checkboxes; one that gates a button and
 * leaves no row behind is not something anybody could later evidence — and the school is about to
 * become a data controller for several hundred children.
 */
SELECT ok(
  (SELECT terms_accepted_at IS NOT NULL AND privacy_accepted_at IS NOT NULL
     FROM public.school_onboarding
    WHERE school_id = current_setting('zsms.reg_school_id')::UUID),
  'both consents are timestamped, not merely validated in a form'
);

SELECT is(
  (SELECT created_by FROM public.school_onboarding
    WHERE school_id = current_setting('zsms.reg_school_id')::UUID),
  'user_grace',
  'and the registrant is recorded — which is what the one-trial-per-person guard reads'
);

SELECT ok(
  (SELECT owner_accepted_at IS NOT NULL FROM public.school_onboarding
    WHERE school_id = current_setting('zsms.reg_school_id')::UUID),
  'the owner counts as accepted immediately — they are the caller, not an invitee'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.onboarding_checklists
    WHERE school_id = current_setting('zsms.reg_school_id')::UUID),
  14,
  'and the full checklist is created, same as the AfriTech path'
);

-- ---------------------------------------------------------------------------
-- Back to the registrant.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$ SELECT * FROM public.register_school(
       'Second Attempt School', 'day', 'primary', 'LSK', 'LSK',
       'Grace', 'Mwale', 'grace@sunrise.example') $$,
  '42710',
  NULL,
  'the same person cannot open a second trial while the first is running'
);

SELECT throws_ok(
  $$ SELECT public.attach_own_registered_school(
       current_setting('zsms.reg_school_id')::UUID, 'not-a-clerk-id') $$,
  '22023',
  NULL,
  'a value that is not a Clerk organisation id is refused'
);

/**
 * THE CROSS-TENANT ASSERTION. `clerk_org_id` is what every RLS policy in this database resolves
 * through, so attaching one to somebody else's school would hand over that school's entire tenant.
 *
 * P0002 — "no school of yours is awaiting an organisation" — is deliberately indistinguishable from
 * the school not existing. A distinct message would confirm another tenant exists, which is the
 * thing the scoping is for.
 */
SELECT throws_ok(
  $$ SELECT public.attach_own_registered_school(
       '11111111-1111-1111-1111-111111111111', 'org_stolen') $$,
  'P0002',
  NULL,
  'and a registrant cannot attach an organisation to a school that is not theirs'
);

SELECT ok(
  (SELECT public.attach_own_registered_school(
     current_setting('zsms.reg_school_id')::UUID, 'org_sunrise')),
  'their own school attaches'
);

SELECT throws_ok(
  $$ SELECT public.attach_own_registered_school(
       current_setting('zsms.reg_school_id')::UUID, 'org_somebody_else') $$,
  '42710',
  NULL,
  'the window closes after one use — a second attach is refused'
);

-- ---------------------------------------------------------------------------
-- What a registered owner still cannot do.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_grace", "role": "authenticated",
  "o": {"id": "org_sunrise", "rol": "owner", "slg": "zm-lsk-0002"}
}';

SELECT is(
  (SELECT clerk_org_id FROM public.schools WHERE clerk_org_id = 'org_sunrise'),
  'org_sunrise',
  'with the organisation attached and the claim present, the owner finally sees their own school'
);

SELECT throws_ok(
  $$ UPDATE public.schools SET subscription_tier = 'enterprise'
      WHERE clerk_org_id = 'org_sunrise' $$,
  '42501',
  NULL,
  'a self-registered owner cannot price their own school — 0140''s column grant binds them too'
);

SELECT throws_ok(
  $$ UPDATE public.schools SET trial_ends_at = NOW() + INTERVAL '10 years'
      WHERE clerk_org_id = 'org_sunrise' $$,
  '42501',
  NULL,
  '...nor extend their own trial, which is the whole commercial point of the trial'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.school_onboarding),
  0,
  'and cannot read their own onboarding record — AfriTech''s internal notes live there'
);

-- A different person may still register, in the same city, taking the next number.
SET LOCAL request.jwt.claims TO '{"sub": "user_john", "role": "authenticated"}';

SELECT is(
  (SELECT out_school_id FROM public.register_school(
     'Second Lusaka School', 'boarding', 'primary', 'LSK', 'LSK',
     'John', 'Banda', 'john@second.example')),
  'ZM-LSK-0003',
  'a different person registers freely — the limit is per registrant, not per city'
);

SELECT * FROM finish();
ROLLBACK;
