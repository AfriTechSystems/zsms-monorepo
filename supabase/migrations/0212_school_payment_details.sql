-- ===========================================================================
-- 0212 — the accounts a school actually wants paying into
--
-- `PAYMENTS.md` has a parent uploading proof of a payment they made "via mobile
-- money, bank transfer, or cash" — and the schema has never held anywhere for a
-- school to say WHERE. The only bank column anywhere is `payments.bank_name`,
-- recorded after the fact on an individual payment.
--
-- So a parent could claim a payment without ZSMS ever being able to tell them
-- the account number to pay into. They rang the school, which is the thing this
-- product exists to stop.
--
-- ## A table, not columns on `schools`
--
-- A school has SEVERAL ways to be paid — a bank account, an Airtel number, an
-- MTN number — and often more than one of each as it changes banks. Columns on
-- `schools` would be `bank_1_name`, `bank_2_name`, and a decision about how many
-- is enough. Rows have no such limit, carry their own display order, and can be
-- deactivated without being deleted, which matters because a closed account must
-- stop being shown without erasing the history of payments made into it.
--
-- It also gives the future gateway somewhere to live: `gateway_name` and
-- `gateway_account_ref` are here from the start, unused, so that connecting a
-- school to a gateway we provide is a row rather than a migration.
--
-- ## What this deliberately does NOT do
--
-- It does not add `mobile_money` to `payments.payment_method`. That vocabulary
-- is a product decision — one value, or `airtel_money` / `mtn_momo` /
-- `zamtel_kwacha` separately, which `ZM.md` lists as distinct gateways — and it
-- is being planned separately. A `method_kind` here describes what the SCHOOL
-- offers, which is a different column from what a payment WAS, and does not
-- pre-empt that decision.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.school_payment_details (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id   UUID NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,

  /*
    What KIND of account this is, so a screen can group and icon them.

    Describes what the school offers, not what a payment was — see the header.
    `other` exists because a school will have something nobody predicted, and
    the alternative is a school unable to tell parents how to pay it.
  */
  method_kind TEXT NOT NULL CHECK (method_kind IN (
    'bank_account', 'mobile_money', 'cash_office', 'gateway', 'other'
  )),

  /** What a parent sees in a list. "Zanaco — Main Account", "Airtel Money". */
  label       TEXT NOT NULL CHECK (btrim(label) <> ''),

  -- Bank fields. Nullable because a mobile-money row has none of them.
  bank_name      TEXT,
  account_name   TEXT,
  account_number TEXT,
  branch         TEXT,
  swift_code     TEXT,

  -- Mobile money.
  provider       TEXT,
  phone_number   TEXT,

  -- The gateway foundation, unused until a gateway is connected.
  gateway_name        TEXT,
  gateway_account_ref TEXT,

  /** Anything the school wants a parent to read — "quote the pupil's name". */
  instructions TEXT,

  /*
    Deactivated rather than deleted.

    A closed account must stop being shown to parents while the payments made
    into it keep their meaning. A hard delete would orphan that history.
  */
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 0,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   TEXT,

  /*
    A row has to be USABLE for the kind it claims to be.

    Without this a school saves a bank account with no account number and a
    parent is shown a card telling them nothing — which looks like a ZSMS bug
    and is a missing field.
  */
  CONSTRAINT school_payment_details_usable CHECK (
    CASE method_kind
      WHEN 'bank_account' THEN account_number IS NOT NULL AND btrim(account_number) <> ''
      WHEN 'mobile_money' THEN phone_number IS NOT NULL AND btrim(phone_number) <> ''
      WHEN 'gateway'      THEN gateway_name IS NOT NULL AND btrim(gateway_name) <> ''
      ELSE TRUE
    END
  )
);

COMMENT ON TABLE public.school_payment_details IS
  'Where a school wants to be paid. Shown to parents alongside the fee balance so a payment claim can be made against a real account (0212).';

CREATE INDEX IF NOT EXISTS idx_school_payment_details_school
  ON public.school_payment_details (school_id, display_order)
  WHERE is_active;

