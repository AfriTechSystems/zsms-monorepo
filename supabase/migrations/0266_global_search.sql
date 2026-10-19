-- ===========================================================================
-- 0266 — global search
--
-- Spec: `19 Design System/ZSMS_UI_REDESIGN_MASTER_PROMPT.md` §4C, which allows a
--       global search in the top bar "where already supported". It was not
--       supported — this is what supports it.
--
-- ## The one decision that matters: SECURITY INVOKER
--
-- Every other function in this schema that crosses tables is SECURITY DEFINER
-- with a hand-written tenant clause. **This one must not be.**
--
-- A DEFINER search would bypass RLS and then have to re-implement, inside one
-- function, every rule that governs who may see a pupil, a member of staff, a
-- school and an announcement — including the teacher-sees-only-their-classes
-- rule that lives in `teacher_assignments`, and the parent rule that lives in
-- `student_parent_links`. That is four policies restated in a place no policy
-- test covers, and the restatement is what would drift.
--
-- As INVOKER the function runs as the caller. Postgres applies the existing
-- policies to every table it touches, so:
--
--   * a school administrator finds pupils at their school and nowhere else;
--   * a teacher finds only pupils in classes they are assigned to, because
--     that is what the policy on `students` already says;
--   * AfriTech finds schools, because `is_afritech_admin()` already admits them;
--   * a parent finds their own children, and nothing else, for free.
--
-- **No new access is created by this migration.** It can only return rows the
-- caller could already have fetched one table at a time.
--
-- ## Who gets a search box, and why not everybody
--
-- | Portal | Searches | Why |
-- |---|---|---|
-- | AfriTech Admin | Schools | A platform operator navigates by school name |
-- | School | Pupils, staff | The two things an office looks up all day |
-- | Teacher (in a school) | Pupils in their classes | Same box, narrower results — RLS, not a different query |
-- | Parent | **No box** | Two children. A search over two names is furniture |
-- | Student / Alumni | **No box** | One record, their own |
--
-- The parent exclusion is a UI decision, not a security one: the function is
-- safe for them, it is simply useless.
--
-- ## Why ILIKE and not a trigram index
--
-- `pg_trgm` is available and is deliberately not installed. A school has
-- hundreds of pupils and the platform has hundreds of schools; an ILIKE over
-- that is sub-millisecond, and the limit below caps the work regardless. Adding
-- an extension, an index per searchable column and a maintenance obligation to
-- solve a problem nobody has would be the wrong trade. Revisit at a scale that
-- actually hurts — the shape of this function does not change when it happens.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.search_everything(
  p_query TEXT,
  p_limit INT DEFAULT 6
)
RETURNS TABLE (
  out_kind     TEXT,
  out_id       TEXT,
  out_title    TEXT,
  out_subtitle TEXT,
  /**
   * Where the result goes. Built here rather than in the UI so one result shape
   * renders as one list, and so a kind added later needs no screen change.
   *
   * School-scoped paths carry `:code`, which the route swaps for the caller's own
   * school code — the function has the school's UUID, not the slug the router uses.
   */
  out_href     TEXT
)
LANGUAGE sql
-- INVOKER, deliberately. See the header: RLS is the authorisation.
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
  WITH q AS (
    SELECT
      /*
        `%` and `_` are ILIKE wildcards. Without escaping, a search for "_" matches
        every row — which is not a security hole, since RLS still applies, but it is
        a confusing result and a pointless scan.
      */
      '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%' AS pattern,
      length(btrim(p_query)) AS len
  )

  -- Pupils. The policy on `students` decides which ones: all of them for the
  -- office, only assigned classes for a teacher, only their own for a parent.
  --
  -- Each branch is parenthesised so it can carry its own ORDER BY and LIMIT: a bare
  -- `ORDER BY ... LIMIT` before UNION ALL binds to the whole union, not the branch,
  -- and Postgres rejects it outright.
  (SELECT
    'student',
    s.id::TEXT,
    s.first_name || ' ' || s.last_name,
    s.student_id || COALESCE(' · ' || s.class_id, ''),
    '/school/:code/students/' || s.id::TEXT
  FROM public.students s, q
  WHERE q.len >= 2
    AND s.is_deleted = FALSE
    AND (s.first_name || ' ' || s.last_name ILIKE q.pattern
         OR s.student_id ILIKE q.pattern)
  ORDER BY s.last_name, s.first_name
  LIMIT p_limit)

  UNION ALL

  -- Staff. `management_read_staff` and `staff_read_own_record` already decide who
  -- appears here; a teacher finds themselves and nobody else.
  (SELECT
    'staff',
    m.id::TEXT,
    m.first_name || ' ' || m.last_name,
    COALESCE(m.department, m.employment_type),
    '/school/:code/staff'
  FROM public.staff_members m, q
  WHERE q.len >= 2
    AND COALESCE(m.is_active, TRUE)
    AND (m.first_name || ' ' || m.last_name ILIKE q.pattern
         OR COALESCE(m.staff_number, '') ILIKE q.pattern)
  ORDER BY m.last_name, m.first_name
  LIMIT p_limit)

  UNION ALL

  /*
    Schools. In practice AfriTech, because they are the only caller whose policies
    admit more than one — a school administrator matches only their own, which is a
    harmless and occasionally useful result.
  */
  (SELECT
    'school',
    sc.id::TEXT,
    sc.name,
    sc.school_id || COALESCE(' · ' || sc.city_code, ''),
    '/admin/schools/' || sc.id::TEXT
  FROM public.schools sc, q
  WHERE q.len >= 2
    AND (sc.name ILIKE q.pattern OR sc.school_id ILIKE q.pattern)
  ORDER BY sc.name
  LIMIT p_limit);
