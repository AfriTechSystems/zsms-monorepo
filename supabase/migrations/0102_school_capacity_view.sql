-- Migration: 0102_school_capacity_view.sql
-- Created: 2026-08-23
-- Description: One-query capacity for a list of schools, and the deprecation of
--              `schools.max_students` — the per-school ceiling nothing enforces.
-- Related documents: Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--                    Official Documentation/17 Integration and Pricing/PRICING.md

-- === MIGRATION START ===

-- WHY A VIEW AND NOT A LOOP
-- -------------------------
-- `school_student_capacity()` answers for one school. The admin schools list and
-- the platform overview both want the answer for every school on the page, and
-- calling the function once per row over PostgREST is the same N+1 already
-- tracked against `/api/admin/schools/[id]` — one network round trip per school,
-- growing with the customer base.
--
-- LATERAL over the function keeps a single definition of the resolution order
-- and the counting rule. Reimplementing either in a flat query is how the list
-- and the detail page start disagreeing about the same school.
CREATE OR REPLACE VIEW public.school_capacity
WITH (security_invoker = true) AS
  SELECT s.id AS school_id,
         c.student_limit,
         c.is_unlimited,
         c.source,
         c.current_count,
         c.remaining,
         c.at_capacity
  FROM public.schools s
  CROSS JOIN LATERAL public.school_student_capacity(s.id) c;

-- security_invoker, so the rows are exactly the schools the caller may already
-- see: an AfriTech admin sees all, a school sees its own, and nobody learns
-- another school's roll size. The function inside is SECURITY DEFINER — it has
-- to be, since it reads `afritech` — but it is only ever reached through a row
-- the caller's own RLS already admitted.
COMMENT ON VIEW public.school_capacity IS
  'Resolved student ceiling and current roll per school. security_invoker — one row per school the caller may see.';

GRANT SELECT ON public.school_capacity TO authenticated;
REVOKE ALL ON public.school_capacity FROM anon;

-- ---------------------------------------------------------------------------
-- schools.max_students — deprecated, not dropped
--
-- The column has existed since 0003 as a per-school copy of the tier ceiling.
-- Nothing has ever read it to make a decision: no trigger, no function, no API
-- route. It was displayed on two admin screens, which is worse than useless —
-- an operator editing it believed they had changed a limit.
--
-- Since 0101 the enforced ceiling is resolved from the tier plus an auditable
-- `student_limit_override`, so this column is now a second answer to a question
-- that has one. It is left in place rather than dropped: dropping a column is
-- destructive and irreversible, the app no longer writes it, and the seed values
-- in it are the only record of what onboarding intended. Removing it is a
-- separate, approved migration.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN public.schools.max_students IS
  'DEPRECATED (0102). Unenforced per-school copy of a tier ceiling. The live ceiling is public.school_student_limit(); vary it per school with a student_limit_override. Do not read or write this column.';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_schools INT;
  v_rows INT;
  v_invoker BOOLEAN;
BEGIN
  SELECT count(*)::INT INTO v_schools FROM public.schools;
  SELECT count(*)::INT INTO v_rows FROM public.school_capacity;

  IF v_rows <> v_schools THEN
    RAISE EXCEPTION '0102: school_capacity returned % rows for % schools', v_rows, v_schools;
  END IF;

  -- A view over tenant data without security_invoker runs as its owner and
  -- silently bypasses every policy on `schools`.
  SELECT 'security_invoker=true' = ANY (c.reloptions) INTO v_invoker
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'school_capacity';

  IF v_invoker IS NOT TRUE THEN
    RAISE EXCEPTION '0102: school_capacity is not security_invoker';
  END IF;
END;
$$;

-- === MIGRATION END ===
