-- ===========================================================================
-- 0268 — a readable activity feed over the audit trail
--
-- Spec: reference images W1 and W3, both of which show a "Recent activity" list
--       in plain language — "New school registration", "Fee payment received".
--
-- ## The data already exists; what is missing is a sentence
--
-- `audit_logs` records `action` + `table_name` + `record_id` + a JSONB diff. That
-- is the right shape for an audit — precise, complete, queryable — and exactly the
-- wrong shape for a dashboard panel. "update on school_fee_reminder_settings" is
-- not something a head teacher reads.
--
-- So this maps rows to a title and a line of description, and leaves the audit
-- trail untouched.
--
-- ## It reads through RLS, not around it
--
-- SECURITY INVOKER, like `search_everything()` (`0266`) and for the same reason:
-- `audit_logs` already has policies deciding who sees a school's trail — including
-- `0257`, which added the accountant. Re-stating those inside a DEFINER function
-- would be a second copy that drifts.
--
-- **A feed therefore shows only what the reader could already have read** on the
-- audit screen. AfriTech sees platform rows; a school sees its own.
--
-- ## Noise is excluded deliberately
--
-- Two kinds of row are filtered out rather than rendered:
--
--   * **`select`-like and no-op rows.** `audit_row_change()` already suppresses
--     no-ops, but a defensive filter here keeps a future trigger from flooding the
--     panel.
--   * **The reader's own actions.** A feed that says "you changed this" to the
--     person who just changed it is a receipt, not news. This is the one piece of
--     filtering a dashboard genuinely wants and an audit screen must never do.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.recent_activity(p_limit INT DEFAULT 8)
RETURNS TABLE (
  out_id         UUID,
  out_at         TIMESTAMPTZ,
  out_kind       TEXT,
  out_title      TEXT,
  out_detail     TEXT,
  out_actor      TEXT
)
LANGUAGE sql
-- INVOKER: the policies on `audit_logs` are the authorisation.
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    a.id,
    a.created_at,

    /*
      A coarse kind, for the icon and tint. Derived from the table rather than
      stored, so a new audited table gets a sensible default instead of nothing.
    */
    CASE
      WHEN a.table_name IN ('payments', 'fee_records', 'invoices') THEN 'money'
      WHEN a.table_name IN ('students', 'student_parent_links')     THEN 'pupil'
      WHEN a.table_name IN ('staff_members', 'teacher_assignments') THEN 'staff'
      WHEN a.table_name IN ('exam_results', 'attendance_records')   THEN 'academic'
      WHEN a.table_name LIKE '%setting%' OR a.table_name LIKE '%template%' THEN 'settings'
      ELSE 'other'
    END,

    /*
      The sentence. Deliberately written per table rather than generated from the
      action, because "created on students" and "A pupil was enrolled" are the same
      fact told to two different audiences.
    */
    CASE a.table_name
      WHEN 'students' THEN
        CASE a.action
          WHEN 'create'      THEN 'A pupil was enrolled'
          WHEN 'soft_delete' THEN 'A pupil left the roll'
          WHEN 'restore'     THEN 'A pupil was returned to the roll'
          ELSE 'A pupil record was updated'
        END
      WHEN 'payments' THEN
        CASE a.action
          WHEN 'create' THEN 'A payment was recorded'
          ELSE 'A payment was updated'
        END
      WHEN 'exam_results' THEN
        CASE a.action
          WHEN 'create' THEN 'Marks were entered'
          ELSE 'Results were updated'
        END
      WHEN 'attendance_records' THEN 'Attendance was marked'
      WHEN 'staff_members' THEN
        CASE a.action
          WHEN 'create' THEN 'A member of staff was added'
          ELSE 'A staff record was updated'
        END
      WHEN 'schools' THEN 'School details were changed'
      ELSE
        -- The fallback still reads as a sentence, not as a table name.
        initcap(replace(a.table_name, '_', ' ')) || ' was ' ||
        CASE a.action WHEN 'create' THEN 'created'
                      WHEN 'soft_delete' THEN 'removed'
                      ELSE 'updated' END
    END,

    /*
      What changed, when the trigger recorded it. `audit_row_change()` stores a
      changed-columns diff, so naming the fields is both accurate and short — and
      far more useful than echoing the values, which may be personal data this
      panel has no business repeating.
    */
    NULLIF(
      (SELECT string_agg(replace(k, '_', ' '), ', ' ORDER BY k)
       FROM jsonb_object_keys(COALESCE(a.new_values, '{}'::JSONB)) AS k
       WHERE k NOT IN ('updated_at', 'created_at', 'id')),
      ''),

    a.actor_user_id

  FROM public.audit_logs a
  WHERE a.action IN ('create', 'update', 'soft_delete', 'restore')
    /*
      Not the reader's own actions. A feed telling you what you just did is a
      receipt rather than news — and it is what makes a quiet dashboard look busy.
    */
    AND a.actor_user_id IS DISTINCT FROM public.get_user_id()
  ORDER BY a.created_at DESC
  LIMIT GREATEST(LEAST(p_limit, 50), 1);
$$;

COMMENT ON FUNCTION public.recent_activity(INT) IS
  'Audit rows as sentences, for a dashboard panel. SECURITY INVOKER so the existing audit_logs policies decide what a reader sees; excludes the reader''s own actions, which are a receipt rather than news (0268).';

REVOKE ALL ON FUNCTION public.recent_activity(INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recent_activity(INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.recent_activity(INT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Assert what a migration honestly can.
--
-- The behaviour that matters — that a school sees only its own trail — is RLS,
-- and observing it needs a role switch. `0257` established that role-switching
-- inside a migration leaves the role switched and breaks the CLI's own history
-- insert, so that assertion belongs in a pgTAP suite.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'recent_activity' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION
      '0268: recent_activity is SECURITY DEFINER — it would show every school''s trail';
  END IF;

  IF has_function_privilege('anon', 'public.recent_activity(INT)', 'EXECUTE') THEN
    RAISE EXCEPTION '0268: anon can read the activity feed';
  END IF;

  RAISE NOTICE '0268: verified — SECURITY INVOKER, authenticated only';
END;
$$;
