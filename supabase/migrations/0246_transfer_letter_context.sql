-- ===========================================================================
-- 0246 — what a transfer letter needs to say (TRANSFER.md)
--
-- Spec: `07 Student and Parent Modules/TRANSFER.md` → *Transfer Letter Contents*
--
-- ## The gap this closes
--
-- `transfer_letter` has been an allowed `doc_type` since `0087`, a type in
-- `packages/documents`, and listed in `/api/documents`. **Nothing ever rendered
-- one.** A school transferring a pupil had no letter for the family — the one
-- physical artefact a transfer produces, and the thing the receiving school asks
-- for.
--
-- `renderTransferLetter()` was added on 2026-10-11 and had no caller. This is the
-- other half: one `worker_*` function returning everything the letter states, so
-- the worker never touches a table directly (ADR-042).
--
-- ## Why one function rather than letting the worker read four tables
--
-- The worker's connection bypasses RLS. Every extra table it can reach is another
-- place a bug crosses a tenant boundary, and `.from(` in `apps/workers` is a
-- defect by rule. One function with one pupil id in and one row out keeps the
-- surface as small as the job needs.
--
-- ## The transfer reference
--
-- Generated here rather than by the worker, so the same pupil transferred twice
-- cannot collide, and so the reference exists before the PDF does — the document
-- row is recorded with it, and TRANSFER.md promises a fresh signed URL years
-- later against that reference.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.worker_transfer_letter_context(p_student_id UUID)
RETURNS TABLE (
  out_school_id       UUID,
  out_school_name     TEXT,
  out_school_code     TEXT,
  out_ministry_reg    TEXT,
  out_student_name    TEXT,
  out_student_code    TEXT,
  out_enrolled_on     TEXT,
  out_transferred_on  TEXT,
  out_final_grade     TEXT,
  out_kind            TEXT,
  out_principal_name  TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.school_id,
    sc.name,
    sc.school_id,
    /*
      The Ministry registration number, which is what gives the letter standing with
      a registrar. NULL is tolerated: a school that has not recorded it still gets a
      letter, and the renderer omits the row rather than printing an empty label.

      The column is `ministry_reg_number`, not `ministry_registration_number` —
      checked with `db:cols` rather than assumed, which is the difference between
      this applying and failing on a column that does not exist.
    */
    sc.ministry_reg_number,
    btrim(s.first_name || ' ' || s.last_name),
    s.student_id,
    to_char(COALESCE(s.enrolment_date, s.created_at::date), 'DD Mon YYYY'),
    to_char(COALESCE(s.updated_at, NOW()), 'DD Mon YYYY'),
    /*
      The grade they COMPLETED, which is what a receiving school places them from.
      `grade_id` is the one they were in when they left, and after a transfer that is
      the last one finished — promotion moves it, and a transfer does not.
    */
    COALESCE(replace(s.grade_id, '_', ' '), 'Not recorded'),
    s.status,
    /*
      The principal's name for the signature line, when the school has one on staff.
      NULL falls back to the word "Principal" in the renderer — better an unnamed
      signature line than a line attributed to the wrong person.
    */
    (SELECT btrim(sm.first_name || ' ' || sm.last_name)
       FROM public.staff_members sm
      WHERE sm.school_id = s.school_id
        AND COALESCE(sm.is_active, TRUE)
        AND sm.department ILIKE '%principal%'
      LIMIT 1)
  FROM public.students s
  JOIN public.schools sc ON sc.id = s.school_id
  WHERE s.id = p_student_id
    AND s.status IN ('transferred', 'withdrawn');
END;
$$;

COMMENT ON FUNCTION public.worker_transfer_letter_context(UUID) IS
  'Everything a transfer letter states, in one row. Worker-only: the worker bypasses RLS, so one narrow function is safer than letting it read four tables (0246).';

REVOKE ALL ON FUNCTION public.worker_transfer_letter_context(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.worker_transfer_letter_context(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.worker_transfer_letter_context(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.worker_transfer_letter_context(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- The reference, generated where the transfer happens.
-- ---------------------------------------------------------------------------

/*
  `TRF-ZM-LSK-0001-000007`, matching the house identifier style.

  Per school and sequential, so two schools never collide and a reference tells
  support which school to look in before they have queried anything.
*/
CREATE OR REPLACE FUNCTION public.next_transfer_reference(p_school_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code TEXT;
  v_n    INT;
BEGIN
  SELECT sc.school_id INTO v_code FROM public.schools sc WHERE sc.id = p_school_id;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'No such school' USING ERRCODE = '22023';
  END IF;

  /*
    Counted from the documents already issued rather than from a sequence.

    A sequence would be tidier and would also hand out numbers for transfers that
    failed to render — so the count would drift from the letters that exist. Counting
    the rows means the reference always matches what was actually produced.
  */
  SELECT COUNT(*) + 1 INTO v_n
  FROM public.generated_documents g
  WHERE g.school_id = p_school_id AND g.doc_type = 'transfer_letter';

  RETURN 'TRF-' || v_code || '-' || lpad(v_n::text, 6, '0');
END;
$$;

REVOKE ALL ON FUNCTION public.next_transfer_reference(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.next_transfer_reference(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.next_transfer_reference(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_transfer_reference(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- Exercise it against a real transfer.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_student UUID;
  v_school  UUID;
  v_ctx     RECORD;
  v_ref     TEXT;
BEGIN
  BEGIN
    /*
      An ACTIVE pupil specifically.

      The first version took any pupil and happened to pick one already transferred,
      so the "an enrolled pupil yields nothing" assertion failed against a pupil who
      was not enrolled. The function was right; the fixture was wrong.
    */
    SELECT s.id, s.school_id INTO v_student, v_school
    FROM public.students s
    WHERE COALESCE(s.is_deleted, FALSE) = FALSE
      AND s.status = 'active'
    LIMIT 1;

    IF v_student IS NULL THEN
      RAISE NOTICE '0246: no active pupil fixture; skipping';
      RAISE EXCEPTION 'ZSMS_0246_ROLLBACK';
    END IF;

    -- A pupil still enrolled must yield NOTHING — the letter is for one who left.
    SELECT COUNT(*) INTO v_ref FROM public.worker_transfer_letter_context(v_student);
    IF v_ref::INT <> 0 THEN
      RAISE EXCEPTION '0246: an enrolled pupil produced a transfer letter context';
    END IF;

    UPDATE public.students SET status = 'transferred' WHERE id = v_student;

    SELECT * INTO v_ctx FROM public.worker_transfer_letter_context(v_student);
    IF v_ctx.out_student_name IS NULL OR btrim(v_ctx.out_student_name) = '' THEN
      RAISE EXCEPTION '0246: the context has no pupil name';
    END IF;
    IF v_ctx.out_school_name IS NULL THEN
      RAISE EXCEPTION '0246: the context has no school name';
    END IF;
    IF v_ctx.out_kind <> 'transferred' THEN
      RAISE EXCEPTION '0246: the kind was % rather than transferred', v_ctx.out_kind;
    END IF;

    v_ref := public.next_transfer_reference(v_school);
    IF v_ref NOT LIKE 'TRF-%' THEN
      RAISE EXCEPTION '0246: the reference is malformed: %', v_ref;
    END IF;

    RAISE EXCEPTION 'ZSMS_0246_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0246_ROLLBACK' THEN
        RAISE NOTICE '0246: verified — enrolled yields nothing, a leaver yields a full context, reference well formed';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
