-- ===========================================================================
-- 0238 — impersonation becomes real (IMPERSONATION.md)
--
-- Spec: `02 Authentication and Identity/IMPERSONATION.md`,
--       `02 Authentication and Identity/ROLES.md`
--
-- ## What already worked
--
-- `is_impersonation_session()` and `get_actor_id()` have existed since `0001`,
-- reading the `act` claim, and `audit_logs.impersonated_user_id` records it. The
-- detection half has been right all along.
--
-- What was missing is the other half: minting the token, and keeping a record of
-- the session itself. `POST /api/admin/impersonate` returned an honest 501.
--
-- That 501's stated reason — "packages/auth-provider does not yet mint [actor
-- tokens]" — was true, and `@clerk/backend@1.21.4` does expose
-- `actorTokens.create` and `.revoke`. So it was reachable, and the blocker was
-- the code not having been written rather than Clerk not supporting it.
--
-- ## Why the session is recorded here and not only in audit_logs
--
-- `audit_logs` records each ACTION taken during impersonation. It cannot answer
-- "who was being impersonated, from when until when, and why", because that is a
-- property of the session rather than of any one write — and if the operator
-- takes no action at all, `audit_logs` has nothing to say about a session that
-- nonetheless happened.
--
-- IMPERSONATION.md requires a ticket reference and a reason for every session. A
-- session that reads a parent's fee history and changes nothing is exactly the
-- one worth being able to find afterwards.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The session record.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.impersonation_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  /** The AfriTech operator. Never NULL — a session with no actor is a bug. */
  actor_user_id   TEXT NOT NULL,
  actor_role      TEXT NOT NULL,

  /** Whose session was entered. */
  target_user_id  TEXT NOT NULL,
  /** Resolved where possible, so the record survives a school being renamed. */
  target_school_id UUID REFERENCES public.schools(id) ON DELETE SET NULL,

  reason          TEXT NOT NULL CHECK (btrim(reason) <> ''),
  /** IMPERSONATION.md: "Every impersonation requires a support ticket reference." */
  ticket_ref      TEXT,

  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  /** How it ended: the operator clicked out, or the token simply lapsed. */
  ended_reason    TEXT CHECK (ended_reason IN ('ended_by_actor', 'expired', 'revoked')),

  /*
    The Clerk actor token id, so a session can be revoked centrally rather than
    waiting for it to lapse.
  */
  actor_token_id  TEXT,
  expires_at      TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE public.impersonation_sessions IS
  'One row per impersonation session (IMPERSONATION.md). audit_logs records the ACTIONS; this records that the session happened at all, which matters most when nothing was changed (0238).';

CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_actor
  ON public.impersonation_sessions (actor_user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_impersonation_sessions_target
  ON public.impersonation_sessions (target_user_id, started_at DESC);

ALTER TABLE public.impersonation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.impersonation_sessions FORCE ROW LEVEL SECURITY;

/*
  AfriTech reads the whole history. A school owner reads sessions that entered
  THEIR school — being impersonated is something the customer is entitled to know
  about, and a log only the operator can read is not accountability.
*/
CREATE POLICY afritech_read_impersonation_sessions
  ON public.impersonation_sessions
  FOR SELECT TO authenticated
  USING (public.is_afritech_admin());

CREATE POLICY school_read_own_impersonation_sessions
  ON public.impersonation_sessions
  FOR SELECT TO authenticated
  USING (
    target_school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal')
  );

-- No INSERT or UPDATE policy: the two functions below are the only writers, and
-- a record somebody can edit is not a record.
GRANT SELECT ON public.impersonation_sessions TO authenticated;
REVOKE ALL ON public.impersonation_sessions FROM anon;

-- ---------------------------------------------------------------------------
-- 2. Opening a session.
-- ---------------------------------------------------------------------------

/*
  Called by the route AFTER Clerk has minted the token, so the record exists
  before the operator can act.

  `impersonate` capability, not `is_afritech_admin()` — ROLES.md says a developer
  "cannot impersonate users" and a regional manager's impersonation is read-only.
  `0237`'s matrix grants it to the super admin alone for now.
*/
CREATE OR REPLACE FUNCTION public.begin_impersonation_session(
  p_target_user_id  TEXT,
  p_reason          TEXT,
  p_ticket_ref      TEXT,
  p_actor_token_id  TEXT,
  p_expires_at      TIMESTAMPTZ,
  p_target_school_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id    UUID;
  v_actor TEXT := public.get_user_id();
BEGIN
  IF NOT public.has_afritech_capability('impersonate') THEN
    RAISE EXCEPTION
      'Your AfriTech role does not include impersonation' USING ERRCODE = '42501';
  END IF;

  -- Nesting makes `act` ambiguous and the trail unreadable.
  IF public.is_impersonation_session() THEN
    RAISE EXCEPTION
      'End the current impersonation session before starting another'
      USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION
      'Give a reason someone can audit in six months' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.impersonation_sessions
    (actor_user_id, actor_role, target_user_id, target_school_id,
     reason, ticket_ref, actor_token_id, expires_at)
  VALUES
    (v_actor, COALESCE(public.afritech_role(), 'unknown'), p_target_user_id,
     p_target_school_id, btrim(p_reason), NULLIF(btrim(COALESCE(p_ticket_ref, '')), ''),
     p_actor_token_id, p_expires_at)
  RETURNING id INTO v_id;

  -- `log_audit_event` records the act of STARTING, separately from whatever is
  -- then done inside the session.
  PERFORM public.log_audit_event(
    'impersonation_started',
    'impersonation_sessions',
    v_id,
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'reason', btrim(p_reason),
      'ticket_ref', p_ticket_ref));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_impersonation_session(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.begin_impersonation_session(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.begin_impersonation_session(TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Closing it.
-- ---------------------------------------------------------------------------

/*
  Callable by the ACTOR from inside the impersonated session.

  That is the awkward part: during impersonation `get_user_id()` returns the
  TARGET, and the operator's real identity is in `get_actor_id()`. So this matches
  on the actor, which is the only identity that is really theirs at that moment.
*/
CREATE OR REPLACE FUNCTION public.end_impersonation_session(
  p_reason TEXT DEFAULT 'ended_by_actor'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor TEXT := COALESCE(public.get_actor_id(), public.get_user_id());
  v_id    UUID;
BEGIN
  UPDATE public.impersonation_sessions
  SET ended_at = NOW(),
      ended_reason = CASE WHEN p_reason IN ('ended_by_actor', 'expired', 'revoked')
                          THEN p_reason ELSE 'ended_by_actor' END
  WHERE actor_user_id = v_actor
    AND ended_at IS NULL
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN FALSE;
  END IF;

  PERFORM public.log_audit_event(
    'impersonation_ended', 'impersonation_sessions', v_id,
    jsonb_build_object('ended_reason', p_reason));

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.end_impersonation_session(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.end_impersonation_session(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.end_impersonation_session(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. What the banner needs.
-- ---------------------------------------------------------------------------

/*
  Answers "am I inside an impersonated session, and whose".

  Safe for anybody to call: during a normal session it returns a row saying no.
  The banner mounts in every shell and must not need a role to ask.
*/
CREATE OR REPLACE FUNCTION public.my_impersonation_context()
RETURNS TABLE (
  out_is_impersonating BOOLEAN,
  out_actor_user_id    TEXT,
  out_target_user_id   TEXT,
  out_reason           TEXT,
  out_started_at       TIMESTAMPTZ,
  out_expires_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_impersonation_session() THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TEXT, NULL::TEXT,
                        NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT TRUE, s.actor_user_id, s.target_user_id, s.reason, s.started_at, s.expires_at
  FROM public.impersonation_sessions s
  WHERE s.actor_user_id = public.get_actor_id()
    AND s.ended_at IS NULL
  ORDER BY s.started_at DESC
  LIMIT 1;

  /*
    A session with the `act` claim but no row would mean a token minted outside
    ZSMS. The banner still shows — `is_impersonation_session()` already said so —
    just without the detail.
  */
  IF NOT FOUND THEN
    RETURN QUERY SELECT TRUE, public.get_actor_id(), public.get_user_id(),
                        'No ZSMS record for this session'::TEXT,
                        NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.my_impersonation_context() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_impersonation_context() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_impersonation_context() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_ctx RECORD;
BEGIN
  -- A developer must be refused, per ROLES.md.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'probe_dev', 'role', 'authenticated',
    'o', json_build_object('id', 'org_afritech', 'slg', 'afritech-systems-admin',
                           'rol', 'developer'))::text, TRUE);
  BEGIN
    PERFORM public.begin_impersonation_session(
      'user_victim', 'a reason long enough to pass', NULL, 'tok', NOW() + INTERVAL '2 hours');
    RAISE EXCEPTION '0238: a developer was allowed to impersonate';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- A super admin may, and the record lands.
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', 'probe_super', 'role', 'authenticated',
    'o', json_build_object('id', 'org_afritech', 'slg', 'afritech-systems-admin',
                           'rol', 'super_admin'))::text, TRUE);

  PERFORM public.begin_impersonation_session(
    'user_victim', 'Investigating a fee reconciliation complaint', 'TKT-1',
    'tok_probe', NOW() + INTERVAL '2 hours');

  IF NOT EXISTS (
    SELECT 1 FROM public.impersonation_sessions
    WHERE actor_user_id = 'probe_super' AND ended_at IS NULL
  ) THEN
    RAISE EXCEPTION '0238: the session was not recorded';
  END IF;

  -- A short reason must be refused — the reason is the whole point of the record.
  BEGIN
    PERFORM public.begin_impersonation_session(
      'user_other', 'too short', NULL, 'tok2', NOW() + INTERVAL '1 hour');
    RAISE EXCEPTION '0238: a one-word reason was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  -- Outside an impersonated session the context says no.
  SELECT * INTO v_ctx FROM public.my_impersonation_context();
  IF v_ctx.out_is_impersonating THEN
    RAISE EXCEPTION '0238: a normal session reports itself as impersonated';
  END IF;

  -- Closing works and is idempotent.
  IF NOT public.end_impersonation_session('ended_by_actor') THEN
    RAISE EXCEPTION '0238: the session could not be closed';
  END IF;
  IF public.end_impersonation_session('ended_by_actor') THEN
    RAISE EXCEPTION '0238: closing an already-closed session reported success';
  END IF;

  RAISE EXCEPTION 'ZSMS_0238_ROLLBACK';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'ZSMS_0238_ROLLBACK' THEN
      RAISE NOTICE '0238: verified — developer refused, session recorded, reason enforced, close idempotent';
    ELSE
      RAISE;
    END IF;
END;
$$;
