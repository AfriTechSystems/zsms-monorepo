-- Migration: 0134_ai_models_prompts_and_incidents.sql
-- Created: 2026-09-28
-- Description: The model chain as data, prompts as versioned configuration, and a
--              platform-wide incident record so AfriTech is told when anything breaks.
-- Related documents: Official Documentation/18 AI Module/AI_OVERVIEW.md
--                    Official Documentation/15 Super Admin and Platform/SUPERADMIN.md
--                    Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--
-- ===========================================================================
-- THREE THINGS, AND THEY BELONG TOGETHER
--
-- A model chain that fails over is useless without somewhere to report that it failed over,
-- and a prompt that can be edited without a deployment is dangerous unless every artefact
-- records which version produced it. So: models, prompts, incidents.
--
-- ---------------------------------------------------------------------------
-- 1. NOTHING CAPTURES ERRORS TODAY. NOT SENTRY, NOT ANYTHING.
-- ---------------------------------------------------------------------------
-- `CLAUDE.md` lists Sentry under Phase 0 observability and `ENV.md` has a section for its
-- DSN, which together give the strong impression that errors are being collected somewhere.
-- **They are not.** There is no `@sentry/*` dependency in any package, no
-- `sentry.*.config.*`, no `captureException`, and no `global-error.tsx`. The only matches for
-- "sentry" in the tree are inside Next's own `node_modules`.
--
-- So if a teacher hits a 500 today, nobody ever finds out. Not a slow discovery — no
-- discovery, ever.
--
-- `platform_incidents` is deliberately **not** a replacement for Sentry, and the two are not
-- alternatives:
--
--   * Sentry collects *exceptions* for engineers — stack traces, release tracking. It has no
--     notion of "a human saw this and topped up the API key".
--   * This table collects *things AfriTech must act on*, with a lifecycle that ends in
--     somebody having acted: a provider key needs rotating, a school's WhatsApp number was
--     rejected, a gateway webhook is failing, a school has hit its pupil ceiling.
--
-- Sentry should still be wired. This works today, without credentials.
--
-- ---------------------------------------------------------------------------
-- WHY DEDUPLICATION IS THE WHOLE DESIGN, NOT A REFINEMENT
-- ---------------------------------------------------------------------------
-- A dead API key does not fail once. It fails on **every request** — two hundred teachers
-- generating means two hundred failures of one underlying problem. A table with one row per
-- failure would bury the signal it exists to raise, and an email channel attached to it later
-- would send two hundred emails about one expired key.
--
-- So an incident is keyed on `dedupe_key` and carries `first_seen`, `last_seen` and
-- `occurrence_count`. `record_platform_incident()` is an UPSERT: the first failure opens an
-- incident, the next hundred and ninety-nine increment a counter and move a timestamp.
--
-- A **resolved** incident that happens again re-opens rather than staying closed, because a
-- key that fails after being fixed is news.
--
-- ---------------------------------------------------------------------------
-- 2. THE MODEL CHAIN IS DATA, WHICH BUYS THREE THINGS AT ONCE
-- ---------------------------------------------------------------------------
-- `afritech.ai_models` holds provider, model, priority and per-million-token rates. That
-- makes adding a third provider a row rather than a release; it makes reordering the
-- failover chain a row; and it makes `cost_usd` on the credit ledger **accurate**, because
-- the rates are read from configuration rather than baked into TypeScript that goes stale the
-- day a provider reprices.
--
-- The Anthropic key on this project currently has no credits while the OpenAI one does, which
-- is precisely why the chain must be data: the working provider changes without the code
-- changing.
--
-- ---------------------------------------------------------------------------
-- 3. AN EDITABLE PROMPT MUST BE A VERSIONED PROMPT
-- ---------------------------------------------------------------------------
-- The requirement is that an admin can improve the prompt without a deployment. The hazard is
-- that output quality then shifts with nothing recording why, and a complaint about a lesson
-- plan from three weeks ago cannot be reproduced.
--
-- So a prompt is immutable once used: editing publishes a NEW version, and
-- `teaching_resources.prompt_template_version` records which one produced each artefact.
--
-- This is ADR-041 for the fourth time — a grade carries its scale version, an invoice freezes
-- its unit price, a resource records its generator, and now a resource records its prompt. The
-- rule generalises: **a derived value must carry the basis it was derived from.**
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. The model chain.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afritech.ai_models (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider              TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  model_name            TEXT NOT NULL,
  display_name          TEXT NOT NULL,
  /**
   * Lower runs first. Not a `role` column of 'primary'/'fallback': with three providers that
   * becomes 'primary'/'secondary'/'tertiary' and the ordering is implied by a name rather
   * than stated. An integer says exactly what it means.
   */
  priority              INT NOT NULL,
  -- Rates per MILLION tokens, which is how both providers publish them — so a rate can be
  -- copied from a price page without arithmetic, and arithmetic is where errors live.
  input_usd_per_million  NUMERIC(12,4) NOT NULL CHECK (input_usd_per_million >= 0),
  output_usd_per_million NUMERIC(12,4) NOT NULL CHECK (output_usd_per_million >= 0),
  -- What this model can be asked to do. A text model must not be selected for a vision
  -- capture, and the chain filters on this rather than on a hardcoded provider name.
  capabilities          TEXT[] NOT NULL DEFAULT '{text}',
  max_output_tokens     INT NOT NULL DEFAULT 8192 CHECK (max_output_tokens > 0),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, model_name)
);

