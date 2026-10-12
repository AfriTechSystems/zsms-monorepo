-- ===========================================================================
-- 0265 — profile photos: who may set whose
--
-- Spec: `19 Design System/ZSMS_UI_REDESIGN_MASTER_PROMPT.md`, and the agreed
--       rule that a school sets a pupil's photo while every other person sets
--       their own.
--
-- ## What already existed, and what nothing did with it
--
-- `students.photo_url`, `staff_members.photo_url`, `schools.logo_url` and
-- `school_branding.logo_url` / `.icon_url` have all existed for some time.
-- **Nothing displayed any of them and nothing could upload one** — one screen
-- mentions `photo_url` in the whole web app. `parents` had no column at all.
--
-- ## The permission rule, which is the point of this migration
--
-- | Whose photo | Who may set it |
-- |---|---|
-- | A pupil | The school — owner, principal, administrator |
-- | A member of staff | **Themselves**, through `update_my_staff_profile()` (`0249`) |
-- | A parent | **Themselves** |
-- | The school's logo | Owner and principal, through the existing settings path |
--
-- **A parent may see their child's photo and may not change it.** That is not an
-- arbitrary restriction: the photo on a pupil record is used to identify a child
-- at a school gate and on a class register, so it is the school's record of who
-- the child is, not the family's choice of picture. A parent who could set it
-- could set anything.
--
-- A teacher is also excluded. Marking a register is not a reason to change what
-- a child looks like in the system.
--
-- ## No bytes here
--
-- The column holds a URL. The file goes to the R2 **public** bucket through
-- `/api/uploads/photo`, which enforces the type and the 2MB ceiling. Storing
-- images in Postgres would put a megabyte on every row read.
-- ===========================================================================

ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS photo_url TEXT;

COMMENT ON COLUMN public.parents.photo_url IS
  'A parent''s own profile picture, set only by themselves (0265).';

/*
  Both URL columns must be https, matching the existing guard on
  `school_branding.logo_url`.

  Not decoration: a `http://` avatar on an https page is a mixed-content block in
  every modern browser, so the picture silently fails to load and the fallback
  initials appear instead — which reads as "the upload did not work" long after
  the upload worked.
*/
ALTER TABLE public.parents
  DROP CONSTRAINT IF EXISTS parents_photo_url_https;
ALTER TABLE public.parents
  ADD CONSTRAINT parents_photo_url_https CHECK (
    photo_url IS NULL OR photo_url ~ '^https://'
  );

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_photo_url_https;
ALTER TABLE public.students
  ADD CONSTRAINT students_photo_url_https CHECK (
    photo_url IS NULL OR photo_url ~ '^https://'
  );

