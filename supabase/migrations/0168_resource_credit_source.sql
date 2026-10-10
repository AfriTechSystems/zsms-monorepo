-- ---------------------------------------------------------------------------
-- 0168 — a teacher chooses which credits pay for a resource
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
--       `Official Documentation/18 AI Module/AI_OVERVIEW.md`
--
-- `0167` gave `ai_credit_consume()` a source. `create_teaching_resource()` is the
-- only thing in the product that charges for a generation, and it called the
-- consume without one — so every resource a linked teacher made was billed to
-- their school, with no way to say "this one is mine".
--
-- The parameter is added LAST with a default of `auto`, so every existing call
-- site keeps working and keeps school-first behaviour.
--
-- ## Restated from 0135, not 0133
--
-- This function is defined three times, across 0130, 0133 and 0135. `CREATE OR
-- REPLACE` cannot add a parameter, so the body must be restated — and restating
-- the wrong one silently reverts whatever the later migrations added. The first
-- attempt took 0133's body, which has no `p_prompt_version` at all: it would have
-- undone the entire point of 0135 while applying cleanly.
--
-- When a function has been redefined more than once, the live definition is the
-- one to copy, and `pg_get_function_identity_arguments` is how to confirm which
-- that is before writing a line.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_teaching_resource(
  p_resource_kind     TEXT,
  p_title             TEXT,
  p_subject           TEXT,
  p_grade_level       TEXT,
  p_topic             TEXT,
  p_curriculum_type   TEXT,
  p_content           JSONB,
  p_generator_name    TEXT,
  p_generator_version TEXT,
  p_duration_minutes  INT     DEFAULT NULL,
  p_lesson_type       TEXT    DEFAULT NULL,
  p_generation_params JSONB   DEFAULT '{}'::jsonb,
  p_knowledge_sources JSONB   DEFAULT NULL,
  p_school_id         UUID    DEFAULT NULL,
  p_model_name        TEXT    DEFAULT NULL,
  p_input_tokens      INT     DEFAULT NULL,
  p_output_tokens     INT     DEFAULT NULL,
  p_cost_usd          NUMERIC DEFAULT NULL,
  p_idempotency_key   TEXT    DEFAULT NULL,
  -- New. NULL means no prompt was involved — the deterministic scaffold — and that NULL is
  -- itself the useful signal, which is why it is not defaulted to a version number.
  p_prompt_version    INT     DEFAULT NULL,
  -- `auto` keeps school-first. `school` and `personal` are the teacher's choice;
  -- 0167 refuses rather than splitting one generation across two payers.
  p_credit_source     TEXT    DEFAULT 'auto'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_user    TEXT := public.get_user_id();
  a         public.standalone_teacher_accounts;
  v_feature TEXT;
  v_id      UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;

  v_feature := public.teaching_resource_feature_key(p_resource_kind);
  IF v_feature IS NULL THEN
    RAISE EXCEPTION 'Unknown resource kind %.', p_resource_kind USING ERRCODE = '22023';
  END IF;

  SELECT * INTO a FROM public.standalone_teacher_accounts
   WHERE clerk_user_id = v_user FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No Teacher Hub account for this user.' USING ERRCODE = 'P0002';
  END IF;

  IF a.subscription_status = 'suspended' THEN
    RAISE EXCEPTION 'This account is suspended.' USING ERRCODE = '42501';
  END IF;

  IF a.subscription_status IN ('active', 'cancelled')
     AND (a.subscription_ends_at IS NULL OR a.subscription_ends_at <= NOW()) THEN
    RAISE EXCEPTION 'The subscription has ended. Saved resources stay readable.'
      USING ERRCODE = '42501';
  END IF;

  IF p_school_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.my_schools() m WHERE m.out_school_uuid = p_school_id
     ) THEN
    RAISE EXCEPTION 'Not a member of that school.' USING ERRCODE = '42501';
  END IF;

  -- Charged before the insert, under a wallet lock, so an unaffordable request writes nothing.
  PERFORM public.ai_credit_consume(
    p_feature_key     => v_feature,
    p_units           => 1,
    p_model_name      => p_model_name,
    p_input_tokens    => p_input_tokens,
    p_output_tokens   => p_output_tokens,
    p_cost_usd        => p_cost_usd,
    p_idempotency_key => p_idempotency_key,
    p_metadata        => jsonb_build_object(
      'resource_kind', p_resource_kind,
      'subject', p_subject,
      'grade_level', p_grade_level,
      'generator', p_generator_name || ' ' || p_generator_version,
      'prompt_version', p_prompt_version
    ),
    p_source          => p_credit_source
  );

  INSERT INTO public.teaching_resources (
    created_by, resource_kind, school_id, title, subject, grade_level, topic,
    curriculum_type, duration_minutes, lesson_type, content, generation_params,
    knowledge_sources, generator_name, generator_version, prompt_template_version
  ) VALUES (
    v_user, p_resource_kind, p_school_id, p_title, p_subject, p_grade_level, p_topic,
    p_curriculum_type, p_duration_minutes, p_lesson_type, p_content, p_generation_params,
    p_knowledge_sources, p_generator_name, p_generator_version, p_prompt_version
  )
  RETURNING id INTO v_id;

  UPDATE public.standalone_teacher_accounts
     SET resources_created = resources_created + 1
   WHERE clerk_user_id = v_user;

  RETURN v_id;
END;
$$;

-- The 20-argument version is dropped. Left in place it is an overload the same
-- named-argument call also resolves to, and PostgREST would have two candidates
-- for one RPC name.
DROP FUNCTION IF EXISTS public.create_teaching_resource(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, INT, TEXT, JSONB, JSONB,
  UUID, TEXT, INT, INT, NUMERIC, TEXT, INT
);

DO $grants$
DECLARE v_fn TEXT := 'public.create_teaching_resource(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, INT, TEXT, JSONB, JSONB, UUID, TEXT, INT, INT, NUMERIC, TEXT, INT, TEXT)';
BEGIN
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);

  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon can execute create_teaching_resource';
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute create_teaching_resource';
  END IF;

  -- Exactly one definition must remain, or an RPC call is ambiguous.
  IF (SELECT COUNT(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'create_teaching_resource') <> 1 THEN
    RAISE EXCEPTION 'create_teaching_resource is overloaded — PostgREST cannot resolve it';
  END IF;
END;
$grants$;
