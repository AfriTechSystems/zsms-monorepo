-- Migration: 0154_enrol_guard_speaks_only_for_verification.sql
-- Created: 2026-09-30
-- Description: `0153`'s trigger fired ahead of `0149`'s and told a SUSPENDED school it was awaiting
--              verification — a call that would never come.
-- Related documents: Official Documentation/06 School and Tenant Management/SCHOOL_SETUP.md
--
-- ===========================================================================
-- TWO GUARDS ON ONE TABLE, AND THE ALPHABET DECIDED WHICH SPOKE
--
-- `students` now carries two AFTER STATEMENT guards:
--
--   enforce_school_can_enrol_on_insert_on_students     (0153)  — pupils need a verified school
--   enforce_school_writable_on_insert_on_students      (0149)  — lapsed schools write nothing
--
-- PostgreSQL fires triggers on the same event in **name order**, and `can_enrol` sorts before
-- `writable`. `school_can_enrol()` requires `trial` or `active`, so it also refuses a
-- `trial_expired` or `suspended` school — and got there first.
--
-- The result was a suspended school being told:
--
--     "This school is awaiting verification, so pupils cannot be enrolled yet. ... AfriTech will
--      activate the school after the verification call."
--
-- Every word of which is wrong for a school whose subscription lapsed. It would have somebody
-- waiting for a phone call that was never going to be made, when what they needed to hear was
-- "your subscription lapsed, here is how to restore it". CI caught it as three assertions expecting
-- `ZS002` and receiving `ZS003`.
--
-- ---------------------------------------------------------------------------
-- THE FIX IS TO MAKE THE RESPONSIBILITIES DISJOINT, NOT TO REORDER THEM
-- ---------------------------------------------------------------------------
-- Renaming a trigger so the other one wins would work today and break the moment somebody adds a
-- third. The real problem is that both guards claimed the same statuses.
--
-- So `0153`'s trigger now raises for **exactly one** status — `pending_verification`, the case it was
-- written for — and stays silent on every other, leaving `0149` to refuse those with a message about
-- subscriptions. Each guard says one true thing, and firing order stops mattering.
--
-- `school_can_enrol()` is left as it is. As a predicate, "may this school create pupil records" is
-- genuinely FALSE for a suspended school, and the UI wants that answer. It is the *message* that had
-- to be narrowed, not the rule — which is the distinction that was missed the first time.
-- ===========================================================================

-- === MIGRATION START ===

CREATE OR REPLACE FUNCTION public.enforce_school_can_enrol()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  /**
   * `pending_verification` only. Every other non-writable status is `0149`'s to refuse, and its
   * message is the accurate one for those cases.
   *
   * AfriTech is exempt for the reason `0153` gave: their verification is the thing this rule waits
   * for, so gating them on it would be circular.
   */
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE
     AND EXISTS (
       SELECT 1
         FROM new_rows n
         JOIN public.schools s ON s.id = n.school_id
        WHERE s.status = 'pending_verification'
     )
  THEN
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
  'AFTER STATEMENT guard on students, raising ZS003 for pending_verification ONLY. Every other '
  'non-writable status belongs to 0149''s guard, whose message is about subscriptions rather than '
  'verification. Before 0154 this fired first and told a suspended school to await a call that '
  'would never come.';

-- === MIGRATION END ===
