-- ---------------------------------------------------------------------------
-- 0160 — A teacher can ask to be linked to a school
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/13 Teacher Portal/TEACHER_PORTAL.md`
--       `Official Documentation/02 Authentication and Identity/ROLES.md`
--       `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
--
-- ## The gap this closes
--
-- Until now a standalone Teacher Hub user could join a school by exactly one
-- route: somebody at the school invites them. There was no way for the teacher
-- to start that conversation, and `TEACHER_PORTAL.md` has no mechanism either —
-- `CLAUDE.md` recorded account linking as "not a code path at all".
--
-- So a teacher who already works at a ZSMS school, and knows it, had to find
-- the right person off-platform and ask them to go and press a button. That is
-- the kind of friction that ends with the teacher not bothering.
--
-- This adds the request. It deliberately does NOT add a way to grant access:
-- approval routes into the SAME server-side Clerk invitation the staff screen
-- already uses, so there is one path by which somebody becomes a member of a
-- school, and it is the one that is already tested.
--
-- ## Exact school code, never a name search
--
-- `request_school_link()` matches `schools.school_code` with `=`, not `ILIKE`,
-- and never returns a list.
--
-- A name search would confirm, to anybody with a free Hub account, which
-- schools are ZSMS customers — including the schools that deliberately kept
-- themselves out of the public directory. That is a customer list, it is
-- commercially valuable to a competitor, and the directory's whole design
-- (0155) is built around schools opting in to being discoverable. A lookup that
-- quietly undoes that for anyone who signs up would be the largest hole in it.
--
-- The code is printed on school documents and known to anybody who actually
-- works there. Where it is not, the office can supply it — which is a question
-- a genuine teacher can ask and an outsider cannot.
--
-- The function returns the same result shape whether the code matched a school
-- or matched nothing, so timing and response alike reveal nothing. The teacher
-- is told their request was submitted either way, and a request against an
-- unknown code simply never appears to anybody.
--
-- ## The school chooses the role
--
-- `p_role` lives on the DECISION, not the request. A requester states "I work
-- here"; they do not get to propose being an owner. The request carries only a
-- free-text note, and `school_decide_join_request()` restricts the role it will
-- accept to the three a joining member could plausibly need.
--
-- ## What approval does NOT do
--
-- It does not touch `teaching_resources`. A teacher who built lesson plans on
-- their own account, on credits they paid for, keeps them — joining a school is
-- not consent to hand over work done before joining. There is deliberately no
-- statement here that transfers ownership, and `teacher_hub_test.sql`'s existing
-- owner-scoping assertions continue to hold afterwards.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_join_requests (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The Clerk user asking. Not a FK to standalone_teacher_accounts: a teacher
  -- may request a link before completing the Hub profile step, and refusing
  -- them until they have would be friction for no benefit.
  requester_user_id  TEXT NOT NULL,
  requester_name     TEXT NOT NULL,
  requester_email    TEXT NOT NULL,

  school_id          UUID NOT NULL REFERENCES public.schools(id),

  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn')),

  -- The teacher's own words: "I teach Grade 5 maths". Helps the school
  -- recognise a name it may only know in person.
  note               TEXT CHECK (note IS NULL OR length(note) <= 500),

  requested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at         TIMESTAMPTZ,
  decided_by         TEXT,
  -- The role granted on approval, recorded so the audit trail says what access
  -- was actually given rather than only that something was.
  granted_role       TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One live request per teacher per school. A partial unique index rather than a
-- plain one, so a teacher who was declined — or who withdrew, or who left and
-- is coming back — can ask again. Only the PENDING state is exclusive.
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_join_requests_one_pending
  ON public.school_join_requests(requester_user_id, school_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_school_join_requests_school_pending
  ON public.school_join_requests(school_id, requested_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_school_join_requests_requester
  ON public.school_join_requests(requester_user_id, requested_at DESC);

COMMENT ON TABLE public.school_join_requests IS
  'A standalone teacher asking to be linked to a school. Approval issues the '
  'ordinary server-side Clerk invitation; this table never grants access itself.';

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_join_requests FORCE ROW LEVEL SECURITY;

-- The teacher sees their own requests, at every status, in every school.
CREATE POLICY requester_read_school_join_requests
  ON public.school_join_requests
  FOR SELECT
  USING (requester_user_id = public.get_user_id());

-- The school sees requests addressed to it. Note this exposes the requester's
-- name and email to the school — which is the point of the feature, and is the
-- same information an invitation would carry in the other direction.
CREATE POLICY school_read_school_join_requests
  ON public.school_join_requests
  FOR SELECT
  USING (school_id = public.current_school_uuid());

CREATE POLICY afritech_read_school_join_requests
  ON public.school_join_requests
  FOR ALL
  USING (public.is_afritech_admin())
  WITH CHECK (public.is_afritech_admin());

-- No INSERT, UPDATE or DELETE policy for anybody else, deliberately. Every
-- write goes through the two SECURITY DEFINER functions below, which is what
-- enforces the pending cap, the role restriction, and the rule that a school
-- may only decide its own requests. A direct INSERT policy would let a teacher
-- create a request already marked `approved`.

-- ---------------------------------------------------------------------------
-- 3. Requesting
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER because it must read `schools` by code — a table the
-- requester has no business reading, and could not, since they have no
-- organisation and `current_school_uuid()` is NULL for them.
--
-- It takes no user id. The identity comes from `get_user_id()` inside the
-- function, so a caller cannot submit a request on somebody else's behalf —
-- the same reasoning `0158` applied to `register_push_token()`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_school_link(
  p_school_code TEXT,
  p_full_name   TEXT,
  p_email       TEXT,
  p_note        TEXT DEFAULT NULL
)
RETURNS TABLE (
  out_request_id UUID,
  out_submitted  BOOLEAN,
  out_message    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id   TEXT := public.get_user_id();
  v_school_id UUID;
  v_pending   INT;
  v_request   UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in before requesting a school link'
      USING ERRCODE = '42501';
  END IF;

  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'A name is required' USING ERRCODE = '22023';
  END IF;

  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RAISE EXCEPTION 'An email address is required' USING ERRCODE = '22023';
  END IF;

  -- Three outstanding requests, across all schools. A teacher belongs to one
  -- school, or is moving between two; nobody has a legitimate reason to have
  -- ten open at once, and without a cap this is a broadcast channel into every
  -- school's admin screen.
  SELECT COUNT(*) INTO v_pending
  FROM public.school_join_requests
  WHERE requester_user_id = v_user_id
    AND status = 'pending';

  IF v_pending >= 3 THEN
    RETURN QUERY SELECT
      NULL::UUID,
      FALSE,
      'You already have three requests waiting. Withdraw one before asking another school.'::TEXT;
    RETURN;
  END IF;

  -- Exact match. See the header: never ILIKE, never a list.
  SELECT s.id INTO v_school_id
  FROM public.schools AS s
  WHERE s.school_code = upper(btrim(p_school_code))
    AND s.deleted_at IS NULL
    -- A school that is terminated or still unprovisioned cannot take staff.
    AND s.status IN ('active', 'trial', 'pending_verification');

  IF v_school_id IS NULL THEN
    /*
      Deliberately indistinguishable from success.

      Returning "no such school" would turn this function into exactly the
      oracle the exact-code rule exists to prevent: a caller could walk the
      code space and learn which schools are on ZSMS. The teacher is told their
      request is with the school; a request against a code that matches nothing
      is simply never seen by anybody.

      The cost is a teacher who mistypes their code waiting for a reply that
      will not come. The Hub screen states the code's format and shows the
      request as pending, so they can withdraw and try again.
    */
    RETURN QUERY SELECT
      NULL::UUID,
      TRUE,
      'Your request has been sent to the school.'::TEXT;
    RETURN;
  END IF;

  -- Already a pending request for this school: report success rather than an
  -- error. Pressing the button twice is not a failure.
  SELECT r.id INTO v_request
  FROM public.school_join_requests AS r
  WHERE r.requester_user_id = v_user_id
    AND r.school_id = v_school_id
    AND r.status = 'pending';

  IF v_request IS NOT NULL THEN
    RETURN QUERY SELECT
      v_request,
      TRUE,
      'Your request is already with the school.'::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.school_join_requests (
    requester_user_id, requester_name, requester_email, school_id, note
  )
  VALUES (
    v_user_id, btrim(p_full_name), lower(btrim(p_email)), v_school_id,
    NULLIF(btrim(COALESCE(p_note, '')), '')
  )
  RETURNING id INTO v_request;

  PERFORM public.log_audit_event(
    'school_link_requested',
    'school_join_requests',
    v_request,
    jsonb_build_object('school_code', upper(btrim(p_school_code))),
    v_school_id
  );

  RETURN QUERY SELECT
    v_request,
    TRUE,
    'Your request has been sent to the school.'::TEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.request_school_link(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_school_link(TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.request_school_link(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Withdrawing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.withdraw_school_link_request(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id TEXT := public.get_user_id();
  v_rows    INT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  UPDATE public.school_join_requests AS r
     SET status = 'withdrawn',
         decided_at = NOW(),
         updated_at = NOW()
   WHERE r.id = p_request_id
     -- Own request only, and only one still pending. A DEFINER function that
     -- omitted this clause would let any signed-in user withdraw anybody's.
     AND r.requester_user_id = v_user_id
     AND r.status = 'pending';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_school_link_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_school_link_request(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.withdraw_school_link_request(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Deciding
-- ---------------------------------------------------------------------------
--
-- Marks the request and returns the detail the route needs to issue the Clerk
-- invitation. It does NOT issue the invitation — Postgres cannot call the Clerk
-- Backend API, and should not try.
--
-- The ordering matters: the row is marked FIRST and the invitation sent after,
-- by the route, on the strength of what this returns. The reverse — invite,
-- then mark — leaves an invitation sent against a request still showing as
-- pending if the second statement fails, and a second press would invite twice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_decide_join_request(
  p_request_id UUID,
  p_approve    BOOLEAN,
  p_role       TEXT DEFAULT NULL
)
RETURNS TABLE (
  out_decided        BOOLEAN,
  out_requester_email TEXT,
  out_requester_name  TEXT,
  out_school_id       UUID,
  out_clerk_org_id    TEXT,
  out_granted_role    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school_id UUID := public.current_school_uuid();
  v_role      TEXT;
  v_req       RECORD;
BEGIN
  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Only a school can decide its own join requests'
      USING ERRCODE = '42501';
  END IF;

  IF p_approve THEN
    v_role := COALESCE(p_role, 'org:teacher');

    /*
      The school chooses, but only from roles a joining member could need.

      `org:owner` is excluded: ownership transfers are a provisioning act, not
      something that should be reachable by approving a request from a stranger
      who typed in a school code. `org:parent` and `org:student` are excluded
      because this is the staff path. Anything outside the list is a mistake or
      an attempt, and both deserve the same refusal.
    */
    IF v_role NOT IN ('org:teacher', 'org:admin', 'org:staff') THEN
      RAISE EXCEPTION
        'A join request can grant org:teacher, org:admin or org:staff — not %', v_role
        USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.school_join_requests AS r
     SET status       = CASE WHEN p_approve THEN 'approved' ELSE 'declined' END,
         decided_at   = NOW(),
         decided_by   = public.get_user_id(),
         granted_role = CASE WHEN p_approve THEN v_role ELSE NULL END,
         updated_at   = NOW()
   WHERE r.id = p_request_id
     -- Own school's requests only. `current_school_uuid()` is the tenant
     -- boundary and this is a DEFINER function, so without this clause a school
     -- could decide another school's requests.
     AND r.school_id = v_school_id
     AND r.status = 'pending'
  RETURNING r.requester_email, r.requester_name, r.school_id INTO v_req;

  IF v_req IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  PERFORM public.log_audit_event(
    CASE WHEN p_approve THEN 'school_link_approved' ELSE 'school_link_declined' END,
    'school_join_requests',
    p_request_id,
    jsonb_build_object('granted_role', v_role),
    v_school_id
  );

  RETURN QUERY
  SELECT
    TRUE,
    v_req.requester_email,
    v_req.requester_name,
    v_req.school_id,
    s.clerk_org_id,
    v_role
  FROM public.schools AS s
  WHERE s.id = v_school_id;
END;
$$;

REVOKE ALL ON FUNCTION public.school_decide_join_request(UUID, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_decide_join_request(UUID, BOOLEAN, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_decide_join_request(UUID, BOOLEAN, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Assert the grants took
--
-- `0151` issued a REVOKE that read correctly and did nothing, because
-- `REVOKE ... FROM anon` does not remove the EXECUTE that `CREATE FUNCTION`
-- grants to PUBLIC. It was caught only because `0156` checked the outcome
-- rather than counting the statements it had issued. Every migration since
-- asserts instead of assuming.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_fn      TEXT;
  v_leaked  TEXT[] := '{}';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.request_school_link(TEXT, TEXT, TEXT, TEXT)',
    'public.withdraw_school_link_request(UUID)',
    'public.school_decide_join_request(UUID, BOOLEAN, TEXT)'
  ]
  LOOP
    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      v_leaked := v_leaked || v_fn;
    END IF;

    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated cannot execute % — the GRANT did not take', v_fn;
    END IF;
  END LOOP;

  IF array_length(v_leaked, 1) > 0 THEN
    RAISE EXCEPTION 'anon can execute: %', array_to_string(v_leaked, ', ');
  END IF;
END;
$$;
