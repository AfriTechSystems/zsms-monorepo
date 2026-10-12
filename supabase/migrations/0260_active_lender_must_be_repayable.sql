-- ===========================================================================
-- 0260 — an active lender must be repayable
--
-- Spec: `14 Loan and Finance Module/REPAYMENT.md` → *Phase 1*,
--       `14 Loan and Finance Module/LENDER_INTEGRATION.md` → *collection_account*
--
-- ## What this found
--
-- REPAYMENT.md is unambiguous about Phase 1: **ZSMS does not process
-- repayments.** The parent repays the lender directly, and ZSMS's entire job is
-- "surfacing the lender's collection details prominently".
--
-- The one seeded lender is active and has `collection_account = NULL`, with
-- `collection_instructions` set to the literal string `'Airtel Money'`. So a
-- parent whose loan was disbursed would be shown "How to repay: Airtel Money"
-- and nothing else — no number, no account, no reference. They have a debt, a
-- channel name, and no way to pay it.
--
-- That is worse than an empty screen, because it reads as an answer.
--
-- ## Why a CHECK rather than a warning
--
-- The alternative was an admin-facing notice. But an active lender is one ZSMS
-- **offers to parents** — `anyone_reads_active_lenders` exposes it, and
-- `lenders_for_application()` recommends it. Offering a loan nobody can repay is
-- not a data-quality blemish to flag on a dashboard; it is a thing the product
-- should be unable to do.
--
-- `is_active` is the switch that makes a lender visible, so that is where the
-- condition belongs. An incomplete lender can still be created and edited — it
-- just cannot be shown to a parent until somebody fills in where the money goes.
--
-- ## The seeded lender is deactivated, not invented
--
-- Lupiya is a real company. Writing a plausible-looking Airtel number into their
-- row would put fabricated payment details in front of a parent about to send
-- money — the single most harmful thing a seed could do in this module. So the
-- row is deactivated with a note, and whoever onboards them supplies the real
-- details from the real agreement.
--
-- The dev consequence is that `lenders_for_application()` returns nothing until
-- that happens. That is the correct state: there is no lender ZSMS can honestly
-- offer yet.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Stand down any active lender a parent could not actually repay.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_row RECORD;
  v_n   INT := 0;
BEGIN
  FOR v_row IN
    SELECT id, lender_name
    FROM public.lenders
    WHERE is_active
      AND (
        collection_account IS NULL
        OR collection_account = '{}'::JSONB
        -- At least one route for the money. A channel name on its own is not one.
        OR NOT (
          (collection_account ? 'mobile_money')
          OR (collection_account ? 'paybill')
          OR (collection_account ? 'account_number')
        )
      )
  LOOP
    UPDATE public.lenders SET is_active = FALSE WHERE id = v_row.id;
    v_n := v_n + 1;
    RAISE NOTICE
      '0260: deactivated % — no collection_account, so a parent could not repay a loan from them',
      v_row.lender_name;
  END LOOP;

  IF v_n > 0 THEN
    RAISE NOTICE
      '0260: % lender(s) stood down. Populate collection_account from the real agreement and reactivate — do NOT invent payment details.',
      v_n;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The constraint.
-- ---------------------------------------------------------------------------

ALTER TABLE public.lenders
  DROP CONSTRAINT IF EXISTS active_lender_must_be_repayable;

ALTER TABLE public.lenders
  ADD CONSTRAINT active_lender_must_be_repayable CHECK (
    NOT is_active
    OR (
      collection_account IS NOT NULL
      AND (
        (collection_account ? 'mobile_money')
        OR (collection_account ? 'paybill')
        OR (collection_account ? 'account_number')
      )
    )
  );

COMMENT ON CONSTRAINT active_lender_must_be_repayable ON public.lenders IS
  'A lender ZSMS offers to parents must say where repayments go. Phase 1 (REPAYMENT.md) is entirely "show the collection details", so an active lender without them hands a parent a debt and no way to pay it (0260).';

-- ---------------------------------------------------------------------------
-- 3. Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_id    UUID;
  v_count INT;
BEGIN
  BEGIN
    -- A lender with no collection details may exist, but not as active.
    /*
      Every NOT NULL column without a default, read from `db:cols` rather than
      discovered one failed push at a time — which is how the first two runs of
      this probe went (`max_loan_amount`, then `interest_rate_display`).

      `intake_email` is required by an existing CHECK whenever
      `integration_type = 'email'`, which is the sort of conditional requirement a
      column listing shows and a guess does not.
    */
    INSERT INTO public.lenders
      (lender_name, display_name, country_codes, integration_type, intake_email,
       max_loan_amount, interest_rate_display, turnaround_label, commission_rate,
       onboarded_by, is_active)
    VALUES ('probe_0260', 'Probe Lender', ARRAY['ZM'], 'email',
            'probe@example.invalid', 10000.00, '0% (probe)', 'Same day', 0.00,
            'migration_0260', FALSE)
    RETURNING id INTO v_id;

    -- Activating it without collection details must be refused.
    BEGIN
      UPDATE public.lenders SET is_active = TRUE WHERE id = v_id;
      RAISE EXCEPTION
        '0260: a lender with nowhere to send repayments was offered to parents';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- With a mobile money number it activates.
    UPDATE public.lenders
    SET collection_account = jsonb_build_object(
          'mobile_money', '+260977000260', 'network', 'Airtel'),
        is_active = TRUE
    WHERE id = v_id;

    IF NOT EXISTS (SELECT 1 FROM public.lenders WHERE id = v_id AND is_active) THEN
      RAISE EXCEPTION '0260: a repayable lender could not be activated';
    END IF;

    -- A bank account alone is also sufficient: not every lender takes mobile money.
    UPDATE public.lenders
    SET collection_account = jsonb_build_object(
          'bank_name', 'A Bank', 'account_number', '000000000260')
    WHERE id = v_id;

    IF NOT EXISTS (SELECT 1 FROM public.lenders WHERE id = v_id AND is_active) THEN
      RAISE EXCEPTION '0260: a bank-only lender was wrongly rejected';
    END IF;

    /*
      A bank NAME with no account number is not a route for money, and must be
      refused — this is the near-miss the constraint exists for, since a row that
      looks populated is the one nobody checks.
    */
    BEGIN
      UPDATE public.lenders
      SET collection_account = jsonb_build_object('bank_name', 'A Bank')
      WHERE id = v_id;
      RAISE EXCEPTION '0260: a bank name with no account number was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;

    -- And no active lender is left in the unrepayable state.
    SELECT count(*) INTO v_count
    FROM public.lenders
    WHERE is_active
      AND (collection_account IS NULL
           OR NOT ((collection_account ? 'mobile_money')
                OR (collection_account ? 'paybill')
                OR (collection_account ? 'account_number')));

    IF v_count <> 0 THEN
      RAISE EXCEPTION '0260: % active lender(s) still cannot be repaid', v_count;
    END IF;

    RAISE EXCEPTION 'ZSMS_0260_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0260_ROLLBACK' THEN
        RAISE NOTICE '0260: verified — unrepayable lender cannot be activated, bank-only works, bank name alone refused';
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
