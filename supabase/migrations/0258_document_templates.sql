-- ===========================================================================
-- 0258 — document templates (TEMPLATE_SYSTEM.md, CUSTOMISATION.md)
--
-- Spec: `13 Document and PDF System/TEMPLATE_SYSTEM.md` → *Database Schema*,
--       *Template Levels in Detail*, *Term-Specific Principal Comment*
--       `13 Document and PDF System/CUSTOMISATION.md` → steps 3–6
--
-- ## What exists and what did not
--
-- `school_branding` (`0092`) covers CUSTOMISATION steps 1 and 2 — logo and
-- colours — and does it well: both colours carry a `wcag_contrast_ratio()` CHECK,
-- so a school physically cannot set a brand colour that fails contrast on a
-- report card a parent has to read.
--
-- **Steps 3 to 6 had nowhere to live.** `document_templates` is specified in
-- TEMPLATE_SYSTEM.md and had never been created, so a layout variant, the report
-- card's content choices, the principal's comment and the parent acknowledgement
-- section were all unrepresentable.
--
-- ## One row per document type, config in JSONB
--
-- Following the specified shape rather than inventing columns. The reason JSONB
-- is right here, where it would be wrong on a financial table: the set of
-- switches differs per document type and will grow — a report card has a
-- principal's comment and an acknowledgement slip, a receipt has neither — and
-- modelling that as columns means a migration every time a document gains an
-- option. Nothing in this config is ever summed, compared or joined on.
--
-- ## The principal's comment is per TERM, which is the subtle part
--
-- TEMPLATE_SYSTEM.md is specific: the comment is term-specific. A school writes
-- one paragraph that appears on every report card that term. Storing it as a
-- single field would mean last term's comment silently printing on this term's
-- cards — so it is keyed by academic year and term inside the config, and the
-- renderer asks for the term it is rendering.
--
-- ## Layout variants are tier-gated, and the gate is the resolver
--
-- CUSTOMISATION.md puts layout variants at "Growth tier and above". That check is
-- `public.school_has_feature()` and is made when the variant is SET, not when a
-- document renders. A school that downgrades keeps the row; the renderer falls
-- back because the feature resolves false. Blocking the render instead would mean
-- a downgrade silently stops report cards being produced at all.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.document_templates (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,

  /*
    Which document this configures. Constrained rather than free text, because a
    typo here produces a config nothing ever reads and no error anybody sees.
  */
  doc_type TEXT NOT NULL CHECK (
    doc_type IN ('report_card', 'receipt', 'transfer_letter', 'fee_statement')
  ),

  /*
    How far the school has customised. `branding` is logo and colours only —
    which `school_branding` already holds — and `layout` means they have chosen a
    variant beyond the default.
  */
  template_level TEXT NOT NULL DEFAULT 'branding' CHECK (
    template_level IN ('branding', 'layout', 'custom')
  ),

  layout_variant TEXT CHECK (
    layout_variant IS NULL
    OR layout_variant IN ('classic', 'modern', 'compact', 'detailed')
  ),

  template_config JSONB NOT NULL DEFAULT '{}'::JSONB,

  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  updated_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One active configuration per document type per school. A second would make
  -- "which template rendered this" unanswerable.
  CONSTRAINT one_template_per_doc_type UNIQUE (school_id, doc_type)
);

COMMENT ON TABLE public.document_templates IS
  'Per-school document configuration beyond logo and colours (TEMPLATE_SYSTEM.md). school_branding holds steps 1-2 of CUSTOMISATION.md; this holds 3-6. JSONB because the switches differ per document type and nothing in them is ever summed or joined (0258).';

COMMENT ON COLUMN public.document_templates.template_config IS
  'Report card: show_position, show_class_average, show_attendance, show_comments, acknowledgement_required, principal_comments keyed "YEAR-TERM" so last term''s comment cannot print on this term''s cards.';

CREATE INDEX IF NOT EXISTS idx_document_templates_school
  ON public.document_templates (school_id, doc_type) WHERE is_active;

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_templates FORCE ROW LEVEL SECURITY;

