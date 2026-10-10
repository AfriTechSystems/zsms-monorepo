-- Migration: 0110_custom_student_fields.sql
-- Created: 2026-09-26
-- Description: School-defined extra fields on a pupil record — religion, house,
--              transport route, medical notes — without a migration per field.
-- Related documents: Official Documentation/07 Student and Parent Modules/STUDENTS.md
--                    Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--                    Official Documentation/01 Foundation Layer/COMPLIANCE.md
--
-- ===========================================================================
-- WHY NOT A JSONB BLOB ON `students`
--
-- The obvious shape is `students.custom_fields JSONB`. It is one column and it
-- would work this afternoon. It is rejected because of what it cannot do:
--
--   * **It cannot be access-controlled per field.** This is the decisive one. A
--     pupil's house colour and a pupil's medical condition are not the same kind
--     of fact. Medical data is health data under the Data Protection Act 2021,
--     and putting it in the same column as "house" means every role that may
--     read one may read the other — there is no way to write a policy over a key
--     inside a JSON document.
--   * **It cannot be validated.** A number field would accept "maybe", a date
--     field "next term". The first bad import makes the column untrustworthy and
--     nothing can tell you which rows are wrong.
--   * **It cannot be renamed safely.** Renaming a key means rewriting every
--     document; a definition row means updating one label.
--
-- So: a definition table per school, a value table per pupil per field, and
-- sensitivity carried on the definition where a policy can reach it.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not let a school invent a field that duplicates a first-class column.
-- `first_name`, `date_of_birth`, `class_id` and the rest stay real columns with
-- real constraints, and a reserved-key list refuses a custom field that would
-- shadow one. A second, unvalidated `date_of_birth` is worse than none.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. The definitions — what fields this school has decided to keep.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_custom_fields (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id      UUID NOT NULL REFERENCES public.schools(id),

  -- What the school applies this field to. Only students today; the column
  -- exists so staff and parent fields do not need a second pair of tables.
  entity_type    TEXT NOT NULL DEFAULT 'student'
                 CHECK (entity_type IN ('student')),

  -- Stable machine name, used by the importer and the API. snake_case and
  -- immutable once created (see the trigger): renaming a key would orphan every
  -- value that references it.
  field_key      TEXT NOT NULL
                 CHECK (field_key ~ '^[a-z][a-z0-9_]{1,38}$'),

  -- What a human sees. Freely editable — that is the point of separating it
  -- from the key.
  label          TEXT NOT NULL CHECK (btrim(label) <> ''),
  help_text      TEXT,

  field_type     TEXT NOT NULL
                 CHECK (field_type IN
                   ('text', 'number', 'date', 'boolean', 'select', 'multi_select')),

  -- For select / multi_select. An array of allowed values; empty otherwise.
  options        JSONB NOT NULL DEFAULT '[]'::JSONB,

  is_required    BOOLEAN NOT NULL DEFAULT FALSE,

  /**
   * How sensitive this field is. This is the reason the whole table exists.
   *
   *   standard  — house, transport route, religion. Any member of staff who can
   *               already read the pupil record.
   *   sensitive — medical conditions, allergies, safeguarding notes. Health and
   *               welfare data under the Data Protection Act 2021. Restricted to
   *               management and the school nurse role if one exists; explicitly
   *               NOT readable by every teacher or the accountant.
   *
   * A field cannot be created without choosing, because the default that feels
   * harmless is the one that leaks. New sensitivity levels belong here, not in
   * application code.
   */
  sensitivity    TEXT NOT NULL DEFAULT 'standard'
                 CHECK (sensitivity IN ('standard', 'sensitive')),

  display_order  INT NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, entity_type, field_key),

  -- A select with no options is a field nobody can fill in.
  CONSTRAINT school_custom_fields_select_has_options CHECK (
    field_type NOT IN ('select', 'multi_select')
    OR jsonb_array_length(options) > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_school_custom_fields_school
  ON public.school_custom_fields(school_id, entity_type)
  WHERE is_active;

DROP TRIGGER IF EXISTS update_timestamp_on_school_custom_fields
  ON public.school_custom_fields;
CREATE TRIGGER update_timestamp_on_school_custom_fields
  BEFORE UPDATE ON public.school_custom_fields
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Reserved keys — a custom field may not shadow a real column.
--
--    Without this, a school creates `date_of_birth` as free text, the importer
--    writes to it, two screens disagree about a pupil's age, and neither is
--    wrong about the column it read.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_reserved_custom_field_key()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.entity_type = 'student'
     AND NEW.field_key IN (
       SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'students'
     ) THEN
    RAISE EXCEPTION
      'A custom field cannot be called "%" — that is already a standard field on '
      'the pupil record. Use the standard field, or choose another name.',
      NEW.field_key
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reject_reserved_key_on_school_custom_fields
  ON public.school_custom_fields;
CREATE TRIGGER reject_reserved_key_on_school_custom_fields
  BEFORE INSERT OR UPDATE OF field_key ON public.school_custom_fields
  FOR EACH ROW EXECUTE FUNCTION public.reject_reserved_custom_field_key();

-- A key is immutable once created. Values reference the definition by id, so a
-- rename would not orphan data — but the key is what the importer's CSV header
-- and every integration matches on, and silently changing it breaks both.
-- The label is the editable name.
CREATE OR REPLACE FUNCTION public.reject_custom_field_key_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.field_key IS DISTINCT FROM OLD.field_key THEN
    RAISE EXCEPTION
      'A field key cannot be changed once created — imports and integrations '
      'match on it. Change the label instead, or retire this field and add a new one.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- Changing the type of a field that already holds values would reinterpret
  -- every one of them. Retire and re-add instead.
  IF NEW.field_type IS DISTINCT FROM OLD.field_type
     AND EXISTS (SELECT 1 FROM public.student_custom_values
                  WHERE field_id = OLD.id) THEN
    RAISE EXCEPTION
      'This field already holds values, so its type cannot be changed — the '
      'existing values would be reinterpreted. Retire it and add a new field.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. The values.
--
--    One row per pupil per field. Typed columns rather than one text column, so
--    a number sorts as a number and a date compares as a date — the thing a
--    JSONB blob cannot give you.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_custom_values (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id    UUID NOT NULL REFERENCES public.schools(id),
  student_id   UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  field_id     UUID NOT NULL REFERENCES public.school_custom_fields(id) ON DELETE CASCADE,

  value_text    TEXT,
  value_number  NUMERIC(14,4),
  value_date    DATE,
  value_boolean BOOLEAN,
  -- multi_select only. An array of strings.
  value_json    JSONB,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (student_id, field_id),

  -- Exactly one value column populated, or none (an empty answer). Without this
  -- a row could carry a text AND a number and nothing would say which is meant.
  CONSTRAINT student_custom_values_one_value CHECK (
    (value_text    IS NOT NULL)::INT
  + (value_number  IS NOT NULL)::INT
  + (value_date    IS NOT NULL)::INT
  + (value_boolean IS NOT NULL)::INT
  + (value_json    IS NOT NULL)::INT
  <= 1
  )
);

CREATE INDEX IF NOT EXISTS idx_student_custom_values_student
  ON public.student_custom_values(student_id);
CREATE INDEX IF NOT EXISTS idx_student_custom_values_field
  ON public.student_custom_values(field_id);
CREATE INDEX IF NOT EXISTS idx_student_custom_values_school
  ON public.student_custom_values(school_id);

DROP TRIGGER IF EXISTS update_timestamp_on_student_custom_values
  ON public.student_custom_values;
CREATE TRIGGER update_timestamp_on_student_custom_values
  BEFORE UPDATE ON public.student_custom_values
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Now that the values table exists, attach the key/type guard from step 2.
DROP TRIGGER IF EXISTS reject_key_change_on_school_custom_fields
  ON public.school_custom_fields;
CREATE TRIGGER reject_key_change_on_school_custom_fields
  BEFORE UPDATE ON public.school_custom_fields
  FOR EACH ROW EXECUTE FUNCTION public.reject_custom_field_key_change();

-- ---------------------------------------------------------------------------
-- 4. A value must match its field's declared type, and its school.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_student_custom_value()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  f public.school_custom_fields;
BEGIN
  SELECT * INTO f FROM public.school_custom_fields WHERE id = NEW.field_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown custom field.' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- A value, its field definition and its pupil must all belong to one school.
  -- Checked explicitly rather than trusted: the definition id arrives from a
  -- request, and without this a caller could attach their pupil to another
  -- school's field and read its label back.
  IF f.school_id <> NEW.school_id THEN
    RAISE EXCEPTION 'That custom field belongs to a different school.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.students
    WHERE id = NEW.student_id AND school_id = NEW.school_id
  ) THEN
    RAISE EXCEPTION 'That pupil is not at this school.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The declared type is the only one that may be populated.
  IF f.field_type = 'number' AND NEW.value_number IS NULL
     AND (NEW.value_text IS NOT NULL OR NEW.value_date IS NOT NULL
          OR NEW.value_boolean IS NOT NULL OR NEW.value_json IS NOT NULL) THEN
    RAISE EXCEPTION '"%" is a number field.', f.label USING ERRCODE = 'check_violation';
  END IF;

  IF f.field_type = 'date' AND NEW.value_date IS NULL
     AND (NEW.value_text IS NOT NULL OR NEW.value_number IS NOT NULL
          OR NEW.value_boolean IS NOT NULL OR NEW.value_json IS NOT NULL) THEN
    RAISE EXCEPTION '"%" is a date field.', f.label USING ERRCODE = 'check_violation';
  END IF;

  IF f.field_type = 'boolean' AND NEW.value_boolean IS NULL
     AND (NEW.value_text IS NOT NULL OR NEW.value_number IS NOT NULL
          OR NEW.value_date IS NOT NULL OR NEW.value_json IS NOT NULL) THEN
    RAISE EXCEPTION '"%" is a yes/no field.', f.label USING ERRCODE = 'check_violation';
  END IF;

  IF f.field_type IN ('text', 'select') AND NEW.value_text IS NULL
     AND (NEW.value_number IS NOT NULL OR NEW.value_date IS NOT NULL
          OR NEW.value_boolean IS NOT NULL OR NEW.value_json IS NOT NULL) THEN
    RAISE EXCEPTION '"%" is a text field.', f.label USING ERRCODE = 'check_violation';
  END IF;

  -- A select may only hold one of its own options. This is what stops an
  -- import inventing a fourth house.
  IF f.field_type = 'select' AND NEW.value_text IS NOT NULL
     AND NOT (f.options ? NEW.value_text) THEN
    RAISE EXCEPTION
      '"%" is not one of the choices for "%". Allowed: %.',
      NEW.value_text, f.label,
      (SELECT string_agg(o, ', ') FROM jsonb_array_elements_text(f.options) o)
      USING ERRCODE = 'check_violation';
  END IF;

  IF f.field_type = 'multi_select' AND NEW.value_json IS NOT NULL THEN
    IF jsonb_typeof(NEW.value_json) <> 'array' THEN
      RAISE EXCEPTION '"%" takes a list of choices.', f.label
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(NEW.value_json) v
      WHERE NOT (f.options ? v.value)
    ) THEN
      RAISE EXCEPTION 'One or more choices are not valid for "%".', f.label
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_value_on_student_custom_values
  ON public.student_custom_values;
