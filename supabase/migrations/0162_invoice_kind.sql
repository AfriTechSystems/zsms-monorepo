-- ---------------------------------------------------------------------------
-- 0162 — invoices can be for something other than a subscription period
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/17 Integration and Pricing/PRICING.md`
--       `Official Documentation/18 AI Module/AI_OVERVIEW.md`
--
-- ## The constraint that blocked this
--
-- `afritech.invoices` carries `UNIQUE (school_id, period_start, period_end, currency)`.
-- That is exactly right for subscription billing — `run_billing()` must not issue a
-- school two invoices for September — and it makes a second KIND of invoice
-- impossible. A school buying AI credits in September would collide with its own
-- September subscription invoice and the insert would fail.
--
-- The obvious workarounds are both worse:
--
--   * **Add credit purchases as lines on the period invoice.** A school buying
--     credits mid-term would wait for the next billing run to be billed, and a
--     purchase made after the invoice was issued could not be added to it at all
--     without reopening a document that has already gone out.
--   * **A separate table for credit invoices.** Two invoice tables means two
--     numbering sequences, two payment-recording paths and two places to look when
--     a school asks what it owes. Billing has one ledger or it has none.
--
-- So the invoice gains a kind, and the uniqueness becomes a PARTIAL index that
-- applies only to subscription invoices — which is what the rule was always about.
-- Credit purchases are deliberately not constrained this way: a school may buy
-- credits twice in one month, and that is a normal thing to do rather than a
-- duplicate to prevent.
--
-- ## Why this is safe on a table holding financial rows
--
-- The column is added with a DEFAULT, so every existing row becomes
-- `subscription`, which is what every existing row is — there has never been
-- another kind. The index replacing the constraint is equivalent for those rows,
-- so nothing that was rejected before becomes accepted now.
--
-- The DROP and the CREATE are in one migration, therefore one transaction: there
-- is no window in which a duplicate subscription invoice could be inserted.
-- ---------------------------------------------------------------------------

ALTER TABLE afritech.invoices
  ADD COLUMN IF NOT EXISTS invoice_kind TEXT NOT NULL DEFAULT 'subscription'
    CHECK (invoice_kind IN ('subscription', 'ai_credits'));

COMMENT ON COLUMN afritech.invoices.invoice_kind IS
  'What this invoice is for. Subscription invoices are unique per school per period; '
  'credit purchases are not, because buying twice in a month is normal.';

-- The original constraint, by the name Postgres gave it.
ALTER TABLE afritech.invoices
  DROP CONSTRAINT IF EXISTS invoices_school_id_period_start_period_end_currency_key;

-- Same rule, narrowed to the kind it was written for.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_one_subscription_per_period
  ON afritech.invoices(school_id, period_start, period_end, currency)
  WHERE invoice_kind = 'subscription';

CREATE INDEX IF NOT EXISTS idx_invoices_kind
  ON afritech.invoices(school_id, invoice_kind, period_start DESC);

-- ---------------------------------------------------------------------------
-- Assert the swap actually happened.
--
-- A DROP CONSTRAINT IF EXISTS against a name that is wrong succeeds silently and
-- leaves the old constraint in place — the migration would apply, look correct,
-- and the first credit purchase would still fail. So both halves are checked.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'afritech.invoices'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%school_id%period_start%period_end%currency%'
  ) THEN
    RAISE EXCEPTION
      'the old table-level UNIQUE is still present — DROP CONSTRAINT named the wrong thing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'afritech'
      AND indexname = 'idx_invoices_one_subscription_per_period'
  ) THEN
    RAISE EXCEPTION 'the replacement partial unique index was not created';
  END IF;
END;
$$;
