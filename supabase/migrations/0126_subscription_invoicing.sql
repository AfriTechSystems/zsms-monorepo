-- Migration: 0126_subscription_invoicing.sql
-- Created: 2026-09-27
-- Description: Subscription invoicing — what AfriTech charges a school, what a
--              school has paid, and the ground a payment gateway will stand on.
-- Related documents: Official Documentation/17 Integration and Pricing/PRICING.md
--                    Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-041 (the basis lesson)
--
-- ===========================================================================
-- THIS IS SCHOOL → AFRITECH. IT IS NOT PARENT → SCHOOL.
--
-- `public.payments` is a parent paying a school for a child's fees. What follows is
-- a school paying AfriTech for its subscription. They are different money, different
-- parties, different tables, and conflating them would be among the worst modelling
-- errors available here: a school's revenue and AfriTech's revenue would sum into
-- the same ledger and no report afterwards would be trustworthy.
--
-- Hence the `afritech` schema, which is also not exposed to PostgREST — the school
-- reads its own invoices through a public view (below), never the table.
--
-- AN INVOICE CARRIES ITS OWN BASIS
--
-- The central design decision, and it is ADR-041's lesson applied to money. An
-- invoice stores the tier, the pricing model, the pupil count, the unit price and
-- the tax rate **as they were when it was issued**. Bands change, tiers get
-- repriced, VAT moves. A bill that stores only a total becomes unexplainable the
-- first time any of those happens, and "why was I charged K1,800 in March" is a
-- question a school will ask.
--
-- So nothing about a historical invoice is recomputed from current configuration.
-- Ever.
--
-- MANUAL RECORDING NOW, GATEWAY LATER — AND WHY THE COLUMNS EXIST TODAY
--
-- AfriTech records a bank transfer or a mobile-money receipt against an invoice.
-- Unlike a parent's payment there is no verification step: AfriTech recording that
-- it received money IS the verification, so a manual payment lands confirmed.
--
-- The gateway columns are here now rather than in a later migration because the
-- shape they need is known and adding them later would mean migrating live payment
-- rows. `gateway_reference` with a unique index is the idempotency key — a webhook
-- that retries must not credit a school twice, and that is a constraint rather than
-- application care.
-- ===========================================================================

-- === MIGRATION START ===

-- PRICING.md's DDL specifies an annual USD price; the applied schema had only ZMW.
-- Additive, so the divergence closes without touching anything that reads it.
ALTER TABLE afritech.subscription_tiers
  ADD COLUMN IF NOT EXISTS annual_price_usd NUMERIC(10,2);

COMMENT ON COLUMN afritech.subscription_tiers.annual_price_usd IS
  'Annual price in USD. Added in 0126 — PRICING.md always specified it and the '
  'applied schema had only annual_price_zmw. Nullable: a tier priced per student '
  'has no meaningful annual figure until a pupil count exists.';