-- Two models cannot share a priority, or the chain order depends on which row the planner
-- happens to return first — a failover order that varies between calls is not an order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_models_priority
  ON afritech.ai_models(priority) WHERE is_active = TRUE;

COMMENT ON TABLE afritech.ai_models IS
  'The failover chain, in priority order, with per-million-token rates. Data rather than code '
  'so a third provider is a row, reordering is a row, and cost_usd stays accurate when a '
  'provider reprices.';

/**
 * Seeded in the order this project can actually use TODAY: OpenAI first, because the
 * Anthropic key has no credits. Reordering is a row change once that is topped up — and the
 * point of the table is that this sentence does not require a deployment to stop being true.
 *
 * Rates are the published list prices at the time of writing and WILL go stale. They are
 * configuration precisely so that staleness is a five-second correction rather than a release.
 */
INSERT INTO afritech.ai_models
  (provider, model_name, display_name, priority,
   input_usd_per_million, output_usd_per_million, capabilities, max_output_tokens, notes)
VALUES
  ('openai', 'gpt-4o', 'GPT-4o', 10, 2.5000, 10.0000, '{text,vision,structured}', 16384,
   'First in the chain because this is the key with credit on it.'),
  ('anthropic', 'claude-sonnet-4-5', 'Claude Sonnet 4.5', 20, 3.0000, 15.0000,
   '{text,vision,structured}', 8192,
   'Wired but UNVERIFIED — the key on this project has no credits, so failover TO it has '
   'never executed. Raise its priority above OpenAI once topped up and tested.')