/*
  Everyone at the school may READ it — a teacher entering marks benefits from
  knowing whether class position prints on the card.
*/
CREATE POLICY school_read_document_templates
  ON public.document_templates
  FOR SELECT TO authenticated
  USING (school_id = public.current_school_uuid());

CREATE POLICY afritech_all_document_templates
  ON public.document_templates
  FOR ALL TO authenticated
  USING (public.is_afritech_admin())
  WITH CHECK (public.is_afritech_admin());

-- SELECT only for end users; the setter below is the single writer, so the tier
-- gate on layout variants cannot be bypassed by writing the row directly.
GRANT SELECT ON public.document_templates TO authenticated;
REVOKE ALL ON public.document_templates FROM anon;

-- `0149`'s status guard and the audit trigger, attached here because both of
-- those migrations iterate the catalogue at their own migration time.
DO $$
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS enforce_school_writable_on_update_on_document_templates
             ON public.document_templates';
  EXECUTE 'CREATE TRIGGER enforce_school_writable_on_update_on_document_templates
             AFTER UPDATE ON public.document_templates
             REFERENCING NEW TABLE AS new_rows
             FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_new()';

  EXECUTE 'DROP TRIGGER IF EXISTS audit_changes_on_document_templates
             ON public.document_templates';
  EXECUTE 'CREATE TRIGGER audit_changes_on_document_templates
             AFTER INSERT OR UPDATE OR DELETE ON public.document_templates
             FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()';
END;
$$;

