-- Migration: 0116_announcement_policies_use_audience.sql
-- Created: 2026-09-27
-- Description: Point the announcement read policies at the two-dimension resolver
--              so a pupil-scoped notice is not read as a parent-scoped one.
-- Related documents: Official Documentation/12 Communication System/ANNOUNCEMENTS.md
--
-- ===========================================================================
-- WHY THIS IS A SEPARATE MIGRATION
--
-- 0114 split `target_type` into `target_audience` + `target_scope` precisely
-- because the flattened value cannot distinguish "Grade 7 pupils" from
-- "Grade 7 parents". It also left a three-argument compatibility wrapper that
-- takes the flattened value — and that wrapper has to guess, which it does by
-- assuming parents, because every pre-0114 grade notice was a parent notice.
--
-- The policies from 0113 were still calling that wrapper. So a notice written to
-- Grade 7 PUPILS was readable by Grade 7 PARENTS and not by the pupils
-- themselves — the exact inversion the split was meant to prevent. Caught by the
-- suite: two assertions failed, one in each direction, which is the useful shape
-- of failure because it rules out an off-by-one in the test.
--
-- The lesson worth keeping: adding a better representation does nothing until the
-- readers use it. A compatibility wrapper that guesses is a correct thing to
-- provide and a wrong thing to leave in the hot path.
-- ===========================================================================

-- === MIGRATION START ===

DROP POLICY IF EXISTS "school_members_read_addressed_announcements" ON public.announcements;
CREATE POLICY "school_members_read_addressed_announcements"
ON public.announcements FOR SELECT
USING (
  school_id = current_school_uuid()
  AND status = 'sent'
  -- Four arguments: the real columns, no guessing.
  AND public.announcement_addressed_to_me(
        school_id, target_audience, target_scope, target_ids)
);

DROP POLICY IF EXISTS "reader_record_own_announcement_read" ON public.announcement_reads;
CREATE POLICY "reader_record_own_announcement_read"
ON public.announcement_reads FOR INSERT
WITH CHECK (
  reader_user_id = get_user_id()
  AND school_id = current_school_uuid()
  AND EXISTS (
    SELECT 1 FROM public.announcements a
    WHERE a.id = announcement_reads.announcement_id
      AND a.school_id = announcement_reads.school_id
      AND a.status = 'sent'
      AND public.announcement_addressed_to_me(
            a.school_id, a.target_audience, a.target_scope, a.target_ids)
  )
);

COMMENT ON FUNCTION public.announcement_addressed_to_me(UUID, TEXT, TEXT[]) IS
  'DEPRECATED compatibility form. It cannot distinguish a pupil-scoped notice '
  'from a parent-scoped one and assumes parents. No policy calls it as of 0116; '
  'use the four-argument form with target_audience and target_scope.';

-- === MIGRATION END ===
