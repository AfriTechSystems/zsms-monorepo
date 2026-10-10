-- Migration: 0141_school_settings.sql
-- Created: 2026-09-29
-- Description: The two profile columns SCHOOL_CONFIG.md specified and the schema never had, plus
--              term dates, which nothing anywhere stored.
-- Related documents: Official Documentation/06 School and Tenant Management/SCHOOL_CONFIG.md
--                    Official Documentation/04 Country and Configuration/ZM.md
--
-- ===========================================================================
-- TWO DOCUMENTED COLUMNS THAT DID NOT EXIST, AND A TABLE NOBODY HAD NOTICED WAS MISSING
--
-- `SCHOOL_CONFIG.md`'s School Profile table lists nine fields against their database columns.
-- **Two of those columns have never existed**: `schools.display_name` and
-- `schools.ministry_reg_number`. The document states them as fact, with a `DB Column` heading above
-- them. Found by building the form the document describes — the same way `class_enrolments` and the
-- missing payment-verification columns were found, and the reason CLAUDE.md says to verify against
-- the applied schema rather than the documentation.
--
-- The larger gap is **term dates**. The Settings panel lists "Term Dates — Academic year, term
-- start/end dates" and nothing in the schema holds them. `fee_structures`, `exam_results` and
-- `attendance_records` all carry `academic_year` and `term_number`, so the whole product already
-- reasons in terms — it simply has no idea when one starts or ends. Which means nothing can answer
-- "what term is it today", and every screen that wants to know has to be told.
--
-- ---------------------------------------------------------------------------
-- TERMS MAY NOT OVERLAP, AND THE DATABASE SAYS SO
-- ---------------------------------------------------------------------------
-- Two terms covering the same day makes `current_term()` ambiguous, and an ambiguous answer here
-- propagates: fee issuing, mark entry and attendance all key off the term. The exclusion trigger is
-- the same shape as `0124`'s price-band overlap check, for the same reason — a rule that must hold
-- across rows belongs beside the rows, not in whichever screen last wrote one.
--
-- ---------------------------------------------------------------------------
-- `term_number` IS NOT CAPPED AT THREE
-- ---------------------------------------------------------------------------
-- Zambia runs three terms and the temptation is `CHECK (term_number BETWEEN 1 AND 3)`. ADR-040
-- already tracks five hardcoded CHECKs that each need a migration to admit a second country, and
-- this would be a sixth. A positive integer is the real constraint; three is a fact about Zambia,
-- and the uniqueness key stops a school inventing a fourth by accident.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. The two missing profile columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS display_name         TEXT,
  ADD COLUMN IF NOT EXISTS ministry_reg_number  TEXT;

COMMENT ON COLUMN public.schools.display_name IS
  'Short name for portal headers and tight spaces. NULL means use `name` — a school with a short '
  'name needs no second one, and defaulting it would create two fields to keep in step.';

COMMENT ON COLUMN public.schools.ministry_reg_number IS
  'Ministry of Education registration number. Optional, and printed on attendance certificates and '
  'formal documents where it is expected.';

/**
 * Added to the profile grant from `0140`.
 *
 * `GRANT UPDATE (cols)` is additive per column, so this widens the existing grant rather than
 * replacing it — the commercial columns revoked in `0140` stay revoked. Stated because the
 * tempting shorthand is to re-issue the whole list, and a re-issue that forgot to omit
 * `subscription_tier` would silently restore the escalation `0140` closed.
 */
GRANT UPDATE (display_name, ministry_reg_number) ON public.schools TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Term dates.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_term_dates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID NOT NULL REFERENCES public.schools(id),
  -- Text rather than an integer: `academic_year` is text everywhere else in this schema, and
  -- `2026/2027` is a real form in some systems even though Zambia uses a single year.
  academic_year TEXT NOT NULL,
  term_number   INT  NOT NULL CHECK (term_number > 0),
  starts_on     DATE NOT NULL,
  ends_on       DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT school_term_dates_order CHECK (ends_on > starts_on),
  -- One row per term per year per school. This is what makes re-saving a corrected date an update
  -- rather than a second, competing term.
  UNIQUE (school_id, academic_year, term_number)
);

CREATE INDEX IF NOT EXISTS idx_school_term_dates_lookup
  ON public.school_term_dates(school_id, starts_on, ends_on);

COMMENT ON TABLE public.school_term_dates IS
  'When each term runs. The product has reasoned in terms since the fee module — fee_structures, '
  'exam_results and attendance_records all carry academic_year and term_number — without anything '
  'knowing when a term actually starts.';

