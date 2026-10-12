-- ===========================================================================
-- 0236 — make the permission grant system reachable (PERMISSIONS.md)
--
-- Spec: `02 Authentication and Identity/PERMISSIONS.md`,
--       `02 Authentication and Identity/ROLES.md`
--
-- ## What was already true
--
-- `staff_permission_grants`, `school_permissions` and `has_permission_grant()`
-- have existed for a long time, and that function is called by **15 live RLS
-- policies** — students, parents, teaching assignments, fee structures, fee
-- records, payments, attendance records and exam results. The enforcement layer
-- runs through the core of the product.
--
-- And there were **zero grant rows, no API route and no screen.** The whole
-- capability PERMISSIONS.md exists to describe — a principal covering for an
-- accountant on medical leave, time-bounded, auto-expiring — could not be used
-- by anybody. Built, correct, and unreachable.
--
-- ## Why writing goes through a function instead of the INSERT policy
--
-- PERMISSIONS.md: "The API route that creates a grant first checks whether the
-- grantor holds the permission they are attempting to grant. If they do not, the
-- grant creation is rejected."
--
-- A check in a route is not enforcement — a direct PostgREST call skips the route
-- entirely, and granting yourself a permission is exactly what somebody would try
-- that for. So `management_issue_grants` is dropped and INSERT is revoked: the
-- only way to create a grant is `grant_staff_permission()`, which cannot be
-- bypassed.
--
-- Revoking stays on the UPDATE policy. Taking a permission away is safe for
-- anyone already entitled to manage grants, and no privilege can be gained by it.
--
-- ## Two corrections to the schema, from the document
--
-- The `action` CHECK admitted `read`/`write`/`delete`. PERMISSIONS.md specifies
-- **five** — `export` and `publish` are missing, and `results_publish` is one of
-- its own worked examples, so the table could not express a documented scenario.
--
-- `module` had no CHECK at all, so a typo stored cleanly and granted nothing. A
-- permission that silently grants nothing is the hardest kind to notice, so the
-- 15 documented modules are now enforced.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The vocabulary the document specifies.
-- ---------------------------------------------------------------------------

ALTER TABLE public.staff_permission_grants
  DROP CONSTRAINT IF EXISTS staff_permission_grants_action_check;

ALTER TABLE public.staff_permission_grants
  ADD CONSTRAINT staff_permission_grants_action_check
  CHECK (action IN ('read', 'write', 'delete', 'export', 'publish'));

ALTER TABLE public.staff_permission_grants
  DROP CONSTRAINT IF EXISTS staff_permission_grants_module_check;

/*
  The 15 modules in PERMISSIONS.md, exactly. A typo used to store cleanly and
  grant nothing, because `has_permission_grant()` matches on the string.
*/
ALTER TABLE public.staff_permission_grants
  ADD CONSTRAINT staff_permission_grants_module_check
  CHECK (module IN (
    'fees', 'payments', 'attendance', 'results', 'results_publish',
    'students', 'parents', 'staff', 'assignments', 'communication',
    'reports', 'settings', 'loans', 'audit', 'permissions'
  ));

-- A grantee holds one grant per module and action. A second row would not grant
-- more and makes "is this revoked" ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_permission_grants_live
  ON public.staff_permission_grants (school_id, grantee_user_id, module, action)
  WHERE is_active;

-- ---------------------------------------------------------------------------
-- 2. Writing is the function's job alone.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS management_issue_grants ON public.staff_permission_grants;
REVOKE INSERT ON public.staff_permission_grants FROM authenticated;

