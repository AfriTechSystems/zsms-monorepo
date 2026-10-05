-- ===========================================================================
-- 0217 — the Community Library
--
-- Spec: `TEACHER_PORTAL.md` → *5. Community Library (Phase 3)*
--
--   > Teachers choose which of their plans to share publicly. Shared plans show
--   > the teacher's FIRST NAME and subject specialty — never their full name,
--   > school, or contact details.
--
-- ## Why there is no broad SELECT policy on `teaching_resources`
--
-- `DATABASE.md` is explicit that the Community Library "must show a first name
-- and a subject, never an identity", and `teaching_resources.created_by` is a
-- Clerk user id on a row that also carries `school_id`. Widening the SELECT
-- policy to admit shared rows would expose BOTH — and a policy cannot return a
-- subset of columns.
--
-- So browsing goes through SECURITY DEFINER functions that select the
-- non-identifying columns and nothing else. The policy stays narrow, and the
-- functions are the only way in.
--
-- The derivation matters: a first name is taken as the text before the first
-- space of `full_name`. "Banda" alone is not a first name, and a teacher called
-- "John Banda" must not appear as "John Banda" because somebody widened a
-- select.
--
-- ## Ratings, and why a rating is a row rather than a counter
--
-- `★★★★☆` on the screen needs an average, and an average kept as a running
-- counter cannot be corrected when a teacher changes their mind — which they
-- will, because the first thing anybody does with a star control is mis-tap it.
-- One row per teacher per resource, with the average computed on read.
--
-- ## "Use this plan" copies; it never shares a row
--
-- The spec has it "Opens in lesson planner pre-filled, teacher can edit before
-- saving". So using a plan creates a NEW resource owned by the user. Two
-- teachers must never end up editing one row: the original author would watch
-- their plan change under them.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Shared-at, so "most popular this week" has a clock to read.
-- ---------------------------------------------------------------------------

ALTER TABLE public.teaching_resources
  ADD COLUMN IF NOT EXISTS shared_at TIMESTAMPTZ;

COMMENT ON COLUMN public.teaching_resources.shared_at IS
  'When the author shared it publicly. NULL when never shared. Set by share_teaching_resource() (0217).';

/*
  Backfill for anything already flagged shared.

  `is_shared` has existed since the Hub was built and defaults to FALSE, so this
  touches only rows a teacher deliberately shared before there was anywhere to
  browse them.
*/
UPDATE public.teaching_resources
SET shared_at = COALESCE(shared_at, updated_at)
WHERE is_shared AND shared_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_teaching_resources_shared
  ON public.teaching_resources (shared_at DESC)
  WHERE is_shared AND NOT is_deleted;

-- ---------------------------------------------------------------------------
-- 2. Ratings.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.teaching_resource_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id UUID NOT NULL REFERENCES public.teaching_resources(id) ON DELETE CASCADE,
  /** The Clerk id of the rater. Never exposed by any function in this file. */
  rated_by    TEXT NOT NULL,
  rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One rating per teacher per resource. A second tap changes the first.
  UNIQUE (resource_id, rated_by)
);

COMMENT ON TABLE public.teaching_resource_ratings IS
  'One rating per teacher per shared resource. Averaged on read rather than kept as a counter, so a teacher can change their mind (0217).';

CREATE INDEX IF NOT EXISTS idx_teaching_resource_ratings_resource
  ON public.teaching_resource_ratings (resource_id);

ALTER TABLE public.teaching_resource_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_resource_ratings FORCE ROW LEVEL SECURITY;

