-- Migration: 0069_drop_staff_assignments.sql
-- Created: 2026-08-15
-- Description: Drops public.staff_assignments, superseded by
--              public.teacher_assignments in ADR-037.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-037
--                    Official Documentation/08 Staff Management/ASSIGNMENTS.md
--
-- THIS MIGRATION IS DESTRUCTIVE AND IRREVERSIBLE. Explicitly authorised.
--
-- Verified dead on zsms-dev before writing:
--   rows                  0
--   inbound foreign keys  0
--   functions referencing 0
--   views referencing     0
--   application code      0 references outside generated types
--
-- 0021 marked it superseded and deliberately did not drop it. Nothing has
-- referenced it for authorisation since teacher_read_assigned_students moved to
-- teacher_reaches_class(). Everything it expressed is representable in
-- teacher_assignments: is_class_teacher = TRUE becomes scope='class', and a
-- class/subject pairing becomes scope='subject'.
--
-- Numbered 0069 per MIGRATIONS.md → Next Available Sequence Number. It is NOT
-- 0022: that number and everything through 0065 is claimed by migrations
-- specified in that document but not yet written, and 0066-0068 hold the
-- renumbered fee and message-quota migrations.
--
-- Note for staging and production: neither has ever held this table, since no
-- environment beyond zsms-dev has run migrations 0002 onward. On any future
-- environment this is a no-op that removes a table created moments earlier in
-- the same push.

-- === MIGRATION START ===

-- Guard: refuse to drop if the table somehow holds data. A drop is
-- irreversible, and "it was empty when I checked" is not the same as "it is
-- empty now".
DO $$
DECLARE
  n BIGINT;
BEGIN
  IF to_regclass('public.staff_assignments') IS NULL THEN
    RAISE NOTICE 'public.staff_assignments already absent — nothing to drop';
    RETURN;
  END IF;

  EXECUTE 'SELECT count(*) FROM public.staff_assignments' INTO n;

  IF n > 0 THEN
    RAISE EXCEPTION
      'public.staff_assignments holds % row(s); refusing to drop. Migrate them into teacher_assignments first (is_class_teacher TRUE -> scope=class, otherwise scope=subject).', n;
  END IF;

  -- RESTRICT, not CASCADE: if anything still depends on this table, the drop
  -- must fail loudly rather than silently remove the dependent object too.
  EXECUTE 'DROP TABLE public.staff_assignments RESTRICT';
END;
$$;

-- Verify the drop and that its replacement is in place.
DO $$
BEGIN
  IF to_regclass('public.staff_assignments') IS NOT NULL THEN
    RAISE EXCEPTION 'public.staff_assignments still exists after the drop';
  END IF;

  IF to_regclass('public.teacher_assignments') IS NULL THEN
    RAISE EXCEPTION 'public.teacher_assignments is absent — the replacement must exist before the superseded table is removed';
  END IF;
END;
$$;

-- === MIGRATION END ===
