-- ===========================================================================
-- A school owner may edit their school. They may not price it.
--
-- Spec: Official Documentation/01 Foundation Layer/SECURITY_POLICIES.md
--       Official Documentation/17 Integration and Pricing/PRICING.md
--
-- THIS SUITE EXISTS BECAUSE THE HOLE WAS REAL, AND WAS DEMONSTRATED.
--
-- Before `0140`, `authenticated` held a **table-level** UPDATE grant on `public.schools`, covering
-- every column, and `owner_update_own_school` checked only that the caller owned that school.
-- Nothing checked WHICH columns were written. Run against `zsms-dev` as an ordinary school owner:
--
--   before:  starter    / trial ends 2026-10-02
--   after:   enterprise / trial ends 2036-09-29 / whatsapp_enabled / max_students 999999
--
-- Every priced dimension of the product was self-serve. The fix is a column-level grant, because
-- **RLS cannot express this rule**: a policy decides which ROWS a statement may touch, and
-- `WITH CHECK` sees the finished row without being able to tell a changed `subscription_tier`
-- from one that was already there.
--
-- The reason this suite exists rather than the migration alone: a grant is one line, and the next
-- migration that needs an owner to write one more column can restore the hole by widening it
-- carelessly. These assertions fail if that happens.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(14);

INSERT INTO public.schools
  (id, school_id, clerk_org_id, name, type, level, city_code, status, subscription_tier,
   trial_ends_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
        'Alpha Academy', 'day', 'combined', 'LSK', 'trial', 'starter',
        NOW() + INTERVAL '3 days');

-- ---------------------------------------------------------------------------
-- The grant itself. Asserted directly, because it IS the fix — a behavioural test alone
-- would still pass if somebody re-granted the column and the policy happened to deny.
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.schools', 'subscription_tier', 'UPDATE'),
  'authenticated holds no UPDATE on subscription_tier — the column that was self-serve'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.schools', 'status', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.schools', 'trial_ends_at', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.schools', 'subscription_ends_at', 'UPDATE'),
  'nor on status, trial_ends_at or subscription_ends_at'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.schools', 'whatsapp_enabled', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.schools', 'finance_module_enabled', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.schools', 'max_students', 'UPDATE'),
  'nor on the paid module flags or the pupil ceiling'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.schools', 'school_id', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.schools', 'clerk_org_id', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.schools', 'city_code', 'UPDATE'),
  'nor on identity — school_id is inside every pupil identifier and receipt ever issued'
);

-- The other half. A fix that locks everything is not a fix, it is a regression.
SELECT ok(
  has_column_privilege('authenticated', 'public.schools', 'name', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.schools', 'address', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.schools', 'phone', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.schools', 'email', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.schools', 'logo_url', 'UPDATE'),
  'the profile columns a school actually edits are still writable'
);

-- ---------------------------------------------------------------------------
-- The behaviour, as an owner.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_owner_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "owner", "slg": "alpha-academy"}
}';

SELECT throws_ok(
  $$ UPDATE public.schools SET subscription_tier = 'enterprise'
      WHERE clerk_org_id = 'org_school_a' $$,
  '42501',
  NULL,
  'a school owner cannot give themselves the top tier'
);

SELECT throws_ok(
  $$ UPDATE public.schools SET trial_ends_at = NOW() + INTERVAL '10 years'
      WHERE clerk_org_id = 'org_school_a' $$,
  '42501',
  NULL,
  '...nor extend their own trial'
);

SELECT throws_ok(
  $$ UPDATE public.schools SET whatsapp_enabled = TRUE
      WHERE clerk_org_id = 'org_school_a' $$,
  '42501',
  NULL,
  '...nor switch on a paid module'
);

SELECT throws_ok(
  $$ UPDATE public.schools SET max_students = 999999
      WHERE clerk_org_id = 'org_school_a' $$,
  '42501',
  NULL,
  '...nor raise their own pupil ceiling'
);

SELECT lives_ok(
  $$ UPDATE public.schools
        SET name = 'Renamed Academy', phone = '+260971234567', address = '12 Cairo Road'
      WHERE clerk_org_id = 'org_school_a' $$,
  'but the owner CAN still edit the school profile, which is the point of the grant'
);

-- ---------------------------------------------------------------------------
-- And a teacher edits nothing at all. The policy, not the grant, does this one.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_teacher_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "teacher", "slg": "alpha-academy"}
}';

SELECT is(
  (SELECT count(*)::int FROM public.schools WHERE name = 'Teacher Renamed'),
  0,
  'a teacher renaming the school changes nothing — an RLS-blocked UPDATE is silent, not an error'
);

-- ---------------------------------------------------------------------------
-- AfriTech, through the named act.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_afritech", "role": "authenticated",
  "o": {"id": "org_afritech", "rol": "afritech:super_admin", "slg": "afritech-systems-admin"}
}';

SELECT is(
  (SELECT subscription_tier FROM public.admin_update_school_commercial(
     '11111111-1111-1111-1111-111111111111', 'active', 'professional', NULL, NULL, NULL, NULL)),
  'professional',
  'AfriTech changes the tier through admin_update_school_commercial()'
);

SELECT is(
  (SELECT status FROM public.schools WHERE id = '11111111-1111-1111-1111-111111111111'),
  'active',
  '...and the change lands'
);

-- The function is the boundary, so the boundary is tested on the function too.
SET LOCAL request.jwt.claims TO '{
  "sub": "user_owner_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "owner", "slg": "alpha-academy"}
}';

SELECT throws_ok(
  $$ SELECT public.admin_update_school_commercial(
       '11111111-1111-1111-1111-111111111111', NULL, 'enterprise', NULL, NULL, NULL, NULL) $$,
  '42501',
  NULL,
  'and an owner calling that function directly is refused — the grant is not the only guard'
);

SELECT * FROM finish();
ROLLBACK;
