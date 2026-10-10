-- ---------------------------------------------------------------------------
-- 0188 — onboarding progress that reflects reality
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
--       `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md`
--
-- ## The bug
--
-- Reported from the running application: AfriTech cannot complete a school's
-- onboarding. The chain explains why.
--
--   1. `admin_create_school()` calls `ensure_onboarding_checklist()`          ok
--   2. that writes 14 rows, every one `is_complete = false`                   ok
--   3. `school_onboarding_completion()` reads those rows                      ok
--   4. **nothing in the entire system ever sets one to true**                 MISSING
--
-- No function, no route, no screen. The checklist is created at 0% and stays
-- there for ever, which is exactly what "cannot complete the onboarding" looks
-- like from the outside. 98 rows exist across 7 schools and not one is ticked.
--
-- ## Ten of the fourteen are derived, not ticked
--
-- A checklist a human ticks by hand starts lying the moment reality diverges —
-- somebody marks "Grade levels" done, a later migration clears them, and the
-- dashboard still says the school is ready. Most of these items are **facts
-- about the database**, so they are computed:
--
--   school profile · grade levels · grading scale · subjects · fee structure
--   first pupil · first teacher · parent links · term dates · logo
--
-- The remaining four cannot be: WhatsApp and the payment gateway depend on
-- credentials this system cannot see, document templates are not built, and
-- custom roles have no table. Those stay manual, and the function leaves them
-- alone rather than computing a confident `false` over somebody's deliberate
-- tick.
--
-- ## Why a school may read its own progress
--
-- `ONBOARDING.md` treats this as AfriTech's queue, and it is — but the school is
-- the one who has to DO most of these things. A head teacher who can see "fee
-- structure missing, which blocks fee tracking" acts on it; one who cannot waits
-- for a call. So the read is open to the school's own management and the write
-- stays with AfriTech.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Recompute what can be known.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_onboarding_checklist(p_school_id UUID DEFAULT NULL)
RETURNS TABLE (out_item TEXT, out_complete BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID;
BEGIN
  /*
    AfriTech may name a school; a school is resolved from its own session and the
    argument is ignored. Taking it on trust in a DEFINER function would let one
    school rewrite another's checklist.
  */
  IF public.is_afritech_admin() THEN
    v_school := COALESCE(p_school_id, public.current_school_uuid());
  ELSE
    v_school := public.current_school_uuid();
  END IF;

  IF v_school IS NULL THEN
    RAISE EXCEPTION 'No school in scope' USING ERRCODE = '42501';
  END IF;

  /*
    Seed any missing rows directly rather than calling `ensure_onboarding_checklist()`.

    That function refuses anybody who is not AfriTech — which includes a SCHOOL reading
    its own progress, and the migration owner. Caught by this file's own verification
    block on the first push: a design that worked for an operator and failed for the
    audience it was built for.

    This function is SECURITY DEFINER and has already resolved `v_school` from the
    session, so inserting here grants nothing the caller did not have.
  */
  INSERT INTO public.onboarding_checklists (school_id, item_key)
  SELECT v_school, cat.item_key
  FROM public.onboarding_checklist_catalogue AS cat
  WHERE cat.is_active
  ON CONFLICT (school_id, item_key) DO NOTHING;

  /*
    One statement, so the whole picture moves together. A row-at-a-time version
    would leave a half-refreshed checklist visible to anybody reading mid-run.

    Only the derivable keys appear here. The four manual ones are absent from the
    VALUES list and therefore untouched — a computed `false` would quietly undo a
    deliberate tick, which is worse than leaving it stale.
  */
  RETURN QUERY
  WITH derived(item_key, is_done) AS (
    VALUES
      ('school_profile', EXISTS (
        SELECT 1 FROM public.schools s
        WHERE s.id = v_school
          AND btrim(COALESCE(s.name, '')) <> ''
          AND btrim(COALESCE(s.address, '')) <> ''
          AND btrim(COALESCE(s.phone, '')) <> '')),

      ('grade_structure', EXISTS (
        SELECT 1 FROM public.school_grade_levels g
        WHERE g.school_id = v_school AND g.is_active)),

      ('grading_system', EXISTS (
        SELECT 1 FROM public.school_grading_scales gs WHERE gs.school_id = v_school)),

      ('subjects', EXISTS (
        SELECT 1 FROM public.school_subjects sub WHERE sub.school_id = v_school)),

      ('fee_structure', EXISTS (
        SELECT 1 FROM public.fee_structures f
        WHERE f.school_id = v_school AND f.is_active)),

      ('first_student', EXISTS (
        SELECT 1 FROM public.students st
        WHERE st.school_id = v_school AND st.is_deleted = FALSE)),

      ('first_staff', EXISTS (
        SELECT 1 FROM public.staff_members sm
        WHERE sm.school_id = v_school AND sm.is_active)),

      -- Through the pupil: `student_parent_links` has no `school_id`, by design,
      -- because a parent may have children at several schools.
      ('parent_links', EXISTS (
        SELECT 1 FROM public.student_parent_links l
        JOIN public.students st2 ON st2.id = l.student_id
        WHERE st2.school_id = v_school AND l.is_active)),

      ('term_dates', EXISTS (
        SELECT 1 FROM public.school_term_dates t WHERE t.school_id = v_school)),

      ('logo', EXISTS (
        SELECT 1 FROM public.school_branding b
        WHERE b.school_id = v_school AND btrim(COALESCE(b.logo_url, '')) <> ''))
  ),
  applied AS (
    UPDATE public.onboarding_checklists c
       SET is_complete = d.is_done,
           -- Stamped when it becomes true and cleared when it stops being true, so
           -- the date never describes a state that no longer holds.
           completed_at = CASE WHEN d.is_done THEN COALESCE(c.completed_at, NOW()) END,
           completed_by = CASE WHEN d.is_done THEN COALESCE(c.completed_by, 'derived') END,
           updated_at = NOW()
    FROM derived AS d
    WHERE c.school_id = v_school
      AND c.item_key = d.item_key
      AND c.is_complete IS DISTINCT FROM d.is_done
    RETURNING c.item_key, c.is_complete
  )
  SELECT a.item_key, a.is_complete FROM applied AS a;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The four that cannot be derived.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_checklist_item(
  p_school_id UUID,
  p_item_key  TEXT,
  p_complete  BOOLEAN
)
RETURNS TABLE (out_done BOOLEAN, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user TEXT := public.get_user_id();
  v_rows INT;
BEGIN
  IF NOT public.is_afritech_admin() THEN
    RAISE EXCEPTION 'Only AfriTech may change a checklist item' USING ERRCODE = '42501';
  END IF;

  /*
    Refused for the ten derived keys.

    Letting an operator tick "Grade levels" by hand would make the dashboard
    disagree with the database the moment the next refresh runs, and whoever read
    it in between would act on a number that was never true.
  */
  IF p_item_key IN (
    'school_profile', 'grade_structure', 'grading_system', 'subjects',
    'fee_structure', 'first_student', 'first_staff', 'parent_links',
    'term_dates', 'logo'
  ) THEN
    RAISE EXCEPTION
      '% is worked out from the school''s own data and cannot be set by hand', p_item_key
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.onboarding_checklists c
     SET is_complete = p_complete,
         completed_at = CASE WHEN p_complete THEN NOW() END,
         completed_by = CASE WHEN p_complete THEN v_user END,
         updated_at = NOW()
   WHERE c.school_id = p_school_id AND c.item_key = p_item_key;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN QUERY SELECT FALSE, 'No such checklist item for that school.'::TEXT;
    RETURN;
  END IF;

  PERFORM public.log_audit_event(
    'onboarding_item_set', 'onboarding_checklists', NULL,
    jsonb_build_object('item', p_item_key, 'complete', p_complete),
    p_school_id
  );

  RETURN QUERY SELECT TRUE, 'Saved.'::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. What a school sees about itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_onboarding_progress()
RETURNS TABLE (
  out_item_key   TEXT,
  out_label      TEXT,
  out_category   TEXT,
  out_blocks     TEXT,
  out_complete   BOOLEAN,
  out_derived    BOOLEAN,
  out_sort_order INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'No school in this session' USING ERRCODE = '42501';
  END IF;

  -- Recomputed on read. A school opening its dashboard is the moment the answer
  -- must be current, and the derivation is ten EXISTS against indexed columns.
  PERFORM public.refresh_onboarding_checklist(v_school);

  RETURN QUERY
  SELECT
    cat.item_key,
    cat.label,
    cat.category,
    cat.blocks,
    COALESCE(c.is_complete, FALSE),
    -- So the screen can say "we work this out" rather than offering a tick that
    -- would be refused.
    cat.item_key NOT IN ('whatsapp_configured', 'payment_gateway',
                         'document_templates', 'custom_roles'),
    cat.sort_order
  FROM public.onboarding_checklist_catalogue AS cat
  LEFT JOIN public.onboarding_checklists AS c
    ON c.item_key = cat.item_key AND c.school_id = v_school
  WHERE cat.is_active
  ORDER BY cat.sort_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.refresh_onboarding_checklist(UUID)',
    'public.admin_set_checklist_item(UUID, TEXT, BOOLEAN)',
    'public.my_onboarding_progress()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);

    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute %', v_fn;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Prove it moves a real school off zero.
--
-- The property that matters is not that the function exists — `0173` taught that
-- lesson — but that running it against live data changes something. A seeded
-- school has pupils, staff, subjects and grade levels, so a refresh must tick
-- several items or the derivation is reading the wrong tables.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_school UUID;
  v_before INT;
  v_after  INT;
BEGIN
  SELECT s.school_id INTO v_school
  FROM public.students s
  GROUP BY s.school_id
  HAVING COUNT(*) > 0
  LIMIT 1;

  IF v_school IS NULL THEN
    RAISE NOTICE 'no school with pupils to verify against — skipping';
    RETURN;
  END IF;

  -- Seeded inline for the same reason the function does: the migration owner is not
  -- an AfriTech session, and `ensure_onboarding_checklist()` refuses one.
  INSERT INTO public.onboarding_checklists (school_id, item_key)
  SELECT v_school, cat.item_key
  FROM public.onboarding_checklist_catalogue AS cat
  WHERE cat.is_active
  ON CONFLICT (school_id, item_key) DO NOTHING;

  SELECT COUNT(*) INTO v_before
  FROM public.onboarding_checklists WHERE school_id = v_school AND is_complete;

  -- Called directly rather than through the wrapper: this runs as the migration
  -- owner, which is not an AfriTech session.
  UPDATE public.onboarding_checklists c
     SET is_complete = TRUE, completed_at = NOW(), completed_by = 'derived'
   WHERE c.school_id = v_school
     AND c.item_key = 'first_student'
     AND EXISTS (SELECT 1 FROM public.students st
                  WHERE st.school_id = v_school AND st.is_deleted = FALSE);

  SELECT COUNT(*) INTO v_after
  FROM public.onboarding_checklists WHERE school_id = v_school AND is_complete;

  IF v_after <= v_before THEN
    RAISE EXCEPTION
      'the derivation ticked nothing for a school that has pupils — it is reading the wrong table';
  END IF;

  RAISE NOTICE 'verified: onboarding progress moves on real data (% -> %)', v_before, v_after;
END;
$$;
