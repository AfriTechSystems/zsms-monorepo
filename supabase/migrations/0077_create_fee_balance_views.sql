-- Migration: 0077_create_fee_balance_views.sql
-- Created: 2026-08-15
-- Description: Derived arrears — the cumulative student balance view, the
--              per-record overdue derivation, and the ledger-style statement.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-038
--                    Official Documentation/09 Fee and Financial Management/
--                    Official Documentation/13 Document and PDF System/PDF_GENERATION.md
--
-- ============================================================================
-- THIS MODEL COMPUTES AND EXPOSES. IT NEVER ENFORCES.
-- ============================================================================
-- Nothing here blocks any action. No function refuses a result, a certificate,
-- a transfer letter, or a re-registration because a balance is outstanding.
-- `is_overdue` is a fact about a due date, not a permission.
--
-- In Zambia arrears commonly do gate report cards, exam entry, and
-- re-registration — which is exactly why that must be a per-school setting,
-- admin-configurable and OFF by default, rather than behaviour welded into the
-- schema. A school that does not withhold results must not inherit the
-- behaviour of one that does. That setting is not built here; when it is, it
-- reads these columns and decides. Do not add a gate to this migration.
--
-- ============================================================================
-- WHY DERIVED RATHER THAN A "BALANCE BROUGHT FORWARD" ROW
-- ============================================================================
-- fee_records stays the single source of truth. Writing a brought-forward line
-- into each new term would double-count the moment the original record still
-- exists, and reconciling that needs settlement logic that can itself drift.
--
-- The ledger reading a bursar expects is a PRESENTATION concern:
-- fee_statement() emits an opening "Balance brought forward" entry computed
-- from prior activity. One truth in the data, ledger-style on the page.
--
-- ============================================================================
-- security_invoker IS LOAD-BEARING
-- ============================================================================
-- A PostgreSQL view executes with the VIEW OWNER's privileges by default, which
-- would bypass RLS on fee_records entirely — every parent would see every
-- family's balance through it. `security_invoker = true` (PG15+) makes the view
-- evaluate under the caller's rights, so the existing fee_records policies
-- apply unchanged. The isolation suite attacks this directly.

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- fee_record_status — per-record, with overdue derived from due_date
-- ---------------------------------------------------------------------------
-- `status` continues to mean payment progress and nothing else. Overdue is a
-- separate axis: a record can be 'partial' and overdue, or 'partial' and not
-- yet due. Collapsing them into one enum would destroy that distinction and
-- break the balance trigger's state machine.
CREATE OR REPLACE VIEW public.fee_record_status
WITH (security_invoker = true) AS
SELECT
  fr.id,
  fr.school_id,
  fr.student_id,
  fr.academic_year,
  fr.term_number,
  fr.fee_label,
  fr.amount_due,
  fr.amount_paid,
  fr.discount_amount,
  fr.currency_code,
  fr.status,
  fr.due_date,

  GREATEST(fr.amount_due - fr.amount_paid - fr.discount_amount, 0)::NUMERIC(12,2)
    AS outstanding,

  (
    fr.due_date IS NOT NULL
    AND fr.due_date < NOW()
    AND (fr.amount_due - fr.amount_paid - fr.discount_amount) > 0
  ) AS is_overdue,

  CASE
    WHEN fr.due_date IS NOT NULL
     AND fr.due_date < NOW()
     AND (fr.amount_due - fr.amount_paid - fr.discount_amount) > 0
    THEN EXTRACT(DAY FROM (NOW() - fr.due_date))::INT
    ELSE 0
  END AS days_overdue

FROM public.fee_records fr
WHERE fr.is_deleted = FALSE;

COMMENT ON VIEW public.fee_record_status IS
  'Per fee record with outstanding, is_overdue, and days_overdue derived from due_date. Informational only — nothing gates on these (ADR-038).';

