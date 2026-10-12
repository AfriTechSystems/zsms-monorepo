-- ===========================================================================
-- 0263 — the Sage 50 export's data source
--
-- Spec: `17 Integration and Pricing/ACCOUNTING_CONNECTORS.md` → *Connector 1 —
--       Sage 50 (Desktop) — CSV Export*
--
-- ## Why this connector and not one of the API ones
--
-- Every other integration in folder 17 is blocked on a credential ZSMS does not
-- have: Sage Business Cloud and Xero need OAuth, QuickBooks needs an app,
-- HubSpot needs a key, and a custom webhook needs a signing secret that cannot
-- be stored while `FIELD_ENCRYPTION_KEY` is unset.
--
-- **Sage 50 needs nothing.** INTEGRATIONS.md says so in its own schema comment:
-- "NULL for sage_50_export (no auth needed)". It is a desktop application with no
-- cloud API, so the integration is a CSV the accountant downloads and imports
-- through Sage's batch feature. That makes it the one connector that can work
-- today — and ACCOUNTING_CONNECTORS.md notes Sage 50 Pastel is the most common
-- accounting software in Zambian private schools, so it is also the one most
-- schools would actually use.
--
-- ## What this migration provides
--
-- The rows. The CSV itself is assembled in the route, because the format is a
-- presentation concern — Sage's column order, its `DD/MM/YYYY` dates and its `SA`
-- type code are not facts about a payment.
--
-- ## Verified payments only, and why that is not a detail
--
-- A Sales Receipt in a ledger asserts money arrived. ZSMS records a parent's
-- *claim* of payment and a bursar's *verification* of it separately, and only the
-- second is evidence. Exporting an unverified claim would put a school's books
-- out by whatever a parent mistyped.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.sage50_export_rows(
  p_from DATE,
  p_to   DATE
)
RETURNS TABLE (
  out_payment_id     UUID,
  out_receipt_number TEXT,
  out_paid_at        DATE,
  out_student_name   TEXT,
  out_fee_label      TEXT,
  out_term_number    INT,
  out_amount         NUMERIC(12,2),
  out_currency       TEXT,
  out_method         TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school UUID := public.current_school_uuid();
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Sign in to your school first' USING ERRCODE = '42501';
  END IF;

  -- The books are the bursar's. A teacher has no business exporting them.
  IF public.get_user_role() NOT IN
       ('org:owner', 'org:principal', 'org:accountant') THEN
    RAISE EXCEPTION 'Only the owner, principal or accountant can export to Sage'
      USING ERRCODE = '42501';
  END IF;

  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Give a start date and an end date, in that order'
      USING ERRCODE = '22023';
  END IF;

  /*
    A whole year is the most this will return at once. Sage's batch import is not
    the place to discover that somebody asked for every payment since 2026, and a
    bounded window keeps the CSV a thing a person can check before importing it.
  */
  IF p_to - p_from > 366 THEN
    RAISE EXCEPTION 'Export at most one year at a time'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.receipt_number,
    /*
      The VERIFICATION date, not the date a parent said they paid.

      ACCOUNTING_CONNECTORS.md specifies "payment verification date", and it is
      the right one: the ledger entry should fall on the day the school accepted
      the money, which is the day its own records changed.
    */
    COALESCE(p.verified_at, p.created_at)::DATE,
    st.first_name || ' ' || st.last_name,
    COALESCE(fr.fee_label, 'School Fees'),
    fr.term_number,
    p.amount,
    COALESCE(p.currency_code, 'ZMW'),
    p.payment_method
  FROM public.payments p
  JOIN public.students st ON st.id = p.student_id
  LEFT JOIN public.fee_records fr ON fr.id = p.fee_record_id
  WHERE p.school_id = v_school
    /*
      Verified only. An unverified claim is not evidence money arrived.

      The column is `status`, not `verification_status`, and `payments` has no
      `is_deleted` at all — both were guesses in the first draft, and the second
      would have applied cleanly and failed on first call, because plpgsql resolves
      names at RUN time. `db:cols -- payments` answers this in one call.
    */
    AND p.status = 'verified'
    /*
      Reversals and waivers are excluded. A reversal is already reflected by the
      absence of the original from a later export, and a waiver moved no money at
      all — a Sales Receipt for either would overstate the school's income.
    */
    AND p.payment_method NOT IN ('reversal', 'waiver')
    AND COALESCE(p.verified_at, p.created_at)::DATE BETWEEN p_from AND p_to
  ORDER BY COALESCE(p.verified_at, p.created_at), p.receipt_number;
END;
$$;

COMMENT ON FUNCTION public.sage50_export_rows(DATE, DATE) IS
  'Verified payments for the Sage 50 batch import CSV (ACCOUNTING_CONNECTORS.md). Verified only, because a Sales Receipt asserts money arrived and ZSMS records a parent''s claim separately from a bursar''s verification. Reversals and waivers excluded (0263).';

REVOKE ALL ON FUNCTION public.sage50_export_rows(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sage50_export_rows(DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.sage50_export_rows(DATE, DATE) TO authenticated;

-- ---------------------------------------------------------------------------
-- Exercise it.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_school UUID;
  v_org    TEXT;
  v_n      INT;
  v_bad    INT;
BEGIN
  BEGIN
    SELECT s.id, s.clerk_org_id INTO v_school, v_org
    FROM public.schools s
    WHERE s.clerk_org_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.payments p WHERE p.school_id = s.id)
    LIMIT 1;

    IF v_school IS NULL THEN
      RAISE NOTICE '0263: no payment fixture; asserting refusals only';
      SELECT s.id, s.clerk_org_id INTO v_school, v_org
      FROM public.schools s WHERE s.clerk_org_id IS NOT NULL LIMIT 1;
    END IF;

    IF v_school IS NULL THEN
      RAISE NOTICE '0263: no school fixture; skipping';
      RAISE EXCEPTION 'ZSMS_0263_ROLLBACK';
    END IF;

    -- A teacher must not export the school's books.
    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_teacher', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'teacher'))::text, TRUE);
    BEGIN
      PERFORM public.sage50_export_rows(CURRENT_DATE - 30, CURRENT_DATE);
      RAISE EXCEPTION '0263: a teacher exported the school''s payment ledger';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    PERFORM set_config('request.jwt.claims', json_build_object(
      'sub', 'probe_accountant', 'role', 'authenticated',
      'o', json_build_object('id', v_org, 'rol', 'accountant'))::text, TRUE);

    -- Reversed dates are refused rather than silently returning nothing.
    BEGIN
      PERFORM public.sage50_export_rows(CURRENT_DATE, CURRENT_DATE - 30);
      RAISE EXCEPTION '0263: an end date before the start date was accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;

    -- And an unbounded window is refused.
    BEGIN
      PERFORM public.sage50_export_rows(DATE '2020-01-01', CURRENT_DATE);
      RAISE EXCEPTION '0263: a multi-year export was accepted';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;

    -- The accountant may export, and gets only this school's rows.
    SELECT count(*) INTO v_n
    FROM public.sage50_export_rows(CURRENT_DATE - 365, CURRENT_DATE);

    /*
      Nothing unverified, reversed or waived may appear. This is the assertion that
      matters: every row here becomes a Sales Receipt in a real ledger, and a
      single unverified claim puts the school's books out by whatever a parent
      mistyped.
    */
    SELECT count(*) INTO v_bad
    FROM public.sage50_export_rows(CURRENT_DATE - 365, CURRENT_DATE) r
    JOIN public.payments p ON p.id = r.out_payment_id
    WHERE p.status <> 'verified'
       OR p.payment_method IN ('reversal', 'waiver')
       OR p.school_id <> v_school;

    IF v_bad > 0 THEN
      RAISE EXCEPTION
        '0263: % exported row(s) are unverified, reversed, waived, or another school''s',
        v_bad;
    END IF;

    RAISE NOTICE
      '0263: verified — teacher refused, bad dates refused, year cap enforced, % verified row(s) exportable and nothing else',
      v_n;

    RAISE EXCEPTION 'ZSMS_0263_ROLLBACK';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ZSMS_0263_ROLLBACK' THEN
        NULL;
      ELSE
        RAISE;
      END IF;
  END;
END;
$$;
