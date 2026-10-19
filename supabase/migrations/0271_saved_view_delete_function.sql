-- ===========================================================================
-- 0271 — removing a saved view is a function, not a DELETE grant
--
-- ## What 0269 got wrong
--
-- It granted `DELETE ON saved_views TO authenticated` and wrote a DELETE policy.
-- Both are correct in isolation and both violate a standing invariant of this
-- schema: `tenant_isolation_test` asserts that **no DELETE or TRUNCATE privilege
-- exists anywhere in `public` for end-user roles**, and CI caught it.
--
-- The invariant is not about saved views. It is that every removal in this product
-- goes through a function that can decide, record and refuse — so that "can this be
-- deleted" is answered in one place per table rather than by a policy that is easy to
-- widen by accident. `0200` already does exactly this for timetable slots.
--
-- Worth stating plainly: the policy I wrote was not wrong about WHO may delete. It
-- was wrong about the mechanism, and the suite that caught it is a better guard than
-- the review that did not.
--
-- ## The id is validated, not trusted
--
-- `p_view_id` names the row to remove, and the function establishes both that the row
-- belongs to the caller's school and that the caller is entitled to remove it. That
-- is different from a DEFINER function accepting `p_school_id` and believing it —
-- the argument here is the subject of the operation, not a claim about who is asking.
-- ===========================================================================

DROP POLICY IF EXISTS school_delete_saved_views ON public.saved_views;

REVOKE DELETE ON public.saved_views FROM authenticated;

CREATE OR REPLACE FUNCTION public.delete_saved_view(p_view_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_school  UUID := public.current_school_uuid();
  v_user    TEXT := public.get_user_id();
  v_role    TEXT := auth.jwt() -> 'o' ->> 'rol';
  v_creator TEXT;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  /*
    A DEFINER function bypasses RLS, so the tenant clause is written by hand. Without
    `school_id = v_school` this would remove any school's view by id.
  */
  SELECT created_by INTO v_creator
  FROM public.saved_views
  WHERE id = p_view_id AND school_id = v_school;

  /*
    Not found and not permitted are ONE answer.

    Saying "that view belongs to someone else" would confirm it exists, and a view's
    name is chosen by a colleague — "Fees overdue - Mrs Banda's list" is information
    about another school if the id came from one.
  */
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'That view is not available to remove' USING ERRCODE = '42501';
  END IF;

  /*
    The creator, or the people who run the school.

    A shared view a colleague relies on should not vanish because somebody tidied up —
    but an owner must be able to remove one left behind by a member of staff who has
    gone, or it is permanent.
  */
  IF v_creator <> v_user AND v_role NOT IN ('owner', 'principal') THEN
    RAISE EXCEPTION 'That view is not available to remove' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.saved_views
  WHERE id = p_view_id AND school_id = v_school;

  RETURN TRUE;
END;
$fn$;

COMMENT ON FUNCTION public.delete_saved_view(UUID) IS
  'Removes a saved view. A function rather than a DELETE grant, because no end-user role holds DELETE anywhere in public — tenant_isolation_test asserts it (0271).';

REVOKE ALL ON FUNCTION public.delete_saved_view(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_saved_view(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_saved_view(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Exercise it.
-- ---------------------------------------------------------------------------

DO $do$
BEGIN
  -- The invariant CI enforces. Asserted here too, so the migration that reintroduces
  -- the grant fails at apply time rather than three suites later.
  IF has_table_privilege('authenticated', 'public.saved_views', 'DELETE') THEN
    RAISE EXCEPTION
      '0271: authenticated still holds DELETE on saved_views; removal must go through delete_saved_view()';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'saved_views' AND cmd = 'DELETE'
  ) THEN
    RAISE EXCEPTION '0271: a DELETE policy survives on saved_views';
  END IF;

  IF has_function_privilege('anon', 'public.delete_saved_view(UUID)', 'EXECUTE') THEN
    RAISE EXCEPTION '0271: anon can delete a saved view';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.delete_saved_view(UUID)', 'EXECUTE') THEN
    RAISE EXCEPTION '0271: authenticated cannot call delete_saved_view';
  END IF;

  RAISE NOTICE '0271: verified - no DELETE grant, no DELETE policy, function is authenticated-only';
END;
$do$;
