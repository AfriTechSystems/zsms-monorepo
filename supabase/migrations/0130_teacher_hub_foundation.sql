-- Migration: 0130_teacher_hub_foundation.sql
-- Created: 2026-09-27
-- Description: The Teacher Hub — the standalone `platform:teacher` product. Accounts,
--              generated teaching resources, plan configuration, entitlement metering.
-- Related documents: Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md
--                    Official Documentation/02 Authentication and Identity/ROLES.md
--                    Official Documentation/01 Foundation Layer/DATABASE.md
--                    Official Documentation/18 AI Module/LESSON_PLANNER.md
--
-- ===========================================================================
-- THIS IS THE FIRST OWNER-SCOPED TABLE SET IN THE SCHEMA
--
-- Every one of the 32 `public` tables built so far is SCHOOL-scoped: it carries
-- `school_id`, and its policies filter through `current_school_uuid()`, which reads the
-- Clerk organisation claim. 75 of the 150 policies depend on that one function.
--
-- A standalone teacher has **no organisation**. `current_school_uuid()` returns NULL for
-- them, so every existing policy denies — which is the correct default and is why no
-- school data can leak into this product by construction. But it also means none of the
-- established tenancy machinery applies here. These tables filter on
-- **`public.get_user_id()`** — the Clerk user id from the `sub` claim — and the unit of
-- isolation is a PERSON, not a school.
--
-- That difference is the whole design, and it has one consequence worth stating in
-- capitals because it is the opposite of every other table here:
--
--   A SCHOOL MUST NOT BE ABLE TO READ ITS OWN TEACHER'S RESOURCES.
--
-- `TEACHER_PORTAL.md` business rule 2: plans belong to the teacher, not the school, and
-- a teacher who leaves a school retains them. So `school_id` on `teaching_resources` is
-- **provenance only** — it records where a resource was made and is deliberately NOT an
-- access path. A principal reading their teachers' personal lesson plans would be a
-- defect, and the pgTAP suite asserts they read zero.
--
-- ---------------------------------------------------------------------------
-- FOUR DEVIATIONS FROM THE DOCUMENTED DDL, EACH DELIBERATE
-- ---------------------------------------------------------------------------
--
-- `DATABASE.md` specifies `public.lesson_plans` and `public.standalone_teacher_accounts`,
-- planned as migrations `0058` and `0060`. **Both numbers are in the void range
-- `0022`–`0068`** — they sort below the applied high-water mark and `db push` would skip
-- them — so this migration supersedes both.
--
-- 1. **`teaching_resources`, not `lesson_plans`.** The documented Hub has three
--    generators — lesson planner, quiz generator, homework creator — and the doc defines
--    a table for only the first. All three take the same inputs (subject, grade, topic,
--    curriculum) and produce the same shape (a JSONB document plus its sources). Three
--    near-identical tables would triple the policy surface for no behavioural
--    difference; one table named `lesson_plans` holding quizzes would be a name that
--    lies. One table with `resource_kind`. DATABASE.md and SCHEMA.md are updated.
--
-- 2. **No `linked_school_id`.** The documented column is a single UUID, but the same
--    document's business rule 4 says a teacher may be linked to SEVERAL schools. One
--    column cannot hold two schools, so the column and the rule contradict each other.
--    `my_schools()` (migration `0117`) already answers "which schools is this user in",
--    is self-scoped on `get_user_id()`, and supports any number. A `linked_school_id`
--    would be a second source of truth that can disagree with Clerk — so it is omitted
--    rather than faked, the same choice `0124` made about the module-subscription step.
--
-- 3. **Trial allowance and prices are rows, not literals.** The doc hardcodes
--    `trial_plans_limit INT DEFAULT 5` and K300/K3,000 in prose. Prohibition: never
--    hardcode a price or a limit. `afritech.teacher_hub_plans` holds all three, trial
--    included — the trial IS a plan, priced zero with a lifetime resource cap — and the
--    ceiling resolves **account override → plan allowance**, exactly as
--    `school_student_limit()` resolves its own. NULL means unlimited, as it does there.
--
-- 4. **Counters are not writable by their owner.** `trial_resources_used` is the meter
--    that decides whether this teacher gets a free product. A plain `GRANT UPDATE` on
--    their own row lets them set it back to 0 and take the trial forever. The grants
--    here are **column-level** — the teacher may write their name, phone, subjects and
--    grades, and holds no privilege at all on `subscription_status`, `plan_code`, or
--    either counter. Same for INSERT: self-registration cannot supply a status.
--
-- ---------------------------------------------------------------------------
-- WHY THE RESOURCE RECORDS WHAT GENERATED IT
-- ---------------------------------------------------------------------------
-- `generator_name` and `generator_version` are NOT NULL. There is no LLM and no
-- curriculum knowledge base on this project yet, so the first generator is a
-- deterministic template. When Claude-over-RAG replaces it, every resource created
-- before the swap must still be identifiable as machine-templated rather than
-- AI-generated — otherwise the library silently mixes two very different things and
-- nothing can tell them apart afterwards.
--
-- This is ADR-041 again, in a third place: a derived artefact must carry the basis it
-- was derived from. A grade carries its scale version, an invoice freezes its unit
-- price, and a lesson plan records its generator.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. Plan configuration. Prices and the trial cap as data.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afritech.teacher_hub_plans (
  plan_code           TEXT PRIMARY KEY,
  display_name        TEXT NOT NULL,
  -- 'none' for the trial: it has a resource cap rather than a renewal period.
  billing_period      TEXT NOT NULL CHECK (billing_period IN ('none', 'monthly', 'annual')),
  price               NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  currency_code       TEXT NOT NULL DEFAULT 'ZMW',
  -- NULL = unlimited, the same convention `school_student_limit()` uses. A number is a
  -- LIFETIME cap, not a monthly one — see business rule 6.
  included_resources  INT CHECK (included_resources >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order          INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE afritech.teacher_hub_plans IS
  'Teacher Hub plans, including the free trial. Prices and the trial allowance are rows '
  'because a price is never hardcoded. included_resources NULL = unlimited.';

COMMENT ON COLUMN afritech.teacher_hub_plans.included_resources IS
  'Lifetime resource cap, NOT per period. TEACHER_PORTAL.md business rule 6: a teacher '
  'gets exactly 5 free resources, ever — the counter is never reset.';

INSERT INTO afritech.teacher_hub_plans
  (plan_code, display_name, billing_period, price, currency_code, included_resources, sort_order)
VALUES
  ('trial',   'Free trial',      'none',      0.00, 'ZMW',    5, 0),
  ('monthly', 'Monthly',         'monthly',  300.00, 'ZMW', NULL, 1),
  ('annual',  'Annual',          'annual',  3000.00, 'ZMW', NULL, 2)
ON CONFLICT (plan_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The account.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.standalone_teacher_accounts (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The unit of isolation. Every policy on this table compares it to get_user_id().
  clerk_user_id             TEXT NOT NULL UNIQUE,
  full_name                 TEXT NOT NULL,
  email                     TEXT NOT NULL,
  phone_e164                TEXT,
  country_code              TEXT NOT NULL DEFAULT 'ZM',
  -- The profile step in TEACHER_PORTAL.md asks for curricula, subjects AND grades; the
  -- documented DDL omitted grades. Added — the planner uses it to prefill.
  curriculum_types          TEXT[] NOT NULL DEFAULT '{ecz}',
  subjects                  TEXT[] NOT NULL DEFAULT '{}',
  grade_levels              TEXT[] NOT NULL DEFAULT '{}',
  -- Tiers are data (0125): a foreign key, never a CHECK listing plan names.
  plan_code                 TEXT NOT NULL DEFAULT 'trial'
                            REFERENCES afritech.teacher_hub_plans(plan_code)
                            ON UPDATE CASCADE ON DELETE RESTRICT,
  subscription_status       TEXT NOT NULL DEFAULT 'trial'
                            CHECK (subscription_status IN ('trial', 'active', 'cancelled', 'suspended')),
  -- Per-account override of the plan's allowance — a promotion, a goodwill top-up.
  -- NULL means "use the plan". Resolution: override → plan.
  trial_allowance_override  INT CHECK (trial_allowance_override >= 0),
  -- MONOTONIC. Never decremented, never reset, not writable by the account holder.
  trial_resources_used      INT NOT NULL DEFAULT 0 CHECK (trial_resources_used >= 0),
  resources_created         INT NOT NULL DEFAULT 0 CHECK (resources_created >= 0),
  subscription_started_at   TIMESTAMPTZ,
  -- Read access outlives this date; generation does not (business rule 5).
  subscription_ends_at      TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_standalone_teacher_accounts_clerk
  ON public.standalone_teacher_accounts(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_standalone_teacher_accounts_status
  ON public.standalone_teacher_accounts(subscription_status)
  WHERE subscription_status = 'active';

COMMENT ON TABLE public.standalone_teacher_accounts IS
  'Teacher Hub accounts. OWNER-scoped on get_user_id(), not school-scoped — a '
  'standalone teacher has no organisation and current_school_uuid() is NULL for them.';

COMMENT ON COLUMN public.standalone_teacher_accounts.trial_resources_used IS
  'Monotonic lifetime counter. Only create_teaching_resource() writes it; authenticated '
  'holds no UPDATE privilege on this column, because a teacher who could reset it would '
  'have an unlimited free product.';

-- ---------------------------------------------------------------------------
-- 3. The generated resources.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teaching_resources (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Clerk user id of the owner. This is the ONLY access path to the row.
  created_by         TEXT NOT NULL,
  resource_kind      TEXT NOT NULL CHECK (resource_kind IN ('lesson_plan', 'quiz', 'homework')),
  -- PROVENANCE ONLY, and deliberately not an access path. See the header.
  school_id          UUID REFERENCES public.schools(id),
  title              TEXT NOT NULL,
  subject            TEXT NOT NULL,
  grade_level        TEXT NOT NULL,
  topic              TEXT NOT NULL,
  curriculum_type    TEXT NOT NULL,
  duration_minutes   INT CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  lesson_type        TEXT CHECK (lesson_type IS NULL OR lesson_type IN
                       ('introduction', 'core', 'revision', 'assessment_prep')),
  -- The generated document.
  content            JSONB NOT NULL,
  -- What was asked for — question count, difficulty, the teacher's context note. Kept so
  -- a regeneration can be compared against the request that produced the first one.
  generation_params  JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Which knowledge chunks were retrieved. NULL until a knowledge base exists.
  knowledge_sources  JSONB,
  -- ADR-041, third application: the artefact carries its basis.
  generator_name     TEXT NOT NULL,
  generator_version  TEXT NOT NULL,
  is_shared          BOOLEAN NOT NULL DEFAULT FALSE,
  teacher_notes      TEXT,
  -- Soft delete. There is no DELETE grant on this table — see section 5 — so removing a
  -- resource from the library is a flag, exactly as it is for a pupil or a fee record.
  is_deleted         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teaching_resources_created_by
  ON public.teaching_resources(created_by, created_at DESC)
  WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_teaching_resources_kind
  ON public.teaching_resources(created_by, resource_kind)
  WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_teaching_resources_school
  ON public.teaching_resources(school_id)
  WHERE school_id IS NOT NULL;

COMMENT ON COLUMN public.teaching_resources.school_id IS
  'Provenance only — where the resource was created. NOT an access path: a school '
  'cannot read its teachers'' resources. TEACHER_PORTAL.md business rule 2.';

COMMENT ON COLUMN public.teaching_resources.generator_name IS
  'Which generator produced this. The first one is a deterministic template because no '
  'LLM or knowledge base exists yet; recorded so that resources made before the Claude '
  'swap stay distinguishable from those made after it.';

CREATE TRIGGER set_updated_at_on_standalone_teacher_accounts
  BEFORE UPDATE ON public.standalone_teacher_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_on_teaching_resources
  BEFORE UPDATE ON public.teaching_resources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_on_teacher_hub_plans
  BEFORE UPDATE ON afritech.teacher_hub_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. RLS. Enabled AND forced on all three — prohibition 4.
-- ---------------------------------------------------------------------------
ALTER TABLE afritech.teacher_hub_plans            ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.teacher_hub_plans            FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.standalone_teacher_accounts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standalone_teacher_accounts    FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.teaching_resources             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teaching_resources             FORCE  ROW LEVEL SECURITY;

-- A price list a signed-in visitor is about to be asked to choose from. Readable by any
-- authenticated session; only AfriTech writes it.
CREATE POLICY authenticated_read_teacher_hub_plans
  ON afritech.teacher_hub_plans FOR SELECT TO authenticated
  USING (is_active = TRUE OR COALESCE(public.is_afritech_admin(), FALSE));

CREATE POLICY afritech_write_teacher_hub_plans
  ON afritech.teacher_hub_plans FOR ALL TO authenticated
  USING (COALESCE(public.is_afritech_admin(), FALSE))
  WITH CHECK (COALESCE(public.is_afritech_admin(), FALSE));

-- The account. Own row, or AfriTech for support and billing.
CREATE POLICY teacher_read_own_account
  ON public.standalone_teacher_accounts FOR SELECT TO authenticated
  USING (
    clerk_user_id = public.get_user_id()
    OR COALESCE(public.is_afritech_admin(), FALSE)
  );

-- Self-registration. The WITH CHECK pins the row to the caller; the column-level grant
-- in section 5 is what stops them supplying a subscription status.
CREATE POLICY teacher_create_own_account
  ON public.standalone_teacher_accounts FOR INSERT TO authenticated
  WITH CHECK (clerk_user_id = public.get_user_id());

-- USING and WITH CHECK both, so a row cannot be updated INTO somebody else's ownership.
CREATE POLICY teacher_update_own_account
  ON public.standalone_teacher_accounts FOR UPDATE TO authenticated
  USING (clerk_user_id = public.get_user_id())
  WITH CHECK (clerk_user_id = public.get_user_id());

CREATE POLICY afritech_manage_teacher_accounts
  ON public.standalone_teacher_accounts FOR UPDATE TO authenticated
  USING (COALESCE(public.is_afritech_admin(), FALSE))
  WITH CHECK (COALESCE(public.is_afritech_admin(), FALSE));

/**
 * The resources. Owner only — no school clause, no role clause, no exceptions.
 *
 * Note what is NOT here: a policy admitting `is_shared = TRUE` rows to other teachers.
 * The Community Library is Phase 3, and a broad SELECT policy would expose `created_by`
 * — the sharer's Clerk user id — when the documented design says a shared plan shows a
 * first name and a subject and never an identity. When that feature is built it gets a
 * SECURITY DEFINER function returning the non-identifying columns, not a widened policy.
 */
CREATE POLICY teacher_read_own_resources
  ON public.teaching_resources FOR SELECT TO authenticated
  USING (created_by = public.get_user_id());

CREATE POLICY teacher_write_own_resources
  ON public.teaching_resources FOR INSERT TO authenticated
  WITH CHECK (created_by = public.get_user_id());

CREATE POLICY teacher_update_own_resources
  ON public.teaching_resources FOR UPDATE TO authenticated
  USING (created_by = public.get_user_id())
  WITH CHECK (created_by = public.get_user_id());

-- ---------------------------------------------------------------------------
-- 5. Grants. COLUMN-LEVEL, which is the whole defence of the meter.
-- ---------------------------------------------------------------------------
GRANT SELECT ON afritech.teacher_hub_plans TO authenticated;
GRANT INSERT, UPDATE ON afritech.teacher_hub_plans TO authenticated;  -- policy-gated to AfriTech

GRANT SELECT ON public.standalone_teacher_accounts TO authenticated;

/**
 * Self-registration may supply identity and profile. It may NOT supply `plan_code`,
 * `subscription_status`, `trial_allowance_override`, or either counter — those are absent
 * from this list, so an INSERT naming them is refused before RLS is even consulted, and
 * the row takes its defaults: the trial plan, zero used.
 *
 * `id`, `created_at` and `updated_at` are omitted too; their defaults are correct and
 * letting a client choose a primary key serves nothing.
 */
GRANT INSERT (clerk_user_id, full_name, email, phone_e164, country_code,
              curriculum_types, subjects, grade_levels)
  ON public.standalone_teacher_accounts TO authenticated;

-- Profile edits, and nothing else. Deliberately excludes every commercial column.
GRANT UPDATE (full_name, phone_e164, country_code, curriculum_types, subjects, grade_levels)
  ON public.standalone_teacher_accounts TO authenticated;

/**
 * Resources: no `created_by` in the UPDATE list, so ownership cannot be reassigned even
 * though the policy would also refuse it — and no `content`, `generator_name` or
 * `generator_version` either. A generated document is not editable in place; the
 * teacher annotates it with `teacher_notes`, renames it, shares it, or removes it.
 * Editing `content` while `generator_name` still claims a generator produced it would
 * make the provenance a lie.
 *
 * And no DELETE, on any of the three. `tenant_isolation_test` asserts that no end-user
 * role holds DELETE anywhere in `public` and `communications_test` asserts it for
 * `afritech` configuration — the invariant `0129` had to restore twice. Removal is
 * `is_deleted`.
 */
GRANT SELECT, INSERT ON public.teaching_resources TO authenticated;
GRANT UPDATE (title, teacher_notes, is_shared, is_deleted)
  ON public.teaching_resources TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Entitlement. Returns a REASON, never a silent no.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_hub_entitlement(p_clerk_user_id TEXT DEFAULT NULL)
RETURNS TABLE (
  may_generate        BOOLEAN,
  reason              TEXT,
  plan_code           TEXT,
  subscription_status TEXT,
  allowance           INT,
  used                INT,
  remaining           INT,
  subscription_ends_at TIMESTAMPTZ
)
LANGUAGE plpgsql
-- DEFINER so the resolution reads the plan row regardless of the caller's privileges on
-- `afritech`, and so `create_teaching_resource()` can share exactly this logic rather
-- than restating it. The subject is pinned to the caller below.
SECURITY DEFINER
STABLE
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_user TEXT;
  a      public.standalone_teacher_accounts;
  v_allow INT;
BEGIN
  /**
   * AfriTech may ask about any teacher, for support. Anybody else asking about anybody
   * else gets their own answer instead of somebody else's — the argument is a
   * convenience for the admin panel, not a lookup key that widens access.
   */
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

  SELECT * INTO a FROM public.standalone_teacher_accounts
   WHERE clerk_user_id = v_user;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'no_account', NULL::TEXT, NULL::TEXT,
                        NULL::INT, NULL::INT, NULL::INT, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Override → plan. The same order, and the same NULL-means-unlimited convention, as
  -- school_student_limit().
  SELECT COALESCE(a.trial_allowance_override, p.included_resources)
    INTO v_allow
    FROM afritech.teacher_hub_plans p
   WHERE p.plan_code = a.plan_code;

  RETURN QUERY
  SELECT
    CASE
      WHEN a.subscription_status = 'suspended' THEN FALSE
      -- A paid subscription that has run past its date is lapsed whatever the status
      -- column still says. Billing is recorded by hand, so the row can easily be stale;
      -- the date decides, not the label.
      WHEN a.subscription_status IN ('active', 'cancelled')
        THEN a.subscription_ends_at IS NOT NULL AND a.subscription_ends_at > NOW()
      -- Trial. NULL allowance would mean unlimited, which no trial plan sets.
      WHEN v_allow IS NULL THEN TRUE
      ELSE a.trial_resources_used < v_allow
    END,
    CASE
      WHEN a.subscription_status = 'suspended' THEN 'account_suspended'
      WHEN a.subscription_status IN ('active', 'cancelled')
           AND (a.subscription_ends_at IS NULL OR a.subscription_ends_at <= NOW())
        THEN CASE WHEN a.subscription_status = 'cancelled'
                  THEN 'subscription_cancelled' ELSE 'subscription_lapsed' END
      WHEN v_allow IS NOT NULL AND a.trial_resources_used >= v_allow
        THEN 'trial_exhausted'
      ELSE NULL
    END,
    a.plan_code,
    a.subscription_status,
    v_allow,
    a.trial_resources_used,
    -- Remaining is meaningless without a cap, so it is NULL rather than a large number
    -- somebody would render as a countdown.
    CASE WHEN v_allow IS NULL THEN NULL
         ELSE GREATEST(v_allow - a.trial_resources_used, 0) END,
    a.subscription_ends_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.teacher_hub_entitlement(TEXT) TO authenticated;

COMMENT ON FUNCTION public.teacher_hub_entitlement(TEXT) IS
  'Whether this teacher may generate, and if not, why. Returns a named reason rather '
  'than a bare false, so a screen can say something true about what to do next.';

-- ---------------------------------------------------------------------------
-- 7. Creating a resource. The check and the increment, in one lock.
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
  p_school_id         UUID    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
-- DEFINER because it must write `trial_resources_used`, on which `authenticated` holds
-- no privilege by design. This function IS the meter.
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_user  TEXT := public.get_user_id();
  a       public.standalone_teacher_accounts;
  v_allow INT;
  v_id    UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;

  /**
   * FOR UPDATE, and the entitlement re-resolved INSIDE the lock.
   *
   * Calling teacher_hub_entitlement() and then inserting would be two statements with a
   * gap between them: two generations submitted together both read four-of-five used,
   * both pass, and the teacher gets six free resources. The row lock closes the gap, so
   * the second waits and then sees five.
   *
   * This is why the check is restated here instead of delegating — the delegated version
   * cannot hold the lock across the insert.
   */
  SELECT * INTO a FROM public.standalone_teacher_accounts
   WHERE clerk_user_id = v_user
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No Teacher Hub account for this user.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(a.trial_allowance_override, p.included_resources)
    INTO v_allow
    FROM afritech.teacher_hub_plans p
   WHERE p.plan_code = a.plan_code;

  IF a.subscription_status = 'suspended' THEN
    RAISE EXCEPTION 'This account is suspended.' USING ERRCODE = '42501';
  END IF;

  IF a.subscription_status IN ('active', 'cancelled') THEN
    IF a.subscription_ends_at IS NULL OR a.subscription_ends_at <= NOW() THEN
      RAISE EXCEPTION 'The subscription has ended. Saved resources stay readable.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF v_allow IS NOT NULL AND a.trial_resources_used >= v_allow THEN
    RAISE EXCEPTION 'The free trial of % resources is used up.', v_allow
      USING ERRCODE = '42501';
  END IF;

  /**
   * `p_school_id` is accepted only if the caller is actually in that school. Provenance
   * that anybody can assert is worse than no provenance: a plan stamped with a school
   * the teacher never taught at would be a false record.
   *
   * `my_schools()` filters on `get_user_id()` in its own body rather than relying on
   * RLS, which is what makes it safe to call from inside a SECURITY DEFINER function —
   * a function that leaned on policies would return every school once the caller became
   * the owner here, and this guard would pass for anybody.
   */
  IF p_school_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.my_schools() m WHERE m.out_school_uuid = p_school_id
     ) THEN
    RAISE EXCEPTION 'Not a member of that school.' USING ERRCODE = '42501';
  END IF;

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

  UPDATE public.standalone_teacher_accounts
     SET resources_created = resources_created + 1,
         -- Only the trial consumes allowance. A subscriber's counter is frozen where the
         -- trial left it, so cancelling does not hand back free resources — business
         -- rule 6, five free ones EVER.
         trial_resources_used = trial_resources_used
           + CASE WHEN subscription_status = 'trial' THEN 1 ELSE 0 END
   WHERE clerk_user_id = v_user;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_teaching_resource(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, INT, TEXT, JSONB, JSONB, UUID
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Subscription state. Activation is AfriTech's, cancellation is the teacher's.
-- ---------------------------------------------------------------------------
/**
 * Payment is recorded by hand — the same decision taken for school billing, for the same
 * reason: mobile money and a bank account exist, an integrated gateway does not yet.
 *
 * So activation cannot be a teacher-facing action. If a teacher could call this they
 * would simply grant themselves a paid subscription, and the product would be free to
 * anyone who found the endpoint. AfriTech records a payment it has actually received.
 */
CREATE OR REPLACE FUNCTION public.teacher_hub_activate_subscription(
  p_clerk_user_id TEXT,
  p_plan_code     TEXT,
  p_paid_until    TIMESTAMPTZ DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_period TEXT;
  v_until  TIMESTAMPTZ;
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech records a Teacher Hub payment.' USING ERRCODE = '42501';
  END IF;

  SELECT billing_period INTO v_period
    FROM afritech.teacher_hub_plans WHERE plan_code = p_plan_code AND is_active;

  IF v_period IS NULL THEN
    RAISE EXCEPTION 'No active plan %.', p_plan_code USING ERRCODE = 'P0002';
  END IF;

  IF v_period = 'none' THEN
    RAISE EXCEPTION 'The trial is not a subscription.' USING ERRCODE = '22023';
  END IF;

  -- An explicit date wins, because a payment may cover an odd period. Otherwise the
  -- plan's own period, measured from now.
  v_until := COALESCE(
    p_paid_until,
    NOW() + CASE v_period WHEN 'monthly' THEN INTERVAL '1 month'
                          WHEN 'annual'  THEN INTERVAL '1 year' END
  );

  UPDATE public.standalone_teacher_accounts
     SET plan_code = p_plan_code,
         subscription_status = 'active',
         subscription_started_at = COALESCE(subscription_started_at, NOW()),
         subscription_ends_at = v_until
         -- trial_resources_used is untouched, deliberately. See business rule 6.
   WHERE clerk_user_id = p_clerk_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No Teacher Hub account for %.', p_clerk_user_id USING ERRCODE = 'P0002';
  END IF;

  RETURN v_until;
END;
$$;

GRANT EXECUTE ON FUNCTION public.teacher_hub_activate_subscription(TEXT, TEXT, TIMESTAMPTZ)
  TO authenticated;

/**
 * Cancelling is the teacher's own, and is NOT immediate: the documented behaviour is
 * "new generation stops at the end of the billing period". So the status changes and
 * `subscription_ends_at` is left exactly where it was — the entitlement function already
 * treats 'cancelled' with a future date as still entitled.
 */
CREATE OR REPLACE FUNCTION public.teacher_hub_cancel_subscription()
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user  TEXT := public.get_user_id();
  v_until TIMESTAMPTZ;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.standalone_teacher_accounts
     SET subscription_status = 'cancelled'
   WHERE clerk_user_id = v_user
     AND subscription_status = 'active'
  RETURNING subscription_ends_at INTO v_until;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active subscription to cancel.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_until;
END;
$$;

GRANT EXECUTE ON FUNCTION public.teacher_hub_cancel_subscription() TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. The account with its entitlement, in one round trip.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_teacher_hub()
RETURNS TABLE (
  account     JSONB,
  entitlement JSONB,
  plans       JSONB
)
LANGUAGE sql
-- INVOKER: the account row comes back through the caller's own policy, so this cannot
-- return somebody else's even by mistake.
SECURITY INVOKER
STABLE
SET search_path = public, afritech, pg_temp
AS $$
  SELECT
    (SELECT to_jsonb(a) - 'id'
       FROM public.standalone_teacher_accounts a
      WHERE a.clerk_user_id = public.get_user_id()),
    (SELECT to_jsonb(e) FROM public.teacher_hub_entitlement() e),
    (SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.sort_order), '[]'::jsonb)
       FROM afritech.teacher_hub_plans p
      WHERE p.is_active);
$$;

-- SECURITY INVOKER over a table in `afritech` means the caller needs SELECT on it in
-- their own right — the two-gate rule, which `0122` and `0128` both had to learn. The
-- grant is in section 5.
GRANT EXECUTE ON FUNCTION public.my_teacher_hub() TO authenticated;

COMMENT ON FUNCTION public.my_teacher_hub() IS
  'The signed-in teacher''s account, entitlement and the plan catalogue in one call — '
  'what the Hub shell needs on every page.';

-- === MIGRATION END ===
