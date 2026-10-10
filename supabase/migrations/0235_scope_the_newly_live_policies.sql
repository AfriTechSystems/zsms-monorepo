-- ===========================================================================
-- 0235 — four school-wide policies were broader than their screens
--
-- Spec: `01 Foundation Layer/RLS.md`, `apps/web/lib/roles.ts`
--
-- ## Why this only surfaced now
--
-- `0233` and `0234` granted SELECT on five tables whose policies had never been
-- exercisable — the grant was missing, so every read was refused and the policies
-- were dead code. Granting was right. It also made four policies **live for the
-- first time**, and they turned out to be written as `school_id =
-- current_school_uuid()` with no role check at all.
--
-- So the moment the grant landed, every member of staff at a school could read:
--
--   * `school_credit_assignments` — which colleague holds how many AI credits
--   * `school_credit_settings`    — the school's commercial credit configuration
--   * `school_credit_purchases`   — what the school has spent, and when
--   * `parent_link_claims`        — a claimant's identity, name and contact
--
-- `school_credits_test` caught the first of those: a teacher read three
-- assignments where it expected one.
--
-- ## The tell that these were always meant to be narrower
--
-- `school_credit_assignments` already carries a SECOND policy,
-- `teacher_read_own_school_credit_assignments`, scoped to
-- `clerk_user_id = get_user_id()`. Policies are OR'd, so a school-wide policy
-- makes that one redundant — and nobody writes a redundant policy on purpose.
-- It was written expecting its sibling to be role-limited.
--
-- ## Audiences, taken from `lib/roles.ts` rather than invented
--
-- Credits are commercial, and the nav gates `/settings/credits` on `fees:read` —
-- owner, principal, accountant, admin. The three credit policies match that set.
--
-- `parent_link_claims` is a pupil-records act: the route gates on
-- `students:write`, which is `MANAGEMENT` — owner, principal, admin. The accountant
-- is excluded, because approving who may see a child is not a finance decision.
--
-- A teacher keeps their own assignment row through the existing narrow policy,
-- which now does the job it was written for.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Credits — the `fees:read` audience.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS school_read_school_credit_assignments
  ON public.school_credit_assignments;
CREATE POLICY school_read_school_credit_assignments
  ON public.school_credit_assignments
  FOR SELECT TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN
      ('org:owner', 'org:principal', 'org:accountant', 'org:admin')
  );

DROP POLICY IF EXISTS school_read_school_credit_settings
  ON public.school_credit_settings;
CREATE POLICY school_read_school_credit_settings
  ON public.school_credit_settings
  FOR SELECT TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN
      ('org:owner', 'org:principal', 'org:accountant', 'org:admin')
  );

DROP POLICY IF EXISTS school_read_school_credit_purchases
  ON public.school_credit_purchases;
CREATE POLICY school_read_school_credit_purchases
  ON public.school_credit_purchases
  FOR SELECT TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN
      ('org:owner', 'org:principal', 'org:accountant', 'org:admin')
  );

-- ---------------------------------------------------------------------------
-- 2. Parent link claims — the `students:write` audience.
-- ---------------------------------------------------------------------------

/*
  Narrower than credits, and deliberately so.

  A link claim carries a person's name and contact details and asserts a
  relationship to a child. The accountant is excluded: approving who may see a
  child is a records decision, not a finance one.

  The claimant's own policy is untouched — a parent must still be able to see the
  claim they made.
*/
DROP POLICY IF EXISTS school_read_parent_link_claims ON public.parent_link_claims;
CREATE POLICY school_read_parent_link_claims
  ON public.parent_link_claims
  FOR SELECT TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  );

-- ---------------------------------------------------------------------------
-- 3. Prove a teacher is held out, and leadership is not.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_org    TEXT;
  v_teach  INT;
  v_lead   INT;
BEGIN
  SELECT clerk_org_id INTO v_org
  FROM public.schools
  WHERE clerk_org_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.school_credit_assignments a
                 WHERE a.school_id = schools.id)
  LIMIT 1;

  IF v_org IS NULL THEN
    RAISE NOTICE '0235: no school with credit assignments; skipping the role test';
    RETURN;
  END IF;

  /*
    Claims only, no `SET LOCAL ROLE authenticated` — switching role inside
    `db push` fails with "permission denied for schema auth". RLS is not applied
    at this privilege level either way, so the policy expressions are evaluated
    directly instead.
  */
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'probe_teacher', 'role', 'authenticated',
    'o', json_build_object('id', v_org, 'rol', 'teacher'))::text, TRUE);

  SELECT COUNT(*) INTO v_teach
  FROM public.school_credit_assignments a
  WHERE a.school_id = public.current_school_uuid()
    AND public.get_user_role() IN
      ('org:owner', 'org:principal', 'org:accountant', 'org:admin');

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'probe_owner', 'role', 'authenticated',
    'o', json_build_object('id', v_org, 'rol', 'owner'))::text, TRUE);

  SELECT COUNT(*) INTO v_lead
  FROM public.school_credit_assignments a
  WHERE a.school_id = public.current_school_uuid()
    AND public.get_user_role() IN
      ('org:owner', 'org:principal', 'org:accountant', 'org:admin');

  IF v_teach <> 0 THEN
    RAISE EXCEPTION '0235: the school-wide clause still admits a teacher (% rows)', v_teach;
  END IF;

  IF v_lead = 0 THEN
    RAISE EXCEPTION '0235: the school-wide clause now excludes leadership too';
  END IF;

  RAISE NOTICE '0235: verified — teacher held out, leadership sees % row(s)', v_lead;
END;
$$;
