-- ===========================================================================
-- 0232 — allocate_payment selected a column that does not exist
--
-- Spec: `09 Fees and Payments/PAYMENTS.md`
--
-- ## What 0213 broke, and what it cost
--
-- `0213` rewrote `allocate_payment()` and, in the branch that runs when the caller
-- supplies no explicit allocations, selected `s.allocate` from
-- `suggest_payment_allocation()`. That function returns `suggested`. There is no
-- column named `allocate` and there never was.
--
-- plpgsql resolves column names at RUN time, so the migration applied cleanly and
-- the function failed on its first call. `0214` then carried the same two lines
-- forward while fixing a different fault, so the error survived two migrations.
--
-- **This is the accountant's main path.** `POST /api/payments` and the parent
-- payment claim both call `allocate_payment(student, amount, method)` with no
-- allocations — meaning "work out what this money pays off, oldest first". Every
-- such call has raised 42703 since 0213. Only the explicit-allocation branch
-- worked, and that is precisely the one the original verification exercised.
--
-- CI found it, as it was built to. `fee_payment_flow_test` failed 13 of 13 and
-- `fee_arrears_test` 15 of 38, both reporting `column s.allocate does not exist`,
-- and the red branch went unread for about twenty commits.
--
-- ## Why this file is a mechanical edit
--
-- The body below is `pg_get_functiondef()` as the database holds it today, with
-- `s.allocate` changed to `s.suggested` and nothing else touched. 0213's own
-- mistake was rebuilding this function from 0078 and silently discarding 0080's
-- ambiguity fix. Extending what currently stands is how that is not repeated.
--
-- Grants are deliberately not reasserted: CREATE OR REPLACE keeps them, and
-- restating them is how a REVOKE made elsewhere gets quietly undone.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.allocate_payment(p_student_id uuid, p_amount numeric, p_payment_method text, p_allocations jsonb DEFAULT NULL::jsonb, p_notes text DEFAULT NULL::text, p_proof_url text DEFAULT NULL::text, p_confirmation_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_transaction_reference text DEFAULT NULL::text)
 RETURNS TABLE(out_payment_id uuid, out_fee_record_id uuid, out_amount numeric, out_receipt_number text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    SELECT s.fee_record_id, s.suggested
    FROM public.suggest_payment_allocation(p_student_id, p_amount) s
    WHERE s.suggested > 0;
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

  IF EXISTS (SELECT 1 FROM _alloc a WHERE a.amount IS NULL OR a.amount <= 0) THEN
    RAISE EXCEPTION 'Allocation amounts must be greater than zero' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(a.amount), 0) INTO v_allocated FROM _alloc a;

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

    UPDATE _alloc a SET amount = a.amount + v_remainder
    WHERE a.fee_record_id = v_newest
      AND (SELECT count(*) FROM _alloc b WHERE b.fee_record_id = v_newest) = 1
      AND a.amount <> v_remainder;
  END IF;

  FOR v_alloc IN SELECT a.fee_record_id, a.amount FROM _alloc a LOOP
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
    RETURNING payments.id, payments.fee_record_id, payments.amount, payments.receipt_number;
  END LOOP;
END;
$function$;


-- ---------------------------------------------------------------------------
-- Exercise the branch that was broken, not the one that worked.
-- ---------------------------------------------------------------------------

DO $ZSMS0232$
DECLARE
  v_student UUID;
  v_paid    UUID;
BEGIN
  BEGIN
    /*
      A pupil who genuinely owes something.

      The first attempt took any fee record whose status was not 'paid', and got
      one with nothing outstanding — so the probe failed on "Nothing outstanding
      to allocate against", which is the function working correctly. The status
      column is not the same question as the arithmetic.
    */
    SELECT fr.student_id INTO v_student
    FROM public.fee_records fr
    WHERE COALESCE(fr.is_deleted, FALSE) = FALSE
      AND (fr.amount_due - fr.amount_paid - COALESCE(fr.discount_amount, 0)) > 25.00
    LIMIT 1;

    IF v_student IS NULL THEN
      RAISE NOTICE '0232: no fee record with an outstanding balance; skipping';
      RAISE EXCEPTION 'ZSMS_0232_ROLLBACK';
    END IF;

    /*
      A session, because `allocate_payment` stamps `recorded_by_user_id` from
      `get_user_id()` and that column is NOT NULL. The second attempt here failed
      on exactly that — which is the function being right and the probe having no
      caller.

      Only the claim is set, not `SET LOCAL ROLE authenticated`: switching role
      inside `db push` fails with "permission denied for schema auth". RLS is
      bypassed either way at this privilege level, and the tenant rules are what
      the pgTAP suites exist to check.
    */
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'migration_0232', 'role', 'authenticated')::text, TRUE);

    -- NULL allocations: the path that has raised 42703 on every call since 0213.
    SELECT out_payment_id INTO v_paid
    FROM public.allocate_payment(v_student, 25.00, 'cash') LIMIT 1;

    IF v_paid IS NULL THEN
      RAISE EXCEPTION '0232: allocate_payment returned no payment id';
    END IF;

    RAISE EXCEPTION 'ZSMS_0232_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0232_ROLLBACK' THEN
        RAISE NOTICE '0232: verified — a payment allocates with no explicit allocations';
      ELSE
        RAISE;
      END IF;
  END;
END;
$ZSMS0232$;
