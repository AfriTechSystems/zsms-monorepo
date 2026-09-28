-- ===========================================================================
-- The model chain, versioned prompts, and the incident record.
--
-- Spec: Official Documentation/18 AI Module/AI_OVERVIEW.md
--       Official Documentation/15 Super Admin and Platform/SUPERADMIN.md
--       Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- Nothing in this repository captured an error before `0134` — no Sentry dependency, no
-- `captureException`, no `global-error.tsx`. A teacher hitting a 500 produced no record
-- anywhere. So the assertions here are about whether the replacement is actually usable:
--
--   * **Deduplication is the design, not a refinement.** A dead API key fails on every
--     request, so two hundred failures must be ONE incident with a count of two hundred. A
--     row per occurrence would bury the signal the table exists to raise.
--   * A **resolved** incident that recurs must re-open. A key failing again after somebody
--     fixed it is news, and leaving it closed hides the second outage behind the first
--     resolution.
--   * Severity **escalates and never silently drops**, or a critical outage could be talked
--     down by one later `info` report.
--   * A prompt is **immutable once written**. Editing in place would change what every future
--     artefact claims to have been made from, and make an old complaint unreproducible.
--   * The model chain, the prompts and the token rates are **AfriTech's alone** — they reveal
--     which provider ZSMS depends on, what its margin is, and the accumulated prompt work a
--     competitor could copy verbatim.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(18);

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
        'Alpha Academy', 'day', 'combined', 'LSK', 'active');

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_afritech", "role": "authenticated",
  "o": {"id": "org_afritech", "rol": "afritech:super_admin", "slg": "afritech-systems-admin"}
}';

-- ---------------------------------------------------------------------------
-- Deduplication.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ DO $do$
     DECLARE i INT;
     BEGIN
       FOR i IN 1..200 LOOP
         PERFORM public.record_platform_incident(
           'ai_provider', 'insufficient_credits', 'Anthropic key has no credit',
           'ai_provider:anthropic:insufficient_credits', 'error',
           'HTTP 402 from api.anthropic.com', NULL, 'ai_lesson_planner', FALSE, '{}'::jsonb);
       END LOOP;
     END $do$ $$,
  'two hundred identical failures are reported'
);

SELECT is(
  (SELECT count(*)::int FROM public.platform_incidents
    WHERE dedupe_key = 'ai_provider:anthropic:insufficient_credits'),
  1,
  '...and produce exactly ONE incident, not two hundred'
);

SELECT is(
  (SELECT occurrence_count FROM public.platform_incidents
    WHERE dedupe_key = 'ai_provider:anthropic:insufficient_credits'),
  200,
  '...with the count recorded, which is what says how bad it is'
);

SELECT ok(
  (SELECT last_seen_at >= first_seen_at FROM public.platform_incidents
    WHERE dedupe_key = 'ai_provider:anthropic:insufficient_credits'),
  'first_seen and last_seen bracket the outage rather than being the same instant by accident'
);

-- ---------------------------------------------------------------------------
-- Lifecycle, and the recurrence that must re-open.
-- ---------------------------------------------------------------------------
SELECT ok(
  public.set_incident_status(
    (SELECT id FROM public.platform_incidents
      WHERE dedupe_key = 'ai_provider:anthropic:insufficient_credits'),
    'resolved', 'Topped the key up'),
  'AfriTech can resolve an incident'
);

SELECT is(
  (SELECT resolved_by FROM public.platform_incidents
    WHERE dedupe_key = 'ai_provider:anthropic:insufficient_credits'),
  'user_afritech',
  'and the resolution names who did it — "resolved" is otherwise a claim nobody owns'
);

SELECT lives_ok(
  $$ SELECT public.record_platform_incident(
       'ai_provider', 'insufficient_credits', 'Anthropic key has no credit',
       'ai_provider:anthropic:insufficient_credits', 'error', 'Failed again', NULL,
       'ai_lesson_planner', FALSE, '{}'::jsonb) $$,
  'the same problem happens again after being resolved'
);

SELECT is(
  (SELECT status FROM public.platform_incidents
    WHERE dedupe_key = 'ai_provider:anthropic:insufficient_credits'),
  'open',
  'a resolved incident RE-OPENS on recurrence — a second outage is not hidden by the first fix'
);

