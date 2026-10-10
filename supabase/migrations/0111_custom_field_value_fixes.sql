-- Migration: 0111_custom_field_value_fixes.sql
-- Created: 2026-09-26
-- Description: Two corrections to 0110, both found by its own pgTAP suite.
-- Related documents: Official Documentation/07 Student and Parent Modules/STUDENTS.md
--
-- ===========================================================================
-- CORRECTION 1 — the integrity check was doing authorisation by accident
--
-- `validate_student_custom_value()` was SECURITY INVOKER, so its
--
--   EXISTS (SELECT 1 FROM students WHERE id = ... AND school_id = ...)
--
-- ran under the caller's RLS. The question it means to ask is a fact about the
-- data — "does this pupil belong to this school" — but what it actually asked
-- was "can *you* see this pupil", and it reported the answer as
-- "That pupil is not at this school."
--
-- That message was simply false for any caller who could write a value but not
-- read `students`, and it made a validation error look like a data error. The
-- check is now SECURITY DEFINER: it validates the fact. Who may write remains
-- entirely the RLS policies' decision, which is where it belongs.
--
-- Safe against probing: the WITH CHECK on `student_custom_values` still requires
-- `school_id = current_school_uuid()`, so a caller can only ever assert their
-- own school. Passing a foreign pupil id fails the EXISTS and learns only that
-- the pupil is not theirs — which they knew.
--
-- CORRECTION 2 — 0110 invented a role grant the rest of ZSMS does not give
--
-- 0110's value policies named `org:registrar` as a writer of standard fields.
-- But `org:registrar` has **no policy on `students` at all**: the read policy
-- lists owner, principal, admin and accountant, and `lib/roles.ts` grants
-- `students:write` to owner, principal and admin. The app and the database agree
-- that a registrar touches no pupil record.
--
-- So 0110 would have let a role edit custom fields on a pupil it cannot see or
-- otherwise edit — a capability invented in one migration and contradicted
-- everywhere else. Custom fields are part of the pupil record and follow the
-- pupil record's access exactly. Whether `org:registrar` *should* have pupil
-- access is a real product question, but it is not one a custom-fields migration
-- gets to answer by itself.
-- ===========================================================================

-- === MIGRATION START ===

CREATE OR REPLACE FUNCTION public.validate_student_custom_value()
RETURNS TRIGGER
LANGUAGE plpgsql
-- DEFINER: this validates facts, not permissions. See the header.
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  f public.school_custom_fields;
BEGIN
  SELECT * INTO f FROM public.school_custom_fields WHERE id = NEW.field_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown custom field.' USING ERRCODE = 'foreign_key_violation';
  END IF;

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

-- ---------------------------------------------------------------------------
-- Value access now mirrors pupil-record access exactly.
-- ---------------------------------------------------------------------------
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
  -- Matches `school_management_read_students` plus the teacher case below it.
  AND (
    get_user_role() IN ('org:owner', 'org:principal', 'org:admin', 'org:accountant')
    OR (
      get_user_role() = 'org:teacher'
      AND EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.id = student_custom_values.student_id
          AND public.teacher_reaches_class(s.class_id)
      )
    )
  )
);

-- A teacher reads custom fields only for pupils they actually teach, exactly as
-- `teacher_read_assigned_students` already decides for the pupil record. 0110
-- gave every teacher every standard value in the school, which was wider than
-- the record those values hang off.

DROP POLICY IF EXISTS "registrar_write_standard_custom_values"
  ON public.student_custom_values;

DROP POLICY IF EXISTS "management_write_standard_custom_values"
  ON public.student_custom_values;
CREATE POLICY "management_write_standard_custom_values"
ON public.student_custom_values FOR ALL
USING (
  school_id = current_school_uuid()
  -- `students:write` in lib/roles.ts. Not registrar: see the header.
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  AND EXISTS (
    SELECT 1 FROM public.school_custom_fields f
    WHERE f.id = student_custom_values.field_id AND f.sensitivity = 'standard'
  )
)
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  AND EXISTS (
    SELECT 1 FROM public.school_custom_fields f
    WHERE f.id = student_custom_values.field_id AND f.sensitivity = 'standard'
  )
);

-- === MIGRATION END ===
