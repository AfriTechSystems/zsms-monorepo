-- Migration: 0115_worker_announcement_recipients_all_audiences.sql
-- Created: 2026-09-27
-- Description: The delivery worker resolves every audience, not only parents.
--              Fixes announcements to staff and pupils being silently undelivered.
-- Related documents: Official Documentation/12 Communication System/ANNOUNCEMENTS.md
--                    Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-042
--
-- ===========================================================================
-- THE DEFECT
--
-- `worker_announcement_recipients()` ended with:
--
--     AND a.target_type IN ('all_parents', 'grade', 'class')
--
-- and its only join was to `parents`. Consequences:
--
--   * an `all_staff` notice resolved **zero** recipients;
--   * an `all_students` notice resolved **zero** recipients;
--   * nothing was queued, so nothing was ever sent by WhatsApp, SMS or email.
--
-- And it was invisible. The announcement's status still moved to 'sent' — the
-- worker completed successfully, having found nobody to tell. A school looking at
-- the list saw a delivered notice. The only way to notice was to ask a member of
-- staff whether they had received it.
--
-- This is the failure mode the honesty on the compose screen exists to prevent,
-- one layer lower down: "sent" meant "the queue ran", not "anybody was told".
--
-- WHAT A RECIPIENT IS, PER AUDIENCE
--
--   parents   — the parents of pupils in scope, one row per parent even with
--               several children in scope (the DISTINCT ON is load-bearing: a
--               parent of triplets is one WhatsApp message, not three).
--   students  — the pupils themselves, and only those with their own contact
--               details or account. A pupil with neither is not silently swapped
--               for their parent: that would send a child's notice to an adult
--               who was not addressed.
--   staff     — staff members at the school.
--   individuals — exactly the named user ids, looked up across all three
--               directories, because "send this to one person" must not care
--               which kind of person they are.
--
-- `out_student_id` stays in the signature — the receipts worker uses it to attach
-- a message to a pupil — and is NULL for staff and for individually addressed
-- staff, which is correct rather than missing.
-- ===========================================================================

-- === MIGRATION START ===