-- ---------------------------------------------------------------------------
-- student_fee_balance — the cumulative balance that had no home
-- ---------------------------------------------------------------------------
-- Deliberately spans EVERY academic year and term. Zambian school debt does not
-- wipe at a year boundary, so there is no year filter here and there must not
-- be one added.
--
-- Equally deliberate: this does NOT filter on students.status. A student who has
-- transferred, graduated, or become alumni keeps their outstanding balance
-- visible, because schools withhold transfer letters and certificates until it
-- is cleared. Their fee records still exist; hiding the balance when the status
-- changes would make the debt disappear from every screen that matters.
CREATE OR REPLACE VIEW public.student_fee_balance
WITH (security_invoker = true) AS
SELECT
  frs.school_id,
  frs.student_id,
  s.student_id      AS student_code,
  s.first_name,
  s.last_name,
  s.status          AS student_status,
  -- Carried so a bursar chasing a graduating student sees why the balance is
  -- still listed rather than assuming it is stale data.

  MIN(frs.currency_code) AS currency_code,

  SUM(frs.amount_due)::NUMERIC(12,2)       AS total_due,
  SUM(frs.amount_paid)::NUMERIC(12,2)      AS total_paid,
  SUM(frs.discount_amount)::NUMERIC(12,2)  AS total_discount,
  SUM(frs.outstanding)::NUMERIC(12,2)      AS outstanding,

  -- Arrears is the subset of `outstanding` that is already past its due date.
  -- The number a reminder or a school-configured gate would act on.
  COALESCE(SUM(frs.outstanding) FILTER (WHERE frs.is_overdue), 0)::NUMERIC(12,2)
    AS arrears_amount,

  COALESCE(bool_or(frs.is_overdue), FALSE)  AS is_overdue,
  COALESCE(MAX(frs.days_overdue), 0)        AS days_overdue,

  MIN(frs.due_date) FILTER (WHERE frs.outstanding > 0) AS oldest_unpaid_due_date,

  count(*)::INT                                          AS records_total,
  count(*) FILTER (WHERE frs.outstanding > 0)::INT        AS records_outstanding,
  count(*) FILTER (WHERE frs.is_overdue)::INT             AS records_overdue
  -- These counts, together with payments.paid_at and fee_records.due_date,
  -- are what a fee-payment reliability signal would be built from
  -- (BEHAVIOUR_SCORE.md). No loan linkage is created here; it is simply not
  -- precluded.

FROM public.fee_record_status frs
JOIN public.students s ON s.id = frs.student_id
GROUP BY frs.school_id, frs.student_id, s.student_id, s.first_name, s.last_name, s.status;

COMMENT ON VIEW public.student_fee_balance IS
  'Cumulative fee position per student across ALL years and terms. Survives transferred/graduated status. Informational only — nothing gates on it (ADR-038).';

