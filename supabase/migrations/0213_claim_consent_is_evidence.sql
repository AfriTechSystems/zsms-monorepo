-- ===========================================================================
-- 0213 — the confirmation checkbox is evidence, so stop manufacturing it
--
-- `allocate_payment()` (`0078`) writes `confirmation_checkbox_at = NOW()` on
-- every row it creates, unconditionally. That column exists to record that **a
-- person ticked a box**, and `PAYMENTS.md` is specific about why:
--
--   > `confirmation_checkbox_at` is required on all parent-submitted payments.
--   > Validated server-side — missing value returns 400 `MISSING_CONFIRMATION`.
--   > ... confirmation_checkbox_at is within the last 10 minutes (freshness
--   > check)
--
-- The checkbox carries a declaration — "I confirm that this payment has been
-- made and the information provided is accurate. I understand that false
-- submissions may result in account suspension." Writing `NOW()` on the server
-- means that declaration is recorded as having been made whether or not anybody
-- made it, including on an accountant-recorded payment where no parent was
-- present at all.
--
-- Evidence a system fabricates is not evidence. If a school ever has to show
-- that a parent accepted those terms, this column was going to say yes for
-- every row ever written.
--
-- ## What changes
--
-- `p_confirmation_at` is now passed in, and **NULL is stored as NULL.** A path
-- where nobody ticked anything records nothing, which is the honest answer. A
-- supplied timestamp is checked for freshness and refused if it is stale or in
-- the future.
--
-- `p_transaction_reference` arrives at the same time: `0212` added the column,
-- and the parent route had been folding the reference into `notes` as free text
-- so the duplicate detection `PAYMENTS.md` specifies could not be written.
--
-- ## Why the signature changes rather than gaining an overload
--
-- Two PostgREST-visible overloads differing only by defaulted arguments make
-- PostgREST raise `PGRST203` — "could not choose the best candidate function" —
-- rather than pick one. That has bitten this schema before, so the old function
-- is DROPPED and replaced. Its single caller
-- (`/api/school/fees/[studentId]`) is updated in the same commit.
-- ===========================================================================

-- A signature change, not a replacement: CREATE OR REPLACE cannot alter the
-- argument list, and leaving both would be the PGRST203 trap.
DROP FUNCTION IF EXISTS public.allocate_payment(UUID, NUMERIC, TEXT, JSONB, TEXT, TEXT);

CREATE FUNCTION public.allocate_payment(
  p_student_id     UUID,
  p_amount         NUMERIC(12,2),
  p_payment_method TEXT,
  p_allocations    JSONB       DEFAULT NULL,
  p_notes          TEXT        DEFAULT NULL,
  p_proof_url      TEXT        DEFAULT NULL,
  /*
    When the person actually ticked the confirmation box.

    NULL for a path where nobody did — an accountant recording cash over the
    counter. Stored as NULL rather than as NOW(), because a fabricated consent
    timestamp is worse than an absent one.
  */
  p_confirmation_at TIMESTAMPTZ DEFAULT NULL,
  /** What the payer typed: a mobile money confirmation number, a bank slip. */
  p_transaction_reference TEXT  DEFAULT NULL
)
RETURNS TABLE (
  payment_id     UUID,
  fee_record_id  UUID,
  amount         NUMERIC(12,2),
  receipt_number TEXT
)
LANGUAGE plpgsql
SET search_path = public, pg_temp
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

  /*
    Freshness, per `PAYMENTS.md`.

    A stale timestamp means the form was left open — possibly on a shared school
    office machine — and the person submitting may not be the person who ticked.
    Refused rather than silently refreshed.

    The future case is checked separately because a clock-skewed client sending
    tomorrow's time would otherwise pass a "within 10 minutes" test.
  */
  IF p_confirmation_at IS NOT NULL THEN
    IF p_confirmation_at > NOW() + INTERVAL '1 minute' THEN
      RAISE EXCEPTION 'The confirmation timestamp is in the future'
        USING ERRCODE = '22023';
    END IF;

    IF p_confirmation_at < NOW() - INTERVAL '10 minutes' THEN
      RAISE EXCEPTION 'That confirmation has expired. Tick the box again and resubmit.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _alloc(
    fee_record_id UUID,
    amount        NUMERIC(12,2)
  ) ON COMMIT DROP;
  DELETE FROM _alloc;

  IF p_allocations IS NULL THEN
    -- Oldest first, which is arrears first. `suggest_payment_allocation()`
    -- orders by due date then year then term.
    INSERT INTO _alloc(fee_record_id, amount)
    SELECT s.fee_record_id, s.allocate
    FROM public.suggest_payment_allocation(p_student_id, p_amount) s
    WHERE s.allocate > 0;
  ELSE
    INSERT INTO _alloc(fee_record_id, amount)
    SELECT (x ->> 'fee_record_id')::UUID, (x ->> 'amount')::NUMERIC(12,2)
    FROM jsonb_array_elements(p_allocations) x;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM _alloc) THEN
    RAISE EXCEPTION 'Nothing outstanding to allocate against for this student'
      USING ERRCODE = '22023';
  END IF;

  -- Every target must belong to this pupil. Without this an allocation could
  -- name another family's fee record and move their balance.
  IF EXISTS (
    SELECT 1 FROM _alloc a
    LEFT JOIN public.fee_records fr ON fr.id = a.fee_record_id
    WHERE fr.id IS NULL OR fr.student_id <> p_student_id
  ) THEN
    RAISE EXCEPTION 'An allocation targets a fee record that does not belong to this student'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM _alloc WHERE amount IS NULL OR amount <= 0) THEN
    RAISE EXCEPTION 'Allocation amounts must be greater than zero' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_allocated FROM _alloc;

  IF v_allocated > p_amount THEN
    RAISE EXCEPTION 'Allocations total % which exceeds the payment of %', v_allocated, p_amount
      USING ERRCODE = '22023';
  END IF;

  /*
    An unallocated remainder goes on the NEWEST record.

    A parent who pays more than they owe has credit, and the newest term is
    where it belongs — crediting an old settled term would make a closed period
    move.
  */
  v_remainder := p_amount - v_allocated;

  IF v_remainder > 0 THEN
    SELECT fr.id INTO v_newest
    FROM public.fee_records fr
    WHERE fr.student_id = p_student_id
    ORDER BY fr.academic_year DESC, fr.term_number DESC, fr.created_at DESC
    LIMIT 1;

    IF v_newest IS NULL THEN
      RAISE EXCEPTION 'Cannot place the unallocated remainder of %; no fee record found', v_remainder
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO _alloc(fee_record_id, amount)
    VALUES (v_newest, v_remainder)
    ON CONFLICT DO NOTHING;

    UPDATE _alloc SET amount = amount + v_remainder
    WHERE fee_record_id = v_newest
      AND (SELECT count(*) FROM _alloc WHERE fee_record_id = v_newest) = 1
      AND amount <> v_remainder;
  END IF;

  FOR v_alloc IN SELECT * FROM _alloc LOOP
    SELECT fr.school_id INTO v_school
    FROM public.fee_records fr WHERE fr.id = v_alloc.fee_record_id;

    /*
      The INSERT is RLS-checked. A caller without an applicable payments INSERT
      policy is refused here, exactly as a direct insert would be — which is why
      this function is SECURITY INVOKER and must stay that way.
    */
    RETURN QUERY
    INSERT INTO public.payments (
      school_id, fee_record_id, student_id, recorded_by_user_id, amount,
      payment_method, status, confirmation_checkbox_at, notes,
      proof_of_payment_url, transaction_reference
    )
    VALUES (
      v_school, v_alloc.fee_record_id, p_student_id, v_actor, v_alloc.amount,
      p_payment_method, 'pending_verification',
      -- Passed through, NOT NOW(). See the header.
      p_confirmation_at,
      p_notes, p_proof_url, p_transaction_reference
    )
    RETURNING id, fee_record_id, amount, receipt_number;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.allocate_payment(UUID, NUMERIC, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TEXT) IS
  'Splits one lump sum into per-record pending payments. Oldest-first (arrears first) by default, overridable per fee record. The confirmation timestamp is passed in and stored as given — never manufactured (0213). SECURITY INVOKER: the payments policies still decide.';

