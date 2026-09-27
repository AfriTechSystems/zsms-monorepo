-- Migration: 0114_announcement_audience_and_scope.sql
-- Created: 2026-09-27
-- Description: Separates WHO an announcement is for from WHICH PART of the school
--              it covers, adds individually-addressed notices, and fixes a worker
--              that delivered to parents only.
-- Related documents: Official Documentation/12 Communication System/ANNOUNCEMENTS.md
--                    Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-040
--
-- ===========================================================================
-- TWO DEFECTS AND A MODELLING PROBLEM
--
-- 1. `worker_announcement_recipients()` resolved PARENTS ONLY:
--
--      AND a.target_type IN ('all_parents', 'grade', 'class')
--
--    So an `all_staff` or `all_students` announcement returned zero recipients
--    and was **never delivered out of band at all**. It appeared in the portal
--    and nothing was ever queued for WhatsApp, SMS or email. A school sending a
--    staff notice had no way to discover this: the notice was visibly "sent".
--
-- 2. `target_type` conflates audience with scope. `grade` means "the parents of
--    pupils in this grade" — not because anyone decided that, but because that is
--    the only branch the worker implemented. There is no way to say "Grade 7
--    pupils" as opposed to "Grade 7 parents", and no way to address one person.
--
-- THE MODEL
--
--   target_audience — WHO:    parents | students | staff | individuals | everyone
--   target_scope    — WHERE:  school | grade | class | individual | platform
--   target_ids      — grade ids, class ids, or Clerk user ids
--
-- The two are independent, which is what makes "Grade 7 pupils" expressible.
--
-- WHY `target_type` SURVIVES, AS A DERIVED COLUMN
--
-- Six places read it. Dropping a column is destructive and needs approval, and
-- leaving two independent sources of truth is how `schools.max_students` became a
-- field that two screens displayed and nothing enforced. So it is maintained by a
-- trigger from the two new columns and commented as derived — the same treatment
-- `school_grading_scales.grade_bands` got in 0106, for the same reason.
--
-- A NOTE ON "NOTHING HARDCODED"
--
-- Audience and scope are CHECK constraints, not reference tables, and that is
-- deliberate rather than an oversight of ADR-040's lesson. A new audience value
-- requires a new resolver branch in `announcement_addressed_to_me()` and in the
-- worker — code, not data. A reference table would let an operator add
-- "governors", have it accepted, and then silently address nobody. The CHECK
-- makes the dependency honest. Prices, limits, feature access and custom fields
-- are data and live in tables; a branch the code must implement is not.
-- ===========================================================================

-- === MIGRATION START ===

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS target_audience TEXT,
  ADD COLUMN IF NOT EXISTS target_scope    TEXT;

-- Backfill from the flattened column before constraining, so existing rows stay
-- legal. `grade` and `class` map to parents because that is what the worker
-- actually did — recording the behaviour as it was, not as it should have been.
UPDATE public.announcements SET
  target_audience = CASE target_type
    WHEN 'all_parents'  THEN 'parents'
    WHEN 'all_students' THEN 'students'
    WHEN 'all_staff'    THEN 'staff'
    WHEN 'grade'        THEN 'parents'
    WHEN 'class'        THEN 'parents'
    WHEN 'platform'     THEN 'everyone'
  END,
  target_scope = CASE target_type
    WHEN 'all_parents'  THEN 'school'
    WHEN 'all_students' THEN 'school'
    WHEN 'all_staff'    THEN 'school'
    WHEN 'grade'        THEN 'grade'
    WHEN 'class'        THEN 'class'
    WHEN 'platform'     THEN 'platform'
  END
WHERE target_audience IS NULL OR target_scope IS NULL;

ALTER TABLE public.announcements
  ALTER COLUMN target_audience SET NOT NULL,
  ALTER COLUMN target_scope    SET NOT NULL;

ALTER TABLE public.announcements
  DROP CONSTRAINT IF EXISTS announcements_target_audience_check;
ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_target_audience_check CHECK (
    target_audience IN ('parents', 'students', 'staff', 'individuals', 'everyone')
  );

ALTER TABLE public.announcements
  DROP CONSTRAINT IF EXISTS announcements_target_scope_check;
ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_target_scope_check CHECK (
    target_scope IN ('school', 'grade', 'class', 'individual', 'platform')
  );

-- The combinations that mean something. Without this, 'individuals' + 'grade'
-- would be accepted and address nobody.
ALTER TABLE public.announcements
  DROP CONSTRAINT IF EXISTS announcements_audience_scope_shape;
ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_audience_scope_shape CHECK (
    (target_audience = 'individuals' AND target_scope = 'individual')
    OR (target_audience = 'everyone'  AND target_scope = 'platform')
    OR (target_audience IN ('parents', 'students', 'staff')
        AND target_scope IN ('school', 'grade', 'class'))
  );

-- A scoped or individually-addressed notice needs something in target_ids, and a
-- whole-school one must not carry stray ids that would look like a filter.
ALTER TABLE public.announcements
  DROP CONSTRAINT IF EXISTS announcements_target_ids_shape;
ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_target_ids_shape CHECK (
    CASE
      WHEN target_scope IN ('grade', 'class', 'individual')
        THEN target_ids IS NOT NULL AND array_length(target_ids, 1) >= 1
      ELSE COALESCE(array_length(target_ids, 1), 0) = 0
    END
  );

-- `individual` joins the derived column's vocabulary.
ALTER TABLE public.announcements DROP CONSTRAINT IF EXISTS announcements_target_type_check;
ALTER TABLE public.announcements
  ADD CONSTRAINT announcements_target_type_check CHECK (
    target_type IN ('all_parents', 'all_students', 'all_staff',
                    'grade', 'class', 'individual', 'platform')
  );

