-- Migration: 0078_create_payment_allocation.sql
-- Created: 2026-08-15
-- Description: Lump-sum payment allocation — an overridable oldest-first
--              suggestion, and the allocation that acts on it.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-038
--
-- WHY THIS EXISTS
-- ---------------
-- payments.fee_record_id is NOT NULL and names exactly one record, so a parent
-- transferring one lump sum against three outstanding terms had no way to
-- express it. Parents pay by mobile money, bank transfer, and cash at the
-- office — all of which arrive as a single amount, not as a per-term breakdown.
--
-- Oldest-first is the DEFAULT, not the rule. A bursar must be able to override
-- it: clearing the current term so a child can sit an exam while an older
-- disputed amount stays open is a normal, legitimate instruction, and a system
-- that silently swallowed that payment into the disputed debt would be wrong.
--
-- These functions allocate money. They do not gate anything (ADR-038).

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- suggest_payment_allocation — what oldest-first would do, without doing it
-- ---------------------------------------------------------------------------
-- Returns the proposed split so a client can render it for one-tap acceptance
-- or let the payer redistribute. SECURITY INVOKER: a caller who cannot see a
-- student's fee records gets no suggestion for them.
CREATE OR REPLACE FUNCTION public.suggest_payment_allocation(
  p_student_id UUID,
  p_amount     NUMERIC(12,2)
)
RETURNS TABLE (
  fee_record_id UUID,
  academic_year TEXT,
  term_number   INT,
  fee_label     TEXT,
  due_date      TIMESTAMPTZ,
  outstanding   NUMERIC(12,2),
  suggested     NUMERIC(12,2)
)
LANGUAGE SQL
STABLE
AS $$
  WITH ordered AS (
    SELECT
      frs.id, frs.academic_year, frs.term_number, frs.fee_label,
      frs.due_date, frs.outstanding,
      -- Oldest first. NULL due dates sort last: a record with no due date is
      -- not yet chaseable, so it should not absorb money ahead of a real debt.
      SUM(frs.outstanding) OVER (
        ORDER BY frs.due_date NULLS LAST, frs.academic_year, frs.term_number, frs.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS cumulative
    FROM public.fee_record_status frs
    WHERE frs.student_id = p_student_id
      AND frs.outstanding > 0
  )
  SELECT
    o.id, o.academic_year, o.term_number, o.fee_label, o.due_date, o.outstanding,
    -- Each record takes what remains of the payment, capped at its outstanding.
    GREATEST(
      LEAST(o.outstanding, p_amount - (o.cumulative - o.outstanding)),
      0
    )::NUMERIC(12,2) AS suggested
  FROM ordered o
  WHERE p_amount > (o.cumulative - o.outstanding)
  ORDER BY o.due_date NULLS LAST, o.academic_year, o.term_number, o.id;
$$;

COMMENT ON FUNCTION public.suggest_payment_allocation(UUID, NUMERIC) IS
  'Proposed oldest-first split of a lump sum. Advisory only — allocate_payment accepts an override.';

GRANT EXECUTE ON FUNCTION public.suggest_payment_allocation(UUID, NUMERIC) TO authenticated;

-- ---------------------------------------------------------------------------
-- allocate_payment — one submitted amount, several payment rows
-- ---------------------------------------------------------------------------
-- p_allocations: NULL uses the oldest-first suggestion; otherwise a JSONB array
-- of {"fee_record_id": "...", "amount": 123.45} which the caller has chosen.
--
-- SECURITY INVOKER on purpose. Each INSERT is evaluated by the existing
-- payments policies, so a parent may only allocate against their own child's
-- records and every row still lands as pending_verification. The function adds
-- no authority of its own; it only saves the caller from writing the rows.
CREATE OR REPLACE FUNCTION public.allocate_payment(
  p_student_id     UUID,
  p_amount         NUMERIC(12,2),
  p_payment_method TEXT,
  p_allocations    JSONB DEFAULT NULL,
  p_notes          TEXT  DEFAULT NULL,
  p_proof_url      TEXT  DEFAULT NULL
)
RETURNS TABLE (
  payment_id     UUID,
  fee_record_id  UUID,
  amount         NUMERIC(12,2),
  receipt_number TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor      TEXT := public.get_user_id();
  v_allocated  NUMERIC(12,2) := 0;
  v_alloc      RECORD;
  v_school     UUID;
  v_newest     UUID;
  v_remainder  NUMERIC(12,2);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _alloc(
    fee_record_id UUID,
    amount        NUMERIC(12,2)
  ) ON COMMIT DROP;
  DELETE FROM _alloc;

  IF p_allocations IS NULL THEN
    INSERT INTO _alloc(fee_record_id, amount)
    SELECT s.fee_record_id, s.suggested
    FROM public.suggest_payment_allocation(p_student_id, p_amount) s
    WHERE s.suggested > 0;
  ELSE
    INSERT INTO _alloc(fee_record_id, amount)
    SELECT (e ->> 'fee_record_id')::UUID, (e ->> 'amount')::NUMERIC(12,2)
    FROM jsonb_array_elements(p_allocations) e;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM _alloc) THEN
    RAISE EXCEPTION 'Nothing outstanding to allocate against for this student'
      USING ERRCODE = 'P0002';
  END IF;

  -- Every targeted record must belong to the named student. Without this, a
  -- caller could hand over their own child's id and a fee_record_id belonging
  -- to another family, and the payment would land on the wrong ledger.
  IF EXISTS (
    SELECT 1
    FROM _alloc a
    LEFT JOIN public.fee_records fr ON fr.id = a.fee_record_id
    WHERE fr.id IS NULL OR fr.student_id <> p_student_id
  ) THEN
    RAISE EXCEPTION 'An allocation targets a fee record that does not belong to this student'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM _alloc WHERE amount <= 0) THEN
    RAISE EXCEPTION 'Allocation amounts must be greater than zero' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_allocated FROM _alloc;

  IF v_allocated > p_amount THEN
    RAISE EXCEPTION 'Allocations total % which exceeds the payment of %', v_allocated, p_amount
      USING ERRCODE = '22023';
  END IF;

  -- A small overpayment is routine — a parent rounds up, or clears a term and
  -- leaves credit. Rather than refuse the whole payment, the remainder goes to
  -- the newest record, which becomes 'overpaid'. Refusing here would send the
  -- payer away over a few kwacha.
  v_remainder := p_amount - v_allocated;
  IF v_remainder > 0 THEN
    SELECT fr.id INTO v_newest
    FROM public.fee_records fr
    WHERE fr.student_id = p_student_id AND fr.is_deleted = FALSE
    ORDER BY fr.academic_year DESC, fr.term_number DESC, fr.created_at DESC
    LIMIT 1;

    IF v_newest IS NULL THEN
      RAISE EXCEPTION 'Cannot place the unallocated remainder of %; no fee record found', v_remainder
        USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO _alloc(fee_record_id, amount)
    VALUES (v_newest, v_remainder)
    ON CONFLICT DO NOTHING;

    -- If the newest record already had an allocation, fold the remainder in.
    UPDATE _alloc SET amount = amount + v_remainder
    WHERE fee_record_id = v_newest
      AND (SELECT count(*) FROM _alloc WHERE fee_record_id = v_newest) = 1
      AND amount <> v_remainder;
  END IF;

  FOR v_alloc IN SELECT * FROM _alloc LOOP
    SELECT fr.school_id INTO v_school
    FROM public.fee_records fr WHERE fr.id = v_alloc.fee_record_id;

    -- The INSERT is RLS-checked. A caller without an applicable payments INSERT
    -- policy is refused here, exactly as a direct insert would be.
    RETURN QUERY
    INSERT INTO public.payments (
      school_id, fee_record_id, student_id, recorded_by_user_id, amount,
      payment_method, status, confirmation_checkbox_at, notes, proof_of_payment_url
    )
    VALUES (
      v_school, v_alloc.fee_record_id, p_student_id, v_actor, v_alloc.amount,
      p_payment_method, 'pending_verification', NOW(), p_notes, p_proof_url
    )
    RETURNING id, fee_record_id, amount, receipt_number;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.allocate_payment(UUID, NUMERIC, TEXT, JSONB, TEXT, TEXT) IS
  'Splits one lump sum into per-record pending payments. Oldest-first by default, overridable. SECURITY INVOKER — the payments policies still decide.';

GRANT EXECUTE ON FUNCTION public.allocate_payment(UUID, NUMERIC, TEXT, JSONB, TEXT, TEXT) TO authenticated;

-- === MIGRATION END ===