-- ---------------------------------------------------------------------------
-- 1. Invoices.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afritech.invoices (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number     TEXT NOT NULL UNIQUE,

  school_id          UUID NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,

  period_start       DATE NOT NULL,
  period_end         DATE NOT NULL,

  currency           TEXT NOT NULL DEFAULT 'ZMW' CHECK (currency IN ('ZMW', 'USD')),

  -- ---- the basis, snapshotted. See the header. ----------------------------
  tier_name          TEXT NOT NULL,
  pricing_model      TEXT NOT NULL CHECK (pricing_model IN ('flat', 'per_student')),
  -- NULL on a flat plan; the roll on the issue date for a per-student plan.
  student_count      INT,
  unit_price         NUMERIC(10,2),

  subtotal           NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  -- The rate that applied, stored per invoice. A VAT change must never alter a
  -- historical bill, and an exemption must not require rewriting one.
  tax_rate           NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0 AND tax_rate <= 100),
  tax_amount         NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total              NUMERIC(12,2) NOT NULL CHECK (total >= 0),

  -- Maintained by trigger from invoice_payments. Never written directly.
  amount_paid        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),

  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'issued', 'part_paid', 'paid', 'void')),

  issued_at          TIMESTAMPTZ,
  due_at             DATE,
  paid_at            TIMESTAMPTZ,
  voided_at          TIMESTAMPTZ,
  void_reason        TEXT,

  notes              TEXT,
  created_by         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT invoices_period_shape CHECK (period_end >= period_start),
  -- A school is billed once per period per currency. Re-running a billing month
  -- must not produce a second invoice, and this is the guarantee rather than the
  -- billing function remembering.
  UNIQUE (school_id, period_start, period_end, currency),

  CONSTRAINT invoices_issued_has_timestamp CHECK (
    status = 'draft' OR status = 'void' OR issued_at IS NOT NULL
  ),
  CONSTRAINT invoices_void_has_reason CHECK (
    status <> 'void' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL)
  ),
  -- A per-student invoice without its count is exactly the unexplainable bill this
  -- table exists to prevent.
  CONSTRAINT invoices_per_student_has_basis CHECK (
    pricing_model <> 'per_student' OR (student_count IS NOT NULL AND unit_price IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_invoices_school ON afritech.invoices(school_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON afritech.invoices(status) WHERE status <> 'paid';

DROP TRIGGER IF EXISTS update_timestamp_on_invoices ON afritech.invoices;
CREATE TRIGGER update_timestamp_on_invoices
  BEFORE UPDATE ON afritech.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Lines.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afritech.invoice_lines (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id   UUID NOT NULL REFERENCES afritech.invoices(id) ON DELETE CASCADE,

  line_type    TEXT NOT NULL
               CHECK (line_type IN ('subscription', 'addon', 'adjustment', 'credit')),
  description  TEXT NOT NULL,
  -- Set for an addon line, so a bill can be traced back to the feature that caused
  -- it rather than to a description somebody typed.
  feature_key  TEXT,

  quantity     NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price   NUMERIC(12,2) NOT NULL,
  amount       NUMERIC(12,2) NOT NULL,

  display_order INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice
  ON afritech.invoice_lines(invoice_id, display_order);

-- ---------------------------------------------------------------------------
-- 3. Payments received from a school.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afritech.invoice_payments (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id     UUID NOT NULL REFERENCES afritech.invoices(id) ON DELETE RESTRICT,

  amount         NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency       TEXT NOT NULL DEFAULT 'ZMW' CHECK (currency IN ('ZMW', 'USD')),

  method         TEXT NOT NULL
                 CHECK (method IN ('bank_transfer', 'mobile_money', 'cash', 'cheque', 'gateway')),

  /**
   * A manually recorded payment is confirmed on arrival: AfriTech recording that it
   * received money IS the verification, unlike a parent's claim which a school
   * checks. A gateway payment starts pending and a webhook confirms it.
   */
  status         TEXT NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('pending', 'confirmed', 'failed', 'reversed')),

  -- What a human can match against a bank statement or a mobile-money message.
  reference      TEXT,

  -- ---- gateway foundation -------------------------------------------------
  gateway_name           TEXT,
  gateway_reference      TEXT,
  gateway_transaction_id TEXT,
  webhook_verified       BOOLEAN NOT NULL DEFAULT FALSE,
  gateway_payload        JSONB,

  received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by    TEXT,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A gateway payment must name its gateway, or a reconciliation cannot tell which
  -- rail the money came down.
  CONSTRAINT invoice_payments_gateway_shape CHECK (
    method <> 'gateway' OR gateway_name IS NOT NULL
  )
);

/**
 * The idempotency key. A gateway webhook retries — that is normal and expected —
 * and without this a retry credits the school twice.
 *
 * Partial, so the thousands of manual payments with no gateway reference do not
 * collide with each other on NULL.
 */
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_payments_gateway_ref
  ON afritech.invoice_payments(gateway_name, gateway_reference)
  WHERE gateway_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice
  ON afritech.invoice_payments(invoice_id);

-- ---------------------------------------------------------------------------
-- 4. Paid amount and status, derived — never written by hand.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION afritech.recalculate_invoice_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = afritech, public, pg_temp
AS $$
DECLARE
  v_invoice UUID := COALESCE(NEW.invoice_id, OLD.invoice_id);
  v_paid    NUMERIC(12,2);
  v_total   NUMERIC(12,2);
  v_status  TEXT;
BEGIN
  -- Confirmed payments only. A pending gateway payment is not money yet — the same
  -- distinction the parent-side fee flow draws, and for the same reason.
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM   afritech.invoice_payments
  WHERE  invoice_id = v_invoice AND status = 'confirmed';

  SELECT total, status INTO v_total, v_status
  FROM   afritech.invoices WHERE id = v_invoice;

  -- A void invoice stays void. Recording a payment against one is a mistake to be
  -- corrected, not a reason to revive it.
  IF v_status = 'void' THEN
    UPDATE afritech.invoices SET amount_paid = v_paid WHERE id = v_invoice;
    RETURN NULL;
  END IF;

  UPDATE afritech.invoices
  SET    amount_paid = v_paid,
         status = CASE
           WHEN v_paid >= v_total AND v_total > 0 THEN 'paid'
           WHEN v_paid > 0 THEN 'part_paid'
           -- Back to issued if payments were reversed away entirely.
           WHEN status IN ('part_paid', 'paid') THEN 'issued'
           ELSE status
         END,
         paid_at = CASE WHEN v_paid >= v_total AND v_total > 0 THEN NOW() ELSE NULL END
  WHERE  id = v_invoice;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS recalculate_balance_on_invoice_payments ON afritech.invoice_payments;
CREATE TRIGGER recalculate_balance_on_invoice_payments
  AFTER INSERT OR UPDATE OR DELETE ON afritech.invoice_payments
  FOR EACH ROW EXECUTE FUNCTION afritech.recalculate_invoice_balance();

-- ---------------------------------------------------------------------------
-- 5. Invoice numbering. MAX, not COUNT — the lesson from student identifiers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION afritech.next_invoice_number()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = afritech, pg_temp
AS $$
  SELECT 'INV-' || to_char(NOW(), 'YYYY') || '-' ||
         lpad((
           COALESCE(MAX(NULLIF(regexp_replace(invoice_number, '^.*-', ''), '')::INT), 0) + 1
         )::TEXT, 6, '0')
  FROM   afritech.invoices
  WHERE  invoice_number LIKE 'INV-' || to_char(NOW(), 'YYYY') || '-%';
$$;

COMMENT ON FUNCTION afritech.next_invoice_number() IS
  'Next invoice number for the current year, from MAX of the existing suffix. Not '
  'a row count: a count is lowered by a void or a delete and would reissue a '
  'number, and an invoice number that names two invoices is an audit problem.';

-- ---------------------------------------------------------------------------
-- 6. Generating one invoice.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION afritech.generate_school_invoice(
  p_school_id    UUID,
  p_period_start DATE,
  p_period_end   DATE,
  p_currency     TEXT DEFAULT 'ZMW',
  p_tax_rate     NUMERIC DEFAULT 0,
  p_due_days     INT DEFAULT 14
)
RETURNS afritech.invoices
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = afritech, public, pg_temp
AS $$
DECLARE
  v_charge   RECORD;
  v_invoice  afritech.invoices;
  v_subtotal NUMERIC(12,2) := 0;
  v_addon    RECORD;
  v_order    INT := 1;
  v_tax      NUMERIC(12,2);
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech can issue an invoice.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_charge
  FROM public.school_subscription_charge(p_school_id, p_currency);

  -- The resolver's reason is why this refuses rather than issuing. A roll outside
  -- every band, or a tier with no price row, produces a K0 invoice in the naive
  -- implementation — which looks like a successful billing run and loses real money.
  IF v_charge.out_reason IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot invoice this school: %', v_charge.out_reason
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO afritech.invoices (
    invoice_number, school_id, period_start, period_end, currency,
    tier_name, pricing_model, student_count, unit_price,
    subtotal, tax_rate, tax_amount, total,
    status, due_at, created_by
  ) VALUES (
    afritech.next_invoice_number(), p_school_id, p_period_start, p_period_end,
    upper(p_currency),
    v_charge.out_tier, v_charge.out_pricing_model,
    v_charge.out_student_count, v_charge.out_unit_price,
    0, COALESCE(p_tax_rate, 0), 0, 0,
    'draft', p_period_start + p_due_days,
    NULLIF(btrim(COALESCE(current_setting('request.jwt.claims', true), '')), '')::JSONB->>'sub'
  )
  RETURNING * INTO v_invoice;

  -- The subscription line, described so a school can check the arithmetic itself.
  INSERT INTO afritech.invoice_lines
    (invoice_id, line_type, description, quantity, unit_price, amount, display_order)
  VALUES (
    v_invoice.id, 'subscription',
    CASE WHEN v_charge.out_pricing_model = 'per_student'
      THEN format('%s subscription — %s pupils at %s each',
                  v_charge.out_tier, v_charge.out_student_count, v_charge.out_unit_price)
      ELSE format('%s subscription', v_charge.out_tier)
    END,
    COALESCE(v_charge.out_student_count, 1),
    COALESCE(v_charge.out_unit_price, v_charge.out_amount),
    v_charge.out_amount,
    v_order
  );
  v_subtotal := v_charge.out_amount;

  /**
   * Add-on lines: features this school holds by an active grant override that its
   * tier does NOT include and that are sold as add-ons.
   *
   * The `NOT is_included` half matters. A feature granted by override that the tier
   * already includes is a redundant override, not a chargeable extra — billing it
   * would charge a school twice for one thing.
   */
  FOR v_addon IN
    SELECT f.feature_key, f.display_name,
           CASE WHEN upper(p_currency) = 'USD' THEN f.monthly_addon_price_usd
                ELSE f.monthly_addon_price_zmw END AS price
    FROM   afritech.school_feature_overrides o
    JOIN   afritech.feature_flags f ON f.feature_key = o.feature_key
    WHERE  o.school_id = p_school_id
      AND  o.override_type = 'grant_feature'
      AND  o.is_active
      AND  (o.expires_at IS NULL OR o.expires_at > NOW())
      AND  f.is_available_as_addon
      AND  f.is_active
      AND  NOT EXISTS (
        SELECT 1 FROM afritech.tier_features tf
        WHERE tf.tier_name = v_charge.out_tier
          AND tf.feature_key = f.feature_key
          AND tf.is_included
      )
  LOOP
    IF COALESCE(v_addon.price, 0) > 0 THEN
      v_order := v_order + 1;
      INSERT INTO afritech.invoice_lines
        (invoice_id, line_type, description, feature_key, quantity, unit_price, amount, display_order)
      VALUES (v_invoice.id, 'addon', v_addon.display_name || ' (add-on)',
              v_addon.feature_key, 1, v_addon.price, v_addon.price, v_order);
      v_subtotal := v_subtotal + v_addon.price;
    END IF;
  END LOOP;

  v_tax := ROUND(v_subtotal * COALESCE(p_tax_rate, 0) / 100, 2);

  UPDATE afritech.invoices
  SET    subtotal = v_subtotal,
         tax_amount = v_tax,
         total = v_subtotal + v_tax
  WHERE  id = v_invoice.id
  RETURNING * INTO v_invoice;

  RETURN v_invoice;
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Issuing, paying, voiding.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION afritech.issue_invoice(p_invoice_id UUID)
RETURNS afritech.invoices
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = afritech, public, pg_temp
AS $$
DECLARE
  v_row afritech.invoices;
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech can issue an invoice.' USING ERRCODE = '42501';
  END IF;

  UPDATE afritech.invoices
  SET    status = 'issued', issued_at = NOW()
  WHERE  id = p_invoice_id AND status = 'draft'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'That invoice is not a draft — it has already been issued, paid or voided.'
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION afritech.record_invoice_payment(
  p_invoice_id UUID,
  p_amount     NUMERIC,
  p_method     TEXT,
  p_reference  TEXT DEFAULT NULL,
  p_notes      TEXT DEFAULT NULL,
  p_received   TIMESTAMPTZ DEFAULT NOW()
)
RETURNS afritech.invoice_payments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = afritech, public, pg_temp
AS $$
DECLARE
  v_row      afritech.invoice_payments;
  v_currency TEXT;
  v_status   TEXT;
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech can record a subscription payment.'
      USING ERRCODE = '42501';
  END IF;

  SELECT currency, status INTO v_currency, v_status
  FROM afritech.invoices WHERE id = p_invoice_id;

  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'Invoice not found.' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_status = 'void' THEN
    RAISE EXCEPTION
      'That invoice is void. Recording a payment against it would not be a '
      'correction — reinstate or reissue the invoice first.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_status = 'draft' THEN
    RAISE EXCEPTION
      'That invoice has not been issued yet. A school cannot have paid a bill it '
      'has not been sent.'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO afritech.invoice_payments
    (invoice_id, amount, currency, method, status, reference, notes, received_at, recorded_by)
  VALUES (p_invoice_id, p_amount, v_currency, p_method,
          -- Manual recording is its own verification: AfriTech saw the money.
          'confirmed', p_reference, p_notes, p_received,
          NULLIF(btrim(COALESCE(current_setting('request.jwt.claims', true), '')), '')::JSONB->>'sub')
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION afritech.void_invoice(p_invoice_id UUID, p_reason TEXT)
RETURNS afritech.invoices
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = afritech, public, pg_temp
AS $$
DECLARE
  v_row afritech.invoices;
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech can void an invoice.' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION
      'Voiding an invoice needs a reason — a school will ask why a bill vanished.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Never deleted. An invoice a school has seen must remain visible as voided, or
  -- the record disagrees with what they were sent.
  UPDATE afritech.invoices
  SET    status = 'void', voided_at = NOW(), void_reason = btrim(p_reason)
  WHERE  id = p_invoice_id AND status <> 'paid'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'That invoice is either already void or fully paid. A paid invoice is '
      'corrected with a credit note, not by voiding it.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. The billing run. One invoice per active school per period.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION afritech.run_billing(
  p_period_start DATE,
  p_period_end   DATE,
  p_currency     TEXT DEFAULT 'ZMW',
  p_tax_rate     NUMERIC DEFAULT 0
)
RETURNS TABLE (out_created INT, out_skipped INT, out_failed INT, out_problems JSONB)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = afritech, public, pg_temp
AS $$
DECLARE
  v_school   RECORD;
  v_created  INT := 0;
  v_skipped  INT := 0;
  v_failed   INT := 0;
  v_problems JSONB := '[]'::JSONB;
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech can run billing.' USING ERRCODE = '42501';
  END IF;

  FOR v_school IN
    SELECT id, school_id, name FROM public.schools
    -- Trials are not invoiced. A school still evaluating has agreed to nothing.
    WHERE status = 'active'
    ORDER BY name
  LOOP
    BEGIN
      PERFORM afritech.generate_school_invoice(
        v_school.id, p_period_start, p_period_end, p_currency, p_tax_rate);
      v_created := v_created + 1;
    EXCEPTION
      WHEN unique_violation THEN
        -- Already invoiced for this period. Re-running a month is safe and is the
        -- normal way to pick up a school that failed the first time.
        v_skipped := v_skipped + 1;
      WHEN OTHERS THEN
        -- One school's configuration gap must not abort the whole run, but it must
        -- be reported by name rather than swallowed. A silent failure here is a
        -- school that is never billed.
        v_failed := v_failed + 1;
        v_problems := v_problems || jsonb_build_object(
          'school', v_school.school_id, 'name', v_school.name, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN QUERY SELECT v_created, v_skipped, v_failed, v_problems;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Reading. A school sees its own bills; a network sees the sum of its schools'.
-- ---------------------------------------------------------------------------

/**
 * A school's own invoices.
 *
 * SECURITY DEFINER over the `afritech` table because that schema is not exposed to
 * PostgREST and must not be — but a school genuinely needs to see what it is being
 * charged. Scoped to the caller's own school and to management roles inside it.
 */
CREATE OR REPLACE FUNCTION public.my_school_invoices()
RETURNS TABLE (
  out_id             UUID,
  out_invoice_number TEXT,
  out_period_start   DATE,
  out_period_end     DATE,
  out_currency       TEXT,
  out_tier_name      TEXT,
  out_pricing_model  TEXT,
  out_student_count  INT,
  out_unit_price     NUMERIC,
  out_subtotal       NUMERIC,
  out_tax_amount     NUMERIC,
  out_total          NUMERIC,
  out_amount_paid    NUMERIC,
  out_status         TEXT,
  out_issued_at      TIMESTAMPTZ,
  out_due_at         DATE
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
  SELECT i.id, i.invoice_number, i.period_start, i.period_end, i.currency,
         i.tier_name, i.pricing_model, i.student_count, i.unit_price,
         i.subtotal, i.tax_amount, i.total, i.amount_paid, i.status,
         i.issued_at, i.due_at
  FROM   afritech.invoices i
  WHERE  i.school_id = public.current_school_uuid()
    -- A draft is AfriTech's working state and is not shown to the school. Sending
    -- somebody a bill you have not issued invites an argument about a figure you
    -- were still checking.
    AND  i.status <> 'draft'
    AND  public.get_user_role() IN ('org:owner', 'org:principal', 'org:accountant')
  ORDER BY i.period_start DESC;
$$;

/** One row per school in the caller's network, with what it owes AfriTech. */
CREATE OR REPLACE FUNCTION public.network_billing_summary()
RETURNS TABLE (
  out_school_uuid UUID,
  out_school_code TEXT,
  out_school_name TEXT,
  out_invoices    INT,
  out_billed      NUMERIC,
  out_paid        NUMERIC,
  out_outstanding NUMERIC,
  out_overdue     INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, afritech, pg_temp
AS $$
  WITH mine AS (
    SELECT ns.school_id
    FROM   public.school_network_schools ns
    WHERE  ns.is_active AND ns.network_id = public.my_network_id()
  )
  SELECT s.id, s.school_id, s.name,
         count(i.id)::INT,
         COALESCE(SUM(i.total), 0),
         COALESCE(SUM(i.amount_paid), 0),
         COALESCE(SUM(i.total - i.amount_paid), 0),
         count(*) FILTER (
           WHERE i.status IN ('issued', 'part_paid') AND i.due_at < CURRENT_DATE
         )::INT
  FROM   mine m
  JOIN   public.schools s ON s.id = m.school_id
  -- Voided invoices are excluded from every figure: a bill that was withdrawn is
  -- not money owed, and including it would overstate what the network owes.
  LEFT JOIN afritech.invoices i ON i.school_id = s.id AND i.status <> 'void'
  GROUP  BY s.id, s.school_id, s.name
  ORDER  BY s.name;
$$;

-- ---------------------------------------------------------------------------
-- 10. RLS and privileges.
-- ---------------------------------------------------------------------------
ALTER TABLE afritech.invoices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.invoices         FORCE  ROW LEVEL SECURITY;
ALTER TABLE afritech.invoice_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.invoice_lines    FORCE  ROW LEVEL SECURITY;
ALTER TABLE afritech.invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE afritech.invoice_payments FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_invoices" ON afritech.invoices;
CREATE POLICY "afritech_admin_all_invoices" ON afritech.invoices FOR ALL
USING (public.is_afritech_admin()) WITH CHECK (public.is_afritech_admin());

DROP POLICY IF EXISTS "afritech_admin_all_invoice_lines" ON afritech.invoice_lines;
CREATE POLICY "afritech_admin_all_invoice_lines" ON afritech.invoice_lines FOR ALL
USING (public.is_afritech_admin()) WITH CHECK (public.is_afritech_admin());

DROP POLICY IF EXISTS "afritech_admin_all_invoice_payments" ON afritech.invoice_payments;
CREATE POLICY "afritech_admin_all_invoice_payments" ON afritech.invoice_payments FOR ALL
USING (public.is_afritech_admin()) WITH CHECK (public.is_afritech_admin());

-- No school-facing policy on these tables, and none is wanted: the `afritech`
-- schema is not on PostgREST. A school reads its bills through
-- `my_school_invoices()` and nothing else.
REVOKE ALL ON afritech.invoices         FROM anon;
REVOKE ALL ON afritech.invoice_lines    FROM anon;
REVOKE ALL ON afritech.invoice_payments FROM anon;

GRANT SELECT, INSERT, UPDATE ON afritech.invoices         TO authenticated;
GRANT SELECT, INSERT         ON afritech.invoice_lines    TO authenticated;
GRANT SELECT, INSERT, UPDATE ON afritech.invoice_payments TO authenticated;

GRANT EXECUTE ON FUNCTION afritech.next_invoice_number()                                   TO authenticated;
GRANT EXECUTE ON FUNCTION afritech.generate_school_invoice(UUID, DATE, DATE, TEXT, NUMERIC, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION afritech.issue_invoice(UUID)                                     TO authenticated;
GRANT EXECUTE ON FUNCTION afritech.record_invoice_payment(UUID, NUMERIC, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION afritech.void_invoice(UUID, TEXT)                                TO authenticated;
GRANT EXECUTE ON FUNCTION afritech.run_billing(DATE, DATE, TEXT, NUMERIC)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_school_invoices()                                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.network_billing_summary()                                 TO authenticated;

-- === MIGRATION END ===
