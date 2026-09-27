-- Migration: 0132_ai_credit_ledger.sql
-- Created: 2026-09-27
-- Description: Platform-wide AI credits. One wallet, one ledger, every AI feature metered
--              through it. Retires the Teacher Hub's private trial counter.
-- Related documents: Official Documentation/18 AI Module/AI_CAPTURE.md — Pricing
--                    Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--                    Official Documentation/17 Integration and Pricing/PRICING.md
--                    Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md
--
-- ===========================================================================
-- WHY THIS IS GENERAL RATHER THAN A TEACHER HUB FEATURE
--
-- `AI_CAPTURE.md` already specifies a credit system in real detail — ledger-derived
-- balances, reserve-and-release, charge-on-success, school-or-user wallets, credits as an
-- add-on rather than a tier inclusion. It specifies it for **one feature**, AI capture,
-- under the names `capture_credit_accounts` and `capture_credit_ledger`.
--
-- Meanwhile the Teacher Hub shipped with `standalone_teacher_accounts.trial_resources_used`,
-- a counter of its own. The AI assistant and Smart Analytics will each need the same thing.
-- Left alone, that is three or four implementations of one rule — "has this person paid for
-- this call, and did we charge them only when it worked" — and the first one to disagree
-- with the others does so about money.
--
-- So the tables are `ai_credit_*`, not `capture_credit_*`, and every AI feature meters
-- through them. This migration is deliberately written **before** AI capture exists, because
-- afterwards the generalisation never happens.
--
-- ---------------------------------------------------------------------------
-- THE RULE THAT SHAPED THE LEDGER: TWO PROMISES THAT LOOK INCOMPATIBLE
-- ---------------------------------------------------------------------------
-- The commercial model is an **included monthly allowance** plus **purchased credits that
-- expire after 12 months**. Those two cannot both be honoured if the allowance is deposited
-- into the wallet as credits, because an unused allowance would silently roll over and
-- "resets monthly" would be false.
--
-- So **the allowance is never deposited.** Every consumption row records `funded_from`, and
-- the two quantities are derived differently:
--
--   * **Purchased balance** — `SUM(credits)` per lot, over lots whose `expires_at` has not
--     passed. Expiry needs no scheduled job: an expired lot simply stops being counted. A
--     cron that writes write-off rows could fail silently and leave somebody holding credits
--     they should not have, so correctness comes from arithmetic instead.
--
--   * **Allowance used** — the sum of allowance-funded rows within the current period. It
--     resets because the window moves, not because anything runs.
--
-- Nothing expires by being deleted, nothing resets by being zeroed, and there is no job
-- whose failure corrupts a balance.
--
-- ---------------------------------------------------------------------------
-- LOTS, AND WHY FIFO BY EXPIRY RATHER THAN BY PURCHASE
-- ---------------------------------------------------------------------------
-- Each top-up is a **lot** with its own expiry. Consumption draws from the lot expiring
-- **soonest** first, which is the arrangement most favourable to the customer: it spends the
-- credits that were about to be lost. Drawing newest-first would let old credits expire
-- while new ones were spent, which is the same behaviour a customer would call a trick.
--
-- A single consumption can span two lots. That is a loop, and it writes one row per lot
-- touched, so the trail answers "which purchase did this credit come from".
--
-- ---------------------------------------------------------------------------
-- PRICED IN ACTIONS, COSTED IN TOKENS
-- ---------------------------------------------------------------------------
-- `ai_credit_prices` is credits **per action** — one lesson plan, one quiz, one photographed
-- mark sheet. Teachers do not think in tokens, and pricing in tokens would weld the price
-- list to one provider's rate card, making a model swap a pricing change.
--
-- The cost side is recorded per row: `model_name`, `input_tokens`, `output_tokens`,
-- `cost_usd`. So margin per feature per school is a **measured** number, and a provider
-- price rise is visible before it eats it. `AI_CAPTURE.md` says margin must be monitored;
-- these four columns are what makes that possible rather than aspirational.
--
-- ---------------------------------------------------------------------------
-- THE LEDGER IS APPEND-ONLY, FOR THE SAME REASON `audit_logs` IS
-- ---------------------------------------------------------------------------
-- This is a financial record. UPDATE and DELETE are refused by trigger for **every** caller,
-- including `service_role` — which bypasses RLS, so a policy alone would not stop a worker.
-- A correction is a new `adjustment` row, never an edit. Same lesson as `0131`.
-- ===========================================================================

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- 1. AI features exist in the catalogue, priced in credits rather than per month.
-- ---------------------------------------------------------------------------
/**
 * `category` is a hardcoded CHECK with no 'ai' value. This is the third time a CHECK has had
 * to be widened to admit a value the product needed — the ADR-040 pattern noted in
 * CLAUDE.md. Widened rather than converted to a reference table, because that conversion is
 * its own migration and this one is already large; recorded here so the pattern stays
 * visible.
 */
ALTER TABLE afritech.feature_flags DROP CONSTRAINT IF EXISTS feature_flags_category_check;
ALTER TABLE afritech.feature_flags ADD CONSTRAINT feature_flags_category_check
  CHECK (category = ANY (ARRAY[
    'core', 'academic', 'financial', 'communication', 'integration',
    'api', 'document', 'analytics', 'enterprise', 'ai'
  ]));