-- ---------------------------------------------------------------------------
-- Reading. No-argument for routes, id form for the worker — `0254`'s lesson.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.school_document_template(
  p_school_id UUID,
  p_doc_type  TEXT
)
RETURNS TABLE (
  out_level          TEXT,
  out_layout_variant TEXT,
  out_config         JSONB,
  out_configured     BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(t.template_level, 'branding'),
    /*
      The tier gate, applied on READ as well as on write.

      A school that downgrades keeps its row, and this returns NULL for the
      variant so the renderer falls back to the default. Refusing to render would
      turn a billing change into "no report cards", which is a far worse failure
      than a plainer layout.
    */
    CASE
      WHEN t.layout_variant IS NOT NULL
       AND public.school_has_feature(p_school_id, 'custom_document_layouts')
      THEN t.layout_variant
      ELSE NULL
    END,
    COALESCE(t.template_config, '{}'::JSONB),
    t.id IS NOT NULL
  FROM (SELECT p_school_id AS id) q
  LEFT JOIN public.document_templates t
    ON t.school_id = q.id AND t.doc_type = p_doc_type AND t.is_active;
$$;

REVOKE ALL ON FUNCTION public.school_document_template(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_document_template(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.school_document_template(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.school_document_template(UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.my_document_template(p_doc_type TEXT)
RETURNS TABLE (
  out_level          TEXT,
  out_layout_variant TEXT,
  out_config         JSONB,
  out_configured     BOOLEAN,
  -- So a screen can offer the variants or explain why it cannot.
  out_can_use_layouts BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT d.out_level, d.out_layout_variant, d.out_config, d.out_configured,
         public.school_has_feature(v_school, 'custom_document_layouts')
  FROM public.school_document_template(v_school, p_doc_type) d;
END;
$$;

REVOKE ALL ON FUNCTION public.my_document_template(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_document_template(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.my_document_template(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Writing.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_document_template(
  p_doc_type       TEXT,
  p_config         JSONB,
  p_layout_variant TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_level  TEXT := 'branding';
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  -- What a report card says about a child is the head's responsibility.
  IF public.get_user_role() NOT IN ('org:owner', 'org:principal') THEN
    RAISE EXCEPTION
      'Only the owner or principal can change document templates'
      USING ERRCODE = '42501';
  END IF;

  IF p_layout_variant IS NOT NULL THEN
    /*
      The tier gate, at the point of choosing.

      Checked here rather than only on read so a school is told at the moment they
      try, rather than silently getting the default on a card they thought they
      had customised.
    */
    IF NOT public.school_has_feature(v_school, 'custom_document_layouts') THEN
      RAISE EXCEPTION
        'Layout variants are included from the Growth tier. Your current plan uses the standard layout.'
        USING ERRCODE = '22023';
    END IF;
    v_level := 'layout';
  END IF;

  INSERT INTO public.document_templates
    (school_id, doc_type, template_level, layout_variant, template_config,
     updated_by, updated_at)
  VALUES
    (v_school, p_doc_type, v_level, p_layout_variant,
     COALESCE(p_config, '{}'::JSONB), v_user, NOW())
  ON CONFLICT (school_id, doc_type) DO UPDATE
  SET template_level  = EXCLUDED.template_level,
      layout_variant  = EXCLUDED.layout_variant,
      template_config = EXCLUDED.template_config,
      updated_by      = EXCLUDED.updated_by,
      updated_at      = NOW();

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.set_document_template(TEXT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_document_template(TEXT, JSONB, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_document_template(TEXT, JSONB, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- The principal's comment, which is per TERM.
-- ---------------------------------------------------------------------------

/*
  Separate from `set_document_template()` because it is written at a different
  time by a different motion: the switches are set once a year, the comment is
  written every term, and making the head resend the whole config to add a
  paragraph is how a switch gets clobbered.

  Merged into the existing config rather than replacing it, so writing this
  term's comment cannot drop last term's.
*/
CREATE OR REPLACE FUNCTION public.set_principal_comment(
  p_academic_year TEXT,
  p_term_number   INT,
  p_comment       TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_key    TEXT;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  IF public.get_user_role() NOT IN ('org:owner', 'org:principal') THEN
    RAISE EXCEPTION
      'Only the owner or principal can write the principal''s comment'
      USING ERRCODE = '42501';
  END IF;

  IF p_term_number NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'A Zambian school year has three terms' USING ERRCODE = '22023';
  END IF;

  -- Keyed by year AND term, so last term's words cannot print on this term's cards.
  v_key := p_academic_year || '-' || p_term_number::TEXT;

  INSERT INTO public.document_templates
    (school_id, doc_type, template_config, updated_by, updated_at)
  VALUES
    (v_school, 'report_card',
     jsonb_build_object('principal_comments',
       jsonb_build_object(v_key, btrim(COALESCE(p_comment, '')))),
     v_user, NOW())
  ON CONFLICT (school_id, doc_type) DO UPDATE
  /*
    Merged at BOTH levels, explicitly.

    The first version used `jsonb_set(config, ARRAY['principal_comments', key], …,
    TRUE)`, and this migration's own assertion caught it: `create_missing` creates
    only the LAST element of the path, so when `principal_comments` did not exist
    yet the whole call returned the target unchanged and **every comment write
    silently did nothing.** A head would have typed a paragraph, seen no error, and
    found the report cards blank.

    `||` at each level has no such edge: the outer merge adds or replaces the
    `principal_comments` key, and the inner one adds this term's entry to whatever
    terms are already there.
  */
  SET template_config =
        document_templates.template_config
        || jsonb_build_object(
             'principal_comments',
             COALESCE(document_templates.template_config -> 'principal_comments',
                      '{}'::JSONB)
             || jsonb_build_object(v_key, btrim(COALESCE(p_comment, '')))
           ),
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW();

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.set_principal_comment(TEXT, INT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_principal_comment(TEXT, INT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_principal_comment(TEXT, INT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- The feature flag the tier gate reads.
-- ---------------------------------------------------------------------------

/*
  Column names and the category read from the catalogue, not assumed. The first
  draft wrote `feature_name` (the column is `display_name`), omitted the NOT NULL
  `updated_by`, and used the category `documents` where the CHECK admits
  `document` — three guesses, one statement.
*/
INSERT INTO afritech.feature_flags
  (feature_key, display_name, description, category, is_available_as_addon,
   is_active, updated_by)
SELECT 'custom_document_layouts',
       'Custom document layouts',
       'Choose a report card layout variant beyond the standard one (CUSTOMISATION.md step 3).',
       'document',
       -- Not sold as an add-on: CUSTOMISATION.md ties it to the Growth tier, and
       -- offering it twice would make the tier matrix the second source of truth.
       FALSE,
       TRUE,
       'migration_0258'
WHERE NOT EXISTS (
  SELECT 1 FROM afritech.feature_flags WHERE feature_key = 'custom_document_layouts'
);

-- ---------------------------------------------------------------------------
-- Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school UUID;
  v_org    TEXT;
  v_row    RECORD;
  v_cfg    JSONB;
BEGIN
  BEGIN
    SELECT id, clerk_org_id INTO v_school, v_org FROM public.schools
    WHERE status = 'active' AND clerk_org_id IS NOT NULL LIMIT 1;

    IF v_school IS NULL THEN
      RAISE NOTICE '0258: no school fixture; skipping';
      RAISE EXCEPTION 'ZSMS_0258_ROLLBACK';
    END IF;

    -- An unconfigured school must still resolve, defaulting to branding only.
    SELECT * INTO v_row FROM public.school_document_template(v_school, 'report_card');
    IF v_row.out_level <> 'branding' OR v_row.out_configured THEN
      RAISE EXCEPTION '0258: an unconfigured school did not resolve to the default';
    END IF;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_teacher', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'teacher'))::text, TRUE);

    -- A teacher must not change what a report card says about a child.
    BEGIN
      PERFORM public.set_document_template('report_card', '{"show_position": false}'::JSONB);
      RAISE EXCEPTION '0258: a teacher changed the report card template';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_principal', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'principal'))::text, TRUE);

    PERFORM public.set_document_template('report_card',
      '{"show_position": false, "show_attendance": true}'::JSONB);

    SELECT * INTO v_row FROM public.school_document_template(v_school, 'report_card');
    IF NOT v_row.out_configured THEN
      RAISE EXCEPTION '0258: the template did not save';
    END IF;
    IF (v_row.out_config ->> 'show_position') <> 'false' THEN
      RAISE EXCEPTION '0258: a config switch did not take';
    END IF;

    /*
      The comment must MERGE, not replace. Two terms written in sequence must both
      survive — the failure this guards against is a head writing term 2's comment
      and silently erasing term 1's from every card already produced.
    */
    PERFORM public.set_principal_comment('2026', 1, 'A strong start to the year.');
    PERFORM public.set_principal_comment('2026', 2, 'Steady progress this term.');

    SELECT out_config INTO v_cfg
    FROM public.school_document_template(v_school, 'report_card');

    IF (v_cfg -> 'principal_comments' ->> '2026-1') IS NULL THEN
      RAISE EXCEPTION '0258: writing term 2''s comment erased term 1''s';
    END IF;
    IF (v_cfg -> 'principal_comments' ->> '2026-2')
         <> 'Steady progress this term.' THEN
      RAISE EXCEPTION '0258: term 2''s comment did not save';
    END IF;
    -- And the switches set earlier must have survived the comment write.
    IF (v_cfg ->> 'show_attendance') <> 'true' THEN
      RAISE EXCEPTION '0258: writing a comment clobbered the config switches';
    END IF;

    -- A term outside 1-3 is refused.
    BEGIN
      PERFORM public.set_principal_comment('2026', 4, 'There is no term four.');
      RAISE EXCEPTION '0258: a fourth term was accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;

    -- The worker boundary and `0254`'s lesson.
    IF has_function_privilege('authenticated',
         'public.school_document_template(UUID, TEXT)', 'EXECUTE') THEN
      RAISE EXCEPTION '0258: the id form is reachable by signed-in users (0254 again)';
    END IF;
    IF has_function_privilege('anon', 'public.my_document_template(TEXT)', 'EXECUTE') THEN
      RAISE EXCEPTION '0258: anon can read document templates';
    END IF;

    RAISE EXCEPTION 'ZSMS_0258_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0258_ROLLBACK' THEN
        RAISE NOTICE '0258: verified — defaults resolve, teacher refused, comments merge per term, switches survive';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