CREATE TRIGGER set_updated_at_on_school_term_dates
  BEFORE UPDATE ON public.school_term_dates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Terms may not overlap.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_overlapping_terms()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_clash RECORD;
BEGIN
  SELECT t.academic_year, t.term_number, t.starts_on, t.ends_on
    INTO v_clash
    FROM public.school_term_dates t
   WHERE t.school_id = NEW.school_id
     AND t.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
     -- Two ranges overlap when each starts before the other ends. Inclusive on both ends, because
     -- a term ending the same day another begins is a real mistake rather than a boundary case.
     AND t.starts_on <= NEW.ends_on
     AND NEW.starts_on <= t.ends_on
   LIMIT 1;

  IF FOUND THEN
    /**
     * Names the term it collides with. "Overlapping dates" leaves somebody comparing six rows by
     * hand; saying which one turns it into a correction. Same reasoning as the price-band trigger.
     */
    RAISE EXCEPTION
      'Those dates overlap % term % (% to %).',
      v_clash.academic_year, v_clash.term_number, v_clash.starts_on, v_clash.ends_on
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER reject_overlap_on_school_term_dates
  BEFORE INSERT OR UPDATE ON public.school_term_dates
  FOR EACH ROW EXECUTE FUNCTION public.reject_overlapping_terms();

-- ---------------------------------------------------------------------------
-- 4. What term is it?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_term(
  p_school_id UUID DEFAULT NULL,
  p_on_date   DATE DEFAULT NULL
)
RETURNS TABLE (academic_year TEXT, term_number INT, starts_on DATE, ends_on DATE, is_between BOOLEAN)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := COALESCE(p_school_id, public.current_school_uuid());
  v_date   DATE := COALESCE(p_on_date, CURRENT_DATE);
BEGIN
  IF v_school IS NULL THEN
    RETURN;
  END IF;

  -- The term containing the date.
  RETURN QUERY
  SELECT t.academic_year, t.term_number, t.starts_on, t.ends_on, FALSE
  FROM   public.school_term_dates t
  WHERE  t.school_id = v_school AND v_date BETWEEN t.starts_on AND t.ends_on
  LIMIT  1;

  IF FOUND THEN
    RETURN;
  END IF;

  /**
   * Nothing contains today, so it is a holiday — and the useful answer is the term that is coming,
   * not silence. `is_between` says which case this is, so a screen can print "Term 2 starts on
   * 14 May" rather than a blank where a term name should be.
   *
   * Returning nothing at all in the holidays would have every caller special-casing a third of
   * the year.
   */
  RETURN QUERY
  SELECT t.academic_year, t.term_number, t.starts_on, t.ends_on, TRUE
  FROM   public.school_term_dates t
  WHERE  t.school_id = v_school AND t.starts_on > v_date
  ORDER  BY t.starts_on
  LIMIT  1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.current_term(UUID, DATE) TO authenticated;

COMMENT ON FUNCTION public.current_term(UUID, DATE) IS
  'The term containing a date, or — in the holidays — the next one, with is_between TRUE. Never '
  'returns nothing when any term is configured, so callers do not each special-case the holidays.';

-- ---------------------------------------------------------------------------
-- 5. RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_term_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_term_dates FORCE  ROW LEVEL SECURITY;

-- Every member of staff reads the calendar. A teacher needs to know when the term ends.
CREATE POLICY school_staff_read_term_dates
  ON public.school_term_dates FOR SELECT TO authenticated
  USING (
    school_id = public.current_school_uuid()
    OR COALESCE(public.is_afritech_admin(), FALSE)
  );

/**
 * Leadership writes it. Not the accountant and not a teacher: term dates move fee issuing, mark
 * entry and attendance all at once, so this is a school-calendar decision rather than a
 * departmental one.
 */
CREATE POLICY management_write_term_dates
  ON public.school_term_dates FOR ALL TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  )
  WITH CHECK (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  );

CREATE POLICY afritech_admin_all_term_dates
  ON public.school_term_dates FOR ALL TO authenticated
  USING (COALESCE(public.is_afritech_admin(), FALSE))
  WITH CHECK (COALESCE(public.is_afritech_admin(), FALSE));

/**
 * No DELETE, per the repository-wide invariant `0129` had to restore twice — `tenant_isolation_test`
 * asserts no end-user role holds DELETE anywhere in `public`. Removing a term is rare and
 * consequential (fee records and marks reference the term number), so it is an AfriTech support
 * action rather than a button.
 */
GRANT SELECT, INSERT, UPDATE ON public.school_term_dates TO authenticated;

-- === MIGRATION END ===