/**
 * `is_available_as_addon = FALSE` for every one of these, and that is not a limitation.
 *
 * The existing CHECK requires an add-on to carry `monthly_addon_price_zmw`, and a flat
 * monthly price is exactly what a metered feature must not have: `AI_CAPTURE.md` warns that
 * bundling a metered cost into a flat price transfers all volume risk to AfriTech. These are
 * bought in credits, and the credit price lives in `ai_credit_prices`.
 */
INSERT INTO afritech.feature_flags
  (feature_key, display_name, description, category, is_available_as_addon, is_active,
   display_order, updated_by)
VALUES
  ('ai_lesson_planner', 'AI lesson planner',
   'Generates a lesson plan. Metered per plan in AI credits.', 'ai', FALSE, TRUE, 90,
   'system:migration-0132'),
  ('ai_quiz_generator', 'AI quiz generator',
   'Generates a quiz with a marking guide. Metered per quiz.', 'ai', FALSE, TRUE, 91,
   'system:migration-0132'),
  ('ai_homework_creator', 'AI homework creator',
   'Generates homework sized to a duration. Metered per piece.', 'ai', FALSE, TRUE, 92,
   'system:migration-0132'),
  ('ai_capture', 'AI-assisted capture',
   'Extracts data from a photographed mark sheet, register or receipt. Metered per capture.',
   'ai', FALSE, TRUE, 93, 'system:migration-0132'),
  ('ai_assistant', 'AI assistant',
   'Answers questions about the school''s own data, RLS-enforced. Metered per exchange.',
   'ai', FALSE, TRUE, 94, 'system:migration-0132')