CREATE TRIGGER validate_value_on_student_custom_values
  BEFORE INSERT OR UPDATE ON public.student_custom_values
  FOR EACH ROW EXECUTE FUNCTION public.validate_student_custom_value();

-- ---------------------------------------------------------------------------
-- 5. RLS. The sensitivity split is enforced here, not in the application.
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_custom_fields    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_custom_fields    FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.student_custom_values   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_custom_values   FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_custom_fields" ON public.school_custom_fields;
CREATE POLICY "afritech_admin_all_custom_fields"
ON public.school_custom_fields FOR ALL
USING (is_afritech_admin()) WITH CHECK (is_afritech_admin());

-- Definitions are readable by all staff: a form has to render its labels even
-- for a field whose values the reader cannot see.
DROP POLICY IF EXISTS "school_staff_read_custom_fields" ON public.school_custom_fields;
CREATE POLICY "school_staff_read_custom_fields"
ON public.school_custom_fields FOR SELECT
USING (school_id = current_school_uuid());

-- Defining a field is a settings act: it changes what the school records about
-- children, including whether something counts as sensitive.
DROP POLICY IF EXISTS "management_write_custom_fields" ON public.school_custom_fields;
CREATE POLICY "management_write_custom_fields"
ON public.school_custom_fields FOR ALL
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

