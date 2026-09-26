-- Migration: 0112_import_students.sql
-- Created: 2026-09-26
-- Description: Bulk pupil import in one transaction — standard columns, custom
--              field values, and pupil identifiers allocated without gaps or
--              reuse.
-- Related documents: Official Documentation/07 Student and Parent Modules/STUDENTS.md
--                    Official Documentation/01 Foundation Layer/CONVENTIONS.md — identifiers
--
-- ===========================================================================
-- WHY THIS IS ONE FUNCTION AND NOT A LOOP IN THE API
--
-- An import that fails on row 251 of 400 leaves a half-filled roll. The obvious
-- recovery — run it again — then duplicates the 250 rows that did land. So the
-- whole import is one transaction: every pupil and every custom value, or
-- nothing.
--
-- It also has to allocate identifiers, and that cannot be done from the
-- application one row at a time without either a round trip per pupil or a race.
--
-- THE IDENTIFIER BUG THIS AVOIDS
--
-- `nextStudentId()` in `lib/school-context.ts` derives the next sequence from
--
--   SELECT count(*) FROM students WHERE school_id = ...
--
-- Two problems, and the second is the serious one:
--
--   * Concurrent enrolments read the same count and mint the same identifier.
--   * **A soft delete lowers the count**, so the next pupil is given an
--     identifier that already belongs to a withdrawn pupil. `STU-…-00042` then
--     refers to two children, one of them only in history — and prohibition 8
--     guarantees that history is still there.
--
-- This function takes MAX of the existing numeric suffix instead, which never
-- reuses a number and never needs the row it counts to still be active. The
-- single-enrolment path still uses the count and is tracked as an open item;
-- fixing it is a separate change to a route this migration does not touch.
-- ===========================================================================

-- === MIGRATION START ===

CREATE OR REPLACE FUNCTION public.next_student_sequence(p_school_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
-- DEFINER so the maximum is taken over EVERY pupil, including soft-deleted ones
-- and any the caller's policy would hide. An identifier must be unique against
-- the whole table, not against the subset this caller can see.
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    MAX(NULLIF(regexp_replace(student_id, '^.*-', ''), '')::INT), 0
  ) + 1
  FROM public.students
  WHERE school_id = p_school_id;
$$;

COMMENT ON FUNCTION public.next_student_sequence(UUID) IS
  'Next pupil sequence number for a school, from MAX of existing suffixes — not '
  'from a row count, which reuses numbers after a soft delete. See 0112.';

CREATE OR REPLACE FUNCTION public.import_students(p_rows JSONB)
RETURNS TABLE (created_count INT)
LANGUAGE plpgsql
-- INVOKER: every INSERT below is still filtered by `management_write_students`
-- and by the custom-value policies. This function makes the import atomic; it
-- does not widen who may import.
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school   UUID := public.current_school_uuid();
  v_code     TEXT;
  v_seq      INT;
  v_row      JSONB;
  v_student  JSONB;
  v_custom   JSONB;
  v_value    JSONB;
  v_new_id   UUID;
  v_created  INT := 0;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'No school in session.' USING ERRCODE = '42501';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array'
     OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'Nothing to import.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT school_id INTO v_code FROM public.schools WHERE id = v_school;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'School not found.' USING ERRCODE = 'no_data_found';
  END IF;

  v_seq := public.next_student_sequence(v_school);

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_student := v_row->'student';
    v_custom  := v_row->'custom';

    INSERT INTO public.students
      (student_id, school_id, first_name, last_name, grade_id, class_id,
       date_of_birth, gender, nrc_or_birth_cert, enrolment_date, is_boarding)
    VALUES (
      'STU-' || v_code || '-' || lpad(v_seq::TEXT, 5, '0'),
      -- From the session, never from the payload: the API sets it too, and this
      -- is the layer that cannot be talked out of it.
      v_school,
      v_student->>'first_name',
      v_student->>'last_name',
      v_student->>'grade_id',
      v_student->>'class_id',
      NULLIF(v_student->>'date_of_birth', '')::DATE,
      NULLIF(v_student->>'gender', ''),
      NULLIF(v_student->>'nrc_or_birth_cert', ''),
      COALESCE(NULLIF(v_student->>'enrolment_date', '')::DATE, CURRENT_DATE),
      COALESCE((v_student->>'is_boarding')::BOOLEAN, FALSE)
    )
    RETURNING id INTO v_new_id;

    -- The student ceiling trigger (0101–0103) fires here, per row, and raises
    -- ZS001 if this import crosses the plan limit. The API checks the arithmetic
    -- up front so the message names the numbers; this is the guarantee.

    IF v_custom IS NOT NULL AND jsonb_typeof(v_custom) = 'array' THEN
      FOR v_value IN SELECT * FROM jsonb_array_elements(v_custom)
      LOOP
        INSERT INTO public.student_custom_values
          (school_id, student_id, field_id,
           value_text, value_number, value_date, value_boolean, value_json)
        VALUES (
          v_school,
          v_new_id,
          (v_value->>'field_id')::UUID,
          NULLIF(v_value->>'value_text', ''),
          NULLIF(v_value->>'value_number', '')::NUMERIC,
          NULLIF(v_value->>'value_date', '')::DATE,
          CASE WHEN v_value->>'value_boolean' IS NULL THEN NULL
               ELSE (v_value->>'value_boolean')::BOOLEAN END,
          CASE WHEN jsonb_typeof(v_value->'value_json') = 'array'
               THEN v_value->'value_json' ELSE NULL END
        );
      END LOOP;
    END IF;

    v_seq     := v_seq + 1;
    v_created := v_created + 1;
  END LOOP;

  RETURN QUERY SELECT v_created;
END;
$$;

COMMENT ON FUNCTION public.import_students(JSONB) IS
  'Creates pupils and their custom field values in one transaction. All or '
  'nothing, so a failed import never leaves a partial roll to reconcile.';

GRANT EXECUTE ON FUNCTION public.next_student_sequence(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_students(JSONB) TO authenticated;

-- === MIGRATION END ===
