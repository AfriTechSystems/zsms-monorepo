-- ---------------------------------------------------------------------------
-- 0165 — setting the reserve switch
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
--
-- ## Why this exists
--
-- `0163` states, in its own comments, that a school holds no INSERT, UPDATE or
-- DELETE policy on any of the three credit tables, and that every write goes
-- through a SECURITY DEFINER function. That is true of purchases and assignments.
-- It was not true of `school_credit_settings`, because no function was written
-- for it — the route was going to `upsert` directly.
--
-- That would have failed at runtime with a policy violation, on a screen nobody
-- had opened yet. It surfaced early only because the route needed a school UUID
-- that `SessionUser` does not carry, and the type error prompted a second look.
--
-- The lesson is the small one: a rule stated in a comment is not enforced by
-- having been stated. `0163` left a table with no write path and said it had one.
--
-- ## No school id parameter
--
-- The school comes from `current_school_uuid()` inside the function, never from
-- the caller. A `p_school_id` argument on a SECURITY DEFINER function is an
-- invitation to pass somebody else's — the same reasoning `0158` applied to
-- `register_push_token()` and `0160` to `request_school_link()`.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.school_set_credit_reserve(
  p_enabled BOOLEAN,
  p_per_teacher_cap INT DEFAULT NULL
)
RETURNS TABLE (
  out_reserve_enabled         BOOLEAN,
  out_reserve_per_teacher_cap INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
BEGIN
  IF v_school IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'Only a signed-in school may change its credit reserve'
      USING ERRCODE = '42501';
  END IF;

  IF p_per_teacher_cap IS NOT NULL AND p_per_teacher_cap < 0 THEN
    RAISE EXCEPTION 'A per-teacher cap cannot be negative' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.school_credit_settings AS s
    (school_id, reserve_enabled, reserve_per_teacher_cap, updated_by, updated_at)
  VALUES (v_school, p_enabled, p_per_teacher_cap, v_user, NOW())
  ON CONFLICT (school_id) DO UPDATE
    SET reserve_enabled         = EXCLUDED.reserve_enabled,
        reserve_per_teacher_cap = EXCLUDED.reserve_per_teacher_cap,
        updated_by              = EXCLUDED.updated_by,
        updated_at              = NOW();

  PERFORM public.log_audit_event(
    'school_credit_reserve_set', 'school_credit_settings', NULL,
    jsonb_build_object('enabled', p_enabled, 'cap', p_per_teacher_cap),
    v_school
  );

  RETURN QUERY
  SELECT s.reserve_enabled, s.reserve_per_teacher_cap
  FROM public.school_credit_settings AS s
  WHERE s.school_id = v_school;
END;
$$;

REVOKE ALL ON FUNCTION public.school_set_credit_reserve(BOOLEAN, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_set_credit_reserve(BOOLEAN, INT) FROM anon;
GRANT EXECUTE ON FUNCTION public.school_set_credit_reserve(BOOLEAN, INT) TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.school_set_credit_reserve(BOOLEAN, INT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'school_set_credit_reserve is executable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.school_set_credit_reserve(BOOLEAN, INT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute school_set_credit_reserve';
  END IF;
END;
$$;