$$;

COMMENT ON FUNCTION public.search_everything(TEXT, INT) IS
  'Global search across pupils, staff and schools. SECURITY INVOKER on purpose: RLS is the authorisation, so a teacher finds only their own classes without this function knowing what a teaching assignment is. Creates no access that did not already exist (0266).';

REVOKE ALL ON FUNCTION public.search_everything(TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_everything(TEXT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_everything(TEXT, INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Assert what a migration honestly can.
--
-- ## Why the behavioural checks are not here
--
-- Observing RLS requires `SET LOCAL ROLE authenticated`, and a migration runs as a
-- role RLS does not apply to — so an unswitched count passes whatever the policies
-- say. `0257` tried exactly that twice and both attempts left the role switched when
-- the block ended, so the CLI's own `INSERT INTO supabase_migrations.schema_migrations`
-- failed with "permission denied for schema supabase_migrations". A migration that
-- looked like a tooling privilege bug and was one in the file.
--
-- The behavioural assertions therefore live in
-- `supabase/tests/rls/global_search_test.sql`, where the harness is built to switch
-- identity and CI runs it against a database built from nothing. That is where
-- "school A finds no pupil of school B" is actually proved.
--
-- What remains here is the one property that is both checkable from a migration and
-- load-bearing: that the function is still SECURITY INVOKER.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_everything'
  ) THEN
    RAISE EXCEPTION '0266: search_everything was not created';
  END IF;

  /*
    INVOKER is the entire security model of this function. If somebody "simplifies" it
    to DEFINER later, every tenant rule silently stops applying and the search starts
    returning other schools' pupils — with no error anywhere.
  */
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'search_everything' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION
      '0266: search_everything is SECURITY DEFINER — RLS no longer scopes it';
  END IF;

  IF has_function_privilege('anon', 'public.search_everything(TEXT, INT)', 'EXECUTE') THEN
    RAISE EXCEPTION '0266: anon can search';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.search_everything(TEXT, INT)', 'EXECUTE') THEN
    RAISE EXCEPTION '0266: signed-in users cannot search, so the box would never work';
  END IF;

  RAISE NOTICE '0266: verified — function present, SECURITY INVOKER, authenticated only';
END;
$$;
