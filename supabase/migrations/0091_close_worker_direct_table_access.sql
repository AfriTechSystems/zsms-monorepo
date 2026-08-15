-- ===========================================================================
-- 0091_close_worker_direct_table_access.sql
--
-- Closes the last three direct table statements in `apps/workers`.
--
-- ADR-042 permits a Railway worker to hold the service role key on the
-- condition that it reads and writes only through school-anchored
-- `SECURITY DEFINER` functions. `0090` built that surface, but three
-- statements in `apps/workers/src` still went straight at tables:
--
--   1. `updateDispatch()`  — UPDATE public.message_log ... WHERE id = $1
--   2. `announcementDeps.schoolName()`   — SELECT name FROM public.schools
--   3. `reportCardDeps.loadBranding()`   — SELECT branding FROM public.schools
--
-- None was exploitable. Each id came from a `worker_*` call earlier in the
-- same chain, so no attacker-controlled value ever reached them. The problem
-- is the shape, not the current behaviour: (1) is an unanchored WRITE to a
-- tenant table on a connection that bypasses RLS, which is precisely the
-- statement ADR-042 exists to make unavailable.
--
-- The rule is worth more absolute than qualified. "No direct table access in
-- `apps/workers`" is greppable and needs no judgement; "no direct table access
-- except reads of `schools` by primary key" has to be re-litigated by every
-- reviewer, and it would not have covered the message_log write in any case.
--
-- Related: DECISIONS.md ADR-042, 0090_create_worker_access_functions.sql
-- Tests:   supabase/tests/rls/worker_boundary_test.sql
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- worker_update_dispatch()
--
-- Records the provider's answer against a message_log row.
--
-- Anchored by construction: the row's own `school_id` is never taken from the
-- caller, and the terminal columns are set from `p_status` rather than passed
-- in, so a worker cannot stamp `delivered_at` on a message that failed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.worker_update_dispatch(
  p_message_log_id      UUID,
  p_status              TEXT,
  p_provider_message_id TEXT DEFAULT NULL,
  p_failure_reason      TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- No status whitelist here on purpose. `message_log` already carries a CHECK
  -- listing the nine valid statuses; repeating them would create a second list
  -- to keep in step, and the copy would already be wrong — a first draft of
  -- this function omitted `fallback_sent`, `quota_exceeded`, `bounced`, and
  -- `opted_out`. An invalid status raises 23514 from the constraint.
  UPDATE public.message_log m
  SET status              = p_status,
      provider_message_id = COALESCE(p_provider_message_id, m.provider_message_id),
      failure_reason      = CASE WHEN p_status = 'failed' THEN p_failure_reason ELSE m.failure_reason END,
      sent_at             = CASE WHEN p_status = 'sent'      AND m.sent_at      IS NULL THEN NOW() ELSE m.sent_at END,
      delivered_at        = CASE WHEN p_status = 'delivered' AND m.delivered_at IS NULL THEN NOW() ELSE m.delivered_at END,
      read_at             = CASE WHEN p_status = 'read'      AND m.read_at      IS NULL THEN NOW() ELSE m.read_at END,
      failed_at           = CASE WHEN p_status = 'failed'    AND m.failed_at    IS NULL THEN NOW() ELSE m.failed_at END
  WHERE m.id = p_message_log_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'worker_update_dispatch: no message_log row %', p_message_log_id
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.worker_update_dispatch(UUID, TEXT, TEXT, TEXT) IS
  'Records a provider result against a message_log row. Service role only (ADR-042).';

-- ---------------------------------------------------------------------------
-- worker_school_branding()
--
-- The header block a receipt, statement, or report card is drawn with.
-- One school, by id, and nothing beyond what a document prints.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.worker_school_branding(p_school_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'name',       s.name,
    'schoolCode', s.school_id,
    'address',    s.address,
    'phone',      s.phone,
    'email',      s.email,
    'logoUrl',    s.logo_url
  )
  FROM public.schools s
  WHERE s.id = p_school_id;
$$;

COMMENT ON FUNCTION public.worker_school_branding(UUID) IS
  'Document header fields for one school. Service role only (ADR-042).';

-- ---------------------------------------------------------------------------
-- Grants — service role only, matching 0090
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.worker_update_dispatch(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.worker_school_branding(UUID)                   FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.worker_update_dispatch(UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_school_branding(UUID)                   TO service_role;

-- ---------------------------------------------------------------------------
-- Verification — fails the migration rather than reporting a warning
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_leaked INT;
BEGIN
  SELECT count(*) INTO v_leaked
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name LIKE 'worker\_%'
    AND grantee IN ('authenticated','anon','PUBLIC');

  IF v_leaked > 0 THEN
    RAISE EXCEPTION
      '0091: % worker_* grant(s) reachable by an end-user role — ADR-042 violated', v_leaked;
  END IF;
END;
$$;

-- === MIGRATION END ===
