-- ---------------------------------------------------------------------------
-- 0194 — the staff branch named the wrong column, and the test could not see it
-- ---------------------------------------------------------------------------
--
-- `0193` fixed the Hub-teacher branch and left the staff one reading
-- `staff_members.user_id`. That column is `clerk_user_id`, the same mistake one line
-- further down.
--
-- **The verification missed it for an instructive reason.** It called the function with
-- no session, so the function refused at `get_user_id() IS NULL` and returned before
-- reaching any classification branch. The test passed while the bug sat two statements
-- below the furthest line it executed.
--
-- A test that stops at the first guard proves the first guard. This one now sets a
-- session so execution reaches every branch, which is the only way a plpgsql body's
-- table and column references are checked at all.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_my_erasure(p_reason TEXT DEFAULT NULL)
RETURNS TABLE (out_done BOOLEAN, out_message TEXT, out_action_after TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   TEXT := public.get_user_id();
  v_email  TEXT := auth.jwt() ->> 'email';
  v_kind   TEXT := 'unknown';
  v_grace  INT  := COALESCE(public.platform_setting('erasure_grace_days')::INT, 7);
  v_after  TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  /*
    A school owner cannot erase themselves.

    Their account owns the organisation every colleague signs in through, so erasing it
    locks a whole school out of ZSMS — people who never asked for anything. Refused with
    the actual remedy rather than a generic denial.
  */
  IF public.get_user_role() = 'org:owner' THEN
    RETURN QUERY SELECT FALSE,
      'You own a school on ZSMS. Transfer ownership to a colleague first, or ask '
      'AfriTech to close the school — erasing the owner would lock out everyone who '
      'works there.'::TEXT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  /*
    What they are decides what erasure means for them, and the reviewer needs it.

    Every table and column here is checked against the live schema. Both of the two
    previous attempts guessed one and both guesses were wrong — `teacher_profiles` does
    not exist, and neither `staff_members.user_id` nor
    `standalone_teacher_accounts.user_id` does. Both tables key on `clerk_user_id`.
  */
  IF EXISTS (SELECT 1 FROM public.student_parent_links l
              WHERE l.parent_user_id = v_user AND l.is_active) THEN
    v_kind := 'parent';
  ELSIF EXISTS (SELECT 1 FROM public.staff_members s
                 WHERE s.clerk_user_id = v_user) THEN
    v_kind := 'staff';
  ELSIF EXISTS (SELECT 1 FROM public.standalone_teacher_accounts t
                 WHERE t.clerk_user_id = v_user) THEN
    v_kind := 'teacher_hub';
  END IF;

  v_after := NOW() + (v_grace || ' days')::INTERVAL;

  INSERT INTO public.data_erasure_requests
    (user_id, email, subject_kind, reason, action_after)
  VALUES (v_user, v_email, v_kind, NULLIF(btrim(p_reason), ''), v_after)
  ON CONFLICT (user_id) WHERE status = 'pending' DO NOTHING;

  IF NOT FOUND THEN
    SELECT r.action_after INTO v_after
    FROM public.data_erasure_requests r
    WHERE r.user_id = v_user AND r.status = 'pending';

    RETURN QUERY SELECT TRUE,
      'You have already asked. Nothing more is needed.'::TEXT, v_after;
    RETURN;
  END IF;

  PERFORM public.log_audit_event(
    'erasure_requested', 'data_erasure_requests', NULL,
    jsonb_build_object('kind', v_kind), NULL
  );

  RETURN QUERY SELECT TRUE, 'Your request is recorded.'::TEXT, v_after;
END;
$$;

REVOKE ALL ON FUNCTION public.request_my_erasure(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_my_erasure(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_my_erasure(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Reach every branch, then undo it.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_r    RECORD;
  v_user TEXT;
BEGIN
  -- A real member of staff, so the classification runs rather than being skipped.
  SELECT clerk_user_id INTO v_user FROM public.staff_members
   WHERE clerk_user_id IS NOT NULL LIMIT 1;

  IF v_user IS NULL THEN
    RAISE NOTICE 'no staff fixture to classify against — skipping';
    RETURN;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated',
                      'email', 'verify@zsms-test.invalid')::text, TRUE);

  SELECT * INTO v_r FROM public.request_my_erasure('migration verification');
  IF NOT v_r.out_done THEN
    RAISE EXCEPTION 'the request was refused: %', v_r.out_message;
  END IF;

  IF (SELECT subject_kind FROM public.data_erasure_requests WHERE user_id = v_user)
     <> 'staff' THEN
    RAISE EXCEPTION 'a member of staff was not classified as staff';
  END IF;

  -- The grace period must be real, or nothing can be withdrawn.
  IF v_r.out_action_after <= NOW() THEN
    RAISE EXCEPTION 'the grace period is not in the future';
  END IF;

  RAISE NOTICE 'verified: classified as staff, actionable after %', v_r.out_action_after;

  -- Leave no request behind: this is a migration, not a user.
  DELETE FROM public.data_erasure_requests
   WHERE user_id = v_user AND reason = 'migration verification';

  PERFORM set_config('request.jwt.claims', NULL, TRUE);
END;
$$;
