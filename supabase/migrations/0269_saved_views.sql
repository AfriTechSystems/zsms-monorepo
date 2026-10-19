-- ===========================================================================
-- 0269 — saved filter views
--
-- Spec: reference image W2, which shows filter chips above the pupil list.
--
-- ## What this is, and what it deliberately is not
--
-- A saved view is a NAME for a set of query-string filters — "Year 7 boarders",
-- "fees overdue". It stores the filters, never the rows. So a view resolves fresh
-- every time it is opened, and a pupil who leaves the roll leaves the view; a saved
-- list of pupil ids would quietly become a record of who matched once.
--
-- It also stores no results, which is why this table holds no personal data at all —
-- the filters are grade ids and statuses. That matters for a table whose whole
-- purpose is to be shared across a school.
--
-- ## Shared by default, within the school
--
-- A view belongs to the SCHOOL, not the person who made it. "Fees overdue" is the
-- same question whoever asks it, and a per-user view means four members of the office
-- each build the same filter and none of them agrees on what it means. The creator is
-- recorded so a view can be attributed and removed, not to restrict who sees it.
--
-- Deleting is restricted though: anybody may create and use, only the creator or the
-- owner/principal may delete. A shared view somebody else relies on should not vanish
-- because a colleague tidied up.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.saved_views (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,

  /*
    Which screen the view belongs to. A view is only meaningful on the list whose
    filters it holds, so "students" cannot appear on the staff screen.
  */
  surface     TEXT NOT NULL CHECK (surface IN ('students', 'staff', 'fees', 'results')),

  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),

  /*
    The filters, as the screen's own query-string keys.

    JSONB rather than columns because each surface has different filters and adding a
    filter to a screen should not need a migration. Validated by the ROUTE against
    that screen's known keys — the database cannot know what `status=on_leave` means,
    and a CHECK pretending otherwise would be a second definition to drift.
  */
  filters     JSONB NOT NULL DEFAULT '{}'::JSONB,

  created_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One name per surface per school. Two "Year 7 boarders" is a coin toss.
  UNIQUE (school_id, surface, name)
);

COMMENT ON TABLE public.saved_views IS
  'Named filter sets for a list screen. Stores FILTERS, never rows — so a view resolves fresh and a pupil who leaves the roll leaves the view (0269).';

CREATE INDEX IF NOT EXISTS idx_saved_views_school_surface
  ON public.saved_views (school_id, surface);

ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_views FORCE ROW LEVEL SECURITY;

/*
  RLS does not imply a GRANT — Postgres checks the privilege first and refuses before
  a policy is ever consulted. Seven tables in this schema once had policies and no
  grant, and every one of them read as a permissions bug.
*/
GRANT SELECT, INSERT, DELETE ON public.saved_views TO authenticated;

-- Anybody at the school may read its views.
CREATE POLICY school_select_saved_views ON public.saved_views
  FOR SELECT TO authenticated
  USING (school_id = public.current_school_uuid());

-- Anybody at the school may create one, for their own school, as themselves.
CREATE POLICY school_insert_saved_views ON public.saved_views
  FOR INSERT TO authenticated
  WITH CHECK (
    school_id = public.current_school_uuid()
    -- Recording somebody else as the creator would make attribution a lie.
    AND created_by = public.get_user_id()
  );

/*
  Deleting is narrower: the creator, or the people who run the school.

  A shared view a colleague relies on should not disappear because somebody tidied
  up — but an owner must be able to remove one, or a view created by a member of
  staff who has left is permanent.
*/
CREATE POLICY school_delete_saved_views ON public.saved_views
  FOR DELETE TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND (
      created_by = public.get_user_id()
      OR (auth.jwt() -> 'o' ->> 'rol') IN ('owner', 'principal')
    )
  );

-- ---------------------------------------------------------------------------
-- Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_has_grant BOOLEAN;
BEGIN
  SELECT has_table_privilege('authenticated', 'public.saved_views', 'SELECT')
    INTO v_has_grant;
  IF NOT v_has_grant THEN
    RAISE EXCEPTION '0269: authenticated has no SELECT grant — RLS would never be reached';
  END IF;

  IF has_table_privilege('authenticated', 'public.saved_views', 'UPDATE') THEN
    RAISE EXCEPTION '0269: UPDATE was granted; a view is created and deleted, never edited';
  END IF;

  IF has_table_privilege('anon', 'public.saved_views', 'SELECT') THEN
    RAISE EXCEPTION '0269: anon can read saved views';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'saved_views' AND rowsecurity
  ) THEN
    RAISE EXCEPTION '0269: RLS is not enabled';
  END IF;

  /*
    The name constraint must actually refuse a blank name.

    Exercised against a real school when one exists, and asserted from the catalogue
    when none does. **The first version of this block only did the first half and
    broke CI**: on an EMPTY database `INSERT ... SELECT ... FROM schools LIMIT 1`
    inserts zero rows, which raises nothing at all, so the "was accepted" branch
    fired on a database where nothing had been accepted. It passed on `zsms-dev`
    purely because dev has seeded schools.

    The general lesson is the one CI exists for: a migration verified only against a
    populated database is not verified. Anything that exercises behaviour has to say
    what it does when there is no data to exercise it with.
  */
  IF EXISTS (SELECT 1 FROM public.schools) THEN
    BEGIN
      INSERT INTO public.saved_views (school_id, surface, name, created_by)
      SELECT id, 'students', '   ', 'user_test' FROM public.schools LIMIT 1;
      RAISE EXCEPTION '0269: a blank name was accepted';
    EXCEPTION
      WHEN check_violation THEN NULL;
    END;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.saved_views'::REGCLASS
        AND contype = 'c'
        -- Matched against how POSTGRES renders it, which is `TRIM(BOTH FROM name)`
        -- and not the `btrim(name)` the first attempt guessed. Verified by reading
        -- pg_get_constraintdef on the real table rather than assuming.
        AND pg_get_constraintdef(oid) ILIKE '%length(trim(both from name))%'
    ) THEN
      RAISE EXCEPTION '0269: the name length constraint is missing';
    END IF;
  END IF;

  RAISE NOTICE '0269: verified — grants present, UPDATE withheld, RLS on, blank name refused';
END;
$$;