ON CONFLICT (provider, model_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Prompts, versioned.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afritech.ai_prompt_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key     TEXT NOT NULL
                  REFERENCES afritech.feature_flags(feature_key) ON UPDATE CASCADE,
  version         INT NOT NULL CHECK (version > 0),
  system_prompt   TEXT NOT NULL,
  -- Placeholders the renderer substitutes: {{subject}}, {{grade_level}}, {{topic}},
  -- {{duration_minutes}}, {{lesson_type}}, {{context}}, {{curriculum_outcomes}}.
  user_template   TEXT NOT NULL,
  -- temperature, and any provider-neutral knob. Kept as JSONB so adding one is not a column.
  model_params    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Exactly one active version per feature, enforced by the index below.
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,
  change_note     TEXT,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (feature_key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_prompt_templates_active
  ON afritech.ai_prompt_templates(feature_key) WHERE is_active = TRUE;

/**
 * There is no UPDATE path for `system_prompt` or `user_template` — see the grants. Editing a
 * prompt in place would silently change what every future artefact claims to have been made
 * from, and would make a three-week-old complaint impossible to reproduce.
 *
 * `publish_prompt_template()` below is the only way to change the live prompt, and it creates
 * a version.
 */
COMMENT ON TABLE afritech.ai_prompt_templates IS
  'Versioned prompts. Immutable once written; editing publishes a new version. Every artefact '
  'records the version that produced it — ADR-041 applied to prompts.';

-- Which prompt made this. NULL for everything produced by the deterministic scaffold, which
-- has no prompt at all — and that NULL is itself informative.
ALTER TABLE public.teaching_resources
  ADD COLUMN IF NOT EXISTS prompt_template_version INT;

COMMENT ON COLUMN public.teaching_resources.prompt_template_version IS
  'Which afritech.ai_prompt_templates version produced this. NULL means no prompt was '
  'involved — the deterministic scaffold — which is why it is nullable rather than defaulted.';

-- ---------------------------------------------------------------------------
-- 3. Incidents.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_incidents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /**
   * Deliberately NOT an enum of AI-provider failures. The first use is a dead model key, but
   * the same table must take a rejected WhatsApp number, a failing gateway webhook, an
   * unhandled server error and a school at its ceiling — otherwise there will be four tables
   * doing this, which is the mistake `ai_credit_ledger` was created to avoid repeating.
   */
  source           TEXT NOT NULL CHECK (source IN (
                     'ai_provider', 'notification', 'payment_gateway', 'worker',
                     'api_route', 'database', 'integration', 'other'
                   )),
  -- Free text rather than a CHECK: the set of distinguishable failures grows weekly and a
  -- CHECK would mean a migration to report a new one. Grouping is by `source`.
  kind             TEXT NOT NULL,
  severity         TEXT NOT NULL DEFAULT 'warning'
                   CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  title            TEXT NOT NULL,
  detail           TEXT,
  -- The school this concerns, when it concerns one. NULL for platform-level failures.
  school_id        UUID REFERENCES public.schools(id),
  feature_key      TEXT REFERENCES afritech.feature_flags(feature_key) ON UPDATE CASCADE,
  /**
   * THE DEDUPLICATION KEY. One row per underlying problem, not per occurrence. A dead key
   * failing two hundred times is one incident with a count of two hundred.
   */
  dedupe_key       TEXT NOT NULL UNIQUE,
  occurrence_count INT NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status           TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'acknowledged', 'resolved')),
  acknowledged_by  TEXT,
  acknowledged_at  TIMESTAMPTZ,
  resolved_by      TEXT,
  resolved_at      TIMESTAMPTZ,
  resolution_note  TEXT,
  /**
   * Whether the affected school may see this. FALSE by default and deliberately so: most
   * incidents are AfriTech's plumbing and telling a school its provider chain failed over
   * would be alarming noise. A rejected WhatsApp number is the opposite — the school has to
   * act, so that one gets flagged visible when it is raised.
   */
  is_school_visible BOOLEAN NOT NULL DEFAULT FALSE,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A resolution must say who and when, or "resolved" is a claim nobody owns.
  CONSTRAINT platform_incidents_resolution_shape CHECK (
    (status = 'resolved' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    OR status <> 'resolved'
  ),
  CONSTRAINT platform_incidents_ack_shape CHECK (
    (status = 'acknowledged' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL)
    OR status <> 'acknowledged'
  )
);

-- The dashboard's only question: what is open, worst first, most recent first.
CREATE INDEX IF NOT EXISTS idx_platform_incidents_open
  ON public.platform_incidents(severity, last_seen_at DESC)
  WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS idx_platform_incidents_school
  ON public.platform_incidents(school_id) WHERE school_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_platform_incidents_source
  ON public.platform_incidents(source, kind);

