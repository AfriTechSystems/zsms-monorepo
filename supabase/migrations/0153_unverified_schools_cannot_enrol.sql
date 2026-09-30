-- Migration: 0153_unverified_schools_cannot_enrol.sql
-- Created: 2026-09-30
-- Description: Resolves the `pending_verification` contradiction in favour of the stricter reading:
--              an unverified school cannot put a child's personal data into ZSMS.
-- Related documents: Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md
--                    Official Documentation/15 Super Admin and Platform/ONBOARDING.md
--                    Official Documentation/01 Foundation Layer/COMPLIANCE.md
--
-- ===========================================================================
-- TWO DOCUMENTS, ONE CONTRADICTION, AND A COMPLIANCE ARGUMENT THAT SETTLES IT
--
-- `SCHOOL_SETUP.md`'s lifecycle table gives `pending_verification` "limited" write access, and its
-- business rule 4 says such a school "can log in and enter basic configuration (grade structure,
-- subjects) but cannot invite parents or import students until activated."
--
-- `ONBOARDING.md`'s pilot process contradicts it directly: step 3 has AfriTech "import student data
-- together" during the guided session, and step 5 activates the school afterwards.
--
-- `0149` declined to guess and treated the status as fully writable, recording the conflict. This
-- migration settles it, and the deciding argument is not which document is older:
--
-- **`pending_verification` means AfriTech has not yet confirmed this school is real.** Allowing it to
-- load pupil records means accepting several hundred children's names, dates of birth and in some
-- cases medical notes from a party whose legitimacy nobody has checked. Under the Zambia Data
-- Protection Act, AfriTech is the processor for that data from the moment it lands — before anybody
-- has established there is a school behind it.
--
-- That is not a risk worth a step in an onboarding script. The stricter reading wins, and
-- `ONBOARDING.md`'s pilot sequence is amended to activate before importing rather than after — which
-- reorders two steps in a phone call and changes nothing about how long the call takes.
--
-- ---------------------------------------------------------------------------
-- SCOPE: PUPILS ONLY
-- ---------------------------------------------------------------------------
-- Configuration — grade levels, subjects, grading scales, term dates, fee structures — stays open,
-- exactly as business rule 4 describes. Those hold no personal data and are the whole point of
-- letting an unverified school in at all: they can set themselves up while AfriTech verifies them,
-- which is what makes the verification call short.
--
-- `students` is the only table guarded, because it is the only one an unverified school can use to
-- create a person. Parents arrive through `student_parent_links`, which requires a pupil to link to,
-- so blocking enrolment blocks parent invitation as business rule 4 also requires — without a second
-- rule that could drift from this one.
--
-- AFTER, for the reason `0103` established and `0149` repeated: the message describes tenant state.
-- ===========================================================================

-- === MIGRATION START ===

CREATE OR REPLACE FUNCTION public.school_can_enrol(p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    -- AfriTech enrols on a school's behalf in every state. Their own verification is the thing
    -- this rule waits for, so gating them on it would be circular.
    WHEN public.is_afritech_admin() THEN TRUE
    ELSE COALESCE(
      (SELECT s.status IN ('trial', 'active') FROM public.schools s WHERE s.id = p_school_id),
      FALSE
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.school_can_enrol(UUID) TO authenticated;

COMMENT ON FUNCTION public.school_can_enrol(UUID) IS
  'Whether a school may create pupil records. Stricter than school_can_write(): excludes '
  'pending_verification, because an unverified school must not load children''s personal data. '
  'Configuration remains open to them — see 0153.';

CREATE OR REPLACE FUNCTION public.enforce_school_can_enrol()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM new_rows n WHERE NOT public.school_can_enrol(n.school_id)
  ) THEN
    RAISE EXCEPTION
      'This school is awaiting verification, so pupils cannot be enrolled yet. Set up grade '
      'levels, subjects and fees in the meantime — AfriTech will activate the school after the '
      'verification call.'
      USING ERRCODE = 'ZS003';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.enforce_school_can_enrol() IS
  'AFTER STATEMENT guard on students. AFTER because the message describes tenant state — 0103.';

DROP TRIGGER IF EXISTS enforce_school_can_enrol_on_insert_on_students ON public.students;
CREATE TRIGGER enforce_school_can_enrol_on_insert_on_students
  AFTER INSERT ON public.students
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_can_enrol();

/**
 * UPDATE is guarded too, and the reason is not symmetry.
 *
 * Without it, an unverified school could enrol nobody but could still revive a soft-deleted pupil —
 * or, if a school were moved back to `pending_verification` after a dispute, keep editing the roll
 * it already holds. `0149`'s general write guard does not cover this case, because it admits
 * `pending_verification`.
 */
DROP TRIGGER IF EXISTS enforce_school_can_enrol_on_update_on_students ON public.students;
CREATE TRIGGER enforce_school_can_enrol_on_update_on_students
  AFTER UPDATE ON public.students
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_can_enrol();

-- === MIGRATION END ===