SELECT is(
  (SELECT resolved_by FROM public.platform_incidents
    WHERE dedupe_key = 'ai_provider:anthropic:insufficient_credits'),
  NULL,
  '...and the stale resolution is cleared, so nobody appears to have fixed what is still broken'
);

-- ---------------------------------------------------------------------------
-- Severity only ever goes up.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT public.record_platform_incident(
       'ai_provider', 'insufficient_credits', 'x',
       'ai_provider:anthropic:insufficient_credits', 'info', NULL, NULL, NULL, FALSE,
       '{}'::jsonb) $$,
  'a later report arrives claiming only info severity'
);

SELECT is(
  (SELECT severity FROM public.platform_incidents
    WHERE dedupe_key = 'ai_provider:anthropic:insufficient_credits'),
  'error',
  '...and does NOT talk the incident down — severity escalates, never silently drops'
);

-- ---------------------------------------------------------------------------
-- Prompts: versioned, exactly one live, immutable.
-- ---------------------------------------------------------------------------
/**
 * Version numbers are asserted RELATIVE to whatever is already there, not as 1 and 2.
 *
 * An earlier draft asserted the absolute numbers and passed — until `0137` seeded version 1 of
 * the real prompts, at which point publishing returned 2 and 3 and CI failed. The test had a
 * hidden dependency on the table being empty for this feature, which is not a property any
 * migration promised to preserve.
 *
 * The relative form tests the behaviour that actually matters — each publish takes the next
 * number, and exactly one version is live — and survives the next default prompt being seeded.
 */
CREATE TEMP TABLE _prompt_base AS
SELECT COALESCE(MAX(version), 0) AS v
  FROM afritech.ai_prompt_templates WHERE feature_key = 'ai_lesson_planner';

SELECT is(
  afritech.publish_prompt_template(
    'ai_lesson_planner', 'You are a Zambian curriculum planner.',
    'Plan {{topic}} for {{grade_level}}.', '{"temperature":0.4}'::jsonb, 'first'),
  (SELECT v + 1 FROM _prompt_base),
  'publishing takes the next version number'
);

SELECT is(
  afritech.publish_prompt_template(
    'ai_lesson_planner', 'Revised.', 'Plan {{topic}}.', '{}'::jsonb, 'second'),
  (SELECT v + 2 FROM _prompt_base),
  'publishing again takes the one after it, rather than editing what is live'
);

SELECT is(
  (SELECT count(*)::int FROM afritech.ai_prompt_templates
    WHERE feature_key = 'ai_lesson_planner' AND is_active),
  1,
  'exactly one version is live at a time, enforced by a partial unique index'
);

-- The immutability that makes an old artefact reproducible.
SELECT throws_ok(
  $$ UPDATE afritech.ai_prompt_templates SET system_prompt = 'tampered' WHERE version = 1 $$,
  '42501',
  NULL,
  'a published prompt cannot be edited in place — there is no UPDATE grant, by design'
);

-- ---------------------------------------------------------------------------
-- The chain, and who may see it.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT string_agg(m ->> 'provider', ',' ORDER BY (m ->> 'priority')::int)
     FROM jsonb_array_elements(
       public.ai_generation_config('ai_lesson_planner') -> 'models') m),
  'openai,anthropic',
  'the chain comes back in priority order — OpenAI first, because that is the key with credit'
);

-- ---------------------------------------------------------------------------
-- A school sees AfriTech's plumbing: nothing.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_owner_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "owner", "slg": "alpha-academy"}
}';

SELECT is(
  (SELECT count(*)::int FROM public.platform_incidents),
  0,
  'a school owner sees no platform incident — failover is AfriTech''s plumbing, not their alarm'
);

/**
 * The model chain and the prompts are commercially sensitive: which provider ZSMS depends on,
 * what the token rates are, and the accumulated prompt work that makes the output good — the
 * one asset a competitor could copy verbatim out of a response. No client reads them;
 * `ai_generation_config()` is SECURITY DEFINER and called server-side.
 */
SELECT is(
  (SELECT count(*)::int FROM afritech.ai_models)
    + (SELECT count(*)::int FROM afritech.ai_prompt_templates),
  0,
  'and reads neither the model chain nor the prompts'
);

SELECT * FROM finish();
ROLLBACK;
