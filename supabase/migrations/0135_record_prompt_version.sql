-- Migration: 0135_record_prompt_version.sql
-- Created: 2026-09-28
-- Description: Stores which prompt version produced each resource.
-- Related documents: Official Documentation/18 AI Module/LESSON_PLANNER.md
--                    Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-041
--
-- ===========================================================================
-- `0134` ADDED THE COLUMN AND LEFT NOTHING ABLE TO WRITE IT
--
-- `teaching_resources.prompt_template_version` was added in `0134`, but
-- `create_teaching_resource()` dates from `0133` and does not accept it — so the column would
-- have stayed NULL on every row while the migration header claimed the provenance was
-- recorded. A column nothing writes is worse than no column, because the documentation says it
-- is there and somebody eventually queries it and concludes no prompt was ever used.
--
-- Separate migration rather than an edit to `0134` — prohibition 7. `0134` is applied.
-- ===========================================================================

-- === MIGRATION START ===

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
  p_prompt_version    INT     DEFAULT NULL
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
    )
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

/**
 * The 19-argument form from `0133` is dropped for the reason `0133` dropped `0130`'s: left as
 * an overload it would still work, still charge, and silently record NULL provenance — and a
 * 19-argument call matches both signatures, making the resolution ambiguous rather than merely
 * wrong. A 20-argument function with a default absorbs every shorter call.
 */
DROP FUNCTION IF EXISTS public.create_teaching_resource(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, INT, TEXT, JSONB, JSONB, UUID,
  TEXT, INT, INT, NUMERIC, TEXT
);

GRANT EXECUTE ON FUNCTION public.create_teaching_resource(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, INT, TEXT, JSONB, JSONB, UUID,
  TEXT, INT, INT, NUMERIC, TEXT, INT
) TO authenticated;

-- === MIGRATION END ===