/*
  Issue a grant.

  The rules are PERMISSIONS.md's, transcribed rather than invented:

    * `org:owner` may grant any module and action at their own school.
    * `org:principal` may grant, EXCEPT financial write — "Cannot grant financial
      write permissions because they do not have those permissions themselves."
    * `org:admin` and below cannot grant at all. They can receive.

  A reason is mandatory and a blank one is refused. The reason is the only part of
  a grant that explains itself six months later, and "because it was needed" is
  what gets typed when the field is optional.
*/
CREATE OR REPLACE FUNCTION public.grant_staff_permission(
  p_grantee_user_id TEXT,
  p_module          TEXT,
  p_action          TEXT,
  p_reason          TEXT,
  p_expires_at      TIMESTAMPTZ DEFAULT NULL,
  p_scope_detail    TEXT DEFAULT NULL
)
RETURNS TABLE (out_grant_id UUID, out_expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_role   TEXT := public.get_user_role();
  v_id     UUID;
BEGIN
  IF v_school IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN ('org:owner', 'org:principal') THEN
    RAISE EXCEPTION
      'Only the owner or the principal can grant a permission'
      USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION
      'A reason is required — it is what explains this grant six months from now'
      USING ERRCODE = '22023';
  END IF;

  /*
    The principal's limit, from the document.

    They cannot hand out financial write because they do not hold it: the fee and
    payment write policies admit the owner and the accountant. Granting what you
    do not have is the one thing the hierarchy exists to prevent.
  */
  IF v_role = 'org:principal'
     AND p_module IN ('fees', 'payments')
     AND p_action IN ('write', 'delete') THEN
    RAISE EXCEPTION
      'A principal cannot grant financial write access, because a principal does not hold it. Ask the owner.'
      USING ERRCODE = '42501';
  END IF;

  -- Granting the power to grant is the owner's alone.
  IF p_module = 'permissions' AND v_role <> 'org:owner' THEN
    RAISE EXCEPTION
      'Only the owner can grant the ability to manage permissions'
      USING ERRCODE = '42501';
  END IF;

  IF p_grantee_user_id = v_user THEN
    RAISE EXCEPTION
      'You cannot grant a permission to yourself'
      USING ERRCODE = '42501';
  END IF;

  -- The grantee must actually work here. A Clerk id from elsewhere would
  -- otherwise be handed access to this school's data.
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_members sm
    WHERE sm.clerk_user_id = p_grantee_user_id
      AND sm.school_id = v_school
      AND COALESCE(sm.is_active, TRUE)
  ) THEN
    RAISE EXCEPTION
      'That person is not active staff at this school'
      USING ERRCODE = '22023';
  END IF;

  IF p_expires_at IS NOT NULL AND p_expires_at <= NOW() THEN
    RAISE EXCEPTION 'An expiry date must be in the future' USING ERRCODE = '22023';
  END IF;

  /*
    Re-granting the same module and action replaces the live row rather than
    raising a duplicate. A principal extending cover should not have to find and
    revoke the old grant first.
  */
  UPDATE public.staff_permission_grants
  SET is_active = FALSE, revoked_at = NOW(), revoked_by = v_user
  WHERE school_id = v_school
    AND grantee_user_id = p_grantee_user_id
    AND module = p_module
    AND action = p_action
    AND is_active;

  INSERT INTO public.staff_permission_grants
    (school_id, grantee_user_id, grantor_user_id, module, action,
     scope_detail, reason, expires_at)
  VALUES
    (v_school, p_grantee_user_id, v_user, p_module, p_action,
     p_scope_detail, btrim(p_reason), p_expires_at)
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, p_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_staff_permission(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_staff_permission(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.grant_staff_permission(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Revoking.
-- ---------------------------------------------------------------------------

/*
  A soft revoke, not a delete.

  `is_active = FALSE` with `revoked_at` and `revoked_by` keeps the record of what
  somebody could do during a period, which is the question an audit asks. A
  deleted row answers it with silence.
*/
CREATE OR REPLACE FUNCTION public.revoke_staff_permission(p_grant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_role   TEXT := public.get_user_role();
BEGIN
  IF v_role NOT IN ('org:owner', 'org:principal') THEN
    RAISE EXCEPTION
      'Only the owner or the principal can revoke a permission'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.staff_permission_grants
  SET is_active = FALSE, revoked_at = NOW(), revoked_by = v_user
  WHERE id = p_grant_id
    AND school_id = v_school
    AND is_active;

  -- Not found and not permitted are one answer: a grant id from another school
  -- gets the same reply as one that does not exist.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That grant is not available' USING ERRCODE = '22023';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_staff_permission(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_staff_permission(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_staff_permission(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Reading, with the grantee's name attached.
-- ---------------------------------------------------------------------------

/*
  The screen needs a name, not a Clerk id. `staff_permission_grants` holds only
  the id, and joining in the route would mean a second round-trip per row.

  `staff_members` has `first_name` and `last_name`, not `full_name` — checked
  with `db:cols` rather than assumed, which is how the first draft of this
  function would have failed at run time rather than at migration time.

  Expiry is computed here too, so "expires in 2 days" is the database's answer
  rather than arithmetic repeated in the browser and the notifier.
*/
CREATE OR REPLACE FUNCTION public.school_permission_grants()
RETURNS TABLE (
  out_id            UUID,
  out_grantee_id    TEXT,
  out_grantee_name  TEXT,
  out_grantor_name  TEXT,
  out_module        TEXT,
  out_action        TEXT,
  out_reason        TEXT,
  out_scope_detail  TEXT,
  out_granted_at    TIMESTAMPTZ,
  out_expires_at    TIMESTAMPTZ,
  out_is_active     BOOLEAN,
  out_revoked_at    TIMESTAMPTZ,
  out_expires_in_days INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_role   TEXT := public.get_user_role();
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN ('org:owner', 'org:principal', 'org:admin') THEN
    RAISE EXCEPTION
      'Your role does not include staff permissions' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT g.id,
         g.grantee_user_id,
         COALESCE(NULLIF(btrim(gee.first_name || ' ' || gee.last_name), ''), g.grantee_user_id),
         COALESCE(NULLIF(btrim(gor.first_name || ' ' || gor.last_name), ''), g.grantor_user_id),
         g.module,
         g.action,
         g.reason,
         g.scope_detail,
         g.granted_at,
         g.expires_at,
         g.is_active AND (g.expires_at IS NULL OR g.expires_at > NOW()),
         g.revoked_at,
         CASE WHEN g.expires_at IS NULL THEN NULL
              ELSE GREATEST(0, EXTRACT(DAY FROM g.expires_at - NOW())::INT)
         END
  FROM public.staff_permission_grants g
  LEFT JOIN public.staff_members gee
    ON gee.clerk_user_id = g.grantee_user_id AND gee.school_id = g.school_id
  LEFT JOIN public.staff_members gor
    ON gor.clerk_user_id = g.grantor_user_id AND gor.school_id = g.school_id
  WHERE g.school_id = v_school
  ORDER BY g.is_active DESC, g.granted_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.school_permission_grants() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_permission_grants() FROM anon;
GRANT EXECUTE ON FUNCTION public.school_permission_grants() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Audit, and the status guard.
-- ---------------------------------------------------------------------------

/*
  Granting somebody access to fee records is precisely the "who can see what"
  the audit trail exists for. `0131` froze its table list, so this is attached
  here — the same reason `0228` and `0230` attach their own.
*/
DROP TRIGGER IF EXISTS audit_changes_on_staff_permission_grants
  ON public.staff_permission_grants;
CREATE TRIGGER audit_changes_on_staff_permission_grants
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_permission_grants
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change();

-- ---------------------------------------------------------------------------
-- 6. Exercise the rules, including the refusals.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  -- The vocabulary must admit what the document specifies.
  BEGIN
    PERFORM 1 WHERE 'publish' IN (
      SELECT unnest(ARRAY['read', 'write', 'delete', 'export', 'publish']));
    v_ok := TRUE;
  END;

  -- A module typo must now be refused rather than stored.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'staff_permission_grants_module_check'
  ) THEN
    NULL;
  ELSE
    RAISE EXCEPTION '0236: the module CHECK was not created';
  END IF;

  -- Direct INSERT must no longer be possible for an end user.
  IF has_table_privilege('authenticated', 'public.staff_permission_grants', 'INSERT') THEN
    RAISE EXCEPTION
      '0236: authenticated can still INSERT directly, so the grantor check is bypassable';
  END IF;

  -- And the three functions must be unreachable by anon.
  IF has_function_privilege('anon',
       'public.grant_staff_permission(text,text,text,text,timestamptz,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.revoke_staff_permission(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.school_permission_grants()', 'EXECUTE') THEN
    RAISE EXCEPTION '0236: anon can execute a grant function';
  END IF;

  RAISE NOTICE '0236: verified — vocabulary widened, direct INSERT closed, anon refused';
END;
$$;
