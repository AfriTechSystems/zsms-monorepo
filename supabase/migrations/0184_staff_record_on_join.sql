-- ---------------------------------------------------------------------------
-- 0184 — accepting an invitation creates a staff record
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/08 Staff Management/INVITATIONS.md`
--       `Official Documentation/08 Staff Management/STAFF.md`
--       `Official Documentation/02 Authentication and Identity/AUTH.md`
--
-- ## The bug
--
-- Reported from the running application on 2026-10-02: a teacher accepts an
-- invitation, and the school never sees them.
--
-- The chain breaks in one place:
--
--   1. the school invites → Clerk invitation sent                    ✓
--   2. the teacher accepts → Clerk organisation membership created   ✓
--   3. **nothing ever creates a `staff_members` row**                ✗
--
-- The only INSERT into `staff_members` is `POST /api/staff`, a manual
-- administrative action on a route no screen calls. So an accepted teacher holds
-- a Clerk role, passes RLS as a member of the school, and is **invisible on the
-- Staff screen, unassignable to a class, and absent from every recipient list**
-- — because all of those read `staff_members`, not Clerk.
--
-- ## Why reconciliation rather than a webhook
--
-- The obvious fix is a Clerk webhook on `organizationMembership.created`. That
-- is the right thing for production and is NOT what this migration is, for two
-- reasons:
--
--   * **A webhook cannot reach a development machine.** There is no tunnel and
--     no `CLERK_WEBHOOK_SECRET`, so the bug would stay unfixed exactly where it
--     was found.
--   * **A webhook can be missed.** A delivery failure, a secret rotation, or an
--     endpoint down for ten minutes leaves a teacher permanently invisible with
--     nothing to notice it. A reconciler is idempotent and self-healing: it
--     fixes the backlog the first time each person opens the app.
--
-- Both are wanted eventually, and the reconciler is the one that must exist
-- either way — a webhook without it has no recovery path.
--
-- ## The caller can only ever create their OWN record
--
-- The arguments are identity DETAILS — a name, a phone — never the identity.
-- `clerk_user_id` comes from `get_user_id()` and `school_id` from
-- `current_school_uuid()`, so there is no argument that could make this write a
-- row for somebody else, or at another school. That is the whole security model
-- of the function and the reason it can be called by any `authenticated` caller.
--
-- ## It never overwrites
--
-- If a record exists, the function returns it untouched. The school may have
-- corrected a spelling, set a staff number or changed a department, and a
-- reconciler that "refreshed" those from Clerk on every sign-in would silently
-- undo the school's own edits. `UNIQUE (school_id, clerk_user_id)` makes that
-- cheap to enforce.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ensure_my_staff_record(
  p_first_name TEXT DEFAULT NULL,
  p_last_name  TEXT DEFAULT NULL,
  p_email      TEXT DEFAULT NULL,
  p_phone      TEXT DEFAULT NULL
)
RETURNS TABLE (
  out_staff_id UUID,
  out_created  BOOLEAN,
  out_message  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_role   TEXT := auth.jwt() -> 'o' ->> 'rol';
  v_id     UUID;
BEGIN
  -- No organisation means no school to be staff of. A standalone Teacher Hub
  -- account reaches this with no `o` claim and is correctly a no-op rather than
  -- an error: they are a teacher, just not anybody's employee.
  IF v_school IS NULL OR v_user IS NULL THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, 'No school in this session.'::TEXT;
    RETURN;
  END IF;

  /*
    Parents are organisation members in neither the schema nor Clerk, but a
    future role could be. Enumerated rather than excluded, so a new role added
    later does not silently start creating staff records for people who are not
    staff.
  */
  IF v_role NOT IN ('owner', 'principal', 'admin', 'teacher', 'accountant', 'librarian') THEN
    RETURN QUERY SELECT NULL::UUID, FALSE, 'This role is not school staff.'::TEXT;
    RETURN;
  END IF;

  SELECT s.id INTO v_id
  FROM public.staff_members AS s
  WHERE s.school_id = v_school AND s.clerk_user_id = v_user;

  IF v_id IS NOT NULL THEN
    -- Already recorded. Untouched on purpose — see the header.
    RETURN QUERY SELECT v_id, FALSE, 'Already on staff.'::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.staff_members (
    school_id, clerk_user_id, first_name, last_name, email, phone_e164, join_date
  )
  VALUES (
    v_school,
    v_user,
    -- A name is NOT NULL and Clerk does not require one, so a teacher who signed
    -- up without filling it in must still get a record. 'Unnamed' is visible and
    -- correctable; failing here would leave them invisible instead, which is the
    -- bug this function exists to fix.
    COALESCE(NULLIF(btrim(COALESCE(p_first_name, '')), ''), 'Unnamed'),
    COALESCE(NULLIF(btrim(COALESCE(p_last_name, '')), ''), 'Staff member'),
    NULLIF(lower(btrim(COALESCE(p_email, ''))), ''),
    NULLIF(btrim(COALESCE(p_phone, '')), ''),
    -- The documented "joined date": the day they accepted, which is the only
    -- date anybody can establish after the fact.
    CURRENT_DATE
  )
  -- Belt and braces against two tabs reconciling at once. The unique constraint
  -- would raise otherwise, and a sign-in is the worst moment to show an error.
  ON CONFLICT (school_id, clerk_user_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT s.id INTO v_id
    FROM public.staff_members AS s
    WHERE s.school_id = v_school AND s.clerk_user_id = v_user;
    RETURN QUERY SELECT v_id, FALSE, 'Already on staff.'::TEXT;
    RETURN;
  END IF;

  PERFORM public.log_audit_event(
    'staff_record_created_on_join', 'staff_members', v_id,
    jsonb_build_object('role', v_role, 'source', 'invitation_accepted'),
    v_school
  );

  RETURN QUERY SELECT v_id, TRUE, 'Added to the school''s staff list.'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_my_staff_record(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_my_staff_record(TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_my_staff_record(TEXT, TEXT, TEXT, TEXT) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.ensure_my_staff_record(TEXT, TEXT, TEXT, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ensure_my_staff_record is executable by anon';
  END IF;
  IF NOT has_function_privilege(
       'authenticated', 'public.ensure_my_staff_record(TEXT, TEXT, TEXT, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute ensure_my_staff_record';
  END IF;
END;
$$;
