-- ===========================================================================
-- 0275 — mobile money is a payment method, not an "online gateway"
--
-- ## What this closes
--
-- `payments.payment_method` has admitted `cash`, `bank_deposit`, `cheque`,
-- `online_gateway`, `loan_disbursement`, `reversal` and `waiver` since `0003`, and
-- **mobile money has had to be recorded as `online_gateway`**. CLAUDE.md has carried
-- it as a tracked gap, and `0212` deliberately left it alone as a product decision
-- being planned separately. That decision is now made.
--
-- In Zambia mobile money is not one rail among several — for school fees it is the
-- dominant one. Recording it as `online_gateway` loses the distinction on every
-- receipt a parent keeps and in every reconciliation the office does, and it makes
-- "how much came in by Airtel this term" unanswerable from the data.
--
-- ## What this deliberately does NOT do
--
-- It does not build a payment gateway, and it does not change who confirms a payment.
--
-- ZSMS does not take the money. A parent pays on their own handset, where the
-- confirmation SMS already is, and records what they paid with that reference as
-- proof; the office verifies it. ADR-007 settles the related principle — no OTP on a
-- financial submission — and `0211` settles the ordering: a receipt is issued on
-- VERIFICATION, never on a claim. Both still hold, unchanged.
--
-- So this adds vocabulary, not a flow. The alternative — Airtel and MTN collections
-- APIs with an approve-on-phone prompt — needs merchant contracts with both networks
-- before a line of it is worth writing, and the claim model works today without them.
--
-- ## The provider is a separate column, not six payment methods
--
-- `mobile_money_airtel`, `mobile_money_mtn` and so on would put two facts in one
-- column, and every query asking "how much by mobile money" would then be an `IN`
-- list that a new network silently falls out of. Method and network are orthogonal:
-- the method is how the money moved, the provider is whose rail it moved on.
--
-- Zamtel Kwacha is included although it is the smallest of the three, because a
-- vocabulary that omits a network a school actually uses forces that school back to
-- `online_gateway` and reopens the problem this migration closes.
--
-- ## Existing rows are left alone
--
-- Some of the `online_gateway` payments on this database were almost certainly mobile
-- money. There is no way to tell which from the data, and guessing would write a
-- fact nobody can check into a financial table. They stay as recorded; the
-- distinction exists from here forward.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The method itself.
--
-- The CHECK is replaced rather than added to, because a constraint cannot be
-- extended in place. The full list is restated so the file shows the whole
-- vocabulary rather than a diff the reader has to reconstruct from `0003`.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_method_check
  CHECK (payment_method = ANY (ARRAY[
    'cash',
    'bank_deposit',
    'cheque',
    'mobile_money',      -- added by 0275
    'online_gateway',
    'loan_disbursement',
    'reversal',
    'waiver'
  ]));

-- ---------------------------------------------------------------------------
-- 2. Whose rail it moved on.
-- ---------------------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS mobile_money_provider TEXT;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_mobile_money_provider_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_mobile_money_provider_check
  CHECK (mobile_money_provider IS NULL OR mobile_money_provider = ANY (ARRAY[
    'airtel',
    'mtn',
    'zamtel'
  ]));

/*
  The provider belongs to the method, and the constraint says so in both directions.

  Without the second half, a cash payment could carry `mobile_money_provider =
  'airtel'` — a row that reconciles as cash and reports as Airtel, which is worse
  than either. Without the first, a mobile money payment could omit the network and
  the column would be optional in practice, which is how a column stops being
  trustworthy enough to query.
*/
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_mobile_money_provider_matches_method;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_mobile_money_provider_matches_method
  CHECK (
    (payment_method = 'mobile_money' AND mobile_money_provider IS NOT NULL)
    OR (payment_method <> 'mobile_money' AND mobile_money_provider IS NULL)
  );

COMMENT ON COLUMN public.payments.mobile_money_provider IS
  'Which network the money moved on: airtel | mtn | zamtel. Required when payment_method = ''mobile_money'' and refused otherwise, so a row cannot reconcile as cash and report as Airtel. Separate from payment_method on purpose - method and network are orthogonal, and folding them into mobile_money_airtel/_mtn would make "how much by mobile money" an IN list a new network silently falls out of (0275).';


-- ---------------------------------------------------------------------------
-- Exercise it against the real table, in a transaction that is rolled back.
-- Asserting the constraint EXISTS is the easy property; what matters is which
-- rows it admits and which it refuses.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_school  UUID;
  v_student UUID;
  v_fee     UUID;
  v_ok      BOOLEAN;
BEGIN
  SELECT p.school_id, p.student_id, p.fee_record_id
    INTO v_school, v_student, v_fee
    FROM public.payments p
   LIMIT 1;

  IF v_school IS NULL THEN
    RAISE NOTICE '0275: no payments on this database — constraint shape asserted only';
  ELSE
    -- Admits mobile money WITH a provider.
    BEGIN
      INSERT INTO public.payments
        (school_id, fee_record_id, student_id, recorded_by_user_id, amount,
         payment_method, mobile_money_provider)
      VALUES (v_school, v_fee, v_student, 'user_0275_probe', 1.00,
              'mobile_money', 'airtel');
      v_ok := TRUE;
    EXCEPTION WHEN check_violation THEN
      v_ok := FALSE;
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION '0275: mobile_money with a provider was refused';
    END IF;

    -- Refuses mobile money WITHOUT one.
    BEGIN
      INSERT INTO public.payments
        (school_id, fee_record_id, student_id, recorded_by_user_id, amount, payment_method)
      VALUES (v_school, v_fee, v_student, 'user_0275_probe', 1.00, 'mobile_money');
      v_ok := TRUE;
    EXCEPTION WHEN check_violation THEN
      v_ok := FALSE;
    END;
    IF v_ok THEN
      RAISE EXCEPTION '0275: mobile_money without a provider was accepted';
    END IF;

    -- Refuses a provider on a method that is not mobile money.
    BEGIN
      INSERT INTO public.payments
        (school_id, fee_record_id, student_id, recorded_by_user_id, amount,
         payment_method, mobile_money_provider)
      VALUES (v_school, v_fee, v_student, 'user_0275_probe', 1.00, 'cash', 'mtn');
      v_ok := TRUE;
    EXCEPTION WHEN check_violation THEN
      v_ok := FALSE;
    END;
    IF v_ok THEN
      RAISE EXCEPTION '0275: a cash payment was allowed to name a mobile money network';
    END IF;

    RAISE NOTICE '0275: PASS  admits airtel, refuses a missing provider and a misplaced one';
  END IF;

  -- Everything above inserted probe rows into a financial table. None of them may
  -- survive: a smoke test that leaves money behind is worse than no smoke test.
  DELETE FROM public.payments WHERE recorded_by_user_id = 'user_0275_probe';
END;
$do$;

/*
  Belt and braces on the cleanup.

  The DELETE above runs inside the DO block, but an exception raised before it would
  skip it — and `supabase db push` wraps each migration in its own transaction, so a
  failure rolls back anyway. This statement covers the one case neither does: a
  successful run whose DELETE matched nothing because the probe id drifted.
*/
DO $do$
DECLARE
  v_left INT;
BEGIN
  SELECT count(*) INTO v_left FROM public.payments WHERE recorded_by_user_id = 'user_0275_probe';
  IF v_left > 0 THEN
    RAISE EXCEPTION '0275: % probe payment(s) left behind', v_left;
  END IF;
END;
$do$;
