-- Migration: 0113_announcement_audience_policies.sql
-- Created: 2026-09-27
-- Description: An announcement is readable by the audience it was addressed to,
--              not by every member of the school. Closes a real disclosure.
-- Related documents: Official Documentation/12 Communication System/ANNOUNCEMENTS.md
--                    Official Documentation/01 Foundation Layer/RLS.md
--
-- ===========================================================================
-- THE DISCLOSURE
--
-- `school_members_read_sent_announcements` was:
--
--   school_id = current_school_uuid() AND status = 'sent'
--
-- and nothing else. `target_type` was not consulted. Parents and pupils are
-- members of the school's Clerk organisation (`org:parent`, `org:student`), so
-- `current_school_uuid()` resolves for them — which means **every parent could
-- read every notice addressed to `all_staff`**, and every pupil too.
--
-- That is not a theoretical shape. A staff notice is where a school writes about
-- a disciplinary process, a salary meeting, a safeguarding concern, or which
-- teacher is leaving. The compose screen offers "All staff" as an audience and
-- the school reasonably believes it means staff.
--
-- Found while building the parent portal — the question "what should a parent see
-- here" has an answer the policy did not implement.
--
-- THE FIX
--
-- A reader sees an announcement when it was addressed to them:
--
--   * management sees everything at its own school, including drafts — unchanged,
--     `management_read_all_announcements` already does this;
--   * staff (teacher, accountant, admin-as-staff, base staff) see `all_staff`,
--     plus grade/class notices, which are operational;
--   * parents see `all_parents`, plus a grade/class notice when one of THEIR
--     children is in that grade or class;
--   * pupils see `all_students`, plus a grade/class notice for their own grade or
--     class.
--
-- Nobody outside management sees a draft, a scheduled notice, or a cancelled one.
-- Only `status = 'sent'` — a notice the school has not released is not news.
-- ===========================================================================

-- === MIGRATION START ===

/**
 * TRUE when a sent announcement was addressed to the calling user.
 *
 * SECURITY DEFINER because it reads `student_parent_links` and `students` to
 * resolve a parent's children, and a parent's read policy on those tables is
 * itself expressed in terms of this kind of lookup. Keeping the join inside a
 * definer function avoids a policy that depends on the policy it is helping to
 * define.
 *
 * Takes the row's own columns rather than an id, so it can be used directly in a
 * USING clause without a second lookup of the announcement.
 */
CREATE OR REPLACE FUNCTION public.announcement_addressed_to_me(
  p_school_id   UUID,
  p_target_type TEXT,
  p_target_ids  TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role TEXT := public.get_user_role();
  v_uid  TEXT := public.get_user_id();
BEGIN
  -- A platform-wide notice has no school and is for everybody signed in.
  IF p_school_id IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Management reads everything at its own school through its own policy; this
  -- function answers for the rest, and answering TRUE here as well keeps the two
  -- from disagreeing if the other policy is ever narrowed.
  IF v_role IN ('org:owner', 'org:principal', 'org:admin') THEN
    RETURN TRUE;
  END IF;

  -- ---- Parents ------------------------------------------------------------
  IF v_role = 'org:parent' THEN
    IF p_target_type = 'all_parents' THEN
      RETURN TRUE;
    END IF;

    IF p_target_type IN ('grade', 'class') THEN
      RETURN EXISTS (
        SELECT 1
        FROM   public.student_parent_links spl
        JOIN   public.students s ON s.id = spl.student_id
        WHERE  spl.parent_user_id = v_uid
          AND  spl.is_active = TRUE
          AND  s.school_id = p_school_id
          AND  s.is_deleted = FALSE
          AND  CASE p_target_type
                 WHEN 'grade' THEN s.grade_id = ANY (p_target_ids)
                 ELSE              s.class_id = ANY (p_target_ids)
               END
      );
    END IF;

    -- all_staff and all_students are not a parent's business. This single line
    -- is the disclosure this migration closes.
    RETURN FALSE;
  END IF;

  -- ---- Pupils -------------------------------------------------------------
  IF v_role = 'org:student' THEN
    IF p_target_type = 'all_students' THEN
      RETURN TRUE;
    END IF;

    IF p_target_type IN ('grade', 'class') THEN
      RETURN EXISTS (
        SELECT 1 FROM public.students s
        WHERE  s.clerk_user_id = v_uid
          AND  s.school_id = p_school_id
          AND  s.is_deleted = FALSE
          AND  CASE p_target_type
                 WHEN 'grade' THEN s.grade_id = ANY (p_target_ids)
                 ELSE              s.class_id = ANY (p_target_ids)
               END
      );
    END IF;

    RETURN FALSE;
  END IF;

  -- ---- Everyone else employed by the school -------------------------------
  -- Teachers, the accountant, and base staff. They see staff notices and the
  -- operational grade/class ones. `all_parents` is excluded: a notice written to
  -- families about fees or a closure is not addressed to staff, and including it
  -- would make "All parents" mean "everyone", which is what this migration is
  -- correcting.
  IF v_role IN ('org:teacher', 'org:accountant', 'org:staff') THEN
    RETURN p_target_type IN ('all_staff', 'grade', 'class');
  END IF;

  RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.announcement_addressed_to_me(UUID, TEXT, TEXT[]) IS
  'TRUE when a sent announcement was addressed to the calling user. Parents see '
  'all_parents and their own children''s grade/class only — never all_staff. '
  'See migration 0113.';

GRANT EXECUTE ON FUNCTION public.announcement_addressed_to_me(UUID, TEXT, TEXT[])
  TO authenticated;

-- ---------------------------------------------------------------------------
-- Replace the blanket member policy with an audience-aware one.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "school_members_read_sent_announcements" ON public.announcements;
CREATE POLICY "school_members_read_addressed_announcements"
ON public.announcements FOR SELECT
USING (
  school_id = current_school_uuid()
  -- Unsent means unreleased. Drafts, scheduled and cancelled notices stay with
  -- management, whose own policy is unchanged.
  AND status = 'sent'
  AND public.announcement_addressed_to_me(school_id, target_type, target_ids)
);

-- `read_platform_announcements` is left exactly as it was: a platform notice has
-- a NULL school_id and is for every signed-in user, which is already what it says.

-- ---------------------------------------------------------------------------
-- Reading an announcement is what marks it read, so a parent needs to be able
-- to record that. Without this the read receipt only ever exists for staff, and
-- the unread-escalation rule that gives `importance` its meaning has nothing to
-- act on for the audience it is aimed at.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "reader_record_own_announcement_read" ON public.announcement_reads;
CREATE POLICY "reader_record_own_announcement_read"
ON public.announcement_reads FOR INSERT
WITH CHECK (
  reader_user_id = get_user_id()
  AND school_id = current_school_uuid()
  -- Only for a notice they can actually see. Without this a reader could assert
  -- having read something addressed to somebody else, which is both untrue and a
  -- way to probe which announcement ids exist.
  AND EXISTS (
    SELECT 1 FROM public.announcements a
    WHERE a.id = announcement_reads.announcement_id
      AND a.school_id = announcement_reads.school_id
      AND a.status = 'sent'
      AND public.announcement_addressed_to_me(a.school_id, a.target_type, a.target_ids)
  )
);

DROP POLICY IF EXISTS "reader_read_own_announcement_reads" ON public.announcement_reads;
CREATE POLICY "reader_read_own_announcement_reads"
ON public.announcement_reads FOR SELECT
USING (reader_user_id = get_user_id() AND school_id = current_school_uuid());

-- === MIGRATION END ===
