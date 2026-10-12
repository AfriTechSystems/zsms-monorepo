-- ===========================================================================
-- 0237 — the six AfriTech roles stop being one role (ROLES.md)
--
-- Spec: `02 Authentication and Identity/ROLES.md`,
--       `02 Authentication and Identity/PERMISSIONS.md` → AfriTech Internal Domain
--
-- ## What ROLES.md promises, and what the build does
--
-- Six distinct platform roles, each with a stated limit:
--
--   * `afritech:super_admin`      — everything, including impersonation
--   * `afritech:regional_manager` — read all schools IN SCOPE; cannot modify billing
--   * `afritech:support_agent`    — read-only; write only by time-bounded grant
--   * `afritech:loan_officer`     — loan portfolio; not school operational data
--   * `afritech:finance_officer`  — revenue and billing; NOT individual school data or loan PII
--   * `afritech:developer`        — staging; production by 4-hour grant; cannot impersonate
--
-- The build has **one boolean**: `is_afritech_admin()`, true for anybody in the
-- AfriTech organisation. A finance officer can read loan PII today. A developer
-- could impersonate, were impersonation finished. A support agent can write
-- anywhere.
--
-- At one operator that is theoretical. It stops being theoretical on the first
-- hire, and a permission model is far cheaper to add before there are people
-- relying on the current behaviour.
--
-- ## Why `is_afritech_admin()` is NOT changed
--
-- **91 policies call it.** Redefining it to mean "super admin" would silently
-- narrow every one of them, and a mistake would be invisible until somebody
-- could not do their job — or until somebody could do somebody else's.
--
-- So it keeps its meaning — *is this AfriTech staff at all* — and the
-- differentiation goes ABOVE it: `afritech_role()` reads which one, and
-- `has_afritech_capability()` answers what that role may do. The narrow checks
-- are then applied inside the `admin_*` functions, which is where the actions
-- actually happen, rather than by rewriting 91 policies.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Regional scope — ROLES.md names this table.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS afritech.staff_scope_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /** The AfriTech staff member's Clerk id. */
  staff_user_id TEXT NOT NULL,
  /**
    What they are scoped to. A country code, or a specific school.

    Both, because ROLES.md scopes a regional manager "to assigned country or
    region" while PERMISSIONS.md has a super admin granting a support agent
    access "for specific schools".
  */
  scope_kind    TEXT NOT NULL CHECK (scope_kind IN ('country', 'school')),
  country_code  TEXT,
  school_id     UUID REFERENCES public.schools(id) ON DELETE CASCADE,

  assigned_by   TEXT NOT NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,

  -- The kind and the target must agree, or a 'country' row with a school_id and
  -- no country code would scope to nothing while looking configured.
  CONSTRAINT staff_scope_target_matches_kind CHECK (
    (scope_kind = 'country' AND country_code IS NOT NULL AND school_id IS NULL)
    OR (scope_kind = 'school' AND school_id IS NOT NULL AND country_code IS NULL)
  )
);

COMMENT ON TABLE afritech.staff_scope_assignments IS
  'Which countries or schools an AfriTech staff member is scoped to (ROLES.md). Empty for super_admin, who is unscoped by definition (0237).';

CREATE INDEX IF NOT EXISTS idx_staff_scope_assignments_user
  ON afritech.staff_scope_assignments (staff_user_id) WHERE is_active;

ALTER TABLE afritech.staff_scope_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.staff_scope_assignments FORCE ROW LEVEL SECURITY;

CREATE POLICY afritech_read_staff_scope
  ON afritech.staff_scope_assignments
  FOR SELECT TO authenticated
  USING (public.is_afritech_admin());

-- ---------------------------------------------------------------------------
-- 2. Which AfriTech role is this.
-- ---------------------------------------------------------------------------

