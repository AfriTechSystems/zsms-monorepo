-- Migration: 0081_fix_fee_statement_ordering.sql
-- Created: 2026-08-15
-- Description: Makes fee_statement() deterministic and dates charges by when
--              they fall due rather than when they were generated.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-038
--
-- Caught by the arrears suite:
--
--   not ok  9 - closing running balance equals outstanding   have 1000, want 2200
--   not ok 10 - windowed statement opens with Balance brought forward
--
-- TWO FAULTS, ONE CAUSE.
--
-- 0077 dated a charge by fee_records.created_at. Generation writes a whole
-- term's records in one statement, so every charge in that term carries an
-- IDENTICAL timestamp. The running balance was computed with
-- `ORDER BY entry_date, entry_type` and no tiebreaker, so tied rows had no
-- defined order: the same statement could close at 1000 or at 2200 depending on
-- which tied row the planner emitted last. A financial document whose closing
-- balance changes between renders is not a financial document.
--
-- The same mistake caused the second failure. With charges dated at generation
-- time, a statement windowed to the last five days found nothing before the
-- window, so the brought-forward opening computed to zero and was suppressed —
-- even though a term due forty days earlier was plainly outstanding.
--
-- THE FIX
--
--   * A charge is dated COALESCE(due_date, created_at). A fee belongs on the
--     ledger where it falls due, which is also what makes a windowed statement
--     show prior terms as brought forward.
--   * Every entry carries a stable entry_ref (the row's own id), and both the
--     window function and the final ORDER BY use the same complete key
--     (entry_date, type_rank, entry_ref). Determinism now holds even when two
--     entries share a date.
--   * type_rank orders a charge before a payment on the same date, so a term
--     billed and settled the same day reads debit-then-credit rather than the
--     reverse.

-- === MIGRATION START ===

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
    SELECT
      COALESCE(fr.due_date, fr.created_at)       AS entry_date,
      1                                          AS type_rank,
      fr.id                                      AS entry_ref,
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

    SELECT
      COALESCE(fr.due_date, fr.updated_at),
      2,
      fr.id,
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

    -- Only VERIFIED payments. A pending submission is not yet money, and
    -- showing it would imply a balance the school has not agreed.
    SELECT
      p.paid_at,
      3,
      p.id,
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
    SELECT COALESCE(SUM(debit) - SUM(credit), 0)::NUMERIC(12,2) AS opening
    FROM bounded
    WHERE is_before_window
  ),
  in_window AS (
    SELECT * FROM bounded WHERE NOT is_before_window
  ),
  ledger AS (
    SELECT
      b.entry_date, b.entry_type, b.description, b.reference, b.debit, b.credit,
      ((SELECT opening FROM brought_forward)
        + SUM(b.debit - b.credit) OVER (
            -- The full key, matching the final ORDER BY exactly. entry_ref is
            -- what makes this deterministic when two entries share a date.
            ORDER BY b.entry_date, b.type_rank, b.entry_ref
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          )
      )::NUMERIC(12,2) AS running_balance,
      1 AS sort_key,
      b.type_rank,
      b.entry_ref
    FROM in_window b
  ),
  opening_row AS (
    SELECT
      COALESCE(p_from::TIMESTAMPTZ, (SELECT MIN(l.entry_date) FROM ledger l)) AS entry_date,
      'brought_forward'::TEXT         AS entry_type,
      'Balance brought forward'::TEXT AS description,
      NULL::TEXT                      AS reference,
      0::NUMERIC(12,2)                AS debit,
      0::NUMERIC(12,2)                AS credit,
      (SELECT opening FROM brought_forward) AS running_balance,
      0                               AS sort_key,
      0                               AS type_rank,
      '00000000-0000-0000-0000-000000000000'::UUID AS entry_ref
    WHERE (SELECT opening FROM brought_forward) <> 0
  )
  SELECT c.entry_date, c.entry_type, c.description, c.reference,
         c.debit, c.credit, c.running_balance
  FROM (
    SELECT * FROM opening_row
    UNION ALL
    SELECT * FROM ledger
  ) c
  ORDER BY c.sort_key, c.entry_date, c.type_rank, c.entry_ref;
$$;

COMMENT ON FUNCTION public.fee_statement(UUID, DATE, DATE) IS
  'Deterministic ledger rows with a running balance, opening with a computed "Balance brought forward". Charges are dated by due_date. SECURITY INVOKER so RLS decides what the caller sees.';

GRANT EXECUTE ON FUNCTION public.fee_statement(UUID, DATE, DATE) TO authenticated;

-- === MIGRATION END ===