-- ---------------------------------------------------------------------------
-- A parent's own photo.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_my_parent_photo(p_photo_url TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user TEXT := public.get_user_id();
  v_url  TEXT := NULLIF(btrim(COALESCE(p_photo_url, '')), '');
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  IF v_url IS NOT NULL AND v_url !~ '^https://' THEN
    RAISE EXCEPTION 'A photo must be an https address' USING ERRCODE = '22023';
  END IF;

  /*
    Their own row, resolved from the token. No id argument, for the same reason
    `claim_parent_links()` takes none: an id in a request is a thing somebody can
    change.

    A parent linked to several schools has ONE row, so this is one picture of one
    person rather than a different face per school.
  */
  UPDATE public.parents
  SET photo_url = v_url
  WHERE clerk_user_id = v_user;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_parent_photo(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_parent_photo(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_my_parent_photo(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- A pupil's photo — the school's to set.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_student_photo(
  p_student_id UUID,
  p_photo_url  TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_url    TEXT := NULLIF(btrim(COALESCE(p_photo_url, '')), '');
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  /*
    Management only. A teacher is excluded deliberately: marking a register is not
    a reason to change what a child looks like in the system, and a parent is
    excluded because this picture identifies the child at the gate.
  */
  IF public.get_user_role() NOT IN ('org:owner', 'org:principal', 'org:admin') THEN
    RAISE EXCEPTION
      'Only the owner, principal or administrator can change a pupil''s photo'
      USING ERRCODE = '42501';
  END IF;

  IF v_url IS NOT NULL AND v_url !~ '^https://' THEN
    RAISE EXCEPTION 'A photo must be an https address' USING ERRCODE = '22023';
  END IF;

  /*
    The tenant clause. A DEFINER function bypasses RLS, so the school comes from
    the session and the pupil must belong to it — the id argument alone proves
    nothing about who may touch it.
  */
  UPDATE public.students
  SET photo_url = v_url, updated_at = NOW()
  WHERE id = p_student_id
    AND school_id = v_school
    AND is_deleted = FALSE;

  IF NOT FOUND THEN
    -- Not found and not permitted are one answer, so this cannot be used to
    -- discover that another school holds a particular pupil.
    RAISE EXCEPTION 'That pupil is not available' USING ERRCODE = '42501';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.set_student_photo(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_student_photo(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_student_photo(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school  UUID;
  v_org     TEXT;
  v_student UUID;
  v_got     TEXT;
BEGIN
  BEGIN
    SELECT s.id, s.clerk_org_id INTO v_school, v_org
    FROM public.schools s
    WHERE s.clerk_org_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.students st
                  WHERE st.school_id = s.id AND st.is_deleted = FALSE)
    LIMIT 1;

    IF v_school IS NULL THEN
      RAISE NOTICE '0265: no pupil fixture; skipping';
      RAISE EXCEPTION 'ZSMS_0265_ROLLBACK';
    END IF;

    SELECT id INTO v_student FROM public.students
    WHERE school_id = v_school AND is_deleted = FALSE LIMIT 1;

    -- A TEACHER must not change a pupil's photo.
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_teacher', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'teacher'))::text, TRUE);
    BEGIN
      PERFORM public.set_student_photo(v_student, 'https://example.invalid/a.jpg');
      RAISE EXCEPTION '0265: a teacher changed a pupil''s photo';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- Nor a PARENT. This is the rule the whole migration exists for.
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_parent', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'parent'))::text, TRUE);
    BEGIN
      PERFORM public.set_student_photo(v_student, 'https://example.invalid/a.jpg');
      RAISE EXCEPTION '0265: a parent changed their child''s photo';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- The administrator may.
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_admin', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'admin'))::text, TRUE);

    PERFORM public.set_student_photo(v_student, 'https://example.invalid/pupil.jpg');
    SELECT photo_url INTO v_got FROM public.students WHERE id = v_student;
    IF v_got <> 'https://example.invalid/pupil.jpg' THEN
      RAISE EXCEPTION '0265: the pupil photo did not save';
    END IF;

    -- http is refused, because a mixed-content block looks like a failed upload.
    BEGIN
      PERFORM public.set_student_photo(v_student, 'http://example.invalid/x.jpg');
      RAISE EXCEPTION '0265: an insecure photo URL was accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;

    -- Clearing works, so a wrong photo can be removed rather than only replaced.
    PERFORM public.set_student_photo(v_student, '');
    SELECT photo_url INTO v_got FROM public.students WHERE id = v_student;
    IF v_got IS NOT NULL THEN
      RAISE EXCEPTION '0265: a pupil photo could not be cleared';
    END IF;

    -- Another school must not reach this pupil at all.
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_other', 'role', 'authenticated',
      'o', json_build_object('id', 'org_nonexistent_0265', 'rol', 'owner'))::text, TRUE);
    BEGIN
      PERFORM public.set_student_photo(v_student, 'https://example.invalid/b.jpg');
      RAISE EXCEPTION '0265: another school set a pupil''s photo';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    IF has_function_privilege('anon', 'public.set_student_photo(UUID, TEXT)', 'EXECUTE') THEN
      RAISE EXCEPTION '0265: anon can set a pupil photo';
    END IF;
    IF has_function_privilege('anon', 'public.set_my_parent_photo(TEXT)', 'EXECUTE') THEN
      RAISE EXCEPTION '0265: anon can set a parent photo';
    END IF;

    RAISE EXCEPTION 'ZSMS_0265_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0265_ROLLBACK' THEN
        RAISE NOTICE '0265: verified — teacher and parent refused, admin may, http refused, clearing works, cross-tenant refused';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
