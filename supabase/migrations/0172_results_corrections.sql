-- ---------------------------------------------------------------------------
-- 0172 — correcting a published mark
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/11 Examinations and Results/PUBLISHING.md`
--         → *Post-Publication Corrections*
--       `Official Documentation/11 Examinations and Results/RESULTS.md`
--
-- ## What was missing
--
-- `0074`'s `teacher_update_unpublished_results` locks a mark the moment it is
-- published, which is correct: published results are the school's official
-- position and parents are looking at them. But a transposed mark — 28 where 82
-- was meant — then had no route at all. The documented workflow existed on paper
-- and nowhere else, so a school's only options were to leave a wrong mark on a
-- child's record or to have AfriTech edit the database by hand.
--
-- ## The unlock is granular, and that is the point
--
-- `admin_unlock_result()` takes ONE result row. Not a class, not a subject, not a
-- term. `PUBLISHING.md` is explicit — "unlocking one student's result for one
-- subject does not unlock any other results ... minimum necessary access" — and
-- the reason is that a bulk unlock during a correction would silently withdraw
-- every other mark from the parents already reading them.
--
-- ## Why a reason is mandatory
--
-- The reason is NOT NULL and non-empty, and lands in `audit_logs`. A correction
-- changes a child's academic record after the school has told the family what it
-- was; six months later, "why does this say 82 when the report card said 28" has
-- to be answerable by somebody who was not there. An optional field would be
-- blank on exactly the corrections that later matter.
--
-- ## Who may do it
--
-- Owner and principal only, matching business rule 1 — publication is their act,
-- so unpublishing part of it must be too. A teacher who finds their own error
-- asks; that asking is the control. The role check is INSIDE the function
-- because `authenticated` covers every staff member, so the GRANT cannot express
-- it.
--
-- ## Re-locking is automatic
--
-- Step 9 of the documented flow: saving the correction re-locks the row. That is
-- a trigger rather than a thing the route remembers, because a row left unlocked
-- is invisible — nothing on any screen distinguishes "awaiting correction" from
-- "never published", and the mark would quietly leave the parents' view until
-- somebody noticed.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Why a row is currently unlocked, and for whom.
-- ---------------------------------------------------------------------------
ALTER TABLE public.exam_results
  ADD COLUMN IF NOT EXISTS unlocked_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unlocked_by     TEXT,
  ADD COLUMN IF NOT EXISTS unlock_reason   TEXT,
  -- Set when a published row is unlocked, so the trigger below knows the row is
  -- mid-correction rather than never published. Without it, re-locking could not
  -- tell a correction from a first entry.
  ADD COLUMN IF NOT EXISTS was_published   BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.exam_results.was_published IS
  'TRUE once this result has ever been published. Distinguishes a row mid-correction '
  'from one never published, which is what lets the re-lock trigger fire only on the former.';

CREATE INDEX IF NOT EXISTS idx_exam_results_unlocked
  ON public.exam_results(school_id, unlocked_at DESC)
  WHERE unlocked_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Unlock one result.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.unlock_result_for_correction(
  p_result_id UUID,
  p_reason    TEXT
)
RETURNS TABLE (out_unlocked BOOLEAN, out_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_role   TEXT := auth.jwt() -> 'o' ->> 'rol';
  v_row    RECORD;
BEGIN
  IF v_school IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  /*
    Owner and principal only. Checked here rather than left to the GRANT, which
    covers every `authenticated` caller including the teacher whose mark it is.
    Clerk sends the bare form (`owner`), which is the shape every other policy in
    this schema compares against.
  */
  IF v_role NOT IN ('owner', 'principal') THEN
    RAISE EXCEPTION
      'Only the owner or principal may unlock a published result for correction'
      USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to unlock a published result'
      USING ERRCODE = '22023';
  END IF;

  SELECT r.id, r.student_id, r.subject_code, r.marks_obtained, r.results_published
    INTO v_row
  FROM public.exam_results AS r
  WHERE r.id = p_result_id
    -- Own school only. This is a DEFINER function, so the clause is the guard.
    AND r.school_id = v_school;

  IF v_row IS NULL THEN
    RETURN QUERY SELECT FALSE, 'That result is not available.'::TEXT;
    RETURN;
  END IF;

  IF NOT v_row.results_published THEN
    RETURN QUERY SELECT FALSE, 'That result is not published, so it can already be edited.'::TEXT;
    RETURN;
  END IF;

  UPDATE public.exam_results AS r
     SET results_published = FALSE,
         was_published     = TRUE,
         unlocked_at       = NOW(),
         unlocked_by       = v_user,
         unlock_reason     = btrim(p_reason),
         updated_at        = NOW()
   WHERE r.id = p_result_id
     AND r.school_id = v_school;

  PERFORM public.log_audit_event(
    'results_unlock', 'exam_results', p_result_id,
    jsonb_build_object(
      'student_id', v_row.student_id,
      'subject_code', v_row.subject_code,
      'reason', btrim(p_reason),
      'mark_at_unlock', v_row.marks_obtained
    ),
    v_school
  );

  RETURN QUERY SELECT TRUE, 'Unlocked. Correct the mark — it re-locks when saved.'::TEXT;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Re-lock on save, and record what changed.
--
-- A trigger, not something a route remembers. A row left unlocked is INVISIBLE:
-- nothing on any screen distinguishes "awaiting correction" from "never
-- published", so the mark would quietly vanish from the parents' view until
-- somebody noticed months later.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.relock_corrected_result()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Only a row that is mid-correction: previously published, currently unlocked,
  -- and whose mark actually moved. A row never published is a normal entry.
  IF OLD.was_published
     AND OLD.unlocked_at IS NOT NULL
     AND NEW.marks_obtained IS DISTINCT FROM OLD.marks_obtained
  THEN
    NEW.results_published := TRUE;
    NEW.published_at      := COALESCE(OLD.published_at, NOW());
    NEW.unlocked_at       := NULL;
    NEW.unlocked_by       := NULL;
    NEW.unlock_reason     := NULL;

    PERFORM public.log_audit_event(
      'results_correction', 'exam_results', NEW.id,
      jsonb_build_object(
        'student_id', NEW.student_id,
        'subject_code', NEW.subject_code,
        'old_mark', OLD.marks_obtained,
        'new_mark', NEW.marks_obtained,
        'reason', OLD.unlock_reason
      ),
      NEW.school_id
    );
  END IF;

  RETURN NEW;
END;
$$;

-- BEFORE, because it rewrites the row being written. This is the one case the
-- 0103 rule does not cover: it raises nothing and describes no tenant state, it
-- only edits columns on the row the caller already passed RLS to reach.
DROP TRIGGER IF EXISTS relock_corrected_result_on_exam_results ON public.exam_results;
CREATE TRIGGER relock_corrected_result_on_exam_results
  BEFORE UPDATE ON public.exam_results
  FOR EACH ROW EXECUTE FUNCTION public.relock_corrected_result();

-- ---------------------------------------------------------------------------
-- 4. Keep `was_published` true forever once published.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_result_published()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.results_published AND NOT COALESCE(OLD.was_published, FALSE) THEN
    NEW.was_published := TRUE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mark_result_published_on_exam_results ON public.exam_results;
-- Name sorts BEFORE `relock_...`, and Postgres fires same-event triggers in NAME
-- order — so `was_published` is set before the re-lock trigger reads it. Two
-- guards on one table speaking in the wrong order is a mistake this repo has
-- already made once (0153/0154).
CREATE TRIGGER mark_result_published_on_exam_results
  BEFORE UPDATE ON public.exam_results
  FOR EACH ROW EXECUTE FUNCTION public.mark_result_published();

-- Backfill: anything published today has been published.
UPDATE public.exam_results SET was_published = TRUE
 WHERE results_published AND NOT was_published;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.unlock_result_for_correction(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unlock_result_for_correction(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.unlock_result_for_correction(UUID, TEXT) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.unlock_result_for_correction(UUID, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'unlock_result_for_correction is executable by anon';
  END IF;
  IF NOT has_function_privilege(
       'authenticated', 'public.unlock_result_for_correction(UUID, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute unlock_result_for_correction';
  END IF;
END;
$$;