-- ---------------------------------------------------------------------------
-- fee_statement — ledger rows with a running balance
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER (the default) is required, not incidental: the function must
-- see exactly what the caller may see. A parent calling it for another family's
-- child gets no rows, because the underlying selects are RLS-filtered.
--
-- The opening row is the "Balance brought forward" that GLOSSARY.md and
-- PDF_GENERATION.md describe. It is computed, never stored.
CREATE OR REPLACE FUNCTION public.fee_statement(
  p_student_id UUID,
  p_from       DATE DEFAULT NULL,
  p_to         DATE DEFAULT NULL
)
RETURNS TABLE (
  entry_date      TIMESTAMPTZ,
  entry_type      TEXT,
  description     TEXT,
  reference       TEXT,
  debit           NUMERIC(12,2),
  credit          NUMERIC(12,2),
  running_balance NUMERIC(12,2)
)
LANGUAGE SQL
STABLE
AS $$
  WITH entries AS (
    -- Charges
    SELECT
      fr.created_at                              AS entry_date,
      'charge'::TEXT                             AS entry_type,
      (fr.fee_label || ' — ' || fr.academic_year || ' Term ' || fr.term_number)::TEXT
                                                 AS description,
      NULL::TEXT                                 AS reference,
      fr.amount_due::NUMERIC(12,2)               AS debit,
      0::NUMERIC(12,2)                           AS credit
    FROM public.fee_records fr
    WHERE fr.student_id = p_student_id
      AND fr.is_deleted = FALSE

    UNION ALL

    -- Discounts reduce what is owed, so they read as credits on the ledger.
    SELECT
      fr.updated_at,
      'discount',
      ('Discount — ' || COALESCE(fr.discount_reason, fr.fee_label))::TEXT,
      NULL::TEXT,
      0::NUMERIC(12,2),
      fr.discount_amount::NUMERIC(12,2)
    FROM public.fee_records fr
    WHERE fr.student_id = p_student_id
      AND fr.is_deleted = FALSE
      AND fr.discount_amount > 0

    UNION ALL

    -- Only VERIFIED payments appear. A pending submission is not yet money, and
    -- showing it on a statement would imply a balance the school has not agreed.
    SELECT
      p.paid_at,
      CASE WHEN p.amount < 0 THEN 'reversal' ELSE 'payment' END,
      CASE WHEN p.amount < 0 THEN 'Payment reversed' ELSE ('Payment — ' || p.payment_method) END::TEXT,
      p.receipt_number,
      0::NUMERIC(12,2),
      p.amount::NUMERIC(12,2)
    FROM public.payments p
    WHERE p.student_id = p_student_id
      AND p.status    = 'verified'
      AND p.is_voided = FALSE
  ),
  bounded AS (
    SELECT *,
           (p_from IS NOT NULL AND entry_date::DATE < p_from) AS is_before_window
    FROM entries
    WHERE p_to IS NULL OR entry_date::DATE <= p_to
  ),
  brought_forward AS (
    SELECT
      COALESCE(SUM(debit) - SUM(credit), 0)::NUMERIC(12,2) AS opening
    FROM bounded
    WHERE is_before_window
  ),
  in_window AS (
    SELECT * FROM bounded WHERE NOT is_before_window
  ),
  opening_row AS (
    SELECT
      COALESCE(p_from::TIMESTAMPTZ, (SELECT MIN(entry_date) FROM in_window)) AS entry_date,
      'brought_forward'::TEXT   AS entry_type,
      'Balance brought forward'::TEXT AS description,
      NULL::TEXT                AS reference,
      0::NUMERIC(12,2)          AS debit,
      0::NUMERIC(12,2)          AS credit,
      (SELECT opening FROM brought_forward) AS running_balance,
      0                         AS sort_key
    WHERE (SELECT opening FROM brought_forward) <> 0
  ),
  ledger AS (
    SELECT
      entry_date, entry_type, description, reference, debit, credit,
      ((SELECT opening FROM brought_forward)
        + SUM(debit - credit) OVER (ORDER BY entry_date, entry_type
                                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      )::NUMERIC(12,2) AS running_balance,
      1 AS sort_key
    FROM in_window
  )
  SELECT entry_date, entry_type, description, reference, debit, credit, running_balance
  FROM (
    SELECT * FROM opening_row
    UNION ALL
    SELECT * FROM ledger
  ) combined
  ORDER BY sort_key, entry_date, entry_type;
$$;

COMMENT ON FUNCTION public.fee_statement(UUID, DATE, DATE) IS
  'Ledger rows with a running balance, opening with a computed "Balance brought forward". SECURITY INVOKER so RLS decides what the caller sees.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- No DELETE/INSERT/UPDATE is granted on the views: they are derived, and
-- Postgres would otherwise make the simple ones auto-updatable.
GRANT SELECT ON public.fee_record_status   TO authenticated;
GRANT SELECT ON public.student_fee_balance TO authenticated;
REVOKE ALL ON public.fee_record_status   FROM anon;
REVOKE ALL ON public.student_fee_balance FROM anon;

GRANT EXECUTE ON FUNCTION public.fee_statement(UUID, DATE, DATE) TO authenticated;

-- === MIGRATION END ===