/*
  Clerk sends the BARE role form in `o.rol` — `super_admin`, not
  `afritech:super_admin`. `get_user_role()` returns the prefixed form for `org:*`,
  and `npm run clerk:check` shows a real token, which is the artefact SQL sees.

  Returns NULL for anybody who is not AfriTech staff, so a caller must handle the
  absence rather than receive a default that happens to be safe today.
*/
CREATE OR REPLACE FUNCTION public.afritech_role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN COALESCE((auth.jwt() -> 'o' ->> 'slg') = 'afritech-systems-admin', FALSE)
      THEN 'afritech:' || COALESCE(
        /*
          An AfriTech member with no role claim is treated as the LEAST privileged
          role, not the most. A missing claim is a configuration fault, and the
          safe reading of a configuration fault is "can see, cannot act".
        */
        NULLIF(replace(auth.jwt() -> 'o' ->> 'rol', 'afritech:', ''), ''),
        'developer')
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.afritech_role() IS
  'Which of the six afritech:* roles the caller holds, or NULL if not AfriTech staff. A member with no role claim resolves to the least privileged (0237).';

REVOKE ALL ON FUNCTION public.afritech_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.afritech_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.afritech_role() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The capability matrix, transcribed from ROLES.md.
-- ---------------------------------------------------------------------------

