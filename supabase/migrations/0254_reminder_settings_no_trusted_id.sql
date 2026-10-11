-- ===========================================================================
-- 0254 — `school_reminder_settings(UUID)` trusted its argument
--
-- Corrects `0251`, three migrations ago, which this session wrote.
--
-- ## The defect
--
-- `0251` created a SECURITY DEFINER function taking `p_school_id UUID` and
-- granted EXECUTE to `authenticated`:
--
--     GRANT EXECUTE ON FUNCTION public.school_reminder_settings(UUID) TO authenticated;
--
-- A DEFINER function bypasses RLS, and that one has no tenant clause — it
-- returns whatever school's row the caller names. So **any signed-in user could
-- read any school's reminder configuration** by changing a UUID in a request:
-- which channels they use, whether they chase at three days or thirty, whether
-- they have switched reminders off entirely.
--
-- That is commercially sensitive rather than catastrophic — no pupil, parent or
-- amount is exposed. It is still the exact pattern `zsms-migration` names first
-- among its absolutes: **never trust an id passed as an argument.** AfriTech may
-- name a school; everybody else is resolved from the session.
--
-- The RLS policies `0251` wrote were correct and were simply not what the route
-- would have gone through.
--
-- ## The fix
--
-- Two functions, each with one audience:
--
--   * `school_reminder_settings(UUID)` keeps the argument and loses the
--     `authenticated` grant. It exists for the worker, which joins it per school
--     inside SQL under `service_role` and has no session to resolve from.
--   * `my_reminder_settings()` takes **no argument** and resolves the school from
--     the caller's own claims. This is what a route calls, so there is no id for
--     anybody to change.
--
-- Same shape as `claim_parent_links()` in `0170`, and for the same reason.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Take the grant away from signed-in users.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.school_reminder_settings(UUID) FROM authenticated;

COMMENT ON FUNCTION public.school_reminder_settings(UUID) IS
  'Worker-side resolution of a school''s reminder schedule, joined per school inside SQL. Takes an id and has no tenant clause, so it is service_role only — a route calls my_reminder_settings() instead (0254 correcting 0251).';

-- ---------------------------------------------------------------------------
-- 2. The no-argument form a route can safely call.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.my_reminder_settings()
RETURNS TABLE (
  out_reminder_days INT[],
  out_via_whatsapp  BOOLEAN,
  out_via_email     BOOLEAN,
  out_via_in_app    BOOLEAN,
  out_cooldown_days INT,
  out_is_enabled    BOOLEAN,
  out_configured    BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  /*
    Who may SEE the schedule, matching `0251`'s read policy.

    Narrower than "anybody at the school": a teacher has no reason to know the
    chasing schedule, and it is the accountant who will be asked why a parent
    received a message.
  */
  IF public.get_user_role() NOT IN
       ('org:owner', 'org:principal', 'org:accountant', 'org:admin') THEN
    RAISE EXCEPTION 'You cannot view fee reminder settings' USING ERRCODE = '42501';
  END IF;

  -- The school comes from the session, so there is no argument to tamper with.
  RETURN QUERY SELECT * FROM public.school_reminder_settings(v_school);
END;
$$;

COMMENT ON FUNCTION public.my_reminder_settings() IS
  'The calling school''s fee reminder schedule. Takes no argument on purpose: the id form bypasses RLS and would let any signed-in user read another school''s configuration (0254).';

REVOKE ALL ON FUNCTION public.my_reminder_settings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_reminder_settings() FROM anon;
GRANT EXECUTE ON FUNCTION public.my_reminder_settings() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Prove the hole is shut.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_a      UUID;
  v_b      UUID;
  v_org_a  TEXT;
  v_row    RECORD;
BEGIN
  BEGIN
    -- Two different schools, so "another school's row" is a real thing to ask for.
    SELECT id, clerk_org_id INTO v_a, v_org_a FROM public.schools
    WHERE clerk_org_id IS NOT NULL ORDER BY created_at LIMIT 1;
    SELECT id INTO v_b FROM public.schools WHERE id <> v_a LIMIT 1;

    IF v_a IS NULL OR v_b IS NULL THEN
      RAISE NOTICE '0254: need two school fixtures; asserting privileges only';
    ELSE
      -- Give school B a distinctive setting, so reaching it would be visible.
      INSERT INTO public.school_fee_reminder_settings (school_id, reminder_days)
      VALUES (v_b, ARRAY[21])
      ON CONFLICT (school_id) DO UPDATE SET reminder_days = ARRAY[21];

      PERFORM set_config('request.jwt.claims', json_build_object(
        'sub', 'probe_owner_a', 'role', 'authenticated',
        'o', json_build_object('id', v_org_a, 'rol', 'owner'))::text, TRUE);

      -- School A asking for its own settings gets its own, never B's.
      SELECT * INTO v_row FROM public.my_reminder_settings();
      IF v_row.out_reminder_days = ARRAY[21] THEN
        RAISE EXCEPTION '0254: school A received school B''s schedule';
      END IF;

      -- A teacher must not see it at all.
      PERFORM set_config('request.jwt.claims', json_build_object(
        'sub', 'probe_teacher', 'role', 'authenticated',
        'o', json_build_object('id', v_org_a, 'rol', 'teacher'))::text, TRUE);
      BEGIN
        PERFORM public.my_reminder_settings();
        RAISE EXCEPTION '0254: a teacher read the chasing schedule';
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
    END IF;

    -- The id-taking form must no longer be reachable by a signed-in user at all.
    IF has_function_privilege('authenticated',
         'public.school_reminder_settings(UUID)', 'EXECUTE') THEN
      RAISE EXCEPTION
        '0254: authenticated can still name any school''s reminder settings';
    END IF;
    IF has_function_privilege('anon',
         'public.school_reminder_settings(UUID)', 'EXECUTE') THEN
      RAISE EXCEPTION '0254: anon can name any school''s reminder settings';
    END IF;
    IF has_function_privilege('anon', 'public.my_reminder_settings()', 'EXECUTE') THEN
      RAISE EXCEPTION '0254: anon can execute my_reminder_settings';
    END IF;

    -- And the worker must still be able to use the id form, or 0252 breaks.
    IF NOT has_function_privilege('service_role',
         'public.school_reminder_settings(UUID)', 'EXECUTE') THEN
      RAISE EXCEPTION '0254: the worker lost its access and no reminder can be sent';
    END IF;

    RAISE EXCEPTION 'ZSMS_0254_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0254_ROLLBACK' THEN
        RAISE NOTICE '0254: verified — no cross-school read, teacher refused, worker intact';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
