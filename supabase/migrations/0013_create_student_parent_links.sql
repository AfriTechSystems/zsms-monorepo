-- Migration: 0013_create_student_parent_links.sql
-- Created: 2026-08-14
-- Description: Many-to-many link between students and parents, with the 30-day
--              grace period that governs read access after unlinking.
-- Related documents: Official Documentation/01 Foundation Layer/DATABASE.md
--                    Official Documentation/07 Student and Parent Modules/PARENT_LINKING.md

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS public.student_parent_links (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  student_id            UUID NOT NULL REFERENCES public.students(id),
  parent_id             UUID NOT NULL REFERENCES public.parents(id),

  parent_user_id        TEXT,
  -- Denormalised from parents.clerk_user_id so that RLS policies on students,
  -- fees, attendance, and results can filter without joining parents. Kept in
  -- sync by the trigger below — a stale value here is a read-access bug.

  relationship          TEXT NOT NULL DEFAULT 'guardian'
                        CHECK (relationship IN (
                          'mother', 'father', 'guardian', 'grandparent',
                          'sibling', 'uncle', 'aunt', 'other'
                        )),

  is_primary            BOOLEAN NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,

  grace_period_ends_at  TIMESTAMPTZ,
  -- Set to NOW() + 30 days when is_active flips to FALSE. Read access to the
  -- child's records survives until this passes, then lapses automatically.

  linked_by             TEXT,
  unlinked_at           TIMESTAMPTZ,
  unlinked_by           TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (student_id, parent_id)
);

CREATE INDEX IF NOT EXISTS idx_spl_student      ON public.student_parent_links(student_id);
CREATE INDEX IF NOT EXISTS idx_spl_parent       ON public.student_parent_links(parent_id);
CREATE INDEX IF NOT EXISTS idx_spl_parent_user  ON public.student_parent_links(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_spl_active       ON public.student_parent_links(student_id, is_active);

-- ---------------------------------------------------------------------------
-- Grace period + denormalisation triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_link_grace_period()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Unlinking starts the 30-day clock (SESSIONS.md / PARENT_LINKING.md).
  IF NEW.is_active = FALSE AND COALESCE(OLD.is_active, TRUE) = TRUE THEN
    NEW.grace_period_ends_at := NOW() + INTERVAL '30 days';
    NEW.unlinked_at := COALESCE(NEW.unlinked_at, NOW());
  END IF;

  -- Re-linking clears it, so a previously expired link does not stay expired.
  IF NEW.is_active = TRUE AND COALESCE(OLD.is_active, FALSE) = FALSE THEN
    NEW.grace_period_ends_at := NULL;
    NEW.unlinked_at := NULL;
    NEW.unlinked_by := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_grace_period_on_student_parent_links ON public.student_parent_links;
CREATE TRIGGER set_grace_period_on_student_parent_links
  BEFORE UPDATE ON public.student_parent_links
  FOR EACH ROW EXECUTE FUNCTION public.set_link_grace_period();

-- Keeps parent_user_id aligned with parents.clerk_user_id, which is often NULL
-- at link time and populated later on first login.
CREATE OR REPLACE FUNCTION public.sync_link_parent_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.student_parent_links
  SET    parent_user_id = NEW.clerk_user_id
  WHERE  parent_id = NEW.id
    AND  parent_user_id IS DISTINCT FROM NEW.clerk_user_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_parent_user_id_on_parents ON public.parents;
CREATE TRIGGER sync_parent_user_id_on_parents
  AFTER UPDATE OF clerk_user_id ON public.parents
  FOR EACH ROW EXECUTE FUNCTION public.sync_link_parent_user_id();

REVOKE ALL ON public.student_parent_links FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.student_parent_links TO authenticated;

-- RLS applied in 0016.

-- === MIGRATION END ===