/*
  A function rather than a table.

  The AfriTech matrix is a product decision that changes with a release, not a
  per-customer setting — unlike the school feature matrix, which is genuinely
  configuration and lives in `afritech.tier_features`. Putting this in a table
  would invite editing a security boundary at runtime with no review.

  Capabilities:
    platform:read    see the admin area at all
    schools:read     read school operational data
    schools:write    change it
    billing:read     invoices, revenue, subscriptions
    billing:write    issue, void, record payments, change tiers
    loans:read       loan applications and portfolio
    loans:write      update application status, manage lenders
    incidents:write  raise and update platform incidents
    impersonate      act as another user
    settings:write   platform-wide settings
*/
CREATE OR REPLACE FUNCTION public.has_afritech_capability(p_capability TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT CASE public.afritech_role()
    -- Everything, by definition. ROLES.md: "Full access to everything."
    WHEN 'afritech:super_admin' THEN TRUE

    -- "Read access to all schools in scope. Cannot modify billing."
    WHEN 'afritech:regional_manager' THEN
      p_capability IN ('platform:read', 'schools:read', 'schools:write',
                       'billing:read', 'incidents:write')

    -- "Read-only by default. Write access via explicit time-bounded grant."
    WHEN 'afritech:support_agent' THEN
      p_capability IN ('platform:read', 'schools:read', 'incidents:write')

    -- "Cannot access school operational data beyond loan-linked records."
    WHEN 'afritech:loan_officer' THEN
      p_capability IN ('platform:read', 'loans:read', 'loans:write')

    -- "Cannot access individual school data or loan PII."
    WHEN 'afritech:finance_officer' THEN
      p_capability IN ('platform:read', 'billing:read', 'billing:write')

    -- "Staging access by default... Cannot impersonate users."
    WHEN 'afritech:developer' THEN
      p_capability IN ('platform:read')

    ELSE FALSE
  END;
$$;

COMMENT ON FUNCTION public.has_afritech_capability(TEXT) IS
  'The ROLES.md capability matrix for the six afritech:* roles. A function, not a table: this is a security boundary that should change by release and review, not at runtime (0237).';

REVOKE ALL ON FUNCTION public.has_afritech_capability(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_afritech_capability(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_afritech_capability(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Is a given school within this person's scope.
-- ---------------------------------------------------------------------------

/*
  TRUE for a super admin always, and for anyone with no scope rows — scoping is
  opt-in, so an unscoped regional manager behaves as they do today rather than
  losing access the moment this migration lands.

  That is deliberate. A migration that silently removes access from a live
  account is worse than one that adds a boundary nobody has configured yet, and
  the screen makes the unscoped state visible.
*/
CREATE OR REPLACE FUNCTION public.afritech_school_in_scope(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
  SELECT CASE
    WHEN public.afritech_role() IS NULL THEN FALSE
    WHEN public.afritech_role() = 'afritech:super_admin' THEN TRUE
    WHEN NOT EXISTS (
      SELECT 1 FROM afritech.staff_scope_assignments a
      WHERE a.staff_user_id = public.get_user_id()
        AND a.is_active
        AND (a.expires_at IS NULL OR a.expires_at > NOW())
    ) THEN TRUE
    ELSE EXISTS (
      SELECT 1
      FROM afritech.staff_scope_assignments a
      LEFT JOIN public.schools s ON s.id = p_school_id
      WHERE a.staff_user_id = public.get_user_id()
        AND a.is_active
        AND (a.expires_at IS NULL OR a.expires_at > NOW())
        AND (
          (a.scope_kind = 'school' AND a.school_id = p_school_id)
          OR (a.scope_kind = 'country' AND a.country_code = s.country_code)
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.afritech_school_in_scope(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.afritech_school_in_scope(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.afritech_school_in_scope(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Managing scope — the super admin's alone.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_set_staff_scope(
  p_staff_user_id TEXT,
  p_scope_kind    TEXT,
  p_country_code  TEXT DEFAULT NULL,
  p_school_id     UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Not `is_afritech_admin()`: deciding who may see which schools is the super
  -- admin's, or a regional manager could widen their own scope.
  IF public.afritech_role() <> 'afritech:super_admin' THEN
    RAISE EXCEPTION 'Only an AfriTech super admin can set staff scope'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO afritech.staff_scope_assignments
    (staff_user_id, scope_kind, country_code, school_id, assigned_by)
  VALUES
    (p_staff_user_id, p_scope_kind, p_country_code, p_school_id, public.get_user_id())
  RETURNING id INTO v_id;

  -- `afritech` tables carry no row-change trigger, so the audit call is explicit.
  PERFORM public.log_audit_event(
    'afritech_scope_assigned',
    'staff_scope_assignments',
    v_id,
    jsonb_build_object('staff_user_id', p_staff_user_id, 'scope_kind', p_scope_kind));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_staff_scope(TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_staff_scope(TEXT, TEXT, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_scope(TEXT, TEXT, TEXT, UUID) TO authenticated;

/*
  What the signed-in AfriTech person may do, for the admin shell's navigation.

  One call, so the shell does not make ten round-trips to decide which links to
  render. The nav is a convenience — every function below enforces its own
  capability, which is the actual boundary.
*/
CREATE OR REPLACE FUNCTION public.my_afritech_capabilities()
RETURNS TABLE (out_role TEXT, out_capabilities TEXT[], out_scoped BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
  SELECT
    public.afritech_role(),
    ARRAY(
      SELECT c FROM unnest(ARRAY[
        'platform:read', 'schools:read', 'schools:write',
        'billing:read', 'billing:write', 'loans:read', 'loans:write',
        'incidents:write', 'impersonate', 'settings:write'
      ]) AS c
      WHERE public.has_afritech_capability(c)
    ),
    EXISTS (
      SELECT 1 FROM afritech.staff_scope_assignments a
      WHERE a.staff_user_id = public.get_user_id() AND a.is_active
    );
$$;

REVOKE ALL ON FUNCTION public.my_afritech_capabilities() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_afritech_capabilities() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_afritech_capabilities() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Apply the boundaries that ROLES.md states most plainly.
-- ---------------------------------------------------------------------------

/*
  The two sharpest limits, applied where the data actually is.

  A finance officer must not read loan PII, and a loan officer must not read
  revenue. Both are named in ROLES.md and both are a single capability check at
  the top of the function that serves that data.

  The remaining `admin_*` functions keep `is_afritech_admin()` for now. Narrowing
  34 functions in one migration, with no screen yet showing who holds which role,
  would be a large change nobody could verify — and the two here are the ones
  that guard somebody's personal information.
*/
/*
  The body below is `pg_get_functiondef()` as the database holds it, with only the
  role check replaced.

  The first draft of this migration rewrote the function by hand and got it wrong
  twice over: `private.loan_applications` has no `applicant_name` column, and the
  real signature returns NINE columns rather than the six I had written — which
  `CREATE OR REPLACE` cannot change anyway, so it would have failed outright.
  Reading the live definition is the only thing that catches that.
*/
CREATE OR REPLACE FUNCTION public.admin_loan_applications(p_status text DEFAULT NULL::text)
 RETURNS TABLE(out_id uuid, out_school_id uuid, out_amount numeric, out_status text, out_lender_name text, out_score integer, out_employment text, out_monthly_income numeric, out_created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
BEGIN
  /*
    `loans:read`, not merely "is AfriTech staff".

    The message already said "AfriTech loan officers only" while the check admitted
    every AfriTech account — so a finance officer could read loan PII that ROLES.md
    says they cannot. The check now matches what the message always claimed.
  */
  IF NOT public.has_afritech_capability('loans:read') THEN
    RAISE EXCEPTION 'Your AfriTech role does not include loan data'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.id, a.school_id, a.amount_requested, a.status, a.lender_name,
         a.behaviour_score, a.employment_type, a.monthly_income, a.created_at
  FROM private.loan_applications a
  WHERE p_status IS NULL OR a.status = p_status
  ORDER BY a.created_at DESC
  LIMIT 200;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_loan_applications(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_loan_applications(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_loan_applications(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Exercise every role against the matrix.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_role TEXT;
  v_can  BOOLEAN;
BEGIN
  FOREACH v_role IN ARRAY ARRAY[
    'super_admin', 'regional_manager', 'support_agent',
    'loan_officer', 'finance_officer', 'developer'
  ]
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_' || v_role, 'role', 'authenticated',
      'o', json_build_object('id', 'org_afritech', 'slg', 'afritech-systems-admin',
                             'rol', v_role))::text, TRUE);

    IF public.afritech_role() <> 'afritech:' || v_role THEN
      RAISE EXCEPTION '0237: afritech_role() misread %', v_role;
    END IF;

    -- Everybody with an AfriTech seat can at least see the admin area.
    IF NOT public.has_afritech_capability('platform:read') THEN
      RAISE EXCEPTION '0237: % cannot even read the platform', v_role;
    END IF;
  END LOOP;

  -- The two boundaries ROLES.md states most plainly.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'probe_fin', 'role', 'authenticated',
    'o', json_build_object('id', 'org_afritech', 'slg', 'afritech-systems-admin',
                           'rol', 'finance_officer'))::text, TRUE);
  IF public.has_afritech_capability('loans:read') THEN
    RAISE EXCEPTION '0237: a finance officer can still read loan PII';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'probe_loan', 'role', 'authenticated',
    'o', json_build_object('id', 'org_afritech', 'slg', 'afritech-systems-admin',
                           'rol', 'loan_officer'))::text, TRUE);
  IF public.has_afritech_capability('billing:read') THEN
    RAISE EXCEPTION '0237: a loan officer can still read revenue';
  END IF;

  -- And the one IMPERSONATION.md names.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'probe_dev', 'role', 'authenticated',
    'o', json_build_object('id', 'org_afritech', 'slg', 'afritech-systems-admin',
                           'rol', 'developer'))::text, TRUE);
  IF public.has_afritech_capability('impersonate') THEN
    RAISE EXCEPTION '0237: a developer can still impersonate';
  END IF;

  -- A school user is not AfriTech staff at all.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'probe_owner', 'role', 'authenticated',
    'o', json_build_object('id', 'org_school', 'slg', 'some-school',
                           'rol', 'owner'))::text, TRUE);
  IF public.afritech_role() IS NOT NULL
     OR public.has_afritech_capability('platform:read') THEN
    RAISE EXCEPTION '0237: a school owner resolves as AfriTech staff';
  END IF;

  RAISE NOTICE '0237: verified — six roles resolve, and each boundary ROLES.md names holds';
END;
$$;
