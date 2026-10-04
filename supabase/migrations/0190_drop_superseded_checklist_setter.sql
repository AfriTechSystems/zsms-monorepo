-- ---------------------------------------------------------------------------
-- 0190 — remove the checklist setter that `0189` superseded
-- ---------------------------------------------------------------------------
--
-- `0188` added `admin_set_checklist_item()`, which ticked one of four manual items and
-- REFUSED the ten derived ones. `0189` replaced that model entirely: any item may be
-- signed off, by AfriTech or by the school's own management, with a mandatory reason
-- recorded beside the derived answer.
--
-- Nothing calls the old function — `npm run gaps` flagged it the moment the route moved
-- across. Dropped rather than left in place: a second way to change a checklist item,
-- with different rules and no reason attached, is exactly the kind of thing somebody
-- wires up later because it was there.
--
-- No data is touched. The function only ever wrote `is_complete`, which the derivation
-- now owns.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.admin_set_checklist_item(UUID, TEXT, BOOLEAN);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'admin_set_checklist_item'
  ) THEN
    RAISE EXCEPTION 'admin_set_checklist_item still exists';
  END IF;

  -- And the replacement must be there, or this migration has removed the only way to
  -- complete an item.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'set_onboarding_override'
  ) THEN
    RAISE EXCEPTION 'set_onboarding_override is missing — do not drop the old setter';
  END IF;

  RAISE NOTICE 'verified: superseded setter gone, replacement present';
END;
$$;