ON CONFLICT (feature_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Prices. Credits per action, and packs to buy them with.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afritech.ai_credit_prices (
  feature_key        TEXT PRIMARY KEY
                     REFERENCES afritech.feature_flags(feature_key)
                     ON UPDATE CASCADE ON DELETE RESTRICT,
  credits_per_action INT NOT NULL CHECK (credits_per_action >= 0),
  -- A note the admin panel shows, so whoever changes a price knows what it meters.
  unit_description   TEXT NOT NULL,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE afritech.ai_credit_prices IS
  'Credits per action, per AI feature. Priced in ACTIONS, never tokens: teachers do not '
  'think in tokens and token pricing would weld the price list to one provider''s rate card.';

/**
 * A spreadsheet import costs zero, which is deliberate and comes straight from
 * `AI_CAPTURE.md`: a CSV parse consumes no vision call, and charging a vision-priced credit
 * for a cost not incurred would be charging for nothing. Stated as a row rather than a code
 * branch.
 *
 * These are starting values, editable by a super admin without a deployment. A photographed
 * mark sheet costs 2 because it is a vision call over a large image and its retry rate is
 * unknown until measured against real Zambian paper.
 */
INSERT INTO afritech.ai_credit_prices (feature_key, credits_per_action, unit_description)
VALUES
  ('ai_lesson_planner',   1, 'one lesson plan'),
  ('ai_quiz_generator',   1, 'one quiz'),
  ('ai_homework_creator', 1, 'one homework sheet'),
  ('ai_capture',          2, 'one photographed page'),
  ('ai_assistant',        1, 'one question and answer')
ON CONFLICT (feature_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS afritech.ai_credit_packs (
  pack_code       TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  credits         INT NOT NULL CHECK (credits > 0),
  price           NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  currency_code   TEXT NOT NULL DEFAULT 'ZMW',
  -- 12 months, per the decision recorded on 2026-09-27. Per-pack rather than a constant, so
  -- a promotional pack can carry a different validity without a code change.
  validity_months INT NOT NULL DEFAULT 12 CHECK (validity_months > 0),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO afritech.ai_credit_packs
  (pack_code, display_name, credits, price, currency_code, sort_order)
VALUES
  ('starter_50',  '50 credits',  50,  150.00, 'ZMW', 1),
  ('school_250', '250 credits', 250,  600.00, 'ZMW', 2),
  ('school_1000','1,000 credits', 1000, 2000.00, 'ZMW', 3)
ON CONFLICT (pack_code) DO NOTHING;

-- Included monthly allowance per school tier. A tier absent from here includes nothing.
CREATE TABLE IF NOT EXISTS afritech.tier_ai_allowances (
  tier_name       TEXT PRIMARY KEY
                  REFERENCES afritech.subscription_tiers(tier_name)
                  ON UPDATE CASCADE ON DELETE CASCADE,
  monthly_credits INT NOT NULL CHECK (monthly_credits >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE afritech.tier_ai_allowances IS
  'Included AI credits per month, per school tier. An included allowance exists so the '
  'feature gets USED — a school that must buy credits before trying it mostly never tries.';

/**
 * The Teacher Hub plans need the same thing, and this is where a real commercial problem
 * surfaces that the Hub shipped with.
 *
 * `teacher_hub_plans.included_resources` is NULL for the monthly and annual plans, meaning
 * **unlimited**. That was harmless while the generator was a deterministic template costing
 * nothing. With a model behind it, "unlimited for K300 a month" is an uncapped liability —
 * one enthusiastic teacher generating hundreds of plans costs more than they pay, and it is
 * precisely the flat-price-over-metered-cost trap `AI_CAPTURE.md` warns about.
 *
 * So a Hub plan now carries an AI allowance with a period. The trial keeps its LIFETIME
 * five, which is what makes "five free resources, ever" still exactly true.
 */
ALTER TABLE afritech.teacher_hub_plans
  ADD COLUMN IF NOT EXISTS ai_credits_included INT CHECK (ai_credits_included >= 0),
  ADD COLUMN IF NOT EXISTS ai_credits_period TEXT NOT NULL DEFAULT 'monthly'
    CHECK (ai_credits_period IN ('lifetime', 'monthly'));

UPDATE afritech.teacher_hub_plans SET ai_credits_included = 5,  ai_credits_period = 'lifetime'
 WHERE plan_code = 'trial'   AND ai_credits_included IS NULL;
UPDATE afritech.teacher_hub_plans SET ai_credits_included = 60, ai_credits_period = 'monthly'
 WHERE plan_code IN ('monthly', 'annual') AND ai_credits_included IS NULL;

COMMENT ON COLUMN afritech.teacher_hub_plans.ai_credits_included IS
  'Included AI credits. With ai_credits_period = lifetime this is a once-ever allowance (the '
  'trial''s five); with monthly it resets each calendar month. Replaces the unlimited '
  'generation the paid plans used to imply, which was safe only while no model was wired.';

-- ---------------------------------------------------------------------------
-- 3. Wallets.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_credit_accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id      UUID REFERENCES public.schools(id),
  owner_user_id  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Exactly one owner. A wallet belonging to both a school and a person has no answerable
  -- question about whose credits they are.
  CONSTRAINT ai_credit_accounts_one_owner CHECK (
    (school_id IS NOT NULL AND owner_user_id IS NULL)
    OR (school_id IS NULL AND owner_user_id IS NOT NULL)
  )
);

-- One wallet each, enforced rather than assumed: two wallets for one school would split a
-- balance in a way no screen would reveal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_credit_accounts_school
  ON public.ai_credit_accounts(school_id) WHERE school_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_credit_accounts_owner
  ON public.ai_credit_accounts(owner_user_id) WHERE owner_user_id IS NOT NULL;

/**
 * Optional per-teacher ceiling on a school wallet.
 *
 * Without it, any teacher can spend the term's budget in a week. With it, the school decides
 * how much of a shared wallet one person may draw. Absent row means no personal ceiling —
 * the wallet's balance is the only limit.
 */
CREATE TABLE IF NOT EXISTS public.ai_credit_caps (
  account_id          UUID NOT NULL REFERENCES public.ai_credit_accounts(id) ON DELETE CASCADE,
  clerk_user_id       TEXT NOT NULL,
  monthly_credit_cap  INT NOT NULL CHECK (monthly_credit_cap >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, clerk_user_id)
);

-- ---------------------------------------------------------------------------
-- 4. The ledger.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_credit_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES public.ai_credit_accounts(id),
  /**
   * `reserve` and `release` are admitted now though nothing writes them yet. AI capture needs
   * them — a queued offline capture reserves on queue and settles on successful extraction —
   * and admitting the values here means that arrives as functions rather than as a migration
   * altering a financial table that already holds live rows.
   */
  reason          TEXT NOT NULL CHECK (reason IN (
                    'topup', 'consume', 'reserve', 'release', 'expiry_writeoff', 'adjustment'
                  )),
  -- SIGNED. Positive adds, negative spends. A balance is a SUM, never a subtraction chain.
  credits         INT NOT NULL,
  -- NULL on a top-up, which funds nothing. 'allowance' rows never touch a lot.
  funded_from     TEXT CHECK (funded_from IN ('allowance', 'purchased')),
  /**
   * The top-up row this spends against — self-referential, so a lot and the movements on it
   * live in one table. NULL for allowance-funded rows and for the top-up itself.
   */
  lot_id          UUID REFERENCES public.ai_credit_ledger(id),
  -- Set on top-up rows only. An expired lot stops counting; nothing deletes it.
  expires_at      TIMESTAMPTZ,
  feature_key     TEXT REFERENCES afritech.feature_flags(feature_key) ON UPDATE CASCADE,
  -- Who spent it. On a shared school wallet this is the only way to answer "who used it all".
  actor_user_id   TEXT NOT NULL,
  -- For a future reserve/settle pair.
  reservation_id  UUID,
  -- The cost side. What makes margin measurable rather than hoped for.
  model_name      TEXT,
  input_tokens    INT CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens   INT CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cost_usd        NUMERIC(12,6) CHECK (cost_usd IS NULL OR cost_usd >= 0),
  idempotency_key TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A top-up must expire; a spend must say what funded it. Each half of the model is
  -- enforced rather than left to the functions to remember.
  CONSTRAINT ai_credit_ledger_topup_shape CHECK (
    (reason = 'topup' AND credits > 0 AND expires_at IS NOT NULL AND funded_from IS NULL)
    OR reason <> 'topup'
  ),
  CONSTRAINT ai_credit_ledger_spend_shape CHECK (
    (reason IN ('consume', 'reserve') AND credits < 0 AND funded_from IS NOT NULL)
    OR reason NOT IN ('consume', 'reserve')
  ),
  -- A purchased spend names its lot; an allowance spend must not.
  CONSTRAINT ai_credit_ledger_lot_shape CHECK (
    (funded_from = 'purchased' AND lot_id IS NOT NULL)
    OR (funded_from = 'allowance' AND lot_id IS NULL)
    OR funded_from IS NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_ai_credit_ledger_account
  ON public.ai_credit_ledger(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_credit_ledger_lot
  ON public.ai_credit_ledger(lot_id) WHERE lot_id IS NOT NULL;
-- Open lots, which is the hot path: every consumption scans them.
CREATE INDEX IF NOT EXISTS idx_ai_credit_ledger_lots
  ON public.ai_credit_ledger(account_id, expires_at) WHERE reason = 'topup';
CREATE INDEX IF NOT EXISTS idx_ai_credit_ledger_allowance
  ON public.ai_credit_ledger(account_id, created_at)
  WHERE funded_from = 'allowance';
-- A retried job must not charge twice.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_credit_ledger_idempotency
  ON public.ai_credit_ledger(account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE public.ai_credit_ledger IS
  'Append-only AI credit movements. Balance is DERIVED from this table and never stored, the '
  'same reasoning as ADR-038''s derived arrears: a cached balance must be kept in step with '
  'every top-up, spend and refund, and the first bug makes someone''s credits wrong in a way '
  'nobody can reconstruct.';

-- ---------------------------------------------------------------------------
-- 5. Append-only, against everybody.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refuse_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- No role check, exactly as in 0131: there is no caller for whom editing a financial
  -- ledger is legitimate. A correction is an `adjustment` row.
  RAISE EXCEPTION
    '%.% is append-only. % is never permitted; record a correcting entry instead.',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER refuse_mutation_on_ai_credit_ledger
  BEFORE UPDATE OR DELETE ON public.ai_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.refuse_append_only_mutation();

CREATE TRIGGER refuse_truncate_on_ai_credit_ledger
  BEFORE TRUNCATE ON public.ai_credit_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION public.refuse_append_only_mutation();

CREATE TRIGGER set_updated_at_on_ai_credit_accounts
  BEFORE UPDATE ON public.ai_credit_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_on_ai_credit_caps
  BEFORE UPDATE ON public.ai_credit_caps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Resolving the wallet and its allowance.
-- ---------------------------------------------------------------------------
/**
 * The caller's wallet, created on first use.
 *
 * A session holding a school organisation draws on the SCHOOL wallet — the school holds the
 * budget, which `AI_CAPTURE.md` calls the expected path. A session with no organisation is a
 * standalone Hub teacher and draws on their own.
 */
CREATE OR REPLACE FUNCTION public.ai_credit_account_for_caller()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
  v_user   TEXT := public.get_user_id();
  v_id     UUID;
BEGIN
  IF v_school IS NULL AND v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;

  IF v_school IS NOT NULL THEN
    SELECT id INTO v_id FROM public.ai_credit_accounts WHERE school_id = v_school;
    IF v_id IS NULL THEN
      INSERT INTO public.ai_credit_accounts (school_id) VALUES (v_school)
      -- Two simultaneous first uses would both find nothing and both insert. The unique
      -- index makes the loser a no-op rather than an error the teacher sees.
      ON CONFLICT (school_id) WHERE school_id IS NOT NULL DO NOTHING
      RETURNING id INTO v_id;
      IF v_id IS NULL THEN
        SELECT id INTO v_id FROM public.ai_credit_accounts WHERE school_id = v_school;
      END IF;
    END IF;
  ELSE
    SELECT id INTO v_id FROM public.ai_credit_accounts WHERE owner_user_id = v_user;
    IF v_id IS NULL THEN
      INSERT INTO public.ai_credit_accounts (owner_user_id) VALUES (v_user)
      ON CONFLICT (owner_user_id) WHERE owner_user_id IS NOT NULL DO NOTHING
      RETURNING id INTO v_id;
      IF v_id IS NULL THEN
        SELECT id INTO v_id FROM public.ai_credit_accounts WHERE owner_user_id = v_user;
      END IF;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ai_credit_account_for_caller() TO authenticated;

/**
 * What this wallet includes, and over what period.
 *
 * A school wallet reads its tier's monthly allowance. A personal wallet reads the teacher's
 * Hub plan, which may be a lifetime allowance — that is how the trial's five-ever survives
 * intact inside a system whose other allowances reset monthly.
 */
CREATE OR REPLACE FUNCTION public.ai_allowance_for_account(p_account_id UUID)
RETURNS TABLE (allowance_credits INT, allowance_period TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  a public.ai_credit_accounts;
BEGIN
  SELECT * INTO a FROM public.ai_credit_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 'monthly'::TEXT;
    RETURN;
  END IF;

  IF a.school_id IS NOT NULL THEN
    RETURN QUERY
    SELECT COALESCE(al.monthly_credits, 0), 'monthly'::TEXT
      FROM public.schools s
      LEFT JOIN afritech.tier_ai_allowances al ON al.tier_name = s.subscription_tier
     WHERE s.id = a.school_id;
  ELSE
    RETURN QUERY
    SELECT COALESCE(p.ai_credits_included, 0), p.ai_credits_period
      FROM public.standalone_teacher_accounts t
      JOIN afritech.teacher_hub_plans p ON p.plan_code = t.plan_code
     WHERE t.clerk_user_id = a.owner_user_id;
  END IF;

  -- A personal wallet with no Hub account at all: no allowance rather than an error, so a
  -- balance query on a half-set-up account renders instead of failing.
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 'monthly'::TEXT;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ai_allowance_for_account(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. The balance, derived.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_credit_balance(p_account_id UUID)
RETURNS TABLE (
  allowance_credits   INT,
  allowance_period    TEXT,
  allowance_used      INT,
  allowance_remaining  INT,
  purchased_available  INT,
  purchased_expiring_90d INT,
  purchased_expired    INT,
  total_available     INT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_allow  INT;
  v_period TEXT;
  v_used   INT;
BEGIN
  SELECT al.allowance_credits, al.allowance_period
    INTO v_allow, v_period
    FROM public.ai_allowance_for_account(p_account_id) al;

  /**
   * The window is the whole of time for a lifetime allowance and the current calendar month
   * for a monthly one. Allowance spending is NEGATIVE in the ledger, so it is negated here;
   * a `release` row is positive and therefore nets off correctly without a special case.
   */
  SELECT COALESCE(-SUM(l.credits), 0) INTO v_used
    FROM public.ai_credit_ledger l
   WHERE l.account_id = p_account_id
     AND l.funded_from = 'allowance'
     AND (v_period = 'lifetime'
          OR date_trunc('month', l.created_at) = date_trunc('month', NOW()));

  RETURN QUERY
  WITH lots AS (
    SELECT t.id, t.expires_at,
           -- Every movement on this lot, including the top-up itself.
           (SELECT COALESCE(SUM(m.credits), 0)
              FROM public.ai_credit_ledger m
             WHERE m.id = t.id OR m.lot_id = t.id) AS remaining
      FROM public.ai_credit_ledger t
     WHERE t.account_id = p_account_id AND t.reason = 'topup'
  )
  SELECT
    v_allow,
    v_period,
    v_used,
    GREATEST(v_allow - v_used, 0),
    -- Expiry needs no job: an expired lot simply stops being counted here.
    (SELECT COALESCE(SUM(remaining), 0)::INT FROM lots WHERE expires_at > NOW()),
    -- What the school should be told to spend before it is lost.
    (SELECT COALESCE(SUM(remaining), 0)::INT FROM lots
      WHERE expires_at > NOW() AND expires_at <= NOW() + INTERVAL '90 days'),
    (SELECT COALESCE(SUM(remaining), 0)::INT FROM lots WHERE expires_at <= NOW()),
    GREATEST(v_allow - v_used, 0)
      + (SELECT COALESCE(SUM(remaining), 0)::INT FROM lots WHERE expires_at > NOW());
END;
$$;

GRANT EXECUTE ON FUNCTION public.ai_credit_balance(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_ai_credits()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_account UUID := public.ai_credit_account_for_caller();
  v_user    TEXT := public.get_user_id();
  v_cap     INT;
  v_capused INT;
BEGIN
  SELECT monthly_credit_cap INTO v_cap
    FROM public.ai_credit_caps
   WHERE account_id = v_account AND clerk_user_id = v_user;

  SELECT COALESCE(-SUM(credits), 0) INTO v_capused
    FROM public.ai_credit_ledger
   WHERE account_id = v_account AND actor_user_id = v_user
     AND reason IN ('consume', 'reserve')
     AND date_trunc('month', created_at) = date_trunc('month', NOW());

  RETURN jsonb_build_object(
    'account_id', v_account,
    'balance', (SELECT to_jsonb(b) FROM public.ai_credit_balance(v_account) b),
    -- The caller's own ceiling, if their school set one. NULL means the wallet is the limit.
    'my_monthly_cap', v_cap,
    'my_spend_this_month', v_capused,
    'prices', (SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb)
                 FROM afritech.ai_credit_prices p WHERE p.is_active),
    'packs', (SELECT COALESCE(jsonb_agg(to_jsonb(k) ORDER BY k.sort_order), '[]'::jsonb)
                FROM afritech.ai_credit_packs k WHERE k.is_active)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.my_ai_credits() TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Spending. Allowance first, then lots by soonest expiry.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_credit_consume(
  p_feature_key     TEXT,
  p_units           INT     DEFAULT 1,
  p_model_name      TEXT    DEFAULT NULL,
  p_input_tokens    INT     DEFAULT NULL,
  p_output_tokens   INT     DEFAULT NULL,
  p_cost_usd        NUMERIC DEFAULT NULL,
  p_idempotency_key TEXT    DEFAULT NULL,
  p_metadata        JSONB   DEFAULT '{}'::jsonb
)
RETURNS TABLE (credits_charged INT, funded_allowance INT, funded_purchased INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_account   UUID := public.ai_credit_account_for_caller();
  v_user      TEXT := public.get_user_id();
  v_price     INT;
  v_required  INT;
  v_allowance INT;
  v_from_allow INT := 0;
  v_from_purch INT := 0;
  v_cap       INT;
  v_cap_used  INT;
  v_remaining INT;
  v_take      INT;
  b           RECORD;
  lot         RECORD;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;

  /**
   * Idempotency first, before anything is charged. A retried job — a worker redelivery, a
   * double-submitted form — must return the original charge rather than make a second one.
   */
  IF p_idempotency_key IS NOT NULL THEN
    SELECT COALESCE(-SUM(credits), 0)::INT INTO v_required
      FROM public.ai_credit_ledger
     WHERE account_id = v_account AND idempotency_key = p_idempotency_key;
    IF v_required > 0 THEN
      RETURN QUERY
      SELECT v_required,
             COALESCE((SELECT -SUM(credits)::INT FROM public.ai_credit_ledger
                        WHERE account_id = v_account AND idempotency_key = p_idempotency_key
                          AND funded_from = 'allowance'), 0),
             COALESCE((SELECT -SUM(credits)::INT FROM public.ai_credit_ledger
                        WHERE account_id = v_account AND idempotency_key = p_idempotency_key
                          AND funded_from = 'purchased'), 0);
      RETURN;
    END IF;
  END IF;

  SELECT credits_per_action INTO v_price
    FROM afritech.ai_credit_prices
   WHERE feature_key = p_feature_key AND is_active;

  IF v_price IS NULL THEN
    RAISE EXCEPTION 'No active credit price for %.', p_feature_key USING ERRCODE = 'P0002';
  END IF;

  v_required := v_price * GREATEST(p_units, 1);

  -- A free action still succeeds and still writes nothing. A spreadsheet import costs
  -- nothing because it consumes no vision call, and it must not be blocked by an empty
  -- wallet for a cost it does not incur.
  IF v_required = 0 THEN
    RETURN QUERY SELECT 0, 0, 0;
    RETURN;
  END IF;

  /**
   * Lock the WALLET, not the ledger. Two teachers at one school generating simultaneously
   * must not both read the same balance and both pass — the second waits and sees the first
   * one's spend.
   */
  PERFORM 1 FROM public.ai_credit_accounts WHERE id = v_account FOR UPDATE;

  SELECT * INTO b FROM public.ai_credit_balance(v_account);

  -- The school's ceiling on this individual, checked before the wallet's own balance: a
  -- teacher over their cap is refused even when the school has plenty.
  SELECT monthly_credit_cap INTO v_cap
    FROM public.ai_credit_caps
   WHERE account_id = v_account AND clerk_user_id = v_user;

  IF v_cap IS NOT NULL THEN
    SELECT COALESCE(-SUM(credits), 0) INTO v_cap_used
      FROM public.ai_credit_ledger
     WHERE account_id = v_account AND actor_user_id = v_user
       AND reason IN ('consume', 'reserve')
       AND date_trunc('month', created_at) = date_trunc('month', NOW());

    IF v_cap_used + v_required > v_cap THEN
      RAISE EXCEPTION
        'Your monthly AI limit of % credits is reached (used %). Ask your school to raise it.',
        v_cap, v_cap_used
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF b.total_available < v_required THEN
    -- The shortfall is stated. "Insufficient credits" without a number leaves somebody
    -- guessing how much to buy.
    RAISE EXCEPTION
      'Not enough AI credits: % needed, % available. Top up to continue.',
      v_required, b.total_available
      USING ERRCODE = '42501';
  END IF;

  -- Allowance first, because it is free and resets. Spending purchased credits while an
  -- allowance sat unused would cost the customer money for nothing.
  v_from_allow := LEAST(b.allowance_remaining, v_required);

  IF v_from_allow > 0 THEN
    INSERT INTO public.ai_credit_ledger
      (account_id, reason, credits, funded_from, feature_key, actor_user_id,
       model_name, input_tokens, output_tokens, cost_usd, idempotency_key, metadata)
    VALUES
      (v_account, 'consume', -v_from_allow, 'allowance', p_feature_key, v_user,
       p_model_name, p_input_tokens, p_output_tokens, p_cost_usd, p_idempotency_key,
       p_metadata);
  END IF;

  v_remaining := v_required - v_from_allow;

  /**
   * Then purchased lots, SOONEST EXPIRY FIRST. This spends the credits that were about to be
   * lost, which is the arrangement most favourable to the customer; newest-first would let
   * old credits expire while new ones were spent.
   *
   * One consumption can span two lots, so this loops and writes a row per lot touched — the
   * trail can then answer which purchase a credit came from.
   */
  FOR lot IN
    SELECT t.id,
           (SELECT COALESCE(SUM(m.credits), 0)
              FROM public.ai_credit_ledger m
             WHERE m.id = t.id OR m.lot_id = t.id) AS remaining
      FROM public.ai_credit_ledger t
     WHERE t.account_id = v_account AND t.reason = 'topup' AND t.expires_at > NOW()
     ORDER BY t.expires_at ASC, t.created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    CONTINUE WHEN lot.remaining <= 0;

    v_take := LEAST(lot.remaining, v_remaining);

    INSERT INTO public.ai_credit_ledger
      (account_id, reason, credits, funded_from, lot_id, feature_key, actor_user_id,
       model_name, input_tokens, output_tokens, cost_usd,
       -- The key is on the allowance row when there is one; a unique index cannot hold it
       -- twice for one account.
       idempotency_key, metadata)
    VALUES
      (v_account, 'consume', -v_take, 'purchased', lot.id, p_feature_key, v_user,
       p_model_name, p_input_tokens, p_output_tokens, p_cost_usd,
       CASE WHEN v_from_allow = 0 AND v_remaining = v_required THEN p_idempotency_key END,
       p_metadata);

    v_from_purch := v_from_purch + v_take;
    v_remaining  := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0 THEN
    -- Unreachable: the balance was checked above under the same lock. Raised rather than
    -- ignored, because reaching it would mean the balance function and the lot walk disagree,
    -- and silently under-charging is the worst possible response to that.
    RAISE EXCEPTION 'Credit allocation failed to settle % credits.', v_remaining
      USING ERRCODE = 'XX000';
  END IF;

  RETURN QUERY SELECT v_required, v_from_allow, v_from_purch;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ai_credit_consume(
  TEXT, INT, TEXT, INT, INT, NUMERIC, TEXT, JSONB
) TO authenticated;

COMMENT ON FUNCTION public.ai_credit_consume(TEXT, INT, TEXT, INT, INT, NUMERIC, TEXT, JSONB) IS
  'Charges for one AI action. Allowance first, then purchased lots by soonest expiry. Locks '
  'the wallet so simultaneous callers cannot both spend the last credit. Idempotent when '
  'given a key. Raises 42501 with the shortfall stated when the wallet is short.';

-- ---------------------------------------------------------------------------
-- 9. Topping up — AfriTech only, because payment is recorded by hand.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ai_credit_topup(
  p_account_id UUID,
  p_pack_code  TEXT    DEFAULT NULL,
  p_credits    INT     DEFAULT NULL,
  p_reference  TEXT    DEFAULT NULL,
  p_metadata   JSONB   DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
DECLARE
  v_credits  INT;
  v_months   INT;
  v_id       UUID;
BEGIN
  /**
   * The same control as `teacher_hub_activate_subscription()` and `verify_payment()`: there
   * is no gateway yet, so somebody confirms the mobile money or bank transfer arrived. If a
   * school could call this, credits would be free to anyone who found the endpoint.
   */
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech records a credit purchase.' USING ERRCODE = '42501';
  END IF;

  IF p_pack_code IS NOT NULL THEN
    SELECT credits, validity_months INTO v_credits, v_months
      FROM afritech.ai_credit_packs WHERE pack_code = p_pack_code AND is_active;
    IF v_credits IS NULL THEN
      RAISE EXCEPTION 'No active credit pack %.', p_pack_code USING ERRCODE = 'P0002';
    END IF;
  ELSIF p_credits IS NOT NULL AND p_credits > 0 THEN
    -- A goodwill grant or a correction, outside the pack list. Still expires, so it cannot
    -- become a permanent obligation.
    v_credits := p_credits;
    v_months  := 12;
  ELSE
    RAISE EXCEPTION 'Supply a pack code or a positive credit amount.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ai_credit_ledger
    (account_id, reason, credits, expires_at, actor_user_id, metadata)
  VALUES
    (p_account_id, 'topup', v_credits, NOW() + make_interval(months => v_months),
     COALESCE(public.get_actor_id(), public.get_user_id(), 'system:afritech'),
     p_metadata || jsonb_build_object('pack_code', p_pack_code, 'reference', p_reference))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ai_credit_topup(UUID, TEXT, INT, TEXT, JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ai_credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_credit_accounts FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.ai_credit_ledger   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_credit_ledger   FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.ai_credit_caps     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_credit_caps     FORCE  ROW LEVEL SECURITY;
ALTER TABLE afritech.ai_credit_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.ai_credit_prices FORCE  ROW LEVEL SECURITY;
ALTER TABLE afritech.ai_credit_packs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.ai_credit_packs  FORCE  ROW LEVEL SECURITY;
ALTER TABLE afritech.tier_ai_allowances ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.tier_ai_allowances FORCE  ROW LEVEL SECURITY;

-- Prices and packs are a price list somebody is about to be asked to choose from.
CREATE POLICY authenticated_read_ai_credit_prices
  ON afritech.ai_credit_prices FOR SELECT TO authenticated
  USING (is_active OR COALESCE(public.is_afritech_admin(), FALSE));
CREATE POLICY afritech_write_ai_credit_prices
  ON afritech.ai_credit_prices FOR ALL TO authenticated
  USING (COALESCE(public.is_afritech_admin(), FALSE))
  WITH CHECK (COALESCE(public.is_afritech_admin(), FALSE));

CREATE POLICY authenticated_read_ai_credit_packs
  ON afritech.ai_credit_packs FOR SELECT TO authenticated
  USING (is_active OR COALESCE(public.is_afritech_admin(), FALSE));
CREATE POLICY afritech_write_ai_credit_packs
  ON afritech.ai_credit_packs FOR ALL TO authenticated
  USING (COALESCE(public.is_afritech_admin(), FALSE))
  WITH CHECK (COALESCE(public.is_afritech_admin(), FALSE));

CREATE POLICY authenticated_read_tier_ai_allowances
  ON afritech.tier_ai_allowances FOR SELECT TO authenticated
  USING (TRUE);
CREATE POLICY afritech_write_tier_ai_allowances
  ON afritech.tier_ai_allowances FOR ALL TO authenticated
  USING (COALESCE(public.is_afritech_admin(), FALSE))
  WITH CHECK (COALESCE(public.is_afritech_admin(), FALSE));

-- Own wallet only. No INSERT policy: a wallet appears through
-- ai_credit_account_for_caller(), so nobody can create one for somebody else.
CREATE POLICY own_read_ai_credit_accounts
  ON public.ai_credit_accounts FOR SELECT TO authenticated
  USING (
    school_id = public.current_school_uuid()
    OR owner_user_id = public.get_user_id()
    OR COALESCE(public.is_afritech_admin(), FALSE)
  );

/**
 * The ledger is readable by the wallet's owner, and for a SCHOOL wallet only by leadership
 * and the accountant — it shows who spent what, which is budget information rather than
 * everyone's business. A teacher sees their own balance through `my_ai_credits()`, which
 * returns totals rather than the school's line-by-line spending.
 */
CREATE POLICY own_read_ai_credit_ledger
  ON public.ai_credit_ledger FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_credit_accounts a
      WHERE a.id = ai_credit_ledger.account_id
        AND (
          (a.school_id = public.current_school_uuid()
           AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:accountant'))
          OR a.owner_user_id = public.get_user_id()
        )
    )
    OR COALESCE(public.is_afritech_admin(), FALSE)
  );

-- Caps are set by school leadership, and a teacher may read their own.
CREATE POLICY read_ai_credit_caps
  ON public.ai_credit_caps FOR SELECT TO authenticated
  USING (
    clerk_user_id = public.get_user_id()
    OR EXISTS (
      SELECT 1 FROM public.ai_credit_accounts a
      WHERE a.id = ai_credit_caps.account_id
        AND a.school_id = public.current_school_uuid()
        AND public.get_user_role() IN ('org:owner', 'org:principal')
    )
    OR COALESCE(public.is_afritech_admin(), FALSE)
  );

CREATE POLICY leadership_write_ai_credit_caps
  ON public.ai_credit_caps FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.ai_credit_accounts a
      WHERE a.id = ai_credit_caps.account_id
        AND a.school_id = public.current_school_uuid()
        AND public.get_user_role() IN ('org:owner', 'org:principal')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.ai_credit_accounts a
      WHERE a.id = ai_credit_caps.account_id
        AND a.school_id = public.current_school_uuid()
        AND public.get_user_role() IN ('org:owner', 'org:principal')
    )
  );

-- ---------------------------------------------------------------------------
-- 11. Grants. Read-only everywhere; every movement goes through a function.
-- ---------------------------------------------------------------------------
GRANT SELECT ON afritech.ai_credit_prices, afritech.ai_credit_packs,
               afritech.tier_ai_allowances TO authenticated;
GRANT INSERT, UPDATE ON afritech.ai_credit_prices, afritech.ai_credit_packs,
                        afritech.tier_ai_allowances TO authenticated;  -- policy-gated

GRANT SELECT ON public.ai_credit_accounts TO authenticated;
-- No INSERT/UPDATE/DELETE on the ledger for anybody. It is append-only through functions,
-- and the trigger refuses mutation even to service_role.
GRANT SELECT ON public.ai_credit_ledger TO authenticated;
-- Caps are ordinary configuration a school edits, so they are policy-gated table writes
-- rather than a function. No DELETE: removing a cap is setting it high, and the repository
-- grants DELETE nowhere in `public`.
GRANT SELECT, INSERT, UPDATE ON public.ai_credit_caps TO authenticated;

-- ---------------------------------------------------------------------------
-- 12. Retire the Teacher Hub's private meter.
-- ---------------------------------------------------------------------------
/**
 * The Hub shipped with `trial_resources_used`, a counter of its own. Two meters implementing
 * "has this person used their free allocation" will eventually disagree, and the disagreement
 * will be about whether somebody has to pay.
 *
 * So the existing counts are backfilled into the ledger as allowance-funded consumption, and
 * the column becomes history. A lifetime allowance sums over all time, so these rows land in
 * the window and every existing trial position is preserved exactly.
 */
-- Wallets first. Every existing Hub account gets one, so the backfill below has somewhere to
-- land and so a later balance query never has to create a wallet in the middle of a read.
INSERT INTO public.ai_credit_accounts (owner_user_id)
SELECT t.clerk_user_id FROM public.standalone_teacher_accounts t
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_credit_accounts a WHERE a.owner_user_id = t.clerk_user_id
)
ON CONFLICT DO NOTHING;

-- Then the counts, as allowance-funded consumption. `WHERE NOT EXISTS` on the marker actor
-- makes it idempotent, so a re-run cannot double-charge a trial.
INSERT INTO public.ai_credit_ledger
  (account_id, reason, credits, funded_from, feature_key, actor_user_id, metadata, created_at)
SELECT
  a.id, 'consume', -t.trial_resources_used, 'allowance', 'ai_lesson_planner',
  'system:migration-0132',
  jsonb_build_object(
    'backfill', 'trial_resources_used retired into the ledger by 0132',
    'original_count', t.trial_resources_used
  ),
  t.created_at
FROM public.standalone_teacher_accounts t
JOIN public.ai_credit_accounts a ON a.owner_user_id = t.clerk_user_id
WHERE t.trial_resources_used > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.ai_credit_ledger l
    WHERE l.account_id = a.id AND l.actor_user_id = 'system:migration-0132'
  );

COMMENT ON COLUMN public.standalone_teacher_accounts.trial_resources_used IS
  'DEPRECATED by 0132 and no longer written. The AI credit ledger is the single meter; these '
  'counts were backfilled into it as allowance-funded consumption. Retained because it is '
  'the only record of what the Hub counted before the ledger existed.';

-- === MIGRATION END ===