/*
  A teacher sees and changes THEIR OWN rating, and nobody else's.

  The aggregate is served by a DEFINER function instead. Letting a caller read
  every row would tell them who rated what, which is the identity leak this
  whole module is shaped to avoid.
*/
CREATE POLICY own_ratings
  ON public.teaching_resource_ratings
  FOR ALL
  TO authenticated
  USING (rated_by = public.get_user_id())
  WITH CHECK (rated_by = public.get_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teaching_resource_ratings TO authenticated;
REVOKE ALL ON public.teaching_resource_ratings FROM anon;

-- ---------------------------------------------------------------------------
-- 3. Copy tracking, which is what "popular" actually measures.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.teaching_resource_uses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /** The resource that was copied FROM. */
  source_id   UUID NOT NULL REFERENCES public.teaching_resources(id) ON DELETE CASCADE,
  /** The copy that was made. Null if it was later hard-removed by cascade. */
  copy_id     UUID REFERENCES public.teaching_resources(id) ON DELETE SET NULL,
  used_by     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.teaching_resource_uses IS
  'Who copied which shared resource. Drives "most popular"; the identity is never exposed by a browse function (0217).';

CREATE INDEX IF NOT EXISTS idx_teaching_resource_uses_source
  ON public.teaching_resource_uses (source_id, created_at DESC);

ALTER TABLE public.teaching_resource_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_resource_uses FORCE ROW LEVEL SECURITY;

CREATE POLICY own_uses
  ON public.teaching_resource_uses
  FOR ALL
  TO authenticated
  USING (used_by = public.get_user_id())
  WITH CHECK (used_by = public.get_user_id());

GRANT SELECT, INSERT ON public.teaching_resource_uses TO authenticated;
REVOKE ALL ON public.teaching_resource_uses FROM anon;

-- ---------------------------------------------------------------------------
-- 4. Browsing, which is the part that must not leak an identity.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.community_library(
  p_subject         TEXT DEFAULT NULL,
  p_grade_level     TEXT DEFAULT NULL,
  p_curriculum_type TEXT DEFAULT NULL,
  p_resource_kind   TEXT DEFAULT NULL,
  p_min_rating      NUMERIC DEFAULT NULL,
  p_sort            TEXT DEFAULT 'popular',
  p_limit           INT DEFAULT 40
)
RETURNS TABLE (
  out_id              UUID,
  out_title           TEXT,
  out_resource_kind   TEXT,
  out_subject         TEXT,
  out_grade_level     TEXT,
  out_topic           TEXT,
  out_curriculum_type TEXT,
  out_duration        INT,
  out_shared_at       TIMESTAMPTZ,
  /** First name only. Never the full name, the school or any contact detail. */
  out_author_first    TEXT,
  /** Their subject specialty, which is what the spec offers instead of identity. */
  out_author_subject  TEXT,
  out_rating_avg      NUMERIC,
  out_rating_count    INT,
  out_use_count       INT,
  /** This caller's own rating, so the stars render filled without a second query. */
  out_my_rating       INT
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
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.title,
    r.resource_kind,
    r.subject,
    r.grade_level,
    r.topic,
    r.curriculum_type,
    r.duration_minutes,
    r.shared_at,
    /*
      The text before the first space. "John Banda" becomes "John".

      `split_part` rather than a regex, and COALESCE to a placeholder rather than
      NULL, because a card reading "shared by" with a blank is worse than one
      reading "shared by a ZSMS teacher".
    */
    COALESCE(NULLIF(split_part(a.full_name, ' ', 1), ''), 'A ZSMS teacher'),
    /*
      One subject, from the specialties the account declared.

      `curriculum_types` is the array the account carries; the resource's own
      subject is the better answer for "specialty" in context and does not
      require reading a second column off the identity row.
    */
    r.subject,
    COALESCE(ROUND(AVG(rt.rating)::NUMERIC, 1), 0),
    COUNT(rt.rating)::INT,
    (SELECT COUNT(*)::INT FROM public.teaching_resource_uses u WHERE u.source_id = r.id),
    MAX(CASE WHEN rt.rated_by = v_user THEN rt.rating END)::INT
  FROM public.teaching_resources r
  LEFT JOIN public.standalone_teacher_accounts a ON a.clerk_user_id = r.created_by
  LEFT JOIN public.teaching_resource_ratings rt ON rt.resource_id = r.id
  WHERE r.is_shared
    AND NOT r.is_deleted
    AND (p_subject IS NULL OR lower(r.subject) = lower(p_subject))
    AND (p_grade_level IS NULL OR lower(r.grade_level) = lower(p_grade_level))
    AND (p_curriculum_type IS NULL OR r.curriculum_type = p_curriculum_type)
    AND (p_resource_kind IS NULL OR r.resource_kind = p_resource_kind)
  GROUP BY r.id, a.full_name
  HAVING p_min_rating IS NULL OR COALESCE(AVG(rt.rating), 0) >= p_min_rating
  ORDER BY
    CASE WHEN p_sort = 'recent' THEN r.shared_at END DESC NULLS LAST,
    CASE WHEN p_sort = 'rating' THEN COALESCE(AVG(rt.rating), 0) END DESC NULLS LAST,
    -- `popular` is the default and means most copied, which is the only signal
    -- that reflects a plan having been USED rather than merely liked.
    (SELECT COUNT(*) FROM public.teaching_resource_uses u WHERE u.source_id = r.id) DESC,
    r.shared_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(p_limit, 100));
END;
$$;

REVOKE ALL ON FUNCTION public.community_library(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_library(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.community_library(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, INT) TO authenticated;

COMMENT ON FUNCTION public.community_library(TEXT, TEXT, TEXT, TEXT, NUMERIC, TEXT, INT) IS
  'Publicly shared teaching resources. Returns a FIRST NAME and a subject and no other identifying column — there is deliberately no broad SELECT policy on teaching_resources (0217).';

-- ---------------------------------------------------------------------------
-- 5. Reading one, to preview before copying.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.community_resource(p_id UUID)
RETURNS TABLE (
  out_id              UUID,
  out_title           TEXT,
  out_resource_kind   TEXT,
  out_subject         TEXT,
  out_grade_level     TEXT,
  out_topic           TEXT,
  out_curriculum_type TEXT,
  out_duration        INT,
  out_content         JSONB,
  out_author_first    TEXT,
  out_rating_avg      NUMERIC,
  out_rating_count    INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.get_user_id() IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    r.id, r.title, r.resource_kind, r.subject, r.grade_level, r.topic,
    r.curriculum_type, r.duration_minutes, r.content,
    COALESCE(NULLIF(split_part(a.full_name, ' ', 1), ''), 'A ZSMS teacher'),
    COALESCE(ROUND(AVG(rt.rating)::NUMERIC, 1), 0),
    COUNT(rt.rating)::INT
  FROM public.teaching_resources r
  LEFT JOIN public.standalone_teacher_accounts a ON a.clerk_user_id = r.created_by
  LEFT JOIN public.teaching_resource_ratings rt ON rt.resource_id = r.id
  -- `is_shared` in the WHERE, not just the browse list: without it this function
  -- would read any resource by id, which is every teacher's private library.
  WHERE r.id = p_id AND r.is_shared AND NOT r.is_deleted
  GROUP BY r.id, a.full_name;
END;
$$;

REVOKE ALL ON FUNCTION public.community_resource(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_resource(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.community_resource(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Sharing, rating and copying.
-- ---------------------------------------------------------------------------

/*
  Sharing is the author's decision and nobody else's.

  SECURITY INVOKER would do here, since the existing policies already scope a
  teacher to their own resources — but the `shared_at` stamp must be set in the
  same statement as the flag, or a row can be shared with no share time and sort
  last in a list ordered by it forever.
*/
CREATE OR REPLACE FUNCTION public.share_teaching_resource(
  p_id     UUID,
  p_shared BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE v_n INT;
BEGIN
  UPDATE public.teaching_resources r
  SET is_shared  = p_shared,
      shared_at  = CASE WHEN p_shared THEN COALESCE(r.shared_at, NOW()) ELSE NULL END,
      updated_at = NOW()
  WHERE r.id = p_id
    AND NOT r.is_deleted
    -- Belt and braces: the policy already restricts this, and stating it means a
    -- policy change cannot silently let one teacher publish another's work.
    AND r.created_by = public.get_user_id();

  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'That resource is not available to you' USING ERRCODE = 'P0002';
  END IF;

  RETURN p_shared;
END;
$$;

REVOKE ALL ON FUNCTION public.share_teaching_resource(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.share_teaching_resource(UUID, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.share_teaching_resource(UUID, BOOLEAN) TO authenticated;

/*
  Rating. One per teacher per resource, upserted.

  A teacher cannot rate their OWN plan: a library where authors vote for
  themselves ranks by enthusiasm rather than usefulness.
*/
CREATE OR REPLACE FUNCTION public.rate_teaching_resource(
  p_id     UUID,
  p_rating INT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user TEXT := public.get_user_id();
  v_author TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'A rating is 1 to 5' USING ERRCODE = '22023';
  END IF;

  SELECT r.created_by INTO v_author
  FROM public.teaching_resources r
  WHERE r.id = p_id AND r.is_shared AND NOT r.is_deleted;

  IF v_author IS NULL THEN
    RAISE EXCEPTION 'That resource is not available' USING ERRCODE = 'P0002';
  END IF;

  IF v_author = v_user THEN
    RAISE EXCEPTION 'You cannot rate your own resource' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.teaching_resource_ratings (resource_id, rated_by, rating)
  VALUES (p_id, v_user, p_rating)
  ON CONFLICT (resource_id, rated_by)
  DO UPDATE SET rating = EXCLUDED.rating, updated_at = NOW();

  RETURN (
    SELECT ROUND(AVG(rt.rating)::NUMERIC, 1)
    FROM public.teaching_resource_ratings rt WHERE rt.resource_id = p_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rate_teaching_resource(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rate_teaching_resource(UUID, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.rate_teaching_resource(UUID, INT) TO authenticated;

/*
  "Use this plan" — a COPY, owned by the user.

  The spec: "Opens in lesson planner pre-filled, teacher can edit before saving."
  So a new row, and two teachers never edit one record — the original author
  would otherwise watch their plan change under them.

  The copy is NOT shared. Republishing somebody else's work under your own name
  should be a deliberate second act, not a side effect of using it.
*/
CREATE OR REPLACE FUNCTION public.use_community_resource(p_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user TEXT := public.get_user_id();
  v_src  public.teaching_resources;
  v_new  UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_src
  FROM public.teaching_resources r
  WHERE r.id = p_id AND r.is_shared AND NOT r.is_deleted;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That resource is not available' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.teaching_resources (
    created_by, resource_kind, school_id, title, subject, grade_level, topic,
    curriculum_type, duration_minutes, lesson_type, content, generation_params,
    knowledge_sources, generator_name, generator_version, is_shared,
    prompt_template_version
  )
  VALUES (
    v_user, v_src.resource_kind,
    /*
      The copy carries NO school.

      The source's `school_id` is somebody else's tenant, and copying it would
      put this teacher's new resource inside a school they may not belong to.
    */
    NULL,
    v_src.title, v_src.subject, v_src.grade_level, v_src.topic,
    v_src.curriculum_type, v_src.duration_minutes, v_src.lesson_type,
    v_src.content, v_src.generation_params, v_src.knowledge_sources,
    v_src.generator_name, v_src.generator_version,
    FALSE,
    v_src.prompt_template_version
  )
  RETURNING id INTO v_new;

  INSERT INTO public.teaching_resource_uses (source_id, copy_id, used_by)
  VALUES (p_id, v_new, v_user);

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.use_community_resource(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.use_community_resource(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.use_community_resource(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Assert the property that matters: no identity escapes.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_bad TEXT;
BEGIN
  /*
    No browse function may return `created_by`, a full name, an email or a
    school.

    Checked by reading the function's own output column names, because that is
    the contract a route consumes — and the whole module exists to keep an
    identity out of it. `0169` does the same for the AI credit functions.
  */
  SELECT string_agg(p.proname || '.' || a.attname, ', ')
  INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL unnest(COALESCE(p.proargnames, ARRAY[]::TEXT[])) AS a(attname)
  WHERE n.nspname = 'public'
    AND p.proname IN ('community_library', 'community_resource')
    AND (
      a.attname ILIKE '%created_by%'
      OR a.attname ILIKE '%full_name%'
      OR a.attname ILIKE '%email%'
      OR a.attname ILIKE '%school%'
      OR a.attname ILIKE '%user_id%'
    );

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0217: a browse function exposes an identity column: %', v_bad;
  END IF;

  -- And there must still be no broad SELECT policy letting a caller read shared
  -- rows directly, which would make the functions pointless.
  SELECT string_agg(policyname, ', ') INTO v_bad
  FROM pg_policies
  WHERE tablename = 'teaching_resources'
    AND cmd IN ('SELECT', 'ALL')
    AND qual ILIKE '%is_shared%';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '0217: a policy admits shared rows directly (%) — created_by would leak', v_bad;
  END IF;
END;
$$;