-- ---------------------------------------------------------------------------
-- 2. RLS. A new table without a policy is a defect.
-- ---------------------------------------------------------------------------

ALTER TABLE public.school_payment_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_payment_details FORCE ROW LEVEL SECURITY;

/*
  Parents must READ this — it is the entire point — and only school management
  may write it.

  An account number is not a secret from the people being asked to pay into it,
  but it is exactly the field an attacker would want to change. So the read is
  wide and the write is narrow.
*/
CREATE POLICY school_members_read_payment_details
  ON public.school_payment_details
  FOR SELECT
  TO authenticated
  USING (
    school_id = public.current_school_uuid()
    OR EXISTS (
      -- A parent has no organisation, so `current_school_uuid()` is NULL for
      -- them — their access resolves through the link row instead.
      SELECT 1
      FROM public.students s
      WHERE s.school_id = school_payment_details.school_id
        AND public.is_linked_parent_of(s.id)
    )
  );

CREATE POLICY management_write_payment_details
  ON public.school_payment_details
  FOR ALL
  TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:admin', 'org:accountant')
  )
  WITH CHECK (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:admin', 'org:accountant')
  );

CREATE POLICY afritech_admin_all_payment_details
  ON public.school_payment_details
  FOR ALL
  TO authenticated
  USING (public.is_afritech_admin())
  WITH CHECK (public.is_afritech_admin());

/*
  Table privileges, which RLS does not imply.

  A new table has none, so `authenticated` got `42501 permission denied for
  table` before any policy was consulted — which is a different error from a
  policy refusal and was what made the first attempt at this migration fail.
  RLS does the real filtering; the grant only says the role may try.

  `anon` is granted nothing: an account number is not a secret from the people
  being asked to pay into it, but it is not public either.
*/
GRANT SELECT, INSERT, UPDATE, DELETE ON public.school_payment_details TO authenticated;
REVOKE ALL ON public.school_payment_details FROM anon;

-- ---------------------------------------------------------------------------
-- 3. The `0149` status guard, which is NOT automatic.
-- ---------------------------------------------------------------------------

/*
  `0149` attaches its write-blocking trigger by iterating the catalogue AT
  MIGRATION TIME, so a table created afterwards has none and nothing reminds
  anybody. CLAUDE.md names this as a standing trap; this is the second table to
  hit it.

  A suspended school must not be able to change where money is sent.
*/
DROP TRIGGER IF EXISTS enforce_school_writable_on_insert_on_school_payment_details
  ON public.school_payment_details;
CREATE TRIGGER enforce_school_writable_on_insert_on_school_payment_details
  AFTER INSERT ON public.school_payment_details
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_new();

DROP TRIGGER IF EXISTS enforce_school_writable_on_update_on_school_payment_details
  ON public.school_payment_details;
CREATE TRIGGER enforce_school_writable_on_update_on_school_payment_details
  AFTER UPDATE ON public.school_payment_details
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_school_writable_new();

-- ---------------------------------------------------------------------------
-- 4. A payment's own transaction reference.
-- ---------------------------------------------------------------------------

/*
  `PAYMENTS.md` requires a mobile-money confirmation number or bank reference on
  a parent's claim, and specifies duplicate detection over it. Until now the
  parent route appended it to `notes` as free text — which no query can check,
  so the duplicate detection the document describes could not exist.

  Separate from `gateway_reference`, which is what a GATEWAY told us. This is
  what the PAYER typed, and the two differ in how much they can be trusted.
*/
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS transaction_reference TEXT;

COMMENT ON COLUMN public.payments.transaction_reference IS
  'The reference the payer supplied — a mobile money confirmation number, a bank reference. Untrusted, unlike gateway_reference. Used for duplicate detection (0212).';

