-- ===========================================================================
-- 0228 — school-defined staff roles (ADR-012)
--
-- Spec: `01 Foundation Layer/DECISIONS.md` → ADR-012,
--       `01 Foundation Layer/DATABASE.md` → `public.school_custom_roles`,
--       `02 Authentication and Identity/PERMISSIONS.md`
--
-- ADR-012: "School-defined custom roles live in the ZSMS database. Custom role
-- holders use `org:staff` as their Clerk base role with **zero default access**.
-- All permissions from the database."
--
-- The reason matters as much as the decision: creating school-specific Clerk
-- roles would mean thousands of org-specific roles, which is unmanageable. Clerk
-- stays clean and holds one `org:staff` role; this table holds what that person
-- may actually do.
--
-- ## Zero default access is the load-bearing half
--
-- `apps/web/lib/roles.ts` already grants `org:staff` nothing — it appears in
-- `PORTAL_ROLES` so a holder can sign in, and in no capability. That is correct
-- and this migration does not change it. A custom-role holder with no grants can
-- reach the portal and do nothing, which is the safe failure.
--
-- ## The tier limit resolves the way every other limit does
--
-- ADR-012: Starter 3, Growth 10, Professional/Enterprise unlimited. Resolved
-- through a function rather than read from a column, exactly as
-- `school_student_limit()` is — so an override or a tier change is a row, not a
-- deployment. NULL means unlimited, matching that function's convention.
--
-- ## Why the limit is enforced by an AFTER trigger
--
-- `0101` learned this: a BEFORE ROW trigger runs AHEAD of the RLS `WITH CHECK`,
-- so it would tell School B the exact role ceiling of School A before
-- establishing that B could write there at all. Any trigger whose message
-- describes tenant state must be AFTER.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_custom_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  role_name   TEXT NOT NULL CHECK (btrim(role_name) <> ''),
  description TEXT,

  /*
    `{ "students": { "read": true }, "attendance": { "read": true, "write": true } }`

    JSONB rather than a join table, per `DATABASE.md`. The capability set is
    defined in `apps/web/lib/roles.ts` and changes with the product; a join table
    would need a migration every time a capability is added, and a row per
    capability per role to express the same thing.

    The shape is asserted below rather than left to convention.
  */
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,

  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, role_name),

  /*
    An object, not an array or a scalar.

    `permissions` is read by `can()` as `permissions[resource][action]`. A string
    or an array there would not fail on write and would silently grant nothing,
    which is the hardest kind of permission bug to notice.
  */
  CONSTRAINT school_custom_roles_permissions_shape
    CHECK (jsonb_typeof(permissions) = 'object')
);

COMMENT ON TABLE public.school_custom_roles IS
  'School-defined staff roles (ADR-012). Holders carry org:staff in Clerk with zero default access; everything they may do comes from `permissions` here (0228).';

CREATE INDEX IF NOT EXISTS idx_school_custom_roles_school
  ON public.school_custom_roles (school_id) WHERE is_active;

-- ---------------------------------------------------------------------------
-- 2. Who holds which role.
-- ---------------------------------------------------------------------------

/*
  Separate from `staff_members` rather than a column on it.

  A member of staff can hold more than one custom role — "Librarian" and "Exams
  Officer" is an ordinary combination in a small school — and a column would
  force a choice. The union of their grants is what `can()` resolves.
*/
CREATE TABLE IF NOT EXISTS public.staff_custom_role_assignments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  custom_role_id UUID NOT NULL REFERENCES public.school_custom_roles(id) ON DELETE CASCADE,
  /** The Clerk id of the member of staff. */
  staff_user_id  TEXT NOT NULL,
  assigned_by    TEXT NOT NULL,
  assigned_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (custom_role_id, staff_user_id)
);

COMMENT ON TABLE public.staff_custom_role_assignments IS
  'Which staff hold which custom role. Many-to-many, because a small school gives one person several jobs (0228).';

CREATE INDEX IF NOT EXISTS idx_staff_custom_role_assignments_user
  ON public.staff_custom_role_assignments (staff_user_id);

-- ---------------------------------------------------------------------------
-- 3. RLS, and the grants RLS does not imply.
-- ---------------------------------------------------------------------------

ALTER TABLE public.school_custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_custom_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.staff_custom_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_custom_role_assignments FORCE ROW LEVEL SECURITY;

