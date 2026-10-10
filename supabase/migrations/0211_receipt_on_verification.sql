-- ===========================================================================
-- 0211 — a receipt is issued when a payment is VERIFIED, not when it is claimed
--
-- `RECEIPTS.md` is explicit, and the schema has never matched it:
--
--   > A receipt is generated when a payment is verified — not when it is
--   > submitted. This distinction is important: the parent's submission
--   > acknowledgement reference (`PAY-ZM-LSK-0001-XXXXXX`) confirms the school
--   > received their submission. The formal receipt (`REC-ZM-LSK-0001-000001`)
--   > confirms the school has ACCEPTED and verified the payment. The receipt is
--   > the school's official financial document.
--
-- `assign_receipt_number_on_payments` fires BEFORE INSERT, so every payment got
-- a `REC-` number the instant it was claimed. Found on 2026-10-06 while building
-- the parent claim flow: **5 of the 312 payments on dev are
-- `pending_verification` and all 5 hold receipt numbers.**
--
-- What that means in practice: a parent submits a claim, is handed a formal
-- receipt number, screenshots it — and the school then rejects the payment. The
-- school's official financial document was issued for money it never received.
--
-- ## Two identifiers, two moments
--
-- * `submission_reference` — `PAY-<school>-NNNNNN`, on INSERT. "We have your
--   claim." Trackable immediately, which is the whole point of the parent having
--   a reference before verification.
-- * `receipt_number` — `REC-<school>-NNNNNN`, on the transition to `verified`.
--   "We accepted it."
--
-- ## `receipt_number` becomes nullable, and that is the point
--
-- It was NOT NULL, which is what forced the insert-time assignment. A claim
-- awaiting a decision genuinely has no receipt, and NULL is the honest
-- representation of that. A CHECK keeps the invariant that matters: a VERIFIED
-- payment must have one.
--
-- ## The five existing rows are corrected
--
-- Their receipt numbers are moved aside and nulled. Those numbers then become
-- available again to the next genuinely-verified payment, which is correct —
-- they were never validly issued, and the sequence takes MAX+1 so gaps and
-- reuse are both tolerated. On staging and production this runs before any real
-- payment exists.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The submission reference.
-- ---------------------------------------------------------------------------

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS submission_reference TEXT;

/*
  Nullable, deliberately.

  The 307 payments already verified were never given one and inventing
  references for them would fabricate a history. New rows always get one from
  the trigger below.
*/
COMMENT ON COLUMN public.payments.submission_reference IS
  'PAY-<school>-NNNNNN, assigned on INSERT. Acknowledges a claim was received; it is NOT a receipt. NULL on rows predating 0211.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_submission_reference
  ON public.payments (submission_reference)
  WHERE submission_reference IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. A receipt is no longer mandatory at insert time.
-- ---------------------------------------------------------------------------

ALTER TABLE public.payments
  ALTER COLUMN receipt_number DROP NOT NULL;

COMMENT ON COLUMN public.payments.receipt_number IS
  'REC-<school>-NNNNNN, assigned when the payment is VERIFIED (0211). NULL while a claim is pending or after rejection — the school has issued no document.';

-- ---------------------------------------------------------------------------
-- 3. Correct the rows that hold a receipt they were never owed.
-- ---------------------------------------------------------------------------

/*
  Their old `REC-` number is not kept as the submission reference — the two are
  different sequences and reusing the digits would imply a correspondence that
  does not exist. A fresh `PAY-` reference is generated from the row's position.
*/
DO $$
DECLARE
  v_row   RECORD;
  v_next  BIGINT;
  v_code  TEXT;
BEGIN
  FOR v_row IN
    SELECT p.id, p.school_id
    FROM public.payments p
    WHERE p.status <> 'verified' AND p.receipt_number IS NOT NULL
    ORDER BY p.created_at
  LOOP
    SELECT s.school_id INTO v_code
    FROM public.schools s WHERE s.id = v_row.school_id;

    SELECT COALESCE(
             MAX(NULLIF(regexp_replace(p.submission_reference, '^.*-', ''), '')::BIGINT),
             0) + 1
    INTO v_next
    FROM public.payments p
    WHERE p.school_id = v_row.school_id;

    UPDATE public.payments
    SET submission_reference = 'PAY-' || v_code || '-' || lpad(v_next::TEXT, 6, '0'),
        receipt_number       = NULL
    WHERE id = v_row.id;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The invariant that actually matters.
-- ---------------------------------------------------------------------------

/*
  NOT VALID, then validated separately.

  The existing 307 verified rows all have a receipt number — checked before
  writing this — so validation succeeds. Splitting it means a future row that
  violates it is refused immediately while the one-off scan over history is a
  separate, interruptible step.
*/
ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_verified_has_receipt;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_verified_has_receipt
  CHECK (status <> 'verified' OR receipt_number IS NOT NULL) NOT VALID;

ALTER TABLE public.payments
  VALIDATE CONSTRAINT payments_verified_has_receipt;

-- ---------------------------------------------------------------------------
-- 5. Assigning each identifier at its own moment.
-- ---------------------------------------------------------------------------

/*
  Replaces `assign_receipt_number()`, which assigned the receipt on INSERT.

  Kept as one function over two triggers rather than two functions, because the
  school-row lock and the sequence computation are identical and the only
  difference is which column is being filled.
*/
CREATE OR REPLACE FUNCTION public.assign_payment_references()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code TEXT;
  v_next BIGINT;
