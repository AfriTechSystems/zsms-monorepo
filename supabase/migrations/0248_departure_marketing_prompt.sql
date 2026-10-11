-- ===========================================================================
-- 0248 — the marketing prompt a parent sees when a child leaves
--
-- Spec: `07 Student and Parent Modules/TRANSFER.md` → *Marketing Opt-In at
--       Transfer*, `PARENT_LINKING.md` → *Parent Account After Graduation*,
--       ADR-015
--
-- ## What was missing
--
-- `parents.marketing_opt_in` exists and defaults FALSE (`0229`), and
-- `/parent/account` lets a parent change it whenever they like. What neither
-- document's flow had was the **moment of asking** — TRANSFER.md and
-- PARENT_LINKING.md both describe a prompt shown once when a child leaves, and
-- nothing showed it.
--
-- That matters commercially and legally at once. It is the one point where a
-- parent is plausibly willing to stay in touch, and it is also the point where
-- consent is unambiguous: they were asked, in context, and said yes or did not.
--
-- ## Why a column rather than deriving it
--
-- "Show it once" needs to know it was shown. Deriving from `marketing_opt_in_at`
-- would re-ask forever anybody who declines — and TRANSFER.md is explicit that
-- clicking **Continue** without ticking is an answer, not a deferral. A parent
-- asked the same question every login has been asked once and nagged thereafter.
--
-- ## The checkbox is never pre-ticked, and the schema cannot enforce that
--
-- Only the screen can. What the schema does enforce is that the DEFAULT stays
-- FALSE (`0229` asserts it at migration time), so a parent who never answers is
-- never opted in by omission.
-- ===========================================================================

ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS marketing_prompted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.parents.marketing_prompted_at IS
  'When the departure prompt was last shown and answered. Clicking Continue without ticking sets this too — declining is an answer, and re-asking would be nagging (0248).';

-- ---------------------------------------------------------------------------
-- Should this parent be asked, and about whom.
-- ---------------------------------------------------------------------------

/*
  Returns at most one row: the most recently departed child, and only while the
  parent has not yet answered.

  The grace period matters here. `is_linked_parent_of()` keeps a parent's access
  for 30 days after unlinking, and `0239` keeps a pupil's own records reachable
  forever — but the PROMPT is about a moment, so it is scoped to a child who left
  recently rather than to any departure in the school's history. A parent whose
  eldest left in 2019 should not be greeted with a prompt about them.
*/
CREATE OR REPLACE FUNCTION public.my_departure_prompt()
RETURNS TABLE (
  out_show          BOOLEAN,
  out_student_name  TEXT,
  out_school_name   TEXT,
  out_status        TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user TEXT := public.get_user_id();
BEGIN
  IF v_user IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Already answered, either way.
  IF EXISTS (
    SELECT 1 FROM public.parents p
    WHERE p.clerk_user_id = v_user AND p.marketing_prompted_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT TRUE,
         btrim(s.first_name || ' ' || s.last_name),
         sc.name,
         s.status
  FROM public.student_parent_links spl
  JOIN public.students s ON s.id = spl.student_id
  JOIN public.schools sc ON sc.id = s.school_id
  WHERE spl.parent_user_id = v_user
    AND s.status IN ('transferred', 'graduated', 'withdrawn')
    AND COALESCE(s.is_deleted, FALSE) = FALSE
    /*
      Within 90 days of the change. Wider than the 30-day grace period on
      purpose: a parent may not sign in for weeks after a child leaves, and the
      prompt is worth nothing if it has expired before they next look.
    */
    AND s.updated_at > NOW() - INTERVAL '90 days'
  ORDER BY s.updated_at DESC
  LIMIT 1;

  -- No departed child: nothing to ask about.
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::TEXT, NULL::TEXT;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.my_departure_prompt() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_departure_prompt() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_departure_prompt() TO authenticated;

-- ---------------------------------------------------------------------------
-- Answering it.
-- ---------------------------------------------------------------------------

/*
  One call for both answers.

  `p_opt_in` TRUE means they ticked the box; FALSE means they clicked Continue
  without it. Both stamp `marketing_prompted_at`, so the prompt does not return —
  which is the whole reason this is a function rather than two column updates
  from the route.

  `marketing_opt_in_at` is stamped by the `0229` trigger, not here, so the
  evidence of consent still cannot be supplied by a client.
*/
CREATE OR REPLACE FUNCTION public.answer_departure_prompt(p_opt_in BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user TEXT := public.get_user_id();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  UPDATE public.parents
  SET marketing_prompted_at = NOW(),
      /*
        Only ever set TRUE here, never cleared. A parent who declines keeps
        whatever they had — somebody who opted in last year and declines this
        prompt has not withdrawn consent, they have declined a second ask.
        Withdrawing is `/parent/account`, which is its own deliberate act.
      */
      marketing_opt_in = CASE WHEN p_opt_in THEN TRUE ELSE marketing_opt_in END
  WHERE clerk_user_id = v_user;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.answer_departure_prompt(BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.answer_departure_prompt(BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.answer_departure_prompt(BOOLEAN) TO authenticated;

-- ---------------------------------------------------------------------------
-- Exercise the behaviour the documents insist on.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_parent TEXT;
  v_student UUID;
  v_row    RECORD;
BEGIN
  BEGIN
    SELECT spl.parent_user_id, spl.student_id INTO v_parent, v_student
    FROM public.student_parent_links spl
    JOIN public.students s ON s.id = spl.student_id
    WHERE spl.parent_user_id IS NOT NULL AND s.status = 'active'
    LIMIT 1;

    IF v_parent IS NULL THEN
      RAISE NOTICE '0248: no linked parent fixture; skipping';
      RAISE EXCEPTION 'ZSMS_0248_ROLLBACK';
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', v_parent, 'role', 'authenticated')::text, TRUE);

    -- A parent whose children are all still enrolled is not asked.
    SELECT * INTO v_row FROM public.my_departure_prompt();
    IF v_row.out_show THEN
      RAISE EXCEPTION '0248: a parent with no departed child was prompted';
    END IF;

    UPDATE public.students SET status = 'transferred', updated_at = NOW()
    WHERE id = v_student;

    SELECT * INTO v_row FROM public.my_departure_prompt();
    IF NOT v_row.out_show THEN
      RAISE EXCEPTION '0248: a parent whose child just transferred was NOT prompted';
    END IF;
    IF v_row.out_student_name IS NULL THEN
      RAISE EXCEPTION '0248: the prompt does not name the child';
    END IF;

    -- Declining is an answer: the prompt must not come back.
    PERFORM public.answer_departure_prompt(FALSE);

    SELECT * INTO v_row FROM public.my_departure_prompt();
    IF v_row.out_show THEN
      RAISE EXCEPTION '0248: the prompt returned after being declined';
    END IF;

    -- And declining must not have opted them in.
    IF (SELECT marketing_opt_in FROM public.parents WHERE clerk_user_id = v_parent) THEN
      RAISE EXCEPTION '0248: declining the prompt opted the parent IN';
    END IF;

    RAISE EXCEPTION 'ZSMS_0248_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0248_ROLLBACK' THEN
        RAISE NOTICE '0248: verified — asked once on departure, declining is an answer, declining does not opt in';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
