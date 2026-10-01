-- ---------------------------------------------------------------------------
-- 0179 — linking a parent to a pupil
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/07 Student and Parent Modules/PARENT_LINKING.md`
--         → *Method 2 — Manual Linking by Admin*, *Primary Contact*,
--           *Grace Period After Unlinking*
--
-- ## The gap
--
-- `student_parent_links` has existed since `0013` and the pupil record now shows
-- the guardians on it. **Nothing could create one.** The only routes in were bulk
-- import (Method 1) and the self-registration path `0170` added (Method 3);
-- Method 2 — a school office linking a parent to a pupil in front of them, which
-- is how most links are actually made — had no implementation at all.
--
-- A pupil enrolled one at a time therefore had no contactable guardian, and the
-- card added to the pupil record said so without offering a way to fix it.
--
-- ## The primary-contact index the document specifies did not exist
--
-- `PARENT_LINKING.md` is explicit:
--
--     CREATE UNIQUE INDEX idx_spl_primary
--       ON public.student_parent_links(student_id)
--       WHERE is_primary = TRUE AND is_active = TRUE;
--
-- It was never created. That matters beyond tidiness: the primary contact
-- receives **all** automated notifications — fee reminders, absence alerts,
-- results — and two primaries means two people getting every message about one
-- child, or a notification worker picking arbitrarily between them.
--
-- Verified before adding: no pupil currently has two. So the index goes on
-- without a backfill, and from here the database refuses the second one.
--
-- ## Find-or-create by phone, and why phone rather than email
--
-- Method 2 searches by phone because that is what a Zambian school holds. Email
-- is optional on `parents` and frequently absent; a phone number is on the
-- enrolment form. Matching is on the last nine digits — the national significant
-- number — so `0977123456`, `+260977123456` and `260977 123456` are one parent
-- rather than three.
--
-- A parent found this way is REUSED rather than duplicated, which is what makes
-- one guardian with four children at the school a single account that sees all
-- four.
--
-- ## Unlinking keeps access for 30 days
--
-- Per the document: `is_active = FALSE` plus `grace_period_ends_at = NOW() + 30
-- days`, and `is_linked_parent_of()` (0016) already honours that window. A parent
-- removed mid-term can still download a receipt for fees they paid, which is the
-- reason the grace period exists rather than a hard cut.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. One primary contact per pupil.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_spl_primary
  ON public.student_parent_links(student_id)
  WHERE is_primary = TRUE AND is_active = TRUE;

COMMENT ON INDEX public.idx_spl_primary IS
  'One primary contact per pupil (PARENT_LINKING.md). The primary receives every '
  'automated notification, so two would double-send or make the worker choose arbitrarily.';

-- ---------------------------------------------------------------------------
-- 2. Link a parent, creating the account if the phone is new.
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

  -- Last nine digits: Zambia's national significant number, so the country
  -- prefix and any spacing are irrelevant to whether this is the same person.
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
    /*
      Fill in an email the school has just been given, but never overwrite one.

      The recorded address is what `claim_parent_links()` (0170) matches a signing-up
      parent against — so replacing it would silently break a link that already works,
      and the school office typing a second address for the same person is more likely
      than the first one being wrong.
    */
    UPDATE public.parents AS p
       SET email = lower(btrim(p_email)), updated_at = NOW()
     WHERE p.id = v_parent AND (p.email IS NULL OR btrim(p.email) = '');
  END IF;

  -- Already linked: make it idempotent rather than an error. Pressing the button
  -- twice is not a mistake worth refusing.
  SELECT spl.id INTO v_link
  FROM public.student_parent_links AS spl
  WHERE spl.student_id = p_student_id AND spl.parent_id = v_parent;

  IF v_link IS NOT NULL THEN
    UPDATE public.student_parent_links AS spl
       SET is_active = TRUE,
           grace_period_ends_at = NULL,
           relationship = p_relationship,
           updated_at = NOW()
     WHERE spl.id = v_link;
  ELSE
    INSERT INTO public.student_parent_links
      (student_id, parent_id, relationship, is_active, linked_by)
    VALUES (p_student_id, v_parent, p_relationship, TRUE, v_user)
    RETURNING id INTO v_link;
  END IF;

  /*
    Primary last, and as a demotion followed by a promotion.

    `idx_spl_primary` admits one primary per pupil, so setting this one without
    clearing the other would raise a unique violation — and the school's intent
    when they tick the box is plainly "this person instead", not "fail".
  */
  IF p_is_primary THEN
    UPDATE public.student_parent_links AS spl
       SET is_primary = FALSE, updated_at = NOW()
     WHERE spl.student_id = p_student_id AND spl.id <> v_link AND spl.is_primary;

    UPDATE public.student_parent_links AS spl
       SET is_primary = TRUE, updated_at = NOW()
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

-- ---------------------------------------------------------------------------
-- 3. Unlink, with the documented 30-day grace period.
-- ---------------------------------------------------------------------------
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
         -- `is_linked_parent_of()` (0016) already honours this window, so a parent
         -- removed mid-term can still fetch a receipt for fees they paid.
         grace_period_ends_at = v_until,
         -- A pupil must not be left with a primary contact who no longer has access.
         is_primary = FALSE,
         updated_at = NOW()
   WHERE spl.id = p_link_id
     AND spl.is_active
     -- Own school's pupil only; this is a DEFINER function.
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
-- Grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.link_parent_to_student(UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN)',
    'public.unlink_parent_from_student(UUID)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);

    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute %', v_fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated cannot execute %', v_fn;
    END IF;
  END LOOP;
END;
$$;