/*
  Any member of the school may READ the roles.

  A teacher seeing that "Exams Officer" exists and what it can do is useful, and
  it is not sensitive — it is an org chart. Defining one is management's.
*/
CREATE POLICY school_members_read_custom_roles
  ON public.school_custom_roles
  FOR SELECT TO authenticated
  USING (school_id = public.current_school_uuid() OR public.is_afritech_admin());

/*
  Only the owner and the principal may define a role or grant it.

  Deliberately NOT `org:admin`: a role definition is the ability to GRANT
  capabilities, so anyone who can write here can write themselves a role that
  does anything. That is the narrowest sensible audience.
*/
CREATE POLICY leadership_write_custom_roles
  ON public.school_custom_roles
  FOR ALL TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal')
  )
  WITH CHECK (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal')
  );

CREATE POLICY afritech_all_custom_roles
  ON public.school_custom_roles
  FOR ALL TO authenticated
  USING (public.is_afritech_admin())
  WITH CHECK (public.is_afritech_admin());

/*
  A member of staff may see their OWN assignments, and leadership may see all.

  Somebody should be able to find out what they have been granted without asking.
*/
CREATE POLICY read_own_or_leadership_assignments
  ON public.staff_custom_role_assignments
  FOR SELECT TO authenticated
  USING (
    staff_user_id = public.get_user_id()
    OR (
      school_id = public.current_school_uuid()
      AND public.get_user_role() IN ('org:owner', 'org:principal')
    )
    OR public.is_afritech_admin()
  );

CREATE POLICY leadership_write_assignments
  ON public.staff_custom_role_assignments
  FOR ALL TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal')
  )
  WITH CHECK (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal')
  );

-- RLS decides which rows; the GRANT decides whether the verb may be attempted at
-- all, and Postgres checks the grant first. Forgetting this is the `0212`/`0218`
-- mistake, twice.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_custom_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_custom_role_assignments TO authenticated;
REVOKE ALL ON public.school_custom_roles FROM anon;
REVOKE ALL ON public.staff_custom_role_assignments FROM anon;

-- ---------------------------------------------------------------------------
-- 4. The `0149` status guard and the audit trigger, both attached HERE.
-- ---------------------------------------------------------------------------

