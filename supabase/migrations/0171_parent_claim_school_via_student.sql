-- ---------------------------------------------------------------------------
-- 0171 — the school of a parent link comes from the student, not the link
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/07 Students and Parents/PARENTS.md`
--
-- ## What 0170 got wrong
--
-- `request_parent_link_by_phone()` joined `student_parent_links` and read
-- `spl.school_id`. **That column does not exist.** `student_parent_links` carries
-- `student_id`, `parent_id`, `parent_user_id`, the relationship and the grace
-- period — and deliberately no school, because the school is a property of the
-- STUDENT and duplicating it would be a second place for it to be wrong.
--
-- Caught by exercising the function. `CREATE FUNCTION` accepted it because a
-- PL/pgSQL body is parsed lazily, so the function was broken from the moment it
-- applied and would have raised `42703` the first time a parent entered a phone
-- number.
--
-- This is the second time in this sequence — `0160` invented
-- `schools.school_code` and `schools.deleted_at`. The pattern is the same both
-- times: a column name assumed from what the table ought to hold rather than read
-- from what it does. The habit that catches it is already in place; what this
-- migration adds is the reminder that the habit is not optional.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_parent_link_by_phone(p_phone TEXT)
RETURNS TABLE (out_submitted BOOLEAN, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   TEXT := public.get_user_id();
  v_email  TEXT := public.get_user_email();
  v_digits TEXT;
  r        RECORD;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;

  -- Digits only: a school may have typed 0977123456, +260977123456 or
  -- 260977 123456 for one handset, and refusing a parent over punctuation would
  -- be a support call about spaces.
  v_digits := regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g');
  -- The last nine are Zambia's national significant number, which makes the
  -- country prefix optional on both sides of the comparison.
  v_digits := right(v_digits, 9);

  IF length(v_digits) < 9 THEN
    RETURN QUERY SELECT FALSE, 'That does not look like a phone number.'::TEXT;
    RETURN;
  END IF;

  FOR r IN
    SELECT DISTINCT p.id AS parent_id, st.school_id
    FROM public.parents AS p
    JOIN public.student_parent_links AS spl ON spl.parent_id = p.id
    -- The school lives on the STUDENT. `student_parent_links` has no school_id,
    -- which is what 0170 assumed it did.
    JOIN public.students AS st ON st.id = spl.student_id
    WHERE right(regexp_replace(COALESCE(p.phone_e164, ''), '\D', '', 'g'), 9) = v_digits
      AND p.clerk_user_id IS NULL
      AND spl.is_active
      AND st.deleted_at IS NULL
  LOOP
    INSERT INTO public.parent_link_claims
      (parent_id, school_id, claimant_user_id, claimant_email, matched_on)
    VALUES (r.parent_id, r.school_id, v_user, v_email, 'phone')
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- The same answer whether or not the number matched. Saying "no record of that
  -- number" would make this a check for whether a given phone belongs to a ZSMS
  -- parent — a lookup that reveals something about a family to anybody who can
  -- sign up. Same reasoning as 0160's school codes, on a more sensitive identifier.
  RETURN QUERY SELECT
    TRUE,
    'If that number is on a school''s records, your request has been sent to them.'::TEXT;
END;
$$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.request_parent_link_by_phone(TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'request_parent_link_by_phone is executable by anon';
  END IF;
  IF NOT has_function_privilege(
       'authenticated', 'public.request_parent_link_by_phone(TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute request_parent_link_by_phone';
  END IF;
END;
$$;