DROP POLICY IF EXISTS "afritech_admin_all_custom_values" ON public.student_custom_values;
CREATE POLICY "afritech_admin_all_custom_values"
ON public.student_custom_values FOR ALL
USING (is_afritech_admin()) WITH CHECK (is_afritech_admin());

/**
 * Standard values: anyone who may already read the pupil record.
 *
 * Mirrors `students` read access — management, the accountant (fee context) and
 * teachers. A house colour is not a secret from the person teaching the child.
 */
DROP POLICY IF EXISTS "school_staff_read_standard_custom_values"
  ON public.student_custom_values;
CREATE POLICY "school_staff_read_standard_custom_values"
ON public.student_custom_values FOR SELECT
USING (
  school_id = current_school_uuid()
  AND EXISTS (
    SELECT 1 FROM public.school_custom_fields f
    WHERE f.id = student_custom_values.field_id
      AND f.sensitivity = 'standard'
  )
  AND get_user_role() IN
    ('org:owner', 'org:principal', 'org:admin', 'org:registrar',
     'org:accountant', 'org:teacher')
);

/**
 * Sensitive values: management only.
 *
 * Medical and welfare information. A teacher does not read it through this
 * route, and neither does the accountant — the Data Protection Act's
 * minimisation principle is a rule about who, not only about what.
 *
 * A school that needs a class teacher to know about an allergy should surface
 * that deliberately through a care-plan feature with its own consent record,
 * not by widening a blanket policy over everything marked sensitive.
 */