CREATE OR REPLACE FUNCTION public.worker_announcement_recipients(
  p_announcement_id UUID,
  p_limit INTEGER DEFAULT 2000
)
RETURNS TABLE (
  out_user_id    TEXT,
  out_name       TEXT,
  out_phone      TEXT,
  out_email      TEXT,
  out_student_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH a AS (
  SELECT id, school_id, target_audience, target_scope, target_ids
  FROM   public.announcements
  WHERE  id = p_announcement_id
),
-- Pupils in scope. Shared by the parents and students branches so the two can
-- never disagree about which children a grade notice covers.
in_scope AS (
  SELECT st.*
  FROM   public.students st
  JOIN   a ON a.school_id = st.school_id
  WHERE  st.is_deleted = FALSE
    AND  st.status IN ('active', 'on_leave')
    AND  (
      a.target_scope = 'school'
      OR (a.target_scope = 'grade' AND st.grade_id = ANY (a.target_ids))
      OR (a.target_scope = 'class' AND st.class_id = ANY (a.target_ids))
    )
),
parents_branch AS (
  SELECT DISTINCT ON (pa.clerk_user_id)
         pa.clerk_user_id AS user_id,
         COALESCE(pa.full_name, 'Parent or Guardian') AS name,
         pa.phone_e164 AS phone,
         pa.email      AS email,
         s.id          AS student_id
  FROM   a
  JOIN   in_scope s ON TRUE
  JOIN   public.student_parent_links spl
         ON spl.student_id = s.id AND spl.is_active = TRUE
  JOIN   public.parents pa ON pa.id = spl.parent_id
  WHERE  a.target_audience = 'parents'
    AND  a.target_scope IN ('school', 'grade', 'class')
    AND  (pa.phone_e164 IS NOT NULL OR pa.email IS NOT NULL)
  -- Primary contact wins when a parent appears through more than one child.
  ORDER  BY pa.clerk_user_id, spl.is_primary DESC
),
students_branch AS (
  SELECT s.clerk_user_id AS user_id,
         (s.first_name || ' ' || s.last_name) AS name,
         NULL::TEXT AS phone,
         NULL::TEXT AS email,
         s.id AS student_id
  FROM   a
  JOIN   in_scope s ON TRUE
  WHERE  a.target_audience = 'students'
    AND  a.target_scope IN ('school', 'grade', 'class')
    -- Only pupils who have an account of their own. A pupil without one is
    -- omitted rather than redirected to a parent: the notice was addressed to
    -- children, and quietly sending it to an adult changes who was told.
    AND  s.clerk_user_id IS NOT NULL
),
staff_branch AS (
  SELECT sm.clerk_user_id AS user_id,
         (sm.first_name || ' ' || sm.last_name) AS name,
         sm.phone_e164 AS phone,
         sm.email AS email,
         NULL::UUID AS student_id
  FROM   a
  JOIN   public.staff_members sm ON sm.school_id = a.school_id
  WHERE  a.target_audience = 'staff'
    AND  sm.clerk_user_id IS NOT NULL
    AND  (sm.phone_e164 IS NOT NULL OR sm.email IS NOT NULL)
),
-- Individually addressed. Looked up across all three directories and scoped to
-- the announcement's own school, so a stray id from another school resolves to
-- nobody rather than leaking a notice across tenants.
individuals_branch AS (
  SELECT sm.clerk_user_id, (sm.first_name || ' ' || sm.last_name),
         sm.phone_e164, sm.email, NULL::UUID
  FROM   a JOIN public.staff_members sm ON sm.school_id = a.school_id
  WHERE  a.target_audience = 'individuals' AND sm.clerk_user_id = ANY (a.target_ids)

  UNION ALL

  SELECT pa.clerk_user_id, COALESCE(pa.full_name, 'Parent or Guardian'),
         pa.phone_e164, pa.email, NULL::UUID
  FROM   a
  JOIN   public.parents pa ON pa.clerk_user_id = ANY (a.target_ids)
  WHERE  a.target_audience = 'individuals'
    -- A parent is reachable only through a child at this school, which is the
    -- same relationship that makes them addressable in the first place.
    AND  EXISTS (
      SELECT 1 FROM public.student_parent_links spl
      JOIN public.students st ON st.id = spl.student_id
      WHERE spl.parent_id = pa.id AND spl.is_active = TRUE
        AND st.school_id = a.school_id AND st.is_deleted = FALSE
    )

  UNION ALL

  SELECT st.clerk_user_id, (st.first_name || ' ' || st.last_name),
         NULL::TEXT, NULL::TEXT, st.id
  FROM   a JOIN public.students st ON st.school_id = a.school_id
  WHERE  a.target_audience = 'individuals'
    AND  st.clerk_user_id = ANY (a.target_ids)
    AND  st.is_deleted = FALSE
),
combined AS (
  SELECT * FROM parents_branch
  UNION ALL SELECT * FROM students_branch
  UNION ALL SELECT * FROM staff_branch
  UNION ALL SELECT * FROM individuals_branch
)
-- One row per user across the whole result. Without this a person who is both a
-- parent and a member of staff at the same school would be told twice, and the
-- second message would consume quota for nothing.
SELECT DISTINCT ON (user_id) user_id, name, phone, email, student_id
FROM   combined
WHERE  user_id IS NOT NULL
ORDER  BY user_id
LIMIT  p_limit;
$$;

COMMENT ON FUNCTION public.worker_announcement_recipients(UUID, INTEGER) IS
  'Delivery recipients for an announcement, across every audience. Before 0115 '
  'this resolved parents only, so staff and pupil notices were queued to nobody '
  'while still reporting as sent.';

-- === MIGRATION END ===
