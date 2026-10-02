-- ---------------------------------------------------------------------------
-- 0186 — every billing action was unreachable
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
--       `Official Documentation/15 Super Admin and Platform/SUPERADMIN.md`
--
-- ## The bug
--
-- Found by the gap audit on 2026-10-02. `/api/admin/billing` calls five
-- functions through `rpc()`:
--
--     run_billing · generate_school_invoice · issue_invoice
--     record_invoice_payment · void_invoice
--
-- **All five exist only in `afritech`.** `supabase/config.toml` sets
-- `schemas = ["public"]`, so PostgREST resolves an unqualified `rpc()` against
-- `public` and nothing else. Every one returned 404.
--
-- Proved rather than inferred, against the live project:
--
--     run_billing              404  UNREACHABLE
--     issue_invoice            404  UNREACHABLE
--     void_invoice             404  UNREACHABLE
--     generate_school_invoice  404  UNREACHABLE
--     record_invoice_payment   404  UNREACHABLE
--     school_class_readiness   401  reachable    <- control: exists, denied
--
-- A 401 means the function exists and the caller lacks permission. A 404 means
-- PostgREST cannot see it at all. The control is what makes the difference
-- readable.
--
-- So **no invoice has ever been issued, no billing run has ever started, and no
-- invoice payment has ever been recorded** through the product. `CLAUDE.md` says
-- "`run_billing()` exists and is invoked from the admin screen by hand", which
-- has never once worked.
--
-- ## The fifth instance of one trap
--
-- `0139` added `public` wrappers for three functions that drifted into
-- `afritech`. `0178` did the same for a TABLE. This is the fifth, and the
-- pattern is always identical: nothing fails at build time, nothing fails in
-- review, and it is a 404 the first time somebody clicks a button. Section 3 of
-- the migration skill now states the rule; the assertion at the foot of this
-- file enforces it.
--
-- ## Why the wrappers return JSONB
--
-- Four of the originals return `afritech.invoices` or `afritech.invoice_payments`
-- — composite types in a schema PostgREST cannot see. A wrapper returning one
-- would be reachable and still unusable, which is the same bug wearing a hat.
--
-- `to_jsonb(row)` produces exactly the object shape the route already passes
-- through as `invoice: data`, so this is a drop-in rather than a contract change.
--
-- ## The wrappers do not re-check permission
--
-- All five originals already call `is_afritech_admin()` — verified, not assumed.
-- A second check here would be a copy that drifts, and the copy in the wrapper
-- is the one that could be bypassed by calling the inner function from SQL.
-- These delegate and nothing else.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_run_billing(
  p_period_start DATE,
  p_period_end   DATE,
  p_currency     TEXT    DEFAULT 'ZMW',
  p_tax_rate     NUMERIC DEFAULT 0
)
RETURNS TABLE (
  out_created  INTEGER,
  out_skipped  INTEGER,
  out_failed   INTEGER,
  out_problems JSONB
)
LANGUAGE sql
-- INVOKER, deliberately. The inner function checks `is_afritech_admin()` against
-- the CALLER, and a DEFINER wrapper would run it as the owner and defeat that.
SECURITY INVOKER
SET search_path = public, afritech, pg_temp
AS $$
  SELECT * FROM afritech.run_billing(p_period_start, p_period_end, p_currency, p_tax_rate);
$$;

CREATE OR REPLACE FUNCTION public.admin_generate_school_invoice(
  p_school_id    UUID,
  p_period_start DATE,
  p_period_end   DATE,
  p_currency     TEXT    DEFAULT 'ZMW',
  p_tax_rate     NUMERIC DEFAULT 0,
  p_due_days     INTEGER DEFAULT 14
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, afritech, pg_temp
AS $$
  SELECT to_jsonb(i) FROM afritech.generate_school_invoice(
    p_school_id, p_period_start, p_period_end, p_currency, p_tax_rate, p_due_days
  ) AS i;
$$;

CREATE OR REPLACE FUNCTION public.admin_issue_invoice(p_invoice_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, afritech, pg_temp
AS $$
  SELECT to_jsonb(i) FROM afritech.issue_invoice(p_invoice_id) AS i;
$$;

CREATE OR REPLACE FUNCTION public.admin_record_invoice_payment(
  p_invoice_id UUID,
  p_amount     NUMERIC,
  p_method     TEXT,
  p_reference  TEXT        DEFAULT NULL,
  p_notes      TEXT        DEFAULT NULL,
  p_received   TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, afritech, pg_temp
AS $$
  SELECT to_jsonb(p) FROM afritech.record_invoice_payment(
    p_invoice_id, p_amount, p_method, p_reference, p_notes, p_received
  ) AS p;
$$;

CREATE OR REPLACE FUNCTION public.admin_void_invoice(p_invoice_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, afritech, pg_temp
AS $$
  SELECT to_jsonb(i) FROM afritech.void_invoice(p_invoice_id, p_reason) AS i;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_fn TEXT;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.admin_run_billing(DATE, DATE, TEXT, NUMERIC)',
    'public.admin_generate_school_invoice(UUID, DATE, DATE, TEXT, NUMERIC, INTEGER)',
    'public.admin_issue_invoice(UUID)',
    'public.admin_record_invoice_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, TIMESTAMPTZ)',
    'public.admin_void_invoice(UUID, TEXT)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_fn);

    IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'anon can execute %', v_fn;
    END IF;
    IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated cannot execute %', v_fn;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- The assertion that would have caught all five instances.
--
-- Not "does a wrapper exist" — that is the easy property. This checks that every
-- `afritech` function the APPLICATION is expected to call has a `public`
-- counterpart, by name, so a sixth instance fails here instead of at a button.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_name    TEXT;
  v_missing TEXT[] := '{}';
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'run_billing', 'generate_school_invoice', 'issue_invoice',
    'record_invoice_payment', 'void_invoice',
    -- Already wrapped by earlier migrations; listed so a later edit that removes
    -- one is caught here rather than in production.
    'publish_prompt_template', 'delete_tier_price_band', 'set_tier_pricing_model'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'admin_' || v_name
    ) THEN
      v_missing := v_missing || v_name;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      'these afritech functions have no public admin_ wrapper, so no route can call them: %',
      array_to_string(v_missing, ', ');
  END IF;
END;
$$;
