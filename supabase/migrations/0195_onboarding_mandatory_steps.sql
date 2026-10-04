-- ---------------------------------------------------------------------------
-- 0195 — which setup steps a school cannot skip
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/15 Super Admin and Platform/ONBOARDING.md`
--       `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md`
--
-- The checklist told a school what was outstanding and let it skip everything equally.
-- Four of the fourteen are not optional in any useful sense:
--
--   grade levels · term dates · grading scale · subjects
--
-- Every other thing ZSMS does is recorded against one of them. Without grade levels
-- there is nothing to enrol a pupil into; without term dates nothing knows which term
-- today falls in; without a grading scale a mark cannot become a grade; without
-- subjects there is nothing to teach or examine. A school that skipped all four would
-- reach "ready" and then be unable to mark a register.
--
-- So they are marked mandatory, and the setup flow will not let them be skipped. The
-- rest keep "Skip for now" — a school enrolling its first pupil in January should not
-- be nagged in November about a logo.
--
-- ## Why a column rather than a list in the application
--
-- The catalogue already lives in the database and AfriTech edits it. A hardcoded set of
-- four keys in a React component is a second source of truth that drifts the first time
-- somebody adds a step, and `category` cannot carry it — `critical` already means "do
-- this soon" and applies to more than these four.
-- ---------------------------------------------------------------------------

ALTER TABLE afritech.onboarding_checklist_items
  ADD COLUMN IF NOT EXISTS is_mandatory BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN afritech.onboarding_checklist_items.is_mandatory IS
  'A step the setup flow will not let a school skip. Reserved for things the rest of '
  'ZSMS is recorded against — without them the product does not work, rather than '
  'merely being incomplete.';

UPDATE afritech.onboarding_checklist_items
   SET is_mandatory = TRUE
 WHERE item_key IN ('grade_structure', 'term_dates', 'grading_system', 'subjects');

-- ---------------------------------------------------------------------------
-- The view has to carry it, or no route can see it.
--
-- `supabase/config.toml` exposes `public` alone, so a column added to the `afritech`
-- table is invisible to PostgREST until the view selects it. That trap has cost this
-- project five separate sessions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.onboarding_checklist_catalogue
WITH (security_invoker = true) AS
SELECT
  item_key,
  label,
  description,
  category,
  weight,
  blocks,
  sort_order,
  is_active,
  is_mandatory
FROM afritech.onboarding_checklist_items;

GRANT SELECT ON public.onboarding_checklist_catalogue TO authenticated;

-- ---------------------------------------------------------------------------
-- Report it alongside everything else a school needs to render its checklist.
-- ---------------------------------------------------------------------------
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
  out_mandatory   BOOLEAN,
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
    -- Done by either route. The two are reported separately below so a reader can see
    -- which it was.
    COALESCE(c.is_complete, FALSE) OR COALESCE(c.overridden, FALSE),
    COALESCE(c.is_complete, FALSE),
    COALESCE(c.overridden, FALSE),
    c.override_reason,
    c.overridden_by_role,
    c.overridden_at,
    cat.item_key NOT IN ('whatsapp_configured', 'payment_gateway',
                         'document_templates', 'custom_roles'),
    cat.is_mandatory,
    cat.sort_order
  FROM public.onboarding_checklist_catalogue AS cat
  LEFT JOIN public.onboarding_checklists AS c
    ON c.item_key = cat.item_key AND c.school_id = v_school
  WHERE cat.is_active
  -- Mandatory first within a category, so the setup flow walks them in the order that
  -- matters rather than alphabetically.
  ORDER BY cat.is_mandatory DESC, cat.sort_order;
END;
$$;

REVOKE ALL ON FUNCTION public.my_onboarding_progress() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_onboarding_progress() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_onboarding_progress() TO authenticated;

-- ---------------------------------------------------------------------------
-- Prove the column reaches `public`, which is the half that silently fails.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n INT;
BEGIN
  SELECT COUNT(*) INTO v_n
  FROM public.onboarding_checklist_catalogue WHERE is_mandatory;

  IF v_n <> 4 THEN
    RAISE EXCEPTION 'expected 4 mandatory steps through the VIEW, found %', v_n;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'onboarding_checklist_catalogue'
      AND column_name = 'is_mandatory'
  ) THEN
    RAISE EXCEPTION 'is_mandatory is not exposed on the public view — no route can read it';
  END IF;

  RAISE NOTICE 'verified: 4 mandatory steps, readable through public';
END;
$$;