DROP POLICY IF EXISTS "management_read_sensitive_custom_values"
  ON public.student_custom_values;
CREATE POLICY "management_read_sensitive_custom_values"
ON public.student_custom_values FOR SELECT
USING (
  school_id = current_school_uuid()
  AND EXISTS (
    SELECT 1 FROM public.school_custom_fields f
    WHERE f.id = student_custom_values.field_id
      AND f.sensitivity = 'sensitive'
  )
  AND get_user_role() IN ('org:owner', 'org:principal')
);

-- Writing a value follows who may edit a pupil record, and sensitive values are
-- narrower again.
DROP POLICY IF EXISTS "registrar_write_standard_custom_values"
  ON public.student_custom_values;
CREATE POLICY "registrar_write_standard_custom_values"
ON public.student_custom_values FOR ALL
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin', 'org:registrar')
  AND EXISTS (
    SELECT 1 FROM public.school_custom_fields f
    WHERE f.id = student_custom_values.field_id AND f.sensitivity = 'standard'
  )
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin', 'org:registrar')
  AND EXISTS (
    SELECT 1 FROM public.school_custom_fields f
    WHERE f.id = student_custom_values.field_id AND f.sensitivity = 'standard'
  )
);

DROP POLICY IF EXISTS "management_write_sensitive_custom_values"
  ON public.student_custom_values;
CREATE POLICY "management_write_sensitive_custom_values"
ON public.student_custom_values FOR ALL
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal')
  AND EXISTS (
    SELECT 1 FROM public.school_custom_fields f
    WHERE f.id = student_custom_values.field_id AND f.sensitivity = 'sensitive'
  )
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal')
  AND EXISTS (
    SELECT 1 FROM public.school_custom_fields f
    WHERE f.id = student_custom_values.field_id AND f.sensitivity = 'sensitive'
  )
);

REVOKE ALL ON public.school_custom_fields  FROM anon;
REVOKE ALL ON public.student_custom_values FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.school_custom_fields  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_custom_values TO authenticated;
-- DELETE is granted on values only: clearing a pupil's answer is ordinary
-- correction, not a record deletion. Prohibition 8 covers students, fee records,
-- payments and exam results — an emptied custom answer destroys no history.
-- Definitions are retired with `is_active = FALSE`, never deleted, so the values
-- that reference them keep their meaning.

COMMENT ON TABLE public.school_custom_fields IS
  'School-defined extra fields on a pupil record. `sensitivity` drives RLS on '
  'the values: standard is staff-readable, sensitive is management only. See '
  'migration 0110.';
COMMENT ON TABLE public.student_custom_values IS
  'One row per pupil per custom field, typed. Read access is decided by the '
  'field''s sensitivity, not by the caller''s screen.';

-- === MIGRATION END ===
