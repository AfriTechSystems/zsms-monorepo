-- ---------------------------------------------------------------------------
-- 0180 — the link table's real columns
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/07 Student and Parent Modules/PARENT_LINKING.md`
--
-- ## What 0179 got wrong
--
-- Two mistakes, both the same mistake:
--
--   * **`student_parent_links.updated_at` does not exist.** Almost every table in
--     this schema has one, so it was written without looking. The function raised
--     `42703` on its first call, meaning no guardian could be linked at all.
--   * **`unlinked_at` and `unlinked_by` DO exist, and 0179 ignored them.** The
--     table already models unlinking properly — who removed a guardian and when —
--     and the first version recorded neither, so the audit row was the only trace
--     and the table itself could not answer "who removed this parent".
--
-- The second is the worse one: inventing a column fails loudly on first call.
-- Ignoring a column that exists succeeds, and quietly produces a thinner record
-- than the schema was designed to hold.
--
-- This is the third invented column in this sequence — `schools.school_code`
-- (0160), `student_parent_links.school_id` (0170), and now `updated_at`. Each
-- time the shape was assumed from what the table ought to hold. The habit that
-- catches it is exercising the function; what would PREVENT it is reading
-- `information_schema.columns` for the table before writing a line against it,
-- which is cheaper than the migration it saves.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.link_parent_to_student(
  p_student_id   UUID,
  p_full_name    TEXT,
  p_phone        TEXT,
  p_relationship TEXT    DEFAULT 'guardian',
  p_email        TEXT    DEFAULT NULL,
  p_is_primary   BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  out_link_id    UUID,
  out_parent_id  UUID,
  out_created    BOOLEAN,
  out_message    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school  UUID := public.current_school_uuid();
  v_user    TEXT := public.get_user_id();
  v_digits  TEXT;
  v_parent  UUID;
  v_created BOOLEAN := FALSE;
  v_link    UUID;
BEGIN
  IF v_school IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Only a signed-in school may link a guardian' USING ERRCODE = '42501';
  END IF;

  -- The pupil must be this school's. A DEFINER function without this clause would
  -- let one school attach a guardian to another school's pupil.
  IF NOT EXISTS (
    SELECT 1 FROM public.students AS s
    WHERE s.id = p_student_id AND s.school_id = v_school AND s.is_deleted = FALSE
  ) THEN
    RAISE EXCEPTION 'That pupil is not at this school' USING ERRCODE = '42501';
  END IF;

  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'A guardian needs a name' USING ERRCODE = '22023';
  END IF;

  IF p_relationship NOT IN
     ('mother', 'father', 'guardian', 'grandparent', 'sibling', 'uncle', 'aunt', 'other') THEN
    RAISE EXCEPTION 'Unknown relationship: %', p_relationship USING ERRCODE = '22023';
  END IF;

  -- Last nine digits: Zambia's national significant number, so the country prefix
  -- and any spacing are irrelevant to whether this is the same person.
  v_digits := right(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), 9);

  IF length(v_digits) < 9 THEN
    RAISE EXCEPTION 'A valid phone number is required to identify a guardian'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.id INTO v_parent
  FROM public.parents AS p
  WHERE right(regexp_replace(COALESCE(p.phone_e164, ''), '\D', '', 'g'), 9) = v_digits
  LIMIT 1;

  IF v_parent IS NULL THEN
    INSERT INTO public.parents (full_name, phone_e164, email)
    VALUES (
      btrim(p_full_name),
      btrim(p_phone),
      NULLIF(lower(btrim(COALESCE(p_email, ''))), '')
    )
    RETURNING id INTO v_parent;
    v_created := TRUE;
  ELSIF p_email IS NOT NULL AND btrim(p_email) <> '' THEN
    -- Fill in an address the school has just been given, never overwrite one: the
    -- recorded email is what `claim_parent_links()` (0170) matches a signing-up
    -- parent against, so replacing it would silently break a working link.
    -- `parents` DOES have `updated_at`, unlike the link table.
    UPDATE public.parents AS p
       SET email = lower(btrim(p_email)), updated_at = NOW()
     WHERE p.id = v_parent AND (p.email IS NULL OR btrim(p.email) = '');
  END IF;

  SELECT spl.id INTO v_link
  FROM public.student_parent_links AS spl
  WHERE spl.student_id = p_student_id AND spl.parent_id = v_parent;

  IF v_link IS NOT NULL THEN
    -- Restoring a previously removed guardian: clear the unlink record too, or the
    -- row would read as both active and unlinked.
    UPDATE public.student_parent_links AS spl
       SET is_active = TRUE,
           grace_period_ends_at = NULL,
           unlinked_at = NULL,
           unlinked_by = NULL,
           relationship = p_relationship
     WHERE spl.id = v_link;
  ELSE
    INSERT INTO public.student_parent_links
      (student_id, parent_id, relationship, is_active, linked_by)
    VALUES (p_student_id, v_parent, p_relationship, TRUE, v_user)
    RETURNING id INTO v_link;
  END IF;

  /*
    Primary last, and as a demotion followed by a promotion. `idx_spl_primary`
    admits one primary per pupil, so setting this one without clearing the other
    raises a unique violation — and the school's intent when they tick the box is
    "this person instead", not "fail".
  */
  IF p_is_primary THEN
    UPDATE public.student_parent_links AS spl
       SET is_primary = FALSE
     WHERE spl.student_id = p_student_id AND spl.id <> v_link AND spl.is_primary;

    UPDATE public.student_parent_links AS spl
       SET is_primary = TRUE
     WHERE spl.id = v_link;
  END IF;

  PERFORM public.log_audit_event(
    'parent_linked', 'student_parent_links', v_link,
    jsonb_build_object(
      'student_id', p_student_id,
      'relationship', p_relationship,
      'is_primary', p_is_primary,
      'parent_created', v_created
    ),
    v_school
  );

  RETURN QUERY SELECT
    v_link,
    v_parent,
    v_created,
    CASE WHEN v_created
      THEN 'Guardian added and linked.'
      ELSE 'Existing guardian linked to this pupil.'
    END::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_parent_from_student(p_link_id UUID)
RETURNS TABLE (out_unlinked BOOLEAN, out_access_until TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_until  TIMESTAMPTZ := NOW() + INTERVAL '30 days';
  v_rows   INT;
BEGIN
  IF v_school IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Only a signed-in school may unlink a guardian' USING ERRCODE = '42501';
  END IF;

  UPDATE public.student_parent_links AS spl
     SET is_active = FALSE,
         -- `is_linked_parent_of()` (0016) honours this window, so a parent removed
         -- mid-term can still fetch a receipt for fees they paid.
         grace_period_ends_at = v_until,
         -- The columns the table already had for this, which 0179 ignored — so the
         -- record of who removed a guardian lives in the row, not only in the audit log.
         unlinked_at = NOW(),
         unlinked_by = v_user,
         -- A pupil must not keep a primary contact who no longer has access.
         is_primary = FALSE
   WHERE spl.id = p_link_id
     AND spl.is_active
     AND EXISTS (
       SELECT 1 FROM public.students AS s
       WHERE s.id = spl.student_id AND s.school_id = v_school
     );

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  PERFORM public.log_audit_event(
    'parent_unlinked', 'student_parent_links', p_link_id,
    jsonb_build_object('access_until', v_until), v_school
  );

  RETURN QUERY SELECT TRUE, v_until;
END;
$$;

-- ---------------------------------------------------------------------------
-- Assert these functions reference no column the table lacks.
--
-- The check that would have caught 0179 before it applied: every identifier the
-- bodies assign to on `student_parent_links` must be a real column. A PL/pgSQL
-- body is parsed lazily, so `CREATE FUNCTION` will never do this for us.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_def     TEXT;
  v_col     TEXT;
  v_missing TEXT[] := '{}';
BEGIN
  SELECT string_agg(pg_get_functiondef(p.oid), E'\n') INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('link_parent_to_student', 'unlink_parent_from_student');

  FOREACH v_col IN ARRAY ARRAY[
    'is_active', 'is_primary', 'grace_period_ends_at', 'unlinked_at', 'unlinked_by',
    'relationship', 'linked_by', 'student_id', 'parent_id'
  ]
  LOOP
    IF v_def ILIKE '%' || v_col || '%'
       AND NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'student_parent_links'
           AND column_name = v_col
       )
    THEN
      v_missing := v_missing || v_col;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'these columns do not exist on student_parent_links: %',
      array_to_string(v_missing, ', ');
  END IF;

  -- And the one that actually broke 0179.
  IF v_def ILIKE '%spl.updated_at%' OR v_def ILIKE '%SET is_primary = FALSE, updated_at%' THEN
    RAISE EXCEPTION 'a function still writes student_parent_links.updated_at, which does not exist';
  END IF;
END;
$$;
