-- Migration: 0143_onboarding_checklist_catalogue.sql
-- Created: 2026-09-29
-- Description: Makes the onboarding checklist real — a catalogue of items with the documented
--              weights, the four items that were missing, and a completion percentage.
-- Related documents: Official Documentation/15 Super Admin and Platform/ONBOARDING.md
--                    Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md
--
-- ===========================================================================
-- A TABLE NOTHING HAS EVER WRITTEN TO
--
-- `public.onboarding_checklists` was created in `0010` — table, indexes, RLS, three policies. In
-- the thirteen months since, **nothing in `apps/` or `packages/` has read or written a single
-- row.** It has been correct and empty the entire time.
--
-- That is worth stating because it explains the drift this migration repairs. `0010`'s `item_key`
-- CHECK admits ten keys. `ONBOARDING.md`'s weight map names **fourteen**. The four that were never
-- added are `parent_links`, `whatsapp_configured`, `document_templates` and `custom_roles` — and
-- `ONBOARDING.md` business rule 4 says in as many words that `whatsapp_configured` "must be added
-- to every existing school's checklist retroactively via a migration". That migration is this one,
-- written a year late, because nothing ever needed the column enough to notice.
--
-- ---------------------------------------------------------------------------
-- WHY A CATALOGUE TABLE AND NOT A WIDER CHECK
-- ---------------------------------------------------------------------------
-- The obvious repair is to add four values to the CHECK. That reproduces the failure: the list of
-- items lives in two places — a constraint and a TypeScript weight map in a document — and they
-- have already disagreed once.
--
-- So the items become **data**. A row carries the key, the label a screen shows, the category and
-- the weight. `onboarding_checklists.item_key` gets a foreign key to it in place of the CHECK, and
-- the completion percentage is a join rather than a hardcoded map. Adding a fifteenth item is then
-- an INSERT, and the weights cannot drift from the list because they are the same row.
--
-- It lives in `afritech` with a `public` view, which is the shape `0097` established for
-- `feature_catalogue` — the operator owns the definition, everyone reads it.
--
-- ---------------------------------------------------------------------------
-- THE WEIGHTS ARE THE DOCUMENT'S, NOT MINE
-- ---------------------------------------------------------------------------
-- Every number below is transcribed from `calculateOnboardingCompletion()` in `ONBOARDING.md`.
-- They sum to exactly 100 (60 critical / 30 important / 10 optional), and a CHECK at the end of
-- this migration asserts that — so a future edit that breaks the balance fails here rather than
-- quietly producing percentages that cannot reach 100.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. The catalogue.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afritech.onboarding_checklist_items (
  item_key     TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  description  TEXT NOT NULL,

  category     TEXT NOT NULL
               CHECK (category IN ('critical', 'important', 'optional')),

  -- Relative weight toward the completion percentage. See the header.
  weight       INT NOT NULL CHECK (weight > 0),

  -- What a school cannot do until this item is complete. Prose, shown on the setup screen; NULL
  -- where the item blocks nothing. `SCHOOL_SETUP.md` names these per item.
  blocks       TEXT,

  sort_order   INT NOT NULL,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_timestamp_on_onboarding_checklist_items
  ON afritech.onboarding_checklist_items;
CREATE TRIGGER update_timestamp_on_onboarding_checklist_items
  BEFORE UPDATE ON afritech.onboarding_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE afritech.onboarding_checklist_items IS
  'The onboarding checklist definition. Weights transcribed from ONBOARDING.md. Adding an item is '
  'an INSERT here plus a backfill into public.onboarding_checklists for existing schools.';

-- ---------------------------------------------------------------------------
-- 2. The fourteen items.
-- ---------------------------------------------------------------------------
INSERT INTO afritech.onboarding_checklist_items
  (item_key, label, description, category, weight, blocks, sort_order)
VALUES
  -- Critical — 60 in total.
  ('school_profile', 'School profile',
   'Name, type, level and contact details.',
   'critical', 8, NULL, 10),

  ('grade_structure', 'Grade levels',
   'The grades and classes this school actually runs.',
   'critical', 12, 'Student import, attendance and results', 20),

  ('grading_system', 'Grading scale',
   'ECZ, Cambridge or a scale of your own.',
   'critical', 10, 'Results and report cards', 30),

  ('subjects', 'Subjects',
   'The subject list for your curriculum.',
   'critical', 10, 'Marks entry', 40),

  ('fee_structure', 'Fee structure',
   'At least one fee structure for the current term.',
   'critical', 12, 'Fee tracking and payment recording', 50),

  -- The item ONBOARDING.md business rule 4 required and 0010 never carried.
  ('whatsapp_configured', 'WhatsApp',
   'Use the ZSMS shared number, or connect your own.',
   'critical', 8, 'Parent messaging over WhatsApp', 60),

  -- Important — 30 in total.
  ('first_student', 'First pupil',
   'At least one pupil added or imported.',
   'important', 8, NULL, 70),

  ('first_staff', 'First teacher',
   'At least one member of staff invited.',
   'important', 6, NULL, 80),

  ('parent_links', 'Parent links',
   'At least one parent linked to a pupil.',
   'important', 6, NULL, 90),

  ('payment_gateway', 'Payment gateway',
   'Optional — connect an online payment provider.',
   'important', 5, NULL, 100),

  ('term_dates', 'Term dates',
   'Start and end dates for the current term.',
   'important', 5, NULL, 110),

  -- Optional — 10 in total.
  ('logo', 'School logo',
   'Appears on receipts, report cards and the parent portal.',
   'optional', 4, NULL, 120),

  ('document_templates', 'Document templates',
   'Customise the report card and receipt.',
   'optional', 3, NULL, 130),

  ('custom_roles', 'Custom staff roles',
   'Roles beyond the seven built in — matron, librarian, nurse.',
   'optional', 3, NULL, 140)
ON CONFLICT (item_key) DO UPDATE
  SET label       = EXCLUDED.label,
      description = EXCLUDED.description,
      category    = EXCLUDED.category,
      weight      = EXCLUDED.weight,
      blocks      = EXCLUDED.blocks,
      sort_order  = EXCLUDED.sort_order;

/**
 * The weights must balance, and this is the only place that can tell.
 *
 * `ONBOARDING.md` states the split as 60 / 30 / 10. If a later edit adds an item without adjusting
 * its neighbours, the percentage silently stops being able to reach the documented balance — a
 * school would see "92% complete" with everything ticked. Asserted here so the edit fails instead.
 */
DO $$
DECLARE
  v_critical  INT;
  v_important INT;
  v_optional  INT;
BEGIN
  SELECT COALESCE(SUM(weight) FILTER (WHERE category = 'critical'), 0),
         COALESCE(SUM(weight) FILTER (WHERE category = 'important'), 0),
         COALESCE(SUM(weight) FILTER (WHERE category = 'optional'), 0)
    INTO v_critical, v_important, v_optional
    FROM afritech.onboarding_checklist_items
   WHERE is_active;

  IF (v_critical, v_important, v_optional) IS DISTINCT FROM (60, 30, 10) THEN
    RAISE EXCEPTION
      'Onboarding weights must be 60 critical / 30 important / 10 optional per ONBOARDING.md, '
      'but are % / % / %.', v_critical, v_important, v_optional;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Access. The catalogue is not secret — a school sees its own setup screen.
-- ---------------------------------------------------------------------------
ALTER TABLE afritech.onboarding_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.onboarding_checklist_items FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_onboarding_items"
  ON afritech.onboarding_checklist_items;
CREATE POLICY "afritech_admin_all_onboarding_items"
ON afritech.onboarding_checklist_items FOR ALL
USING (public.is_afritech_admin())
WITH CHECK (public.is_afritech_admin());

DROP POLICY IF EXISTS "authenticated_read_onboarding_items"
  ON afritech.onboarding_checklist_items;
CREATE POLICY "authenticated_read_onboarding_items"
ON afritech.onboarding_checklist_items FOR SELECT
USING (is_active);

GRANT SELECT ON afritech.onboarding_checklist_items TO authenticated;
REVOKE ALL  ON afritech.onboarding_checklist_items FROM anon;

-- PostgREST resolves only `public` (supabase/config.toml), so the API reads the view, not the
-- table. security_invoker keeps the policies above applying to the caller.
CREATE OR REPLACE VIEW public.onboarding_checklist_catalogue
WITH (security_invoker = true) AS
  SELECT item_key, label, description, category, weight, blocks, sort_order, is_active
  FROM afritech.onboarding_checklist_items;

COMMENT ON VIEW public.onboarding_checklist_catalogue IS
  'Read view over afritech.onboarding_checklist_items for the API. security_invoker.';

GRANT SELECT ON public.onboarding_checklist_catalogue TO authenticated;
REVOKE ALL  ON public.onboarding_checklist_catalogue FROM anon;

-- ---------------------------------------------------------------------------
-- 4. The CHECK becomes a foreign key.
-- ---------------------------------------------------------------------------
/**
 * Referential integrity checks bypass RLS by design in PostgreSQL, so a school inserting its own
 * checklist row does not need any privilege on the `afritech` table — only that the key exists.
 * That is what makes the catalogue safe to reference from a tenant table.
 */
ALTER TABLE public.onboarding_checklists
  DROP CONSTRAINT IF EXISTS onboarding_checklists_item_key_check;

ALTER TABLE public.onboarding_checklists
  DROP CONSTRAINT IF EXISTS onboarding_checklists_item_key_fkey;

ALTER TABLE public.onboarding_checklists
  ADD CONSTRAINT onboarding_checklists_item_key_fkey
  FOREIGN KEY (item_key)
  REFERENCES afritech.onboarding_checklist_items(item_key)
  ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. Seeding, and the retroactive backfill business rule 4 asks for.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_onboarding_checklist(p_school_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_added INT;
BEGIN
  /**
   * AfriTech only. A school cannot conjure its own checklist rows through this function — its
   * management can already tick items through `management_write_onboarding` (0010), which is the
   * write they are supposed to have. This exists for creation and for backfilling a new item, both
   * of which are operator acts.
   */
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech seeds an onboarding checklist.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.onboarding_checklists (school_id, item_key)
  SELECT p_school_id, i.item_key
    FROM afritech.onboarding_checklist_items i
   WHERE i.is_active
  ON CONFLICT (school_id, item_key) DO NOTHING;

  GET DIAGNOSTICS v_added = ROW_COUNT;
  RETURN v_added;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_onboarding_checklist(UUID) TO authenticated;

COMMENT ON FUNCTION public.ensure_onboarding_checklist(UUID) IS
  'Adds any catalogue item this school has no row for. Idempotent — run it after adding an item '
  'to the catalogue to backfill every school. AfriTech only.';

/**
 * The backfill itself, run once here.
 *
 * Every school in this database currently has ZERO checklist rows, because nothing has ever
 * written one. So this is not the narrow "add whatsapp_configured to existing schools" that
 * business rule 4 anticipated — it creates all fourteen items for every school that exists.
 *
 * Written as plain SQL rather than through the function above, because a migration runs as the
 * table owner and `is_afritech_admin()` reads a JWT claim there is no JWT to read.
 */
INSERT INTO public.onboarding_checklists (school_id, item_key)
SELECT s.id, i.item_key
  FROM public.schools s
 CROSS JOIN afritech.onboarding_checklist_items i
 WHERE i.is_active
ON CONFLICT (school_id, item_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Completion.
-- ---------------------------------------------------------------------------
/**
 * Invoker rights, deliberately. The function reads `onboarding_checklists`, whose policies already
 * say who sees what: `school_staff_read_onboarding` scopes a school to its own, and
 * `afritech_admin_all_onboarding` gives AfriTech the platform. A SECURITY DEFINER here would
 * replace two tested policies with a third rule, and would let any caller ask about any school.
 *
 * The consequence is worth knowing: a caller who cannot see a school's rows gets 0%, not an error.
 * That is the correct answer to "how complete is a school I cannot see" — it is the same answer
 * they would get by counting the rows themselves.
 */
CREATE OR REPLACE FUNCTION public.school_onboarding_completion(p_school_id UUID)
RETURNS TABLE (
  completion_pct   INT,
  completed_weight INT,
  total_weight     INT,
  items_complete   INT,
  items_total      INT,
  critical_pct     INT
)
LANGUAGE sql
STABLE
SET search_path = public, afritech, pg_temp
AS $$
  WITH rows_for_school AS (
    SELECT c.is_complete, i.weight, i.category
      FROM public.onboarding_checklists c
      JOIN afritech.onboarding_checklist_items i ON i.item_key = c.item_key
     WHERE c.school_id = p_school_id
       AND i.is_active
  )
  SELECT
    -- NULLIF guards the division for a school with no rows at all, which is every school that
    -- predates this migration until the backfill above runs.
    COALESCE(ROUND(
      100.0 * COALESCE(SUM(weight) FILTER (WHERE is_complete), 0)
            / NULLIF(SUM(weight), 0)
    )::INT, 0),
    COALESCE(SUM(weight) FILTER (WHERE is_complete), 0)::INT,
    COALESCE(SUM(weight), 0)::INT,
    COUNT(*) FILTER (WHERE is_complete)::INT,
    COUNT(*)::INT,
    -- Critical progress on its own. `ONBOARDING.md`'s escalation rules trigger on overall
    -- completion, but a school at 45% with every critical item done is in a different situation
    -- from one at 45% that has only uploaded a logo, and the admin panel should be able to say so.
    COALESCE(ROUND(
      100.0 * COALESCE(SUM(weight) FILTER (WHERE is_complete AND category = 'critical'), 0)
            / NULLIF(SUM(weight) FILTER (WHERE category = 'critical'), 0)
    )::INT, 0)
  FROM rows_for_school;
$$;

GRANT EXECUTE ON FUNCTION public.school_onboarding_completion(UUID) TO authenticated;

COMMENT ON FUNCTION public.school_onboarding_completion(UUID) IS
  'Weighted onboarding completion per ONBOARDING.md. Invoker rights — a caller sees only schools '
  'whose checklist rows their policies already admit.';

-- === MIGRATION END ===
