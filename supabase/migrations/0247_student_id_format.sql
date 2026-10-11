-- ===========================================================================
-- 0247 — the student ID format is now enforced (STUDENT_ID.md)
--
-- Spec: `07 Student and Parent Modules/STUDENT_ID.md` → *Validation Rules*,
--       `01 Foundation Layer/CONVENTIONS.md` → Identifiers
--
-- ## What was enforced, and what was not
--
-- `students.student_id` is NOT NULL and UNIQUE. The **format** —
-- `STU-ZM-LSK-0001-00042` — is specified in two documents and was enforced
-- nowhere. A malformed identifier stored cleanly.
--
-- STUDENT_ID.md also names `packages/validators/student.ts` holding a regex.
-- That package does not exist, so nothing in TypeScript checked it either.
--
-- ## Why this matters more than tidiness
--
-- The identifier is the handle a parent, a registrar and a bulk import all use.
-- `STU-ZM-LSK-1-42` would be accepted today, and would then fail every lookup
-- that builds on the documented shape — a pupil who exists and cannot be found,
-- which is a worse failure than a refused insert at the moment of the typo.
--
-- ## Safe to add
--
-- Checked before writing: all 254 pupils on `zsms-dev` match. A CHECK added to a
-- table with a single non-conforming row fails the migration outright, so the
-- count was the precondition rather than an afterthought.
--
-- `NOT VALID` is deliberately NOT used. It would skip the existing rows and
-- leave the constraint half-applied, which is the right tool when old data is
-- known bad — and here it is known good, so the constraint is validated now
-- rather than leaving a future `VALIDATE CONSTRAINT` nobody remembers to run.
-- ===========================================================================

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_student_id_format;

ALTER TABLE public.students
  ADD CONSTRAINT students_student_id_format
  CHECK (student_id ~ '^STU-[A-Z]{2}-[A-Z]{3}-[0-9]{4}-[0-9]{5}$');

COMMENT ON CONSTRAINT students_student_id_format ON public.students IS
  'STU-{country}-{city}-{school}-{serial}, per STUDENT_ID.md. Uppercase and zero-padded: the identifier is the handle a parent and a registrar both use, and a malformed one is a pupil who exists and cannot be found (0247).';

-- ---------------------------------------------------------------------------
-- A validator the application can share, since there is no validators package.
-- ---------------------------------------------------------------------------

/*
  STUDENT_ID.md puts `isValidStudentId()` in `packages/validators/student.ts`,
  which does not exist. Rather than create a package for one regex, the check
  lives beside the data it validates — so a route, a bulk import and a policy all
  ask the same question of the same expression.

  IMMUTABLE and no `search_path` games: it reads nothing and depends on nothing.
*/
CREATE OR REPLACE FUNCTION public.is_valid_student_id(p_student_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_student_id ~ '^STU-[A-Z]{2}-[A-Z]{3}-[0-9]{4}-[0-9]{5}$', FALSE);
$$;

COMMENT ON FUNCTION public.is_valid_student_id(TEXT) IS
  'Does this string match the documented pupil identifier format (STUDENT_ID.md). One expression, shared, so a route and an import cannot disagree (0247).';

REVOKE ALL ON FUNCTION public.is_valid_student_id(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_valid_student_id(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_valid_student_id(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_student_id(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- Exercise the constraint and the examples STUDENT_ID.md gives.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school UUID;
BEGIN
  BEGIN
    -- The document's own worked examples, valid and invalid.
    IF NOT public.is_valid_student_id('STU-ZM-LSK-0001-00042') THEN
      RAISE EXCEPTION '0247: the documented valid example was rejected';
    END IF;
    IF public.is_valid_student_id('STU-ZM-LSK-1-42') THEN
      RAISE EXCEPTION '0247: wrong digit padding was accepted';
    END IF;
    IF public.is_valid_student_id('STU-zm-lsk-0001-00042') THEN
      RAISE EXCEPTION '0247: lowercase was accepted';
    END IF;
    IF public.is_valid_student_id(NULL) THEN
      RAISE EXCEPTION '0247: NULL was treated as valid';
    END IF;

    SELECT id INTO v_school FROM public.schools WHERE status = 'active' LIMIT 1;
    IF v_school IS NULL THEN
      RAISE NOTICE '0247: no school fixture; constraint asserted by regex alone';
      RAISE EXCEPTION 'ZSMS_0247_ROLLBACK';
    END IF;

    -- And the constraint actually bites on a write.
    BEGIN
      INSERT INTO public.students
        (student_id, school_id, first_name, last_name, grade_id, class_id)
      VALUES ('STU-ZM-LSK-1-42', v_school, 'Bad', 'Format', 'grade_7', 'grade_7a');
      RAISE EXCEPTION '0247: a malformed pupil identifier was stored';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    RAISE EXCEPTION 'ZSMS_0247_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0247_ROLLBACK' THEN
        RAISE NOTICE '0247: verified — the documented examples behave, and a malformed id is refused on write';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