CREATE TRIGGER set_updated_at_on_platform_incidents
  BEFORE UPDATE ON public.platform_incidents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_on_ai_models
  BEFORE UPDATE ON afritech.ai_models
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Raising an incident.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_platform_incident(
  p_source            TEXT,
  p_kind              TEXT,
  p_title             TEXT,
  p_dedupe_key        TEXT,
  p_severity          TEXT    DEFAULT 'warning',
  p_detail            TEXT    DEFAULT NULL,
  p_school_id         UUID    DEFAULT NULL,
  p_feature_key       TEXT    DEFAULT NULL,
  p_is_school_visible BOOLEAN DEFAULT FALSE,
  p_metadata          JSONB   DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
/**
 * DEFINER, and executable by `authenticated`, which deserves justifying: any signed-in
 * request must be able to report that something broke, because the request that fails IS the
 * evidence. A route that could not report its own failure would leave exactly the gap this
 * table exists to close.
 *
 * The risk is a caller inventing incidents. That is bounded: the function writes nothing but
 * an incident, reveals nothing, and `actor` is taken from the session rather than the
 * arguments — so a forged report is attributable to whoever forged it.
 */
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.platform_incidents (
    source, kind, severity, title, detail, school_id, feature_key,
    dedupe_key, is_school_visible, metadata
  ) VALUES (
    p_source, p_kind, COALESCE(p_severity, 'warning'), p_title, p_detail,
    p_school_id, p_feature_key, p_dedupe_key, COALESCE(p_is_school_visible, FALSE),
    COALESCE(p_metadata, '{}'::jsonb)
      || jsonb_build_object('reported_by',
           COALESCE(public.get_user_id(), 'system'))
  )
  ON CONFLICT (dedupe_key) DO UPDATE
    SET occurrence_count = public.platform_incidents.occurrence_count + 1,
        last_seen_at     = NOW(),
        -- A worsening problem raises its own severity; it never quietly lowers it.
        severity = CASE
          WHEN EXCLUDED.severity = 'critical' THEN 'critical'
          WHEN public.platform_incidents.severity = 'critical' THEN 'critical'
          WHEN EXCLUDED.severity = 'error' OR public.platform_incidents.severity = 'error'
            THEN 'error'
          ELSE public.platform_incidents.severity
        END,
        /**
         * A RESOLVED incident recurring re-opens. A key that fails again after somebody
         * fixed it is news, and leaving it closed would hide the second outage behind the
         * first one's resolution.
         */
        status = CASE WHEN public.platform_incidents.status = 'resolved'
                      THEN 'open' ELSE public.platform_incidents.status END,
        resolved_by  = CASE WHEN public.platform_incidents.status = 'resolved'
                            THEN NULL ELSE public.platform_incidents.resolved_by END,
        resolved_at  = CASE WHEN public.platform_incidents.status = 'resolved'
                            THEN NULL ELSE public.platform_incidents.resolved_at END,
        -- The newest detail is the useful one; the count says it has happened before.
        detail = COALESCE(EXCLUDED.detail, public.platform_incidents.detail)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_platform_incident(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, JSONB
) TO authenticated;

COMMENT ON FUNCTION public.record_platform_incident(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, BOOLEAN, JSONB) IS
  'Opens an incident or increments an existing one, keyed on dedupe_key. A dead API key fails '
  'on every request; this turns two hundred failures into one incident with a count of 200.';

CREATE OR REPLACE FUNCTION public.set_incident_status(
  p_incident_id UUID,
  p_status      TEXT,
  p_note        TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor TEXT := COALESCE(public.get_actor_id(), public.get_user_id());
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech changes an incident''s status.' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('open', 'acknowledged', 'resolved') THEN
    RAISE EXCEPTION 'Unknown incident status %.', p_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.platform_incidents
     SET status = p_status,
         acknowledged_by = CASE WHEN p_status = 'acknowledged' THEN v_actor
                                ELSE acknowledged_by END,
         acknowledged_at = CASE WHEN p_status = 'acknowledged' THEN NOW()
                                ELSE acknowledged_at END,
         resolved_by     = CASE WHEN p_status = 'resolved' THEN v_actor ELSE NULL END,
         resolved_at     = CASE WHEN p_status = 'resolved' THEN NOW() ELSE NULL END,
         resolution_note = COALESCE(p_note, resolution_note)
   WHERE id = p_incident_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_incident_status(UUID, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Publishing a prompt version.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION afritech.publish_prompt_template(
  p_feature_key   TEXT,
  p_system_prompt TEXT,
  p_user_template TEXT,
  p_model_params  JSONB DEFAULT '{}'::jsonb,
  p_change_note   TEXT  DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = afritech, public, pg_temp
AS $$
DECLARE
  v_version INT;
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech publishes a prompt.' USING ERRCODE = '42501';
  END IF;

  -- MAX, not COUNT. The same lesson as `next_student_sequence()`: once a version is skipped
  -- for any reason, a count collides permanently.
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM afritech.ai_prompt_templates WHERE feature_key = p_feature_key;

  -- Retire the incumbent first: the partial unique index permits exactly one active version
  -- per feature, so this ordering is required rather than tidy.
  UPDATE afritech.ai_prompt_templates
     SET is_active = FALSE
   WHERE feature_key = p_feature_key AND is_active;

  INSERT INTO afritech.ai_prompt_templates
    (feature_key, version, system_prompt, user_template, model_params, is_active,
     change_note, created_by)
  VALUES
    (p_feature_key, v_version, p_system_prompt, p_user_template,
     COALESCE(p_model_params, '{}'::jsonb), TRUE, p_change_note,
     COALESCE(public.get_actor_id(), public.get_user_id(), 'system'));

  RETURN v_version;
END;
$$;

GRANT EXECUTE ON FUNCTION afritech.publish_prompt_template(TEXT, TEXT, TEXT, JSONB, TEXT)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. What a generation needs, in one call.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_generation_config(p_feature_key TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, afritech, pg_temp
AS $$
  SELECT jsonb_build_object(
    -- The chain, in the order it should be tried.
    'models', (
      SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.priority), '[]'::jsonb)
        FROM afritech.ai_models m
       WHERE m.is_active AND 'structured' = ANY (m.capabilities)
    ),
    'prompt', (
      SELECT to_jsonb(t) FROM afritech.ai_prompt_templates t
       WHERE t.feature_key = p_feature_key AND t.is_active
    ),
    'credits_per_action', (
      SELECT p.credits_per_action FROM afritech.ai_credit_prices p
       WHERE p.feature_key = p_feature_key AND p.is_active
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.ai_generation_config(TEXT) TO authenticated;

COMMENT ON FUNCTION public.ai_generation_config(TEXT) IS
  'The model chain, the active prompt and the credit price for one feature, in one round '
  'trip — everything a generation route needs before it calls a provider.';

-- ---------------------------------------------------------------------------
-- 7. RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE afritech.ai_models           ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.ai_models           FORCE  ROW LEVEL SECURITY;
ALTER TABLE afritech.ai_prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.ai_prompt_templates FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.platform_incidents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_incidents    FORCE  ROW LEVEL SECURITY;

/**
 * AfriTech only, for both configuration tables.
 *
 * A model name and a token rate are commercially sensitive — they reveal which provider ZSMS
 * depends on and what its margin is. A prompt is more sensitive still: it is the accumulated
 * product work that makes the output good, and it is the one asset a competitor could copy
 * verbatim from a network response. Neither is read by a client; `ai_generation_config()` is
 * DEFINER and is called server-side.
 */
CREATE POLICY afritech_read_ai_models
  ON afritech.ai_models FOR SELECT TO authenticated
  USING (COALESCE(public.is_afritech_admin(), FALSE));
CREATE POLICY afritech_write_ai_models
  ON afritech.ai_models FOR ALL TO authenticated
  USING (COALESCE(public.is_afritech_admin(), FALSE))
  WITH CHECK (COALESCE(public.is_afritech_admin(), FALSE));

CREATE POLICY afritech_read_ai_prompt_templates
  ON afritech.ai_prompt_templates FOR SELECT TO authenticated
  USING (COALESCE(public.is_afritech_admin(), FALSE));

-- INSERT only, and only through publish_prompt_template() in practice. No UPDATE policy at
-- all: a prompt is immutable once written, so there is no legitimate edit to permit.
CREATE POLICY afritech_insert_ai_prompt_templates
  ON afritech.ai_prompt_templates FOR INSERT TO authenticated
  WITH CHECK (COALESCE(public.is_afritech_admin(), FALSE));

CREATE POLICY afritech_read_platform_incidents
  ON public.platform_incidents FOR SELECT TO authenticated
  USING (
    COALESCE(public.is_afritech_admin(), FALSE)
    -- A school sees only what it must act on, and only its own.
    OR (
      is_school_visible
      AND school_id = public.current_school_uuid()
      AND public.get_user_role() IN ('org:owner', 'org:principal')
    )
  );

-- ---------------------------------------------------------------------------
-- 8. Grants.
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON afritech.ai_models TO authenticated;  -- policy-gated
GRANT SELECT, INSERT ON afritech.ai_prompt_templates TO authenticated;
-- Deliberately no UPDATE grant: immutability is a privilege boundary, not a convention.

GRANT SELECT ON public.platform_incidents TO authenticated;
-- No INSERT or UPDATE: an incident is raised by record_platform_incident() and its status is
-- changed by set_incident_status(), both of which attribute the act to a session.

-- === MIGRATION END ===
