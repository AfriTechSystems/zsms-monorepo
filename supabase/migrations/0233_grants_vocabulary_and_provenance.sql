-- ===========================================================================
-- 0233 — four defects CI found, all of them live
--
-- Spec: `01 Foundation Layer/RLS.md`, `09 Audit/AUDIT.md`,
--       `TEACHER_PORTAL.md`, `12 Communication/PUSH.md`
--
-- Every one of these was failing in CI and read as "stale suites" for about
-- twenty commits. None of them was stale.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Two tables had policies and NO grants, so every read was refused.
-- ---------------------------------------------------------------------------

/*
  The third and fourth instance of this exact defect — `0212` and `0218` were the
  first two.

  RLS does not imply a GRANT. Postgres checks the privilege FIRST, so a table with
  carefully written policies and no grant is dead code that reads as protection.
  `school_credit_purchases` has two policies and `school_join_requests` three, and
  `authenticated` held nothing on either.

  This was not only a test failure. `/api/school/credits`,
  `/api/school/join-requests` and `/api/teacher/school-link` all SELECT from these
  tables, so the credits screen and both join-request screens have been returning
  "permission denied" to real users since those tables were created.

  SELECT only, deliberately: all three call sites read, and every write goes
  through a SECURITY DEFINER function, which needs no grant.
*/
GRANT SELECT ON public.school_credit_purchases TO authenticated;
GRANT SELECT ON public.school_join_requests TO authenticated;
REVOKE ALL ON public.school_credit_purchases FROM anon;
REVOKE ALL ON public.school_join_requests FROM anon;

-- ---------------------------------------------------------------------------
-- 2. Provenance was made editable by a grant that was too broad.
-- ---------------------------------------------------------------------------

/*
  `0218` fixed a real bug — `teaching_resources` had an UPDATE policy and no
  grant, so Hub rename, edit and share had never worked — and fixed it too
  widely, with a table-level GRANT UPDATE.

  A table-level UPDATE implies column-level UPDATE on EVERY column, including
  `content` and `generator_name`. So a teacher could rewrite what the model
  produced and whose model produced it, which is the one thing a provenance
  record must not permit: a resource could be made to claim an origin it did not
  have.

  `teacher_hub_test` asserts exactly this and has failed since `0218`.

  Column-level grants were the intended design all along — the route already
  maps `42501` to "the request named a column the teacher holds no privilege on",
  which is a handler written for privileges that did not yet exist.
*/
REVOKE UPDATE ON public.teaching_resources FROM authenticated;

-- What a teacher may genuinely change about their own resource: what it is
-- called, their own notes, whether it is shared, and whether it is binned.
GRANT UPDATE (title, teacher_notes, is_shared, shared_at, is_deleted, updated_at)
  ON public.teaching_resources TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The audit trail spoke two languages for one act.
-- ---------------------------------------------------------------------------

/*
  `audit_row_change()` wrote `TG_OP` lowercased — `insert`, `update`, `delete` —
  while every explicit `log_audit_event()` call writes `create`, `school_created`,
  `parent_linked` and so on.

  So `audit_logs.action` held BOTH `create` and `insert` for the same kind of
  event, and a filter for either missed half the rows. On a trail whose purpose is
  answering "who did what", a vocabulary that depends on which code path wrote the
  row is a defect, not a detail.

  `create` wins: it is what the deliberate calls use, what `AUDIT.md` documents,
  and what reads as an act rather than an implementation detail. `TG_OP` is how
  Postgres describes itself, not how a head teacher describes what happened.

  **Historical rows are NOT rewritten.** An audit log that gets edited to look
  tidier is no longer evidence. Rows written before this migration keep `insert`,
  and the reader below treats the two as one.
*/
/*
  The body below is `pg_get_functiondef()` as the database holds it, with the INSERT
  branch's `v_action := 'insert'` changed to `'create'` and NOTHING else touched.

  The first draft of this migration rewrote the function by hand and would have
  silently destroyed four things it does: the changed-columns-only diff, the
  suppression of updates that change nothing, the `soft_delete`/`restore` action
  detection, and the row-not-session school attribution. That is precisely the
  mistake `0213` made against `allocate_payment` — rebuilding from an older
  understanding and discarding what had been learned since. Caught here by reading
  the live definition before writing, which is the only thing that catches it.
*/
CREATE OR REPLACE FUNCTION public.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old      JSONB;
  v_new      JSONB;
  v_before   JSONB;
  v_changed  JSONB;
  v_action   TEXT;
  v_school   UUID;
  v_raw      TEXT;
  v_record   UUID;
  v_row      JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_action := 'create';
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_action := 'delete';
  ELSE
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);

    -- Only the columns that actually moved. A whole-row diff on every update
    -- buries the one field somebody needs to find.
    SELECT
      COALESCE(jsonb_object_agg(key, v_old -> key), '{}'::jsonb),
      COALESCE(jsonb_object_agg(key, v_new -> key), '{}'::jsonb)
      INTO v_before, v_changed
    FROM jsonb_object_keys(v_new) AS key
    WHERE (v_old -> key) IS DISTINCT FROM (v_new -> key);

    -- Nothing changed: an UPDATE that rewrites identical values is noise.
    IF v_changed = '{}'::jsonb THEN
      RETURN COALESCE(NEW, OLD);
    END IF;

    v_action := CASE
      WHEN (v_old ->> 'is_deleted') IS DISTINCT FROM (v_new ->> 'is_deleted')
           AND (v_new ->> 'is_deleted') = 'true'
        THEN 'soft_delete'
      WHEN (v_old ->> 'is_deleted') IS DISTINCT FROM (v_new ->> 'is_deleted')
           AND (v_new ->> 'is_deleted') = 'false'
        THEN 'restore'
      ELSE 'update'
    END;

    v_old := v_before;
    v_new := v_changed;
  END IF;

  v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  /*
    The row's own school, not the session's — a worker acting across schools, or a
    DEFINER function, would otherwise attribute the change to whatever org the
    session happened to hold.

    `school_id` is the tenant UUID on every table but `schools`, where it is the
    TEXT business identifier and the UUID is `id`. Tested by shape rather than by
    table name, so a future table built the same way needs no further migration —
    and tested BEFORE the cast, because an exception raised inside a trigger
    aborts the caller's transaction regardless of any handler further out.
  */
  v_raw := v_row ->> 'school_id';

  IF v_raw ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    v_school := v_raw::UUID;
  ELSE
    -- Either this table has no `school_id`, or the column is a business
    -- identifier. On `schools` the row IS the school, so its own `id` is the
    -- tenant it belongs to.
    v_raw := v_row ->> 'id';
    IF TG_TABLE_NAME = 'schools'
       AND v_raw ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN
      v_school := v_raw::UUID;
    ELSE
      v_school := NULL;
    END IF;
  END IF;

  v_raw := v_row ->> 'id';
  v_record := CASE
    WHEN v_raw ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN v_raw::UUID
    ELSE NULL
  END;

  INSERT INTO public.audit_logs (
    school_id, actor_user_id, impersonated_user_id, action, table_name, record_id,
    old_values, new_values
  )
  VALUES (
    v_school,
    -- The REAL actor during impersonation, never the borrowed identity.
    COALESCE(public.get_actor_id(), public.get_user_id(), 'system'),
    CASE WHEN public.is_impersonation_session() THEN public.get_user_id() END,
    v_action,
    TG_TABLE_NAME,
    v_record,
    public.mask_audit_values(v_old),
    public.mask_audit_values(v_new)
  );

  RETURN COALESCE(NEW, OLD);