BEGIN
  /*
    Lock the school row so concurrent payments serialise on it.

    Without this two cashiers taking money at once compute the same sequence.
    Carried over from `assign_receipt_number()`, where it was already right.
  */
  SELECT s.school_id INTO v_code
  FROM public.schools s
  WHERE s.id = NEW.school_id
  FOR UPDATE;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Unknown school % for payment', NEW.school_id;
  END IF;

  -- A submission reference on every new row, whatever its status.
  IF TG_OP = 'INSERT'
     AND (NEW.submission_reference IS NULL OR NEW.submission_reference = '') THEN
    SELECT COALESCE(
             MAX(NULLIF(regexp_replace(p.submission_reference, '^.*-', ''), '')::BIGINT),
             0) + 1
    INTO v_next
    FROM public.payments p
    WHERE p.school_id = NEW.school_id;

    NEW.submission_reference := 'PAY-' || v_code || '-' || lpad(v_next::TEXT, 6, '0');
  END IF;

  /*
    A receipt only once the payment is verified.

    On INSERT this covers an accountant recording an already-verified payment
    directly — path 3 in `PAYMENTS.md`. On UPDATE it covers the verification
    queue, which is the ordinary route.
  */
  IF NEW.status = 'verified'
     AND (NEW.receipt_number IS NULL OR NEW.receipt_number = '') THEN
    SELECT COALESCE(
             MAX(NULLIF(regexp_replace(p.receipt_number, '^.*-', ''), '')::BIGINT),
             0) + 1
    INTO v_next
    FROM public.payments p
    WHERE p.school_id = NEW.school_id;

    NEW.receipt_number := 'REC-' || v_code || '-' || lpad(v_next::TEXT, 6, '0');
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.assign_payment_references() IS
  'Assigns PAY- on insert and REC- on verification. Replaces assign_receipt_number(), which issued a receipt for an unverified claim (0211).';

DROP TRIGGER IF EXISTS assign_receipt_number_on_payments ON public.payments;
DROP TRIGGER IF EXISTS assign_payment_references_on_insert_on_payments ON public.payments;
DROP TRIGGER IF EXISTS assign_payment_references_on_update_on_payments ON public.payments;

/*
  BEFORE, because both triggers SET a column on NEW — an AFTER trigger cannot.

  Named `a_assign_...` so they sort before `recalculate_balance_on_payments`:
  two triggers on one table fire in NAME order, and the balance recalculation
  must not run against a row whose identifiers are still being decided.
*/
CREATE TRIGGER a_assign_payment_references_on_insert_on_payments
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.assign_payment_references();

CREATE TRIGGER a_assign_payment_references_on_update_on_payments
  BEFORE UPDATE OF status ON public.payments
  FOR EACH ROW
  WHEN (NEW.status = 'verified' AND OLD.status <> 'verified')
  EXECUTE FUNCTION public.assign_payment_references();

-- ---------------------------------------------------------------------------
-- 6. Prove it, by writing rather than by reading.
-- ---------------------------------------------------------------------------

/*
  `0173` attached an audit trigger and asserted the trigger was ATTACHED. It was,
  and every write through it then failed. Attachment is not the property that
  matters; surviving a write is.

  So: insert a claim, check it has a PAY- and no REC-, verify it, check it gains
  a REC-, then roll the whole thing back.
*/
DO $$
DECLARE
  v_school  UUID;
  v_student UUID;
  v_fee     UUID;
  v_pay     UUID;
  v_sub     TEXT;
  v_rec     TEXT;
BEGIN
  SELECT fr.school_id, fr.student_id, fr.id
  INTO v_school, v_student, v_fee
  FROM public.fee_records fr
  -- `fee_records` has no `balance` column — outstanding is derived from
  -- amount_due, amount_paid and discount_amount. Assumed otherwise on the first
  -- attempt at this migration and it failed on 42703, which is exactly what
  -- `npm run db:cols` exists to prevent.
  WHERE fr.amount_due > fr.amount_paid + fr.discount_amount
  LIMIT 1;

  IF v_fee IS NULL THEN
    RAISE NOTICE '0211: no outstanding fee record to exercise against; skipping the write test';
    RETURN;
  END IF;

  INSERT INTO public.payments
    (school_id, student_id, fee_record_id, recorded_by_user_id, amount,
     payment_method, status)
  VALUES
    (v_school, v_student, v_fee, 'user_0211_probe', 1.00, 'cash',
     'pending_verification')
  RETURNING id, submission_reference, receipt_number
  INTO v_pay, v_sub, v_rec;

  IF v_sub IS NULL OR v_sub NOT LIKE 'PAY-%' THEN
    RAISE EXCEPTION '0211: a new claim got no PAY- reference (got %)', v_sub;
  END IF;

  IF v_rec IS NOT NULL THEN
    RAISE EXCEPTION '0211: an unverified claim was issued receipt % — the defect is still present', v_rec;
  END IF;

  UPDATE public.payments
  SET status = 'verified', verified_by = 'user_0211_probe', verified_at = NOW()
  WHERE id = v_pay
  RETURNING receipt_number INTO v_rec;

  IF v_rec IS NULL OR v_rec NOT LIKE 'REC-%' THEN
    RAISE EXCEPTION '0211: verification did not issue a receipt (got %)', v_rec;
  END IF;

  -- Undo the probe. `payments` allows no hard delete in application code, but
  -- this row has existed only inside this statement and must not survive it.
  DELETE FROM public.payments WHERE id = v_pay;

  RAISE NOTICE '0211: verified — claim got %, verification issued %', v_sub, v_rec;
END;
$$;

-- No pending payment may still hold a receipt.
DO $$
DECLARE v_n INT;
BEGIN
  SELECT COUNT(*) INTO v_n
  FROM public.payments
  WHERE status <> 'verified' AND receipt_number IS NOT NULL;

  IF v_n > 0 THEN
    RAISE EXCEPTION '0211: % unverified payment(s) still hold a receipt number', v_n;
  END IF;
END;
$$;