/*
  Not UNIQUE.

  `PAYMENTS.md` is explicit that a duplicate reference raises a WARNING the
  parent can acknowledge and proceed past — a parent paying twice with a
  reference they mistyped must not be blocked from recording a real second
  payment. A unique index would make the document's flow impossible.
*/
CREATE INDEX IF NOT EXISTS idx_payments_transaction_reference
  ON public.payments (school_id, transaction_reference)
  WHERE transaction_reference IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Prove what can be proved here; exercise the roles separately.
-- ---------------------------------------------------------------------------

/*
  The first attempt at this section switched roles inside a DO block with
  exception handlers, and it was unreliable: an exception rolls back to the
  block's savepoint, which also reverts `SET LOCAL ROLE`, so the role in force
  for the statements after a caught exception was not the one the test thought.

  Role-based refusals belong in a separate transaction run with
  `supabase db query`, where each one gets its own clean session. What stays here
  is what this file can establish on its own: that the structure is right, and
  that the constraint which silently produces a useless card actually fires.
*/
DO $$
DECLARE
  v_school UUID;
  v_n      INT;
BEGIN
  SELECT s.id INTO v_school
  FROM public.schools s
  WHERE s.status = 'active'
  LIMIT 1;

  IF v_school IS NULL THEN
    RAISE NOTICE '0212: no active school to exercise against; skipping the write test';
    RETURN;
  END IF;

  -- A bank account with no number must be refused. Without this a school saves
  -- a card that tells a parent nothing, which reads as a ZSMS bug.
  BEGIN
    INSERT INTO public.school_payment_details
      (school_id, method_kind, label)
    VALUES (v_school, 'bank_account', '0212 unusable');
    RAISE EXCEPTION '0212: a bank account with no number was accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE '0212: an unusable bank account is refused — correct';
  END;

  -- Same for mobile money with no number.
  BEGIN
    INSERT INTO public.school_payment_details
      (school_id, method_kind, label)
    VALUES (v_school, 'mobile_money', '0212 unusable');
    RAISE EXCEPTION '0212: mobile money with no phone number was accepted';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE '0212: unusable mobile money is refused — correct';
  END;

  -- And a usable row writes, then is undone.
  INSERT INTO public.school_payment_details
    (school_id, method_kind, label, bank_name, account_name, account_number)
  VALUES (v_school, 'bank_account', '0212 probe', 'Zanaco', 'Test Academy', '0123456789');

  SELECT COUNT(*) INTO v_n
  FROM public.school_payment_details
  WHERE school_id = v_school AND label = '0212 probe';

  IF v_n <> 1 THEN
    RAISE EXCEPTION '0212: a usable row did not write (% rows)', v_n;
  END IF;

  DELETE FROM public.school_payment_details
  WHERE school_id = v_school AND label = '0212 probe';

  RAISE NOTICE '0212: verified — the usability constraint holds and a good row writes';
END;
$$;

-- The structure a route depends on.
DO $$
DECLARE v_n INT;
BEGIN
  SELECT COUNT(*) INTO v_n FROM pg_policies
  WHERE tablename = 'school_payment_details';

  IF v_n <> 3 THEN
    RAISE EXCEPTION '0212: expected 3 policies on school_payment_details, found %', v_n;
  END IF;

  -- RLS forced, so the table owner is filtered too.
  SELECT COUNT(*) INTO v_n FROM pg_class
  WHERE relname = 'school_payment_details' AND relrowsecurity AND relforcerowsecurity;

  IF v_n <> 1 THEN
    RAISE EXCEPTION '0212: RLS is not both enabled and forced';
  END IF;

  -- The `0149` guard, which a table created after that migration does not get.
  SELECT COUNT(*) INTO v_n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  WHERE c.relname = 'school_payment_details'
    AND t.tgname LIKE 'enforce_school_writable%';

  IF v_n <> 2 THEN
    RAISE EXCEPTION '0212: expected 2 status-guard triggers, found %', v_n;
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.school_payment_details', 'SELECT') THEN
    RAISE EXCEPTION '0212: authenticated cannot SELECT — the grant is missing';
  END IF;
END;
$$;
