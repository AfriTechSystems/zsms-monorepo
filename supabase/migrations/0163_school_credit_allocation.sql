-- ---------------------------------------------------------------------------
-- 0163 — a school buys credits in seats and assigns them to named teachers
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
--       `Official Documentation/18 AI Module/AI_OVERVIEW.md`
--       `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
--
-- ## What already existed, and what was missing
--
-- `0132` already models a **school wallet**: `ai_credit_accounts` carries either a
-- `school_id` or an `owner_user_id`, and `ai_credit_caps` puts an optional monthly
-- ceiling on what one teacher may draw from a school's.
--
-- That is a POOL with per-person limits, and a pool is specifically what this is
-- not meant to be. The distinction is not pedantic:
--
--   * **a cap LIMITS**. Teacher A capped at 60 is prevented from spending more
--     than 60. Nothing stops teacher B spending the wallet to zero first, at
--     which point A's cap is meaningless and A has nothing;
--   * **an assignment ENTITLES**. 60 credits assigned to A cannot be spent by B,
--     whatever B does.
--
-- A school paying for sixty credits a teacher is buying the second thing. So
-- assignments are added, and `ai_credit_caps` is left alone — it remains the right
-- tool for a genuinely shared wallet, which a school may still run by buying
-- credits and assigning none of them.
--
-- ## Purchase and assignment are separate, deliberately
--
-- The obvious design is to buy credits FOR a named list of teachers. It breaks the
-- first time the staff list changes, which is within a week:
--
--   * a teacher hired in week three of term has nothing, and the school must make
--     another purchase for one person;
--   * a teacher who leaves takes their unspent credits with them, and the school
--     has paid for credits nobody can ever use;
--   * "all teachers" means "all teachers as at the moment of purchase", which is
--     not what anybody choosing it believes it means.
--
-- Buying SEATS and assigning them separately makes all three ordinary: a new
-- teacher draws from unassigned seats, a leaver's assignment is revoked and the
-- remainder returns to unassigned, and "all teachers" is an action you repeat
-- rather than a snapshot you took.
--
-- ## The reserve is the unassigned remainder — not a fourth balance
--
-- Decided 2026-09-30. Strict per-teacher allocation strands credits: forty
-- teachers at sixty each, thirty of whom use five, leaves the school paying for
-- ~1,800 idle credits while ten teachers are blocked and queueing at the bursar.
--
-- So a school MAY let a teacher who has exhausted their assignment draw from what
-- is still unassigned, capped per teacher. This needs no new pot: the unassigned
-- remainder of the purchase already is one. `reserve_enabled` is FALSE by default,
-- because the whole point of assignment is that the school decides.
--
-- ## One new ledger column, not three
--
-- The plan for this migration said `funded_by`, `school_id` and `assignment_id`.
-- Reading `0132` rather than the plan: `ai_credit_ledger.account_id` already
-- points at an account that is EITHER a school wallet OR a personal one, so
-- school-versus-personal and the school id are both already derivable. Adding
-- columns that restate them would create two sources of truth that can disagree,
-- on a financial table, where the disagreement would be silent.
--
-- `assignment_id` is the only genuinely new fact. It is nullable, and on a spend
-- against a SCHOOL account its being NULL has a meaning: the credits came from the
-- reserve rather than from an assignment. That is one column carrying both facts
-- rather than a second column that could contradict it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The plans a school can buy. Configuration, never a literal in code.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afritech.school_credit_plans (
  plan_code         TEXT PRIMARY KEY,
  display_name      TEXT NOT NULL,
  -- `termly` is NOT three months. It resolves against the school's own term dates,
  -- which `academic_terms` already holds and which differ between schools.
  period_kind       TEXT NOT NULL CHECK (period_kind IN ('monthly', 'termly', 'annual')),
  credits_per_seat  INT NOT NULL CHECK (credits_per_seat > 0),
  price_per_seat    NUMERIC(12,2) NOT NULL CHECK (price_per_seat >= 0),
  currency_code     TEXT NOT NULL DEFAULT 'ZMW',
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE afritech.school_credit_plans IS
  'What a school may buy, per teacher seat. Prices are configuration editable without a '
  'deployment — PRICING.md prohibition: never hardcode a price, tier or feature inclusion.';

-- Seeded from the existing Hub plan (60 credits a month) so the numbers are at
-- least consistent with each other. They are GUESSES, like every other price in
-- `afritech`, and belong in the tracked row that says so until a pilot sets them.
INSERT INTO afritech.school_credit_plans
  (plan_code, display_name, period_kind, credits_per_seat, price_per_seat, sort_order)
VALUES
  ('school_monthly', 'Monthly',    'monthly',  60,  120.00, 1),
  ('school_termly',  'Per term',   'termly',  180,  320.00, 2),
  ('school_annual',  'Full year',  'annual',  540,  900.00, 3)
ON CONFLICT (plan_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. What a school bought.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_credit_purchases (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         UUID NOT NULL REFERENCES public.schools(id),
  -- The wallet the credits landed in. One per school (0132's unique index).
  account_id        UUID NOT NULL REFERENCES public.ai_credit_accounts(id),

  plan_code         TEXT NOT NULL
                    REFERENCES afritech.school_credit_plans(plan_code)
                    ON UPDATE CASCADE ON DELETE RESTRICT,

  -- Snapshotted at purchase. A later price change must not alter what a school
  -- was charged, the same reasoning `0126` applies to `invoices.unit_price`.
  period_kind       TEXT NOT NULL CHECK (period_kind IN ('monthly', 'termly', 'annual')),
  credits_per_seat  INT NOT NULL CHECK (credits_per_seat > 0),
  price_per_seat    NUMERIC(12,2) NOT NULL CHECK (price_per_seat >= 0),
  currency_code     TEXT NOT NULL DEFAULT 'ZMW',

  seats             INT NOT NULL CHECK (seats > 0),
  total_credits     INT NOT NULL CHECK (total_credits > 0),
  total_amount      NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),

  /*
    Real dates, not a nominal duration.

    A monthly plan runs from the purchase; a termly one from the school's own term
    dates. `0132`'s allowance is summed over the CALENDAR month, which is why a Hub
    teacher subscribing mid-month sees 55 of their first 60 credits — a tracked
    defect. School credits must not inherit it, so the period is stored rather
    than derived from a clock.
  */
  period_start      DATE NOT NULL,
  period_end        DATE NOT NULL,

  -- The `topup` row in `ai_credit_ledger` this created. The money and the credits
  -- are one chain, so a purchase can always be traced to the lot it funded.
  lot_id            UUID REFERENCES public.ai_credit_ledger(id),
  -- NULL until AfriTech raises the bill. `0162` made a second kind of invoice possible.
  invoice_id        UUID REFERENCES afritech.invoices(id),

  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT school_credit_purchases_period_shape CHECK (period_end >= period_start),
  -- The arithmetic the screen showed, pinned. A total that disagrees with its own
  -- basis is the one error nobody checks for.
  CONSTRAINT school_credit_purchases_credits_match CHECK (total_credits = seats * credits_per_seat)
);

CREATE INDEX IF NOT EXISTS idx_school_credit_purchases_school
  ON public.school_credit_purchases(school_id, period_end DESC);

-- ---------------------------------------------------------------------------
-- 3. Who got what.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_credit_assignments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id          UUID NOT NULL REFERENCES public.schools(id),
  purchase_id        UUID NOT NULL REFERENCES public.school_credit_purchases(id),

  -- The teacher. A Clerk user id rather than a staff_members FK: a teacher's
  -- entitlement must survive a staff row being edited, and the ledger already
  -- attributes spends by `actor_user_id`, so these two agree by construction.
  clerk_user_id      TEXT NOT NULL,

  credits_allocated  INT NOT NULL CHECK (credits_allocated > 0),

  -- Copied from the purchase rather than joined, so an assignment carries its own
  -- expiry. Credits EXPIRE at period end (decided 2026-09-30: rollover makes an
  -- open-ended liability out of something a school has already been invoiced for).
  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,

  assigned_by        TEXT NOT NULL,
  assigned_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at         TIMESTAMPTZ,
  revoked_by         TEXT,

  CONSTRAINT school_credit_assignments_period_shape CHECK (period_end >= period_start),
  CONSTRAINT school_credit_assignments_revoked_shape CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);

-- One LIVE assignment per teacher per purchase. Partial, so revoking and
-- reassigning — a teacher who left and returned — is possible rather than
-- blocked by a row that is no longer in force.
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_credit_assignments_one_live
  ON public.school_credit_assignments(purchase_id, clerk_user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_school_credit_assignments_teacher
  ON public.school_credit_assignments(clerk_user_id, period_end DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_school_credit_assignments_school
  ON public.school_credit_assignments(school_id, period_end DESC);

-- ---------------------------------------------------------------------------
-- 4. The reserve switch.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_credit_settings (
  school_id               UUID PRIMARY KEY REFERENCES public.schools(id),
  -- OFF by default. Assignment exists so the school decides; defaulting this on
  -- would quietly undo that for every school that never opened the screen.
  reserve_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  -- NULL means "no per-teacher limit on the reserve" — the unassigned remainder
  -- is the only ceiling. A number caps how much of it one teacher may draw.
  reserve_per_teacher_cap INT CHECK (reserve_per_teacher_cap IS NULL OR reserve_per_teacher_cap >= 0),
  updated_by              TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 5. The ledger's one new column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.ai_credit_ledger
  ADD COLUMN IF NOT EXISTS assignment_id UUID
    REFERENCES public.school_credit_assignments(id);

COMMENT ON COLUMN public.ai_credit_ledger.assignment_id IS
  'The assignment a school-funded spend drew against. NULL on a SCHOOL account means '
  'the credits came from the unassigned reserve; NULL on a personal account means '
  'nothing, since assignments are a school concept. Deliberately the only column added: '
  'school-versus-personal is already derivable from account_id, and restating it would '
  'put two sources of truth on a financial table.';

CREATE INDEX IF NOT EXISTS idx_ai_credit_ledger_assignment
  ON public.ai_credit_ledger(assignment_id)
  WHERE assignment_id IS NOT NULL;

-- Per-teacher usage reporting walks this. Without it a school's usage screen is a
-- sequential scan over every spend the school has ever made.
CREATE INDEX IF NOT EXISTS idx_ai_credit_ledger_account_actor
  ON public.ai_credit_ledger(account_id, actor_user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. RLS
--
-- All three new public tables are school-scoped, so the shape is the familiar
-- one. The teacher-facing exception is on assignments: a teacher must be able to
-- see their OWN assignment — it is their balance — without being able to see
-- what every colleague was given.
-- ---------------------------------------------------------------------------
ALTER TABLE public.school_credit_purchases   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_credit_purchases   FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.school_credit_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_credit_assignments FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.school_credit_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_credit_settings    FORCE  ROW LEVEL SECURITY;

CREATE POLICY school_read_school_credit_purchases
  ON public.school_credit_purchases FOR SELECT
  USING (school_id = public.current_school_uuid());

CREATE POLICY afritech_all_school_credit_purchases
  ON public.school_credit_purchases FOR ALL
  USING (public.is_afritech_admin())
  WITH CHECK (public.is_afritech_admin());

CREATE POLICY school_read_school_credit_assignments
  ON public.school_credit_assignments FOR SELECT
  USING (school_id = public.current_school_uuid());

-- A teacher reads their own, and only their own.
CREATE POLICY teacher_read_own_school_credit_assignments
  ON public.school_credit_assignments FOR SELECT
  USING (clerk_user_id = public.get_user_id());

CREATE POLICY afritech_all_school_credit_assignments
  ON public.school_credit_assignments FOR ALL
  USING (public.is_afritech_admin())
  WITH CHECK (public.is_afritech_admin());

CREATE POLICY school_read_school_credit_settings
  ON public.school_credit_settings FOR SELECT
  USING (school_id = public.current_school_uuid());

CREATE POLICY afritech_all_school_credit_settings
  ON public.school_credit_settings FOR ALL
  USING (public.is_afritech_admin())
  WITH CHECK (public.is_afritech_admin());

-- No INSERT, UPDATE or DELETE policy for a school on ANY of the three.
--
-- Every write goes through the SECURITY DEFINER functions in 0164, which is what
-- enforces that a purchase's credits match its price, that assignments never
-- exceed what was bought, and that the reserve cap is respected. A school with a
-- direct INSERT on `school_credit_assignments` could grant itself ten thousand
-- credits it never paid for, and nothing in the ledger would look wrong.

-- ---------------------------------------------------------------------------
-- 7. The plan catalogue, reachable from a route.
--
-- `supabase/config.toml` sets `schemas = ["public"]`, so PostgREST resolves
-- against `public` and nothing else: `afritech.school_credit_plans` is readable
-- from SQL, a migration and a pgTAP suite, and NEVER from an API route. Nothing
-- fails at build time — it is a 404 the first time somebody opens the buy screen.
--
-- Three functions drifted into `afritech` before `0139` added wrappers. This one
-- gets its wrapper in the same migration that creates the table.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.school_credit_plan_catalogue()
RETURNS TABLE (
  out_plan_code        TEXT,
  out_display_name     TEXT,
  out_period_kind      TEXT,
  out_credits_per_seat INT,
  out_price_per_seat   NUMERIC,
  out_currency_code    TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
  SELECT plan_code, display_name, period_kind, credits_per_seat, price_per_seat, currency_code
  FROM afritech.school_credit_plans
  WHERE is_active
  ORDER BY sort_order, plan_code;
$$;

REVOKE ALL ON FUNCTION public.school_credit_plan_catalogue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.school_credit_plan_catalogue() FROM anon;
GRANT EXECUTE ON FUNCTION public.school_credit_plan_catalogue() TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.school_credit_plan_catalogue()', 'EXECUTE') THEN
    RAISE EXCEPTION 'school_credit_plan_catalogue is executable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.school_credit_plan_catalogue()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute school_credit_plan_catalogue';
  END IF;
END;
$$;
