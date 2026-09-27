-- Migration: 0118_parent_notices_across_schools.sql
-- Created: 2026-09-27
-- Description: A parent reads notices from every school where they have a child,
--              matching how every other parent policy already works.
-- Related documents: Official Documentation/12 Communication System/ANNOUNCEMENTS.md
--                    Official Documentation/07 Student and Parent Modules/PARENTS.md
--
-- ===========================================================================
-- WHAT THE SCHEMA ALREADY DOES, WHICH IS NOT WHAT I ASSUMED
--
-- Every parent policy in this schema is keyed on the PARENT, not on the active
-- school. All twelve of them resolve through `is_linked_parent_of()`,
-- `parent_can_access_fee_record()` or `parent_has_child_at_school()` — and not one
-- mentions `current_school_uuid()`.
--
-- So a parent with Alice at Alpha and Ben at Beta already reads both children,
-- both fee statements, both attendance registers and both sets of published
-- results, from a single session, with no organisation switching whatsoever. That
-- is a deliberate and good design decision that predates this migration, and it
-- was discovered by asserting the opposite and being wrong.
--
-- THE ONE INCONSISTENCY
--
-- Announcements are school-scoped, correctly — a notice belongs to the school that
-- wrote it. But the reader policy is
--
--     school_id = current_school_uuid() AND status = 'sent' AND addressed_to_me()
--
-- so a parent saw notices from whichever school their session happened to be
-- acting in, while seeing children from all of them. The portal was therefore
-- internally inconsistent: two children listed, one school's notices.
--
-- THE FIX, AND WHY IT IS NOT A WIDENING
--
-- A parent-specific policy keyed on `parent_has_child_at_school(school_id)` — the
-- same helper `parent_read_fee_structures` already uses. A parent reads a notice
-- from a school where they have a child, if that notice is addressed to them. They
-- gain nothing they were not already entitled to: they can already read that
-- school's fee structures and their child's results there.
--
-- The management and staff policies are untouched. Only parents become
-- school-agnostic, because only parents already were.
-- ===========================================================================

-- === MIGRATION START ===

DROP POLICY IF EXISTS "parent_read_addressed_announcements" ON public.announcements;
CREATE POLICY "parent_read_addressed_announcements"
ON public.announcements FOR SELECT
USING (
  get_user_role() = 'org:parent'
  AND status = 'sent'
  AND school_id IS NOT NULL
  -- The parent's own relationship to the school decides reach, not the session's
  -- current organisation.
  AND public.parent_has_child_at_school(school_id)
  -- The audience filter from 0113/0116 still applies in full: a parent reads
  -- notices to parents, to their children's grade or class, and to themselves by
  -- name. Never a staff notice.
  AND public.announcement_addressed_to_me(
        school_id, target_audience, target_scope, target_ids)
);

-- Recording that a parent read a notice must follow the same rule, or a parent can
-- see a notice from the other school and not mark it read — which would leave the
-- unread-escalation rule sending WhatsApp reminders for something already read.
DROP POLICY IF EXISTS "parent_record_announcement_read" ON public.announcement_reads;
CREATE POLICY "parent_record_announcement_read"
ON public.announcement_reads FOR INSERT
WITH CHECK (
  get_user_role() = 'org:parent'
  AND reader_user_id = get_user_id()
  AND public.parent_has_child_at_school(school_id)
  AND EXISTS (
    SELECT 1 FROM public.announcements a
    WHERE a.id = announcement_reads.announcement_id
      AND a.school_id = announcement_reads.school_id
      AND a.status = 'sent'
      AND public.announcement_addressed_to_me(
            a.school_id, a.target_audience, a.target_scope, a.target_ids)
  )
);

DROP POLICY IF EXISTS "parent_read_own_announcement_reads" ON public.announcement_reads;
CREATE POLICY "parent_read_own_announcement_reads"
ON public.announcement_reads FOR SELECT
USING (
  get_user_role() = 'org:parent'
  AND reader_user_id = get_user_id()
);

-- === MIGRATION END ===
