-- ---------------------------------------------------------------------------
-- 0189 — a human may sign off a checklist item, with a reason
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
--
-- ## What `0188` got wrong
--
-- `0188` made ten items derive themselves from live data and REFUSED to let anyone mark
-- those by hand, on the grounds that a tick which disagrees with the database is a lie.
-- That reasoning holds for a plain tick and fails for the business:
--
--   * AfriTech is sometimes paid to do a school's setup. The operator who has just done
--     it needs to record that, and may be working from a spreadsheet the school emailed.
--   * A school may genuinely not need an item — it already runs fees in an accounting
--     package, so a ZSMS fee structure is not coming and the checklist should not
--     pretend the school is unfinished for ever.
--   * Some work is not data at all: training delivered, records migrated, parents told.
--
-- ## An override, not a tick
--
-- The derivation keeps running. An override sits BESIDE it and carries who, when and
-- **why**, and the screen shows both — "the data says no; Mary signed it off on 4 Oct
-- because the school uses Sage". Nobody is misled, and the checklist can reach done.
--
-- A reason is mandatory. Without one this is a checkbox somebody clicks to clear a
-- warning, which is the thing `0188` was right to refuse.
--
-- ## Who may sign off
--
-- AfriTech **and the school's own management**, which is the other half of the
-- correction. `0188` let only AfriTech touch the list. A head teacher who has done the
-- work should be able to say so without telephoning their vendor.
-- ---------------------------------------------------------------------------

ALTER TABLE public.onboarding_checklists
  ADD COLUMN IF NOT EXISTS overridden            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS override_reason       TEXT,
  ADD COLUMN IF NOT EXISTS overridden_by         TEXT,
  ADD COLUMN IF NOT EXISTS overridden_at         TIMESTAMPTZ,
  -- Which side signed it off. A school marking its own work done and AfriTech recording
  -- work it was paid for are different claims, and an auditor reads them differently.
  ADD COLUMN IF NOT EXISTS overridden_by_role    TEXT;

COMMENT ON COLUMN public.onboarding_checklists.overridden IS
  'A human has signed this off regardless of what the data shows. `is_complete` stays '
  'the derived answer, so both remain visible.';

