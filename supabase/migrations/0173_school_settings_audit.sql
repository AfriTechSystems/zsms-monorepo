-- ---------------------------------------------------------------------------
-- 0173 — what changed in a school's settings, who changed it, and when
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md`
--       `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
--       `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
--
-- ## The gap
--
-- `0131` attached the row-change audit trigger to eight tables — payments, fee
-- records, fee structures, exam results, students, staff, teaching assignments
-- and Hub accounts. **`schools` is not among them**, and neither are
-- `school_academic_config` or `school_term_dates`, which is where the rest of a
-- school's settings live.
--
-- So a school could rename itself, change its ministry registration number, move
-- its address, switch curriculum or redefine its term dates, and nothing recorded
-- it. AfriTech had no way to answer "when did this school's name change" or "who
-- moved term 2". For a platform whose onboarding captures regulatory identifiers,
-- that is a compliance gap rather than a missing convenience: ZDPA accountability
-- means being able to say who altered a record and when.
--
-- Term dates matter more than they look. They drive fee period resolution
-- (`school_credit_period()`, 0164) and report-card timing, so moving one silently
-- re-prices a termly AI credit purchase and shifts what "this term" means on
-- every screen.
--
-- ## Why reuse `audit_row_change()` rather than write something
--
-- It already masks PII through `mask_audit_values()`, already records the real
-- actor during impersonation rather than the borrowed identity, and `0131`'s
-- immutability trigger already refuses UPDATE and DELETE on the result. A second
-- mechanism would be a second set of those three decisions to get right, and the
-- one that got them right is already here.
--
-- ## What AfriTech sees, and what the school sees
--
-- Both see the same rows for that school. This is deliberately NOT one of the
-- places where AfriTech is narrowed to aggregates (0169): a settings change is an
-- act by a named member of staff on their own school's configuration, which is
-- exactly what an audit trail is for, and the school's own policy on `audit_logs`
-- already lets it read its own.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Attach the existing trigger to the three settings tables.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['schools', 'school_academic_config', 'school_term_dates']
  LOOP
    -- Guarded: a table named here but absent would otherwise fail the whole
    -- migration on an environment built to a different point in the sequence.
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'skipping %, which does not exist', t;
      CONTINUE;
    END IF;

    EXECUTE format('DROP TRIGGER IF EXISTS audit_changes_on_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER audit_changes_on_%I
         AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.audit_row_change()', t, t);
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Reading the log for one school.
--
-- A function rather than letting a screen query `audit_logs` directly, for two
-- reasons: the join to a readable actor name belongs in one place, and the
-- `schools` row carries a NULL `school_id` on platform-level acts, so "this
-- school's history" is a question with a definition rather than a WHERE clause
-- somebody retypes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_settings_history(
  p_school_id UUID DEFAULT NULL,
  p_limit     INT  DEFAULT 50
)
RETURNS TABLE (
  out_id           UUID,
  out_action       TEXT,
  out_table_name   TEXT,
  out_actor        TEXT,
  out_actor_name   TEXT,
  out_impersonated TEXT,
  out_changed      JSONB,
  out_created_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID;
BEGIN
  /*
    AfriTech may name any school; a school may only ever read its own, and the
    parameter is ignored for them. Taking `p_school_id` on trust would let a
    school read another's settings history through a DEFINER function — the same
    trap every other admin function in this schema avoids by resolving the school
    from the session rather than the argument.
  */
  IF public.is_afritech_admin() THEN
    v_school := COALESCE(p_school_id, public.current_school_uuid());
  ELSE
    v_school := public.current_school_uuid();
  END IF;

  IF v_school IS NULL THEN
    RAISE EXCEPTION 'No school in scope' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.action,
    a.table_name,
    a.actor_user_id,
    -- The staff row's name when there is one. A member who has since left keeps
    -- their entry; dropping the line would make the history incomplete, which is
    -- the one thing an audit trail must not be.
    COALESCE(
      (SELECT sm.first_name || ' ' || sm.last_name
         FROM public.staff_members AS sm
        WHERE sm.clerk_user_id = a.actor_user_id
          AND sm.school_id = v_school
        LIMIT 1),
      '(not on staff)'
    )::TEXT,
    a.impersonated_user_id,
    /*
      Only what actually moved. `audit_row_change()` records whole rows, and a
      settings screen showing forty unchanged columns beside the one that changed
      buries the answer. Computed here so every reader gets the same diff.
    */
    (
      SELECT COALESCE(jsonb_object_agg(key, jsonb_build_object(
               'from', a.old_values -> key,
               'to',   a.new_values -> key
             )), '{}'::jsonb)
      FROM jsonb_object_keys(COALESCE(a.new_values, '{}'::jsonb)) AS key
      WHERE a.old_values IS NULL
         OR (a.old_values -> key) IS DISTINCT FROM (a.new_values -> key)
    ),
    a.created_at
  FROM public.audit_logs AS a
  WHERE a.school_id = v_school
    AND a.table_name IN ('schools', 'school_academic_config', 'school_term_dates')
  ORDER BY a.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.school_settings_history(UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_settings_history(UUID, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_settings_history(UUID, INT) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.school_settings_history(UUID, INT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'school_settings_history is executable by anon';
  END IF;
  IF NOT has_function_privilege(
       'authenticated', 'public.school_settings_history(UUID, INT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute school_settings_history';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Assert the triggers actually attached.
--
-- A DO block that iterated an array and silently skipped every table would apply
-- cleanly and audit nothing — and the absence would only surface the day somebody
-- asked who changed a name.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t       TEXT;
  missing TEXT[] := '{}';
BEGIN
  FOREACH t IN ARRAY ARRAY['schools', 'school_academic_config', 'school_term_dates']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM pg_trigger
         WHERE tgrelid = ('public.' || t)::regclass
           AND tgname = 'audit_changes_on_' || t
           AND NOT tgisinternal
       )
    THEN
      missing := missing || t;
    END IF;
  END LOOP;

  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'audit trigger missing on: %', array_to_string(missing, ', ');
  END IF;
END;
$$;
