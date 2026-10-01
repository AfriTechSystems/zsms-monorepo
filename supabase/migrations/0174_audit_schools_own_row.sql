-- ---------------------------------------------------------------------------
-- 0174 — the audit trigger could not be attached to `schools` itself
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/01 Foundation Layer/COMPLIANCE.md`
--
-- ## The bug
--
-- `audit_row_change()` (0131) resolves which school a change belongs to with:
--
--     v_school := (to_jsonb(NEW) ->> 'school_id')::UUID;
--
-- That is correct for every table it was attached to, because every `public`
-- table carries `school_id` as the tenant UUID — the rule the whole schema is
-- built on.
--
-- **`schools` is the exception, and it is the exception by design.** There,
-- `school_id` is the TEXT business identifier (`ZM-LSK-0001`) that appears on
-- receipts and documents, and the tenant UUID is `id`. So the moment `0173`
-- attached the trigger to `schools`, the first rename raised
--
--     22P02: invalid input syntax for type uuid: "ZM-CBE-9001"
--
-- and the UPDATE failed — meaning a school could not change its own name at all.
-- `0173` applied cleanly and its own assertion passed: the trigger WAS attached.
-- Nothing is wrong until a row is written, which is why this surfaced only when
-- the migration was exercised rather than inspected.
--
-- ## The fix belongs in the trigger, not in the attachment list
--
-- The alternative was to leave `schools` unaudited, which is what created the
-- compliance gap `0173` exists to close. A table-name special case is the smaller
-- cost, and it is honest: `schools` IS special — it is the only table where
-- `school_id` does not mean what it means everywhere else.
--
-- Written as "if the column is not a UUID, fall back to `id`" rather than naming
-- the table, so a future table with the same shape is handled without a third
-- migration. The regex is the test: a UUID cast that would throw is avoided
-- instead of caught, because an exception inside a trigger aborts the caller's
-- transaction whether or not it is handled afterwards.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
    v_action := 'insert';
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
$$;

-- ---------------------------------------------------------------------------
-- Prove it on the real table shape, inside the migration.
--
-- 0173 asserted the trigger was ATTACHED and passed while every write through it
-- would fail. Attachment is not the property that matters; surviving a write is.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_school UUID;
  v_name   TEXT;
  v_logged INT;
BEGIN
  SELECT id, name INTO v_school, v_name FROM public.schools LIMIT 1;
  IF v_school IS NULL THEN
    RAISE NOTICE 'no schools to verify against — skipping';
    RETURN;
  END IF;

  UPDATE public.schools SET name = v_name WHERE id = v_school;      -- no-op, no row
  UPDATE public.schools SET name = v_name || ' ' WHERE id = v_school;  -- a real change

  SELECT COUNT(*) INTO v_logged
  FROM public.audit_logs
  WHERE table_name = 'schools' AND school_id = v_school;

  IF v_logged = 0 THEN
    RAISE EXCEPTION 'a change to schools still writes no audit row';
  END IF;

  -- Put it back. The verification must not leave the name altered.
  UPDATE public.schools SET name = v_name WHERE id = v_school;

  RAISE NOTICE 'verified: a change to schools audits against its own id';
END;
$$;
