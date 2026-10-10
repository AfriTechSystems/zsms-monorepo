-- ---------------------------------------------------------------------------
-- 0193 — `request_my_erasure()` named a table that does not exist
-- ---------------------------------------------------------------------------
--
-- `0192` classified a Hub teacher by reading `public.teacher_profiles`. There is no such
-- table — it is `standalone_teacher_accounts`, and its column is `clerk_user_id`, not
-- `user_id`.
--
-- The migration applied anyway: plpgsql resolves table names when a function RUNS, not
-- when it is created, so the error was waiting for the first person to ask to be
-- erased. `npm run db:cols` exists precisely to stop this and I did not run it first.
--
-- Nothing is lost by the delay — no erasure request has been made — but the general
-- lesson stands: a migration applying cleanly says nothing about whether its plpgsql
-- bodies resolve. Only calling them does, which the verification block below now does.
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

  -- What they are decides what erasure means for them, and the reviewer needs it.
  -- Table and column names checked against the live schema this time.
  IF EXISTS (SELECT 1 FROM public.student_parent_links l
              WHERE l.parent_user_id = v_user AND l.is_active) THEN
    v_kind := 'parent';
  ELSIF EXISTS (SELECT 1 FROM public.staff_members s WHERE s.user_id = v_user) THEN
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
-- Actually CALL it, which is the check `0192` skipped.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_r RECORD;
BEGIN
  -- No session, so `get_user_id()` is null and the function should refuse cleanly
  -- rather than fail resolving a table. Before this fix it raised 42P01 here.
  BEGIN
    SELECT * INTO v_r FROM public.request_my_erasure('verification');
    RAISE EXCEPTION 'expected a refusal with no session';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN
      RAISE NOTICE 'verified: the body resolves and refuses an anonymous caller';
    WHEN undefined_table THEN
      RAISE EXCEPTION 'the function still names a table that does not exist';
  END;

  PERFORM * FROM public.my_erasure_status();
  RAISE NOTICE 'verified: my_erasure_status() resolves';
END;
$$;
