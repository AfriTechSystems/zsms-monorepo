-- Migration: 0103_ceiling_after_rls.sql
-- Created: 2026-08-23
-- Description: Moves the student-ceiling guard from BEFORE to AFTER, so RLS
--              decides who may write before the ceiling says anything about the
--              school being written to.
-- Related documents: Official Documentation/01 Foundation Layer/RLS.md
--                    Official Documentation/01 Foundation Layer/COMPLIANCE.md

-- === MIGRATION START ===

-- THE DEFECT
-- ----------
-- `0101` attached `enforce_student_limit()` as a BEFORE ROW trigger. In
-- PostgreSQL a BEFORE ROW trigger runs **ahead of** the RLS `WITH CHECK`, so the
-- ceiling was evaluated before anyone had established that the caller was
-- allowed to write into that school at all.
--
-- Found by the adversarial suite (`student_ceiling_test.sql`), then isolated:
--
--   School B owner → INSERT INTO students (school_id = School A)
--   →  ZS001: "This school has reached its plan limit of 1 enrolled pupils."
--
-- Three facts about another tenant, to a caller entitled to none of them: that
-- School A exists, that it is full, and the exact number AfriTech has configured
-- as its ceiling. A school's enrolment and its commercial limits are precisely
-- what the tenant boundary exists to keep apart. The correct answer was `42501`,
-- which says only "not permitted".
--
-- The same ordering produced a lesser wrong answer inside a school: an
-- accountant or teacher — who may read the roll but not enrol — was told the
-- school was full rather than that enrolment is not theirs to do. Not a
-- disclosure, but it sends someone to ask for a tier upgrade to solve a
-- permissions problem.
--
-- THE FIX
-- -------
-- AFTER ROW. The insert order becomes: BEFORE triggers → constraints and RLS
-- `WITH CHECK` → the row lands → AFTER triggers. A caller who may not write is
-- refused by the policy and never reaches the ceiling; a caller who may write is
-- still refused by it. Enforcement is unchanged — an exception raised in an
-- AFTER trigger aborts the statement exactly as one raised in a BEFORE trigger
-- does; the row is not committed.
--
-- The one consequence to get right: at AFTER time the new row is already
-- counted, so the comparison moves from `>=` to `>`. Getting that wrong in
-- either direction is silent — one off-by-one lets a school exceed its ceiling
-- by one pupil forever, the other refuses the last legitimate place.

CREATE OR REPLACE FUNCTION public.enforce_student_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech
AS $$
DECLARE
  v_limit     INT;
  v_unlimited BOOLEAN;
  v_count     INT;
BEGIN
  -- Only rows that occupy a place are checked. Importing a graduated pupil for
  -- historical records must not be refused by a ceiling they do not consume.
  IF NEW.is_deleted OR NEW.status NOT IN ('active', 'on_leave') THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Already on the roll before this UPDATE — nothing new is consumed, so an
    -- edit to a name or a class is never blocked by a full school.
    IF NOT OLD.is_deleted AND OLD.status IN ('active', 'on_leave') THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT c.student_limit, c.is_unlimited, c.current_count
    INTO v_limit, v_unlimited, v_count
  FROM public.school_student_capacity(NEW.school_id) c;

  IF v_unlimited THEN
    RETURN NULL;
  END IF;

  -- `>` and not `>=`: this fires after the row is in, so `current_count`
  -- already includes it. At the limit exactly, the school is full but legal.
  IF v_count > v_limit THEN
    RAISE EXCEPTION
      'This school has reached its plan limit of % enrolled pupils. Upgrade the subscription tier, or ask AfriTech for a per-school limit override, to enrol more.',
      v_limit
      USING ERRCODE = 'ZS001';
  END IF;

  -- An AFTER ROW trigger's return value is ignored.
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.enforce_student_limit() IS
  'Refuses an enrolment that exceeds the resolved ceiling. AFTER ROW, so RLS refuses an unauthorised writer first (0103).';

DROP TRIGGER IF EXISTS enforce_student_limit_on_students ON public.students;
CREATE TRIGGER enforce_student_limit_on_students
  AFTER INSERT OR UPDATE OF status, is_deleted, school_id ON public.students
  FOR EACH ROW EXECUTE FUNCTION public.enforce_student_limit();

-- ---------------------------------------------------------------------------
-- Verification
--
-- Structural only, and deliberately so. What actually matters here is the
-- ORDER of two refusals, and only an attempt from a second tenant demonstrates
-- that — which needs two schools, two identities, and a role switch. That is a
-- test, not a migration step: it lives in
-- `supabase/tests/rls/student_ceiling_test.sql`, which is where it was found.
--
-- A migration that tried to run it would have to INSERT an override, switch
-- role, provoke a policy denial, and clean up after itself on a database whose
-- seed contents it cannot assume. The first draft of this file did exactly that
-- and failed on privileges — proving only that the check was in the wrong place.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.students'::regclass
      AND tgname = 'enforce_student_limit_on_students'
      AND NOT tgisinternal
      -- tgtype bit 1 (value 2) set = BEFORE. Clear = AFTER, which is the whole
      -- point of this migration.
      AND (tgtype & 2) = 0
  ) THEN
    RAISE EXCEPTION '0103: the ceiling trigger is missing or is still BEFORE';
  END IF;
END;
$$;

-- === MIGRATION END ===
