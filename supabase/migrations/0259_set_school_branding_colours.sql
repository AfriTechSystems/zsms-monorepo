-- ===========================================================================
-- 0259 — a school can set its brand colours
--
-- Spec: `13 Document and PDF System/CUSTOMISATION.md` → *Step 2 — Set Your
--       School Colours*
--
-- ## The gap
--
-- `school_branding.anchor_color` and `.primary_color` have existed since `0092`,
-- each carrying a `wcag_contrast_ratio()` CHECK — so a school **physically
-- cannot** set a brand colour that fails contrast on a report card a parent has
-- to read. That is a genuinely good constraint.
--
-- **Nothing could set them.** The settings screen edits `schools.logo_url` and
-- stops there. Two columns, two contrast guarantees, and no way in.
--
-- ## A function rather than a table write
--
-- The row is keyed by `school_id`, so an upsert from a route needs the school's
-- UUID in TypeScript — which means either passing it in a request (an id the
-- caller could change) or fetching it first. Resolving from the session in SQL
-- avoids both, and matches every other write in this schema.
--
-- ## The logo is deliberately NOT here
--
-- `worker_school_branding()` reads `COALESCE(b.logo_url, s.logo_url)`, so the
-- logo the existing settings screen writes to `schools` already reaches every
-- PDF. Adding a second editor for the same picture would be two copies of one
-- decision, and the one nobody uses is the one that drifts.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.set_school_branding_colours(
  p_anchor_color  TEXT,
  p_primary_color TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_anchor TEXT := NULLIF(btrim(COALESCE(p_anchor_color, '')), '');
  v_primary TEXT := NULLIF(btrim(COALESCE(p_primary_color, '')), '');
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  -- A school's visual identity is the head's call, and it appears on every
  -- document a parent receives.
  IF public.get_user_role() NOT IN ('org:owner', 'org:principal') THEN
    RAISE EXCEPTION
      'Only the owner or principal can change the school colours'
      USING ERRCODE = '42501';
  END IF;

  /*
    The CHECK constraints on the table do the contrast enforcement, and they are
    left to do it rather than being restated here. Two copies of a contrast
    threshold is two answers to "is this readable", and the copy in a function is
    the one that drifts from the one the database enforces.

    A failure surfaces as `23514`, which the route turns into a sentence about
    the colour being too pale rather than the word "constraint".
  */
  INSERT INTO public.school_branding
    (school_id, anchor_color, primary_color, updated_by, updated_at)
  VALUES (v_school, v_anchor, v_primary, v_user, NOW())
  ON CONFLICT (school_id) DO UPDATE
  SET anchor_color  = EXCLUDED.anchor_color,
      primary_color = EXCLUDED.primary_color,
      updated_by    = EXCLUDED.updated_by,
      updated_at    = NOW();

  RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.set_school_branding_colours(TEXT, TEXT) IS
  'CUSTOMISATION.md step 2. The columns and their WCAG contrast CHECKs existed since 0092 with no way to set them. Leaves contrast enforcement to the table (0259).';

REVOKE ALL ON FUNCTION public.set_school_branding_colours(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_school_branding_colours(TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_school_branding_colours(TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Exercise it, including the contrast refusal that is the point of the columns.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school UUID;
  v_org    TEXT;
  v_got    TEXT;
BEGIN
  BEGIN
    SELECT id, clerk_org_id INTO v_school, v_org FROM public.schools
    WHERE status = 'active' AND clerk_org_id IS NOT NULL LIMIT 1;

    IF v_school IS NULL THEN
      RAISE NOTICE '0259: no school fixture; skipping';
      RAISE EXCEPTION 'ZSMS_0259_ROLLBACK';
    END IF;

    -- A teacher must not restyle every document the school sends out.
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_teacher', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'teacher'))::text, TRUE);
    BEGIN
      PERFORM public.set_school_branding_colours('#1D4ED8', '#1D4ED8');
      RAISE EXCEPTION '0259: a teacher changed the school colours';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_principal', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'principal'))::text, TRUE);

    -- A dark blue has ample contrast on the light surface and must be accepted.
    IF NOT public.set_school_branding_colours('#1D4ED8', '#1D4ED8') THEN
      RAISE EXCEPTION '0259: a valid colour was not saved';
    END IF;

    SELECT anchor_color INTO v_got
    FROM public.school_branding WHERE school_id = v_school;
    IF v_got <> '#1D4ED8' THEN
      RAISE EXCEPTION '0259: the colour did not persist, got %', COALESCE(v_got, 'NULL');
    END IF;

    /*
      A pale yellow must be REFUSED. This is the assertion that matters: the
      columns exist to stop a school rendering a report card nobody can read, and
      a setter that bypassed the CHECK would make that guarantee decorative.
    */
    BEGIN
      PERFORM public.set_school_branding_colours('#FFFFAA', '#FFFFAA');
      RAISE EXCEPTION '0259: an unreadable colour was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- And clearing must work, returning the documents to the default palette.
    PERFORM public.set_school_branding_colours('', '');
    SELECT anchor_color INTO v_got
    FROM public.school_branding WHERE school_id = v_school;
    IF v_got IS NOT NULL THEN
      RAISE EXCEPTION '0259: colours could not be cleared';
    END IF;

    IF has_function_privilege('anon',
         'public.set_school_branding_colours(TEXT, TEXT)', 'EXECUTE') THEN
      RAISE EXCEPTION '0259: anon can restyle a school''s documents';
    END IF;

    RAISE EXCEPTION 'ZSMS_0259_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0259_ROLLBACK' THEN
        RAISE NOTICE '0259: verified — teacher refused, valid colour saved, unreadable colour refused, clearing works';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