/*
  `0149` iterates the catalogue at migration time and `0131` does the same, so a
  table created afterwards gets neither and nothing reminds anybody.
  `school_payment_details` went two days unaudited exactly this way, and `0223`
  had to go back for it. Attached at birth instead.
*/
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['school_custom_roles', 'staff_custom_role_assignments']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS enforce_school_writable_on_insert_on_%1$s ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER enforce_school_writable_on_insert_on_%1$s
         AFTER INSERT ON public.%1$I
         REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_new()', t);

    EXECUTE format(
      'DROP TRIGGER IF EXISTS enforce_school_writable_on_update_on_%1$s ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER enforce_school_writable_on_update_on_%1$s
         AFTER UPDATE ON public.%1$I
         REFERENCING NEW TABLE AS new_rows
         FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_new()', t);

    -- Granting a capability is exactly the "who can see what" the audit rule names.
    EXECUTE format(
      'DROP TRIGGER IF EXISTS audit_changes_on_%1$s ON public.%1$I', t);
    EXECUTE format(
      'CREATE TRIGGER audit_changes_on_%1$s
         AFTER INSERT OR UPDATE OR DELETE ON public.%1$I
         FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. The tier limit.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.school_custom_role_limit(p_school_id UUID)
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_tier TEXT;
BEGIN
  /*
    The tier override is consulted first, the same order `school_has_feature()`
    uses — AfriTech moving a school to Growth for a trial must raise this too, or
    the trial does not include what it says it includes.
  */
  SELECT COALESCE(
    (SELECT o.override_value FROM afritech.school_feature_overrides o
      WHERE o.school_id = p_school_id AND o.override_type = 'tier_override'
        AND o.is_active AND (o.expires_at IS NULL OR o.expires_at > NOW())
      ORDER BY o.created_at DESC LIMIT 1),
    (SELECT s.subscription_tier FROM public.schools s WHERE s.id = p_school_id)
  ) INTO v_tier;

  -- NULL means unlimited, matching `school_student_limit()`'s convention.
  RETURN CASE lower(COALESCE(v_tier, ''))
    WHEN 'starter' THEN 3
    WHEN 'growth'  THEN 10
    WHEN 'professional' THEN NULL
    WHEN 'enterprise'   THEN NULL
    -- An unknown tier gets the most restrictive answer rather than unlimited.
    ELSE 3
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.school_custom_role_limit(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_custom_role_limit(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_custom_role_limit(UUID) TO authenticated;

/*
  AFTER, not BEFORE.

  `0101` told School B the exact pupil ceiling of a full School A because a BEFORE
  ROW trigger runs ahead of the RLS WITH CHECK. Any trigger whose message
  describes tenant state must be AFTER, so the policy has already decided the
  caller is entitled to hear it.
*/
CREATE OR REPLACE FUNCTION public.enforce_custom_role_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit INT;
  v_count INT;
BEGIN
  v_limit := public.school_custom_role_limit(NEW.school_id);
  IF v_limit IS NULL THEN RETURN NULL; END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.school_custom_roles
  WHERE school_id = NEW.school_id AND is_active;

  IF v_count > v_limit THEN
    RAISE EXCEPTION
      'Your plan includes % custom role(s). Remove one, or ask AfriTech about a larger plan.',
      v_limit
      USING ERRCODE = 'ZS002';
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS enforce_custom_role_limit_on_school_custom_roles
  ON public.school_custom_roles;
CREATE TRIGGER enforce_custom_role_limit_on_school_custom_roles
  AFTER INSERT OR UPDATE OF is_active ON public.school_custom_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_custom_role_limit();

-- ---------------------------------------------------------------------------
-- 6. What a given person may do.
-- ---------------------------------------------------------------------------

/*
  The union of every active role this person holds.

  Returned as one merged object so `can()` has a single thing to read. Union
  rather than intersection: holding "Librarian" and "Exams Officer" means being
  able to do both jobs, not only what they have in common.
*/
CREATE OR REPLACE FUNCTION public.my_custom_permissions()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   TEXT := public.get_user_id();
  v_school UUID := public.current_school_uuid();
  v_out    JSONB := '{}'::jsonb;
  v_row    JSONB;
  v_res    TEXT;
BEGIN
  IF v_user IS NULL OR v_school IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR v_row IN
    SELECT r.permissions
    FROM public.staff_custom_role_assignments a
    JOIN public.school_custom_roles r ON r.id = a.custom_role_id
    WHERE a.staff_user_id = v_user
      AND a.school_id = v_school
      AND r.is_active
  LOOP
    -- Merged per RESOURCE, so `{students:{read}}` and `{students:{write}}`
    -- become `{students:{read,write}}` rather than the second replacing the first.
    FOR v_res IN SELECT jsonb_object_keys(v_row)
    LOOP
      v_out := jsonb_set(
        v_out,
        ARRAY[v_res],
        COALESCE(v_out -> v_res, '{}'::jsonb) || COALESCE(v_row -> v_res, '{}'::jsonb),
        TRUE
      );
    END LOOP;
  END LOOP;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.my_custom_permissions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_custom_permissions() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_custom_permissions() TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Prove it by writing, not by reading the catalogue.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school UUID;
  v_role   UUID;
  v_n      INT;
BEGIN
  BEGIN
    SELECT s.id INTO v_school FROM public.schools s WHERE s.status = 'active' LIMIT 1;
    IF v_school IS NULL THEN
      RAISE NOTICE '0228: no active school; skipping the write test';
      RETURN;
    END IF;

    INSERT INTO public.school_custom_roles
      (school_id, role_name, description, permissions, created_by)
    VALUES
      (v_school, '0228 Librarian', 'probe',
       '{"students": {"read": true}}'::jsonb, 'migration_0228')
    RETURNING id INTO v_role;

    -- The shape constraint must refuse anything that is not an object, or a
    -- malformed grant would silently grant nothing.
    BEGIN
      UPDATE public.school_custom_roles SET permissions = '"everything"'::jsonb
      WHERE id = v_role;
      RAISE EXCEPTION '0228: a non-object permissions value was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- The audit trigger must have fired for the insert.
    SELECT COUNT(*) INTO v_n FROM public.audit_logs
    WHERE table_name = 'school_custom_roles';
    IF v_n < 1 THEN
      RAISE EXCEPTION '0228: creating a custom role was not audited';
    END IF;

    -- And the limit must actually be resolvable.
    IF public.school_custom_role_limit(v_school) IS NOT NULL
       AND public.school_custom_role_limit(v_school) < 1 THEN
      RAISE EXCEPTION '0228: the tier limit resolved below 1';
    END IF;

    RAISE EXCEPTION 'ZSMS_0228_ROLLBACK';

  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0228_ROLLBACK' THEN
        RAISE NOTICE '0228: verified — shape constraint, audit trigger, tier limit';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
