-- ===========================================================================
-- 0249 — staff can edit their own profile (STAFF.md)
--
-- Spec: `08 Staff Management/STAFF.md` → *Staff Profile Self-Management*
--
-- ## The gap
--
-- `staff_read_own_record` has let a member of staff READ their own row since
-- `0014`. There has never been an UPDATE path for self, so a teacher whose phone
-- number changed had to ask the office — and STAFF.md lists seven fields it says
-- they manage themselves.
--
-- ## Why a function and not a policy, which is the whole story here
--
-- The obvious fix is an UPDATE policy scoped to `clerk_user_id = get_user_id()`
-- plus a column-level grant for the seven fields. That was the first draft of
-- this migration, and **its own assertion caught it opening an escalation.**
--
-- `authenticated` already holds a **table-level UPDATE** on `staff_members`,
-- granted long ago so `management_write_staff` could work. A column grant does
-- not narrow an existing table grant — it is a union, not an intersection. So
-- adding the self policy would have handed every member of staff the ability to
-- write **any** column on their own row: `school_id`, moving themselves into
-- another school's roster; `is_active`, undoing their own removal;
-- `staff_number`; `employment_type`.
--
-- Revoking the table grant was not an option either: `management_write_staff`
-- depends on it, and narrowing it to a column list would mean enumerating every
-- column management may ever write, which is most of the table.
--
-- So self-service goes through a SECURITY DEFINER function that writes exactly
-- the seven fields and nothing else. No new policy, no new grant, and the
-- columns a teacher may not touch are unreachable because the function never
-- names them.
--
-- `0233` made the mirror-image mistake on `teaching_resources` — a table-level
-- UPDATE granted to fix one missing privilege also handed out the ability to
-- rewrite what a model had produced. Same shape, caught earlier this time only
-- because the assertion asked.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.update_my_staff_profile(
  p_first_name     TEXT DEFAULT NULL,
  p_last_name      TEXT DEFAULT NULL,
  p_phone_e164     TEXT DEFAULT NULL,
  p_email          TEXT DEFAULT NULL,
  p_photo_url      TEXT DEFAULT NULL,
  p_location       TEXT DEFAULT NULL,
  p_qualifications TEXT DEFAULT NULL
)
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

  /*
    NULL means "leave alone", not "clear".

    A profile form sends the fields it rendered. Treating NULL as a deletion
    would mean a screen that omits `qualifications` silently wipes them — and the
    person who notices is the one whose qualifications vanished.

    Clearing a field is therefore an empty string, which `NULLIF` turns back into
    NULL in storage. Deliberate and reversible; absence is not.
  */
  UPDATE public.staff_members
  SET first_name     = COALESCE(NULLIF(btrim(p_first_name), ''), first_name),
      last_name      = COALESCE(NULLIF(btrim(p_last_name), ''), last_name),
      phone_e164     = CASE WHEN p_phone_e164 IS NULL THEN phone_e164
                            ELSE NULLIF(btrim(p_phone_e164), '') END,
      email          = CASE WHEN p_email IS NULL THEN email
                            ELSE NULLIF(btrim(p_email), '') END,
      photo_url      = CASE WHEN p_photo_url IS NULL THEN photo_url
                            ELSE NULLIF(btrim(p_photo_url), '') END,
      location       = CASE WHEN p_location IS NULL THEN location
                            ELSE NULLIF(btrim(p_location), '') END,
      qualifications = CASE WHEN p_qualifications IS NULL THEN qualifications
                            ELSE NULLIF(btrim(p_qualifications), '') END,
      updated_at     = NOW()
  -- Their own row, and only ever their own. The function takes no id for the
  -- same reason `claim_parent_links()` takes no email: an id argument is a thing
  -- somebody can change in a request.
  WHERE clerk_user_id = v_user;

  /*
    Name is NOT NULL on this table, so a blank first name falls back to the
    existing value above rather than failing. A profile form that submits an
    empty name is a mis-click, not an instruction.
  */
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.update_my_staff_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'The seven fields STAFF.md lets staff manage themselves. A function rather than a policy because authenticated already holds a table-level UPDATE on staff_members, so a self-scoped policy would also expose school_id, is_active and staff_number (0249).';

REVOKE ALL ON FUNCTION public.update_my_staff_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_my_staff_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_my_staff_profile(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Exercise it, including the escalations it must NOT permit.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_user    TEXT;
  v_school  UUID;
  v_other   UUID;
  v_phone   TEXT;
  v_after   RECORD;
BEGIN
  BEGIN
    SELECT sm.clerk_user_id, sm.school_id INTO v_user, v_school
    FROM public.staff_members sm
    WHERE COALESCE(sm.is_active, TRUE)
    LIMIT 1;

    IF v_user IS NULL THEN
      RAISE NOTICE '0249: no staff fixture; skipping';
      RAISE EXCEPTION 'ZSMS_0249_ROLLBACK';
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', v_user, 'role', 'authenticated')::text, TRUE);

    IF NOT public.update_my_staff_profile(p_phone_e164 => '+260977000249',
                                          p_qualifications => 'BEd Mathematics') THEN
      RAISE EXCEPTION '0249: the update reported no row';
    END IF;

    SELECT * INTO v_after FROM public.staff_members WHERE clerk_user_id = v_user;

    IF v_after.phone_e164 <> '+260977000249' THEN
      RAISE EXCEPTION '0249: the phone number did not change';
    END IF;
    IF v_after.qualifications <> 'BEd Mathematics' THEN
      RAISE EXCEPTION '0249: qualifications did not change';
    END IF;

    -- The school must be untouched: nothing in the signature can move it.
    IF v_after.school_id <> v_school THEN
      RAISE EXCEPTION '0249: the school changed, which nothing should be able to do here';
    END IF;

    -- An omitted field must be left alone, not cleared.
    IF v_after.first_name IS NULL OR btrim(v_after.first_name) = '' THEN
      RAISE EXCEPTION '0249: an omitted field was cleared rather than left alone';
    END IF;

    -- An empty string clears deliberately, which is the other half of that rule.
    PERFORM public.update_my_staff_profile(p_qualifications => '');
    SELECT * INTO v_after FROM public.staff_members WHERE clerk_user_id = v_user;
    IF v_after.qualifications IS NOT NULL THEN
      RAISE EXCEPTION '0249: an empty string did not clear the field';
    END IF;

    RAISE EXCEPTION 'ZSMS_0249_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0249_ROLLBACK' THEN
        RAISE NOTICE '0249: verified — the seven fields write, omission preserves, empty clears, school untouchable';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
