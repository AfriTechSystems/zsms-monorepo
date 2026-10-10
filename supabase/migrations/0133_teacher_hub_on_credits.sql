-- Migration: 0133_teacher_hub_on_credits.sql
-- Created: 2026-09-27
-- Description: Points the Teacher Hub at the AI credit ledger, so the platform has one
--              meter instead of two.
-- Related documents: Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md
--                    Official Documentation/18 AI Module/AI_CAPTURE.md — Pricing
--
-- ===========================================================================
-- 0132 BUILT THE LEDGER. THIS IS THE HALF THAT MAKES IT THE ONLY ONE.
--
-- The ledger is useless while `create_teaching_resource()` still increments
-- `trial_resources_used`, because then two meters both claim to answer "has this teacher
-- used their free allocation" — and the day they disagree, they disagree about whether
-- somebody has to pay.
--
-- `0132` backfilled the counter into the ledger. This migration stops writing it.
--
-- ---------------------------------------------------------------------------
-- WHAT CHANGES FOR A TEACHER, IN PLAIN TERMS
-- ---------------------------------------------------------------------------
-- Nothing, on a trial. Five free resources is now a five-credit lifetime allowance on their
-- personal wallet, spent one credit per resource, and `0132` carried every existing count
-- across — a teacher who had used three still has two.
--
-- What changes is what happens **after** the trial. Before, a paid plan meant unlimited
-- generation, which was safe only because the generator was a template costing nothing.
-- With a model behind it, unlimited-for-K300 is an uncapped liability. A paid plan now
-- carries 60 credits a month with top-ups available, which is the "included allowance plus
-- top-up" model — and it is configuration in `afritech.teacher_hub_plans`, so the number is
-- a business decision rather than a code change.
--
-- ---------------------------------------------------------------------------
-- WHY THE FEATURE KEY IS DERIVED HERE AND NOT PASSED IN
-- ---------------------------------------------------------------------------
-- `create_teaching_resource()` already knows the `resource_kind`. Letting a caller also
-- supply the feature key would let a route charge a quiz against the lesson-planner price by
-- accident, and there would be no way to notice from the ledger. One derivation, in one
-- place, in the function that writes the row.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. Which feature meters which kind.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teaching_resource_feature_key(p_resource_kind TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_resource_kind
    WHEN 'lesson_plan' THEN 'ai_lesson_planner'
    WHEN 'quiz'        THEN 'ai_quiz_generator'
    WHEN 'homework'    THEN 'ai_homework_creator'
  END;
$$;

COMMENT ON FUNCTION public.teaching_resource_feature_key(TEXT) IS
  'Maps a resource kind to the AI feature that meters it. Derived rather than passed in, so '
  'a route cannot charge a quiz against the lesson-planner price by accident.';

-- ---------------------------------------------------------------------------
-- 2. Entitlement, now answered by the wallet.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_hub_entitlement(p_clerk_user_id TEXT DEFAULT NULL)
RETURNS TABLE (
  may_generate         BOOLEAN,
  reason               TEXT,
  plan_code            TEXT,
  subscription_status  TEXT,
  allowance            INT,
  used                 INT,
  remaining            INT,
  subscription_ends_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_user    TEXT;
  a         public.standalone_teacher_accounts;
  v_account UUID;
  b         RECORD;
BEGIN
  v_user := CASE
    WHEN p_clerk_user_id IS NOT NULL AND COALESCE(public.is_afritech_admin(), FALSE)
      THEN p_clerk_user_id
    ELSE public.get_user_id()
  END;

  IF v_user IS NULL THEN
    RETURN QUERY SELECT FALSE, 'not_signed_in', NULL::TEXT, NULL::TEXT,
                        NULL::INT, NULL::INT, NULL::INT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  SELECT * INTO a FROM public.standalone_teacher_accounts WHERE clerk_user_id = v_user;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'no_account', NULL::TEXT, NULL::TEXT,
                        NULL::INT, NULL::INT, NULL::INT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- The wallet, if one exists. A teacher who has never generated has no wallet yet, and that
  -- is not an error — the allowance still resolves from their plan.
  SELECT id INTO v_account FROM public.ai_credit_accounts WHERE owner_user_id = v_user;

  IF v_account IS NULL THEN
    SELECT COALESCE(p.ai_credits_included, 0) AS allowance_credits,
           0 AS allowance_used,
           COALESCE(p.ai_credits_included, 0) AS allowance_remaining,
           0 AS purchased_available,
           COALESCE(p.ai_credits_included, 0) AS total_available
      INTO b
      FROM afritech.teacher_hub_plans p WHERE p.plan_code = a.plan_code;
  ELSE
    SELECT allowance_credits, allowance_used, allowance_remaining,
           purchased_available, total_available
      INTO b
      FROM public.ai_credit_balance(v_account);
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN a.subscription_status = 'suspended' THEN FALSE
      /**
       * A lapsed subscription blocks generation even with credits in the wallet. The
       * subscription is what grants access to the tools; credits are what meter the calls.
       * Somebody whose plan has ended is not entitled to keep generating just because they
       * bought credits earlier — and their credits are not lost, they resume on renewal.
       */
      WHEN a.subscription_status IN ('active', 'cancelled')
           AND (a.subscription_ends_at IS NULL OR a.subscription_ends_at <= NOW())
        THEN FALSE
      ELSE b.total_available > 0
    END,
    CASE
      WHEN a.subscription_status = 'suspended' THEN 'account_suspended'
      WHEN a.subscription_status IN ('active', 'cancelled')
           AND (a.subscription_ends_at IS NULL OR a.subscription_ends_at <= NOW())
        THEN CASE WHEN a.subscription_status = 'cancelled'
                  THEN 'subscription_cancelled' ELSE 'subscription_lapsed' END
      -- The trial and a paid plan run dry for different reasons and the screen says different
      -- things, so they are named differently rather than both being "out of credits".
      WHEN b.total_available <= 0 AND a.subscription_status = 'trial' THEN 'trial_exhausted'
      WHEN b.total_available <= 0 THEN 'credits_exhausted'
      ELSE NULL
    END,
    a.plan_code,
    a.subscription_status,
    b.allowance_credits,
    b.allowance_used,
    b.total_available,
    a.subscription_ends_at;
END;
$$;

COMMENT ON FUNCTION public.teacher_hub_entitlement(TEXT) IS
  'Whether this teacher may generate, and if not, why. Since 0133 the allowance and the '
  'remaining count come from the AI credit ledger rather than from '
  'standalone_teacher_accounts.trial_resources_used, which is deprecated.';

-- ---------------------------------------------------------------------------
-- 3. Creation, now charged against the wallet.
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
  -- New in 0133: the cost side, so margin is measurable per resource.
  p_model_name        TEXT    DEFAULT NULL,
  p_input_tokens      INT     DEFAULT NULL,
  p_output_tokens     INT     DEFAULT NULL,
  p_cost_usd          NUMERIC DEFAULT NULL,
  p_idempotency_key   TEXT    DEFAULT NULL
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

  -- The subscription gate is separate from the credit gate: a plan that has ended blocks
  -- generation even when credits remain, and those credits are not lost.
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

  /**
   * THE CHARGE. `ai_credit_consume()` locks the wallet, re-derives the balance under that
   * lock, and raises `42501` naming the shortfall if it is short — so the meter cannot be
   * beaten by two requests arriving together, exactly as the old counter could not be.
   *
   * It runs BEFORE the insert so an unaffordable request writes nothing. The resource is the
   * thing being paid for; there is no state worth keeping if the payment fails.
   */
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
      'generator', p_generator_name || ' ' || p_generator_version
    )
  );

  INSERT INTO public.teaching_resources (
    created_by, resource_kind, school_id, title, subject, grade_level, topic,
    curriculum_type, duration_minutes, lesson_type, content, generation_params,
    knowledge_sources, generator_name, generator_version
  ) VALUES (
    v_user, p_resource_kind, p_school_id, p_title, p_subject, p_grade_level, p_topic,
    p_curriculum_type, p_duration_minutes, p_lesson_type, p_content, p_generation_params,
    p_knowledge_sources, p_generator_name, p_generator_version
  )
  RETURNING id INTO v_id;

  -- `resources_created` stays: it is a lifetime count for the library heading, not a meter,
  -- and nothing gates on it. `trial_resources_used` is NO LONGER written — the ledger is the
  -- only meter now, which is the whole point of this migration.
  UPDATE public.standalone_teacher_accounts
     SET resources_created = resources_created + 1
   WHERE clerk_user_id = v_user;

  RETURN v_id;
END;
$$;

/**
 * The 14-argument form from `0130` is dropped, rather than left beside the new one.
 *
 * Postgres would keep both as overloads, and the old one still increments nothing and
 * charges nothing — so a caller that was not updated would generate resources for free,
 * silently, with the ledger showing no consumption. That is a worse outcome than a broken
 * call, because it looks like it works.
 */
DROP FUNCTION IF EXISTS public.create_teaching_resource(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, INT, TEXT, JSONB, JSONB, UUID
);

GRANT EXECUTE ON FUNCTION public.create_teaching_resource(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, INT, TEXT, JSONB, JSONB, UUID,
  TEXT, INT, INT, NUMERIC, TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION public.teaching_resource_feature_key(TEXT) TO authenticated;

-- === MIGRATION END ===