REVOKE ALL ON FUNCTION public.allocate_payment(UUID, NUMERIC, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.allocate_payment(UUID, NUMERIC, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.allocate_payment(UUID, NUMERIC, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Duplicate detection, which `PAYMENTS.md` specifies and nothing could do.
-- ---------------------------------------------------------------------------

/*
  A WARNING, not a refusal.

  `PAYMENTS.md`: "If the parent sees this error but believes their new payment is
  different, they can proceed... The duplicate warning is in the UI — the submit
  button still works after the parent acknowledges." So this answers a question
  and takes no action.

  SECURITY INVOKER: a parent asking about their own child's payments is filtered
  by the same policies as the fee page.
*/
CREATE OR REPLACE FUNCTION public.payment_reference_already_used(
  p_student_id UUID,
  p_reference  TEXT
)
RETURNS TABLE (
  out_payment_id  UUID,
  out_amount      NUMERIC(12,2),
  out_status      TEXT,
  out_submitted   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.amount, p.status, p.created_at
  FROM public.payments p
  WHERE p.student_id = p_student_id
    AND p_reference IS NOT NULL
    AND btrim(p_reference) <> ''
    -- Case-folded and trimmed: a parent retyping a reference will not match the
    -- first one's capitalisation, and "already used" has to notice that.
    AND lower(btrim(p.transaction_reference)) = lower(btrim(p_reference))
    AND p.is_voided = FALSE
  ORDER BY p.created_at DESC
  LIMIT 5;
$$;

REVOKE ALL ON FUNCTION public.payment_reference_already_used(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.payment_reference_already_used(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.payment_reference_already_used(UUID, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Prove the behaviour that changed.
-- ---------------------------------------------------------------------------

DO $$
DECLARE v_n INT;
BEGIN
  -- Exactly one `allocate_payment`, or PostgREST raises PGRST203 instead of
  -- choosing.
  SELECT COUNT(*) INTO v_n
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'allocate_payment';

  IF v_n <> 1 THEN
    RAISE EXCEPTION '0213: % allocate_payment overloads — PostgREST cannot choose', v_n;
  END IF;

  IF has_function_privilege('anon',
      'public.allocate_payment(UUID, NUMERIC, TEXT, JSONB, TEXT, TEXT, TIMESTAMPTZ, TEXT)',
      'EXECUTE') THEN
    RAISE EXCEPTION '0213: anon can execute allocate_payment';
  END IF;

  IF has_function_privilege('anon',
      'public.payment_reference_already_used(UUID, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION '0213: anon can execute payment_reference_already_used';
  END IF;
END;
$$;