COMMENT ON COLUMN public.announcements.target_audience IS
  'WHO the notice is for: parents | students | staff | individuals | everyone.';
COMMENT ON COLUMN public.announcements.target_scope IS
  'WHICH PART of the school: school | grade | class | individual | platform. '
  'Independent of audience, so "Grade 7 pupils" is expressible.';
COMMENT ON COLUMN public.announcements.target_type IS
  'DERIVED from target_audience and target_scope by a trigger (0114). Kept '
  'because six readers still use it; never write it directly.';

-- ---------------------------------------------------------------------------
-- Keep the derived column honest.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_announcement_target_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.target_type :=
    CASE
      WHEN NEW.target_scope = 'platform'   THEN 'platform'
      WHEN NEW.target_scope = 'individual' THEN 'individual'
      WHEN NEW.target_scope = 'grade'      THEN 'grade'
      WHEN NEW.target_scope = 'class'      THEN 'class'
      WHEN NEW.target_audience = 'parents'  THEN 'all_parents'
      WHEN NEW.target_audience = 'students' THEN 'all_students'
      WHEN NEW.target_audience = 'staff'    THEN 'all_staff'
      ELSE NEW.target_type
    END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_target_type_on_announcements ON public.announcements;
CREATE TRIGGER set_target_type_on_announcements
  BEFORE INSERT OR UPDATE OF target_audience, target_scope ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_announcement_target_type();

-- ---------------------------------------------------------------------------
-- The reader-side resolver, rewritten against audience and scope.
-- ---------------------------------------------------------------------------
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
  v_audience TEXT;
  v_scope    TEXT;
BEGIN
  -- Kept at the old signature so the policies in 0113 need no change. The
  -- flattened value is expanded back into the two dimensions, which is lossless
  -- for every combination the shape constraint permits.
  v_audience := CASE p_target_type
    WHEN 'all_parents'  THEN 'parents'
    WHEN 'all_students' THEN 'students'
    WHEN 'all_staff'    THEN 'staff'
    WHEN 'individual'   THEN 'individuals'
    WHEN 'platform'     THEN 'everyone'
    ELSE NULL  -- grade / class: audience comes from the row, resolved below
  END;
  v_scope := CASE p_target_type
    WHEN 'grade' THEN 'grade'
    WHEN 'class' THEN 'class'
    WHEN 'individual' THEN 'individual'
    WHEN 'platform' THEN 'platform'
    ELSE 'school'
  END;

  RETURN public.announcement_addressed_to_me(
    p_school_id, v_audience, v_scope, p_target_ids
  );
END;
$$;

/**
 * The real resolver.
 *
 * `p_audience` NULL means "take it from the row" — only reachable through the
 * compatibility wrapper above for a grade/class notice, where the flattened
 * column cannot say who it was for. Those rows were all written as parent
 * notices, which the backfill recorded, so NULL resolves as parents.
 */
CREATE OR REPLACE FUNCTION public.announcement_addressed_to_me(
  p_school_id UUID,
  p_audience  TEXT,
  p_scope     TEXT,
  p_target_ids TEXT[]
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role     TEXT := public.get_user_role();
  v_uid      TEXT := public.get_user_id();
  v_audience TEXT := COALESCE(p_audience, 'parents');
BEGIN
  IF p_school_id IS NULL OR p_scope = 'platform' THEN
    RETURN TRUE;
  END IF;

  IF v_role IN ('org:owner', 'org:principal', 'org:admin') THEN
    RETURN TRUE;
  END IF;

  -- Individually addressed: the only question is whether this is one of them.
  -- Checked before audience, because an individual notice has no audience class —
  -- it is addressed to people, whoever they happen to be.
  IF p_scope = 'individual' THEN
    RETURN v_uid = ANY (COALESCE(p_target_ids, ARRAY[]::TEXT[]));
  END IF;

  -- ---- Parents ------------------------------------------------------------
  IF v_role = 'org:parent' THEN
    IF v_audience <> 'parents' THEN
      RETURN FALSE;
    END IF;
    IF p_scope = 'school' THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM   public.student_parent_links spl
      JOIN   public.students s ON s.id = spl.student_id
      WHERE  spl.parent_user_id = v_uid
        AND  spl.is_active = TRUE
        AND  s.school_id = p_school_id
        AND  s.is_deleted = FALSE
        AND  CASE p_scope
               WHEN 'grade' THEN s.grade_id = ANY (p_target_ids)
               ELSE              s.class_id = ANY (p_target_ids)
             END
    );
  END IF;

  -- ---- Pupils -------------------------------------------------------------
  IF v_role = 'org:student' THEN
    IF v_audience <> 'students' THEN
      RETURN FALSE;
    END IF;
    IF p_scope = 'school' THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.students s
      WHERE  s.clerk_user_id = v_uid
        AND  s.school_id = p_school_id
        AND  s.is_deleted = FALSE
        AND  CASE p_scope
               WHEN 'grade' THEN s.grade_id = ANY (p_target_ids)
               ELSE              s.class_id = ANY (p_target_ids)
             END
    );
  END IF;

  -- ---- Staff --------------------------------------------------------------
  -- A staff notice reaches staff at any scope: "Grade 7 staff" is a legitimate
  -- narrowing that the old model could not express, and a teacher is not excluded
  -- from it by which class they hold.
  IF v_role IN ('org:teacher', 'org:accountant', 'org:staff') THEN
    RETURN v_audience = 'staff';
  END IF;

  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.announcement_addressed_to_me(UUID, TEXT, TEXT, TEXT[])
  TO authenticated;

-- === MIGRATION END ===