DO $$
BEGIN
  -- A reason is the whole point; an override without one is a checkbox.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_override_needs_reason'
  ) THEN
    ALTER TABLE public.onboarding_checklists
      ADD CONSTRAINT onboarding_override_needs_reason
      CHECK (NOT overridden OR btrim(COALESCE(override_reason, '')) <> '');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'onboarding_override_role_known'
  ) THEN
    ALTER TABLE public.onboarding_checklists
      ADD CONSTRAINT onboarding_override_role_known
      CHECK (overridden_by_role IS NULL OR overridden_by_role IN ('afritech', 'school'));
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Sign an item off, or withdraw the sign-off.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_onboarding_override(
  p_school_id UUID,
  p_item_key  TEXT,
  p_override  BOOLEAN,
  p_reason    TEXT DEFAULT NULL
)
RETURNS TABLE (out_done BOOLEAN, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user   TEXT := public.get_user_id();
  v_school UUID;
  v_role   TEXT;
  v_rows   INT;
BEGIN
  /*
    Who is asking, and about which school.

    AfriTech may name any school. Anybody else is resolved from their own session and
    the argument is ignored — taking an id on trust inside a DEFINER function is how one
    school signs off another's onboarding.
  */
  IF public.is_afritech_admin() THEN
    v_role := 'afritech';
    v_school := COALESCE(p_school_id, public.current_school_uuid());
  ELSE
    v_role := 'school';
    v_school := public.current_school_uuid();

    -- The people who can actually do the work. A teacher signing off "fee structure"
    -- is not a judgement the product should accept.
    -- `get_user_role()` returns the PREFIXED form (`org:owner`), which is what every
    -- other policy in this schema compares against. Verified before writing, not assumed.
    IF public.get_user_role() NOT IN ('org:owner', 'org:principal', 'org:admin') THEN
      RAISE EXCEPTION 'Only the school owner, principal or administrator may sign off setup'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_school IS NULL THEN
    RAISE EXCEPTION 'No school in scope' USING ERRCODE = '42501';
  END IF;

  IF p_override AND btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'Say why this is being signed off' USING ERRCODE = '22023';
  END IF;

  UPDATE public.onboarding_checklists c
     SET overridden         = p_override,
         override_reason    = CASE WHEN p_override THEN btrim(p_reason) END,
         overridden_by      = CASE WHEN p_override THEN v_user END,
         overridden_at      = CASE WHEN p_override THEN NOW() END,
         overridden_by_role = CASE WHEN p_override THEN v_role END,
         updated_at         = NOW()
   WHERE c.school_id = v_school
     AND c.item_key = p_item_key;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    -- The catalogue grows, and a school seeded before an item existed has no row for
    -- it. Create it rather than refusing: the alternative is an operator who cannot
    -- sign off an item they can see on screen.
    INSERT INTO public.onboarding_checklists
      (school_id, item_key, overridden, override_reason, overridden_by, overridden_at,
       overridden_by_role)
    SELECT v_school, cat.item_key, p_override,
           CASE WHEN p_override THEN btrim(p_reason) END,
           CASE WHEN p_override THEN v_user END,
           CASE WHEN p_override THEN NOW() END,
           CASE WHEN p_override THEN v_role END
    FROM public.onboarding_checklist_catalogue AS cat
    WHERE cat.item_key = p_item_key AND cat.is_active
    ON CONFLICT (school_id, item_key) DO NOTHING;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RETURN QUERY SELECT FALSE, 'No such checklist item.'::TEXT;
      RETURN;
    END IF;
  END IF;

  PERFORM public.log_audit_event(
    CASE WHEN p_override THEN 'onboarding_signed_off' ELSE 'onboarding_signoff_withdrawn' END,
    'onboarding_checklists', NULL,
    jsonb_build_object('item', p_item_key, 'reason', btrim(p_reason), 'by_role', v_role),
    v_school
  );

  RETURN QUERY SELECT TRUE,
    CASE WHEN p_override THEN 'Signed off.' ELSE 'Sign-off withdrawn.' END::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- Progress now counts a signed-off item as done.
-- ---------------------------------------------------------------------------
-- Dropped first: `CREATE OR REPLACE` cannot change a function's return type, and this
-- adds five columns to it. Safe here because nothing holds a reference — PostgREST
-- resolves by name at call time.
DROP FUNCTION IF EXISTS public.my_onboarding_progress();

CREATE FUNCTION public.my_onboarding_progress()
RETURNS TABLE (
  out_item_key    TEXT,
  out_label       TEXT,
  out_description TEXT,
  out_category    TEXT,
  out_blocks      TEXT,
  out_complete    BOOLEAN,
  out_from_data   BOOLEAN,
  out_overridden  BOOLEAN,
  out_reason      TEXT,
  out_by_role     TEXT,
  out_at          TIMESTAMPTZ,
  out_derived     BOOLEAN,
  out_sort_order  INT
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

  PERFORM public.refresh_onboarding_checklist(v_school);

  RETURN QUERY
  SELECT
    cat.item_key,
    cat.label,
    cat.description,
    cat.category,
    cat.blocks,
    -- Done is either answer. The two are reported separately below so a reader can see
    -- which it was.
    COALESCE(c.is_complete, FALSE) OR COALESCE(c.overridden, FALSE),
    COALESCE(c.is_complete, FALSE),
    COALESCE(c.overridden, FALSE),
    c.override_reason,
    c.overridden_by_role,
    c.overridden_at,
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
    'public.set_onboarding_override(UUID, TEXT, BOOLEAN, TEXT)',
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
-- Prove the constraint bites.
--
-- The property worth asserting is not that the column exists but that an override
-- WITHOUT a reason is rejected — that is the whole difference between a sign-off and a
-- checkbox somebody clicked to clear a warning.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_school UUID;
BEGIN
  SELECT school_id INTO v_school FROM public.onboarding_checklists LIMIT 1;
  IF v_school IS NULL THEN
    RAISE NOTICE 'no checklist rows to verify against — skipping';
    RETURN;
  END IF;

  BEGIN
    UPDATE public.onboarding_checklists
       SET overridden = TRUE, override_reason = NULL
     WHERE school_id = v_school;
    RAISE EXCEPTION 'an override with no reason was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'verified: an override without a reason is rejected';
  END;
END;
$$;
