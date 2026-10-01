-- ---------------------------------------------------------------------------
-- 0161 — request_school_link() against the columns that actually exist
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/13 Teacher Portal/TEACHER_PORTAL.md`
--
-- ## What 0160 got wrong
--
-- Two column names, both invented rather than checked:
--
--   * **`schools.school_code` does not exist.** The `ZM-LSK-0001` business
--     identifier is `schools.school_id` — a TEXT column, distinct from `id`,
--     which is the UUID primary key. What misled me is `search_schools()` in
--     0155, which selects `s.school_id AS out_school_code`: the directory's
--     PUBLIC vocabulary says "school code" while the column underneath is
--     `school_id`. Reading the API and inferring the schema is precisely the
--     mistake `CLAUDE.md` warns about, and the alias made it look confirmed.
--
--   * **`schools.deleted_at` does not exist.** Schools are not soft-deleted;
--     `status` carries that, with `terminated` as the end state. The filter was
--     copied from the pupil and fee tables, where prohibition 8 does require a
--     soft delete, without checking that it applied here.
--
-- ## Why this was not caught by `CREATE FUNCTION`
--
-- A PL/pgSQL body is parsed LAZILY. `0160` applied without complaint, its grant
-- assertions passed, and the function was broken the entire time — it would
-- have raised `42703: column "school_code" does not exist` the first time a
-- teacher pressed the button.
--
-- It was caught by running every branch of all three functions against the real
-- database inside a transaction that rolls back. That exercise is the only
-- reason this is a correction rather than a defect discovered by a teacher.
-- The lesson is already in `CLAUDE.md` twice; this is the third instance, and
-- the suite added alongside this migration is what stops it being the fourth.
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
  -- school, or is moving between two; nobody has a legitimate reason to hold
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

  /*
    Exact match on `school_id`, the TEXT business identifier — never ILIKE, and
    never returning a list. A name search would confirm to anybody with a free
    Hub account which schools are ZSMS customers, including the ones that kept
    themselves out of the public directory on purpose.

    No `deleted_at` filter: schools are not soft-deleted. The status list is the
    whole of it — `suspended`, `trial_expired` and `terminated` schools cannot
    take on staff.
  */
  SELECT s.id INTO v_school_id
  FROM public.schools AS s
  WHERE s.school_id = upper(btrim(p_school_code))
    AND s.status IN ('active', 'trial', 'pending_verification');

  IF v_school_id IS NULL THEN
    -- Deliberately indistinguishable from success: see 0160's header. Returning
    -- "no such school" would turn this into the enumeration oracle the
    -- exact-code rule exists to prevent.
    RETURN QUERY SELECT
      NULL::UUID,
      TRUE,
      'Your request has been sent to the school.'::TEXT;
    RETURN;
  END IF;

  -- Pressing the button twice is not a failure.
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

-- `CREATE OR REPLACE` preserves grants, but assert rather than assume — the
-- habit that caught 0151's ineffective REVOKE.
DO $$
BEGIN
  IF has_function_privilege(
       'anon', 'public.request_school_link(TEXT, TEXT, TEXT, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'request_school_link is executable by anon';
  END IF;

  IF NOT has_function_privilege(
       'authenticated', 'public.request_school_link(TEXT, TEXT, TEXT, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute request_school_link';
  END IF;
END;
$$;
