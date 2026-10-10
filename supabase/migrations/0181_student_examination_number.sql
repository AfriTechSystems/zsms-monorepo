-- ---------------------------------------------------------------------------
-- 0181 — the candidate number a school writes on a mark sheet
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/07 Student and Parent Modules/STUDENTS.md`
--         → *Student Record*, *Examination Number*
--
-- ## What the document specifies and the schema lacked
--
-- `STUDENTS.md` lists two columns `public.students` does not have:
-- `examination_number` and `alumni_status`.
--
-- **Only one of them is added here, and the omission is deliberate.**
--
--   * `examination_number` is real and missing. The document names three places
--     it must appear — report cards for examination classes, the marks entry
--     screen beside the pupil's name so a teacher can cross-reference a physical
--     ECZ mark sheet, and the profile page. None of them could show it.
--   * `alumni_status` would duplicate `status`, which already admits
--     `graduated`, `transferred` and `withdrawn` alongside `active` and
--     `on_leave`. Adding a second column meaning the same thing is how two
--     sources of truth diverge: a pupil marked `graduated` in one and `active`
--     in the other is a question with no answer. The document predates the
--     `status` CHECK; `status` won.
--
-- ## Unique per school, not globally
--
-- A candidate number is issued by ECZ or Cambridge and is unique within an
-- examination centre, not across Zambia — and two schools can legitimately hold
-- the same string. The partial unique index is per `school_id`, and ignores
-- NULLs, because the field is optional for Grades 1–5 and 7–11 and most pupils
-- will never have one.
--
-- It also ignores soft-deleted rows: a pupil who left should not block the
-- number being reissued to the pupil who replaced them in the centre's register.
-- ---------------------------------------------------------------------------

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS examination_number TEXT;

COMMENT ON COLUMN public.students.examination_number IS
  'ECZ or Cambridge candidate registration number. Optional — set for Grade 6, Form 4 and '
  'Form 6 only. Unique within a school, never globally: a centre issues it, not the country.';

-- Trimmed-empty is NULL, not ''. An empty string would occupy the unique index
-- and make the second pupil with a blank field collide with the first.
ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_examination_number_not_blank;
ALTER TABLE public.students
  ADD CONSTRAINT students_examination_number_not_blank
  CHECK (examination_number IS NULL OR btrim(examination_number) <> '');

CREATE UNIQUE INDEX IF NOT EXISTS idx_students_examination_number
  ON public.students(school_id, examination_number)
  WHERE examination_number IS NOT NULL AND is_deleted = FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'students'
      AND column_name = 'examination_number'
  ) THEN
    RAISE EXCEPTION 'examination_number was not added';
  END IF;

  -- `alumni_status` must NOT appear: `status` already carries it, and a second
  -- column meaning the same thing is the defect this migration declined to add.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'students'
      AND column_name = 'alumni_status'
  ) THEN
    RAISE EXCEPTION
      'alumni_status exists — it duplicates students.status, which already admits graduated/transferred/withdrawn';
  END IF;
END;
$$;
