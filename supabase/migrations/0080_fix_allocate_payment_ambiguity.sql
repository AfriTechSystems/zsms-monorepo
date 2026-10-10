-- Migration: 0080_fix_allocate_payment_ambiguity.sql
-- Created: 2026-08-15
-- Description: Fixes an ambiguous column reference in allocate_payment().
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-038
--
-- Caught by the arrears suite on its first run:
--
--   ERROR 42702: column reference "amount" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- A RETURNS TABLE column becomes a PL/pgSQL variable inside the body, so the
-- OUT columns `amount` and `fee_record_id` collided with the identically named
-- columns of the internal `_alloc` temp table. The function was unusable — the
-- first unqualified reference aborted every call.
--
-- Fixed by prefixing the OUT columns with `out_` and qualifying every `_alloc`
-- reference. Renaming OUT columns changes the function's return type, which
-- CREATE OR REPLACE cannot do, so the old signature is dropped first. Nothing
-- depends on it — it has never successfully run.
--
-- Behaviour is otherwise unchanged: oldest-first by default, overridable,
-- SECURITY INVOKER so the payments policies still decide, and no gating.

-- === MIGRATION START ===

DROP FUNCTION IF EXISTS public.allocate_payment(UUID, NUMERIC, TEXT, JSONB, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.allocate_payment(
  p_student_id     UUID,
  p_amount         NUMERIC(12,2),
  p_payment_method TEXT,
  p_allocations    JSONB DEFAULT NULL,
  p_notes          TEXT  DEFAULT NULL,
  p_proof_url      TEXT  DEFAULT NULL
)
RETURNS TABLE (
  out_payment_id     UUID,
  out_fee_record_id  UUID,
  out_amount         NUMERIC(12,2),
  out_receipt_number TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor     TEXT := public.get_user_id();
  v_allocated NUMERIC(12,2) := 0;
  v_alloc     RECORD;
  v_school    UUID;
  v_newest    UUID;
  v_remainder NUMERIC(12,2);
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

  IF NOT EXISTS (SELECT 1 FROM _alloc a) THEN
    RAISE EXCEPTION 'Nothing outstanding to allocate against for this student'
      USING ERRCODE = 'P0002';
  END IF;

  -- Every targeted record must belong to the named student. Without this a
  -- caller could pair their own child's id with another family's fee record and
  -- the payment would land on the wrong ledger.
  IF EXISTS (
    SELECT 1
    FROM _alloc a
    LEFT JOIN public.fee_records fr ON fr.id = a.fee_record_id
    WHERE fr.id IS NULL OR fr.student_id <> p_student_id
  ) THEN
    RAISE EXCEPTION 'An allocation targets a fee record that does not belong to this student'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM _alloc a WHERE a.amount <= 0) THEN
    RAISE EXCEPTION 'Allocation amounts must be greater than zero' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(a.amount), 0) INTO v_allocated FROM _alloc a;

  IF v_allocated > p_amount THEN
    RAISE EXCEPTION 'Allocations total % which exceeds the payment of %', v_allocated, p_amount
      USING ERRCODE = '22023';
  END IF;

  -- A small overpayment is routine — a parent rounds up, or clears a term and
  -- leaves credit. The remainder goes to the newest record, which becomes
  -- 'overpaid'. Refusing would send the payer away over a few kwacha.
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

    IF EXISTS (SELECT 1 FROM _alloc a WHERE a.fee_record_id = v_newest) THEN
      UPDATE _alloc a SET amount = a.amount + v_remainder WHERE a.fee_record_id = v_newest;
    ELSE
      INSERT INTO _alloc(fee_record_id, amount) VALUES (v_newest, v_remainder);
    END IF;
  END IF;

  FOR v_alloc IN SELECT a.fee_record_id, a.amount FROM _alloc a LOOP
    SELECT fr.school_id INTO v_school
    FROM public.fee_records fr WHERE fr.id = v_alloc.fee_record_id;

    -- RLS-checked. A caller without an applicable payments INSERT policy is
    -- refused here exactly as a direct insert would be.
    RETURN QUERY
    INSERT INTO public.payments (
      school_id, fee_record_id, student_id, recorded_by_user_id, amount,
      payment_method, status, confirmation_checkbox_at, notes, proof_of_payment_url
    )
    VALUES (
      v_school, v_alloc.fee_record_id, p_student_id, v_actor, v_alloc.amount,
      p_payment_method, 'pending_verification', NOW(), p_notes, p_proof_url
    )
    RETURNING payments.id, payments.fee_record_id, payments.amount, payments.receipt_number;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.allocate_payment(UUID, NUMERIC, TEXT, JSONB, TEXT, TEXT) IS
  'Splits one lump sum into per-record pending payments. Oldest-first by default, overridable. SECURITY INVOKER — the payments policies still decide. Never gates (ADR-038).';

GRANT EXECUTE ON FUNCTION public.allocate_payment(UUID, NUMERIC, TEXT, JSONB, TEXT, TEXT) TO authenticated;

-- === MIGRATION END ===