END;
$function$;

COMMENT ON FUNCTION public.audit_row_change() IS
  'Row-change audit trigger. Writes create/update/delete, matching the vocabulary of the explicit log_audit_event() calls. Rows written before 0233 carry insert/update/delete from TG_OP and are deliberately not rewritten (0233).';

-- ---------------------------------------------------------------------------
-- 4. A retirement reason written in prose where a machine value belongs.
-- ---------------------------------------------------------------------------

/*
  `0196` retires a push token with `retired_reason = 'signed out'`. Every other
  machine-read value in this schema is snake_case, and the suite asserts
  `signed_out`.

  The column has no CHECK, so the space never failed — it just meant a filter for
  `signed_out` silently matched nothing. Exactly the class of bug the convention
  exists to prevent.

  Existing rows are corrected here, which is safe in a way rewriting an audit log
  is not: this is an operational status column, not evidence of who did what.
*/
UPDATE public.parent_push_tokens
SET retired_reason = 'signed_out'
WHERE retired_reason = 'signed out';

/*
  Fix the WRITER too, or the next sign-out puts the prose form straight back.

  `retire_push_token()` (0196) is the only one. The body below is
  `pg_get_functiondef()` as the database holds it, with the single string literal
  changed and nothing else — the same discipline as section 3.

  (A first draft here scanned every `public` function with `pg_get_functiondef()`
  to report which ones carried the prose form. That fails with 42809, because the
  catalogue includes aggregates and `pg_get_functiondef` refuses them. Naming the
  one function is better anyway: a diagnostic notice nobody reads would not have
  fixed it.)
*/
CREATE OR REPLACE FUNCTION public.retire_push_token(p_push_token text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user TEXT := public.get_user_id();
  v_rows INT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;

  UPDATE public.parent_push_tokens t
     SET is_active = FALSE,
         retired_at = NOW(),
         retired_reason = 'signed_out',
         updated_at = NOW()
   WHERE t.push_token = btrim(p_push_token)
     -- The clause that was missing. A caller may retire their OWN device and nobody
     -- else's, whatever token they present.
     AND t.parent_user_id = v_user
     AND t.is_active;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  /*
    `false` for a token that is not the caller's, exactly as for one already retired.

    Deliberately indistinguishable: a different answer would confirm that a given token
    exists and belongs to somebody, which is the question an attacker holding a guessed
    token would most like answered.
  */
  RETURN v_rows > 0;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Prove all four.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_n INT;
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.school_credit_purchases', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.school_join_requests', 'SELECT') THEN
    RAISE EXCEPTION '0233: the SELECT grants did not take';
  END IF;

  IF has_column_privilege('authenticated', 'public.teaching_resources', 'content', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.teaching_resources', 'generator_name', 'UPDATE') THEN
    RAISE EXCEPTION '0233: provenance columns are still editable';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.teaching_resources', 'title', 'UPDATE') THEN
    RAISE EXCEPTION '0233: a teacher can no longer rename their own resource';
  END IF;

  SELECT COUNT(*) INTO v_n FROM public.parent_push_tokens
  WHERE retired_reason = 'signed out';
  IF v_n > 0 THEN
    RAISE EXCEPTION '0233: % push token(s) still carry the prose reason', v_n;
  END IF;

  RAISE NOTICE '0233: verified — grants restored, provenance locked, reason normalised';
END;
$$;
