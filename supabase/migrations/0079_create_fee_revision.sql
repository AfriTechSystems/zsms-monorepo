-- Migration: 0079_create_fee_revision.sql
-- Created: 2026-08-15
-- Description: The missing correction path — revise an issued term's fee
--              amount, with an audit row and a floor at what has been paid.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-038
--
-- THE GAP THIS CLOSES
-- -------------------
-- generate_fee_records() is idempotent by ON CONFLICT DO NOTHING, which
-- correctly prevents a re-run from doubling every balance. But it also means an
-- accountant correcting a mis-keyed fee on an ALREADY GENERATED term gets
-- `created: 0` and no change, with no error and no alternative route. The
-- protection against double-billing was also blocking legitimate revision.
--
-- Revision is a separate, deliberate act with its own audit trail — not a
-- side effect of re-running generation.

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- fee_record_revisions — the audit trail
-- ---------------------------------------------------------------------------
-- A dedicated table rather than columns on fee_records: a record may be revised
-- more than once, and overwriting last_revision_reason would lose the history
-- of exactly the operation that most needs it.
CREATE TABLE IF NOT EXISTS public.fee_record_revisions (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id      UUID NOT NULL REFERENCES public.schools(id),
  fee_record_id  UUID NOT NULL REFERENCES public.fee_records(id),

  old_amount     NUMERIC(12,2) NOT NULL,
  new_amount     NUMERIC(12,2) NOT NULL,

  reason         TEXT NOT NULL,
  -- Mandatory. A change to what a family owes, with no recorded reason, is not
  -- defensible when the family disputes it.

  revised_by     TEXT NOT NULL,
  revised_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_revisions_record ON public.fee_record_revisions(fee_record_id);
CREATE INDEX IF NOT EXISTS idx_fee_revisions_school ON public.fee_record_revisions(school_id, revised_at DESC);

REVOKE ALL ON public.fee_record_revisions FROM anon;
GRANT SELECT ON public.fee_record_revisions TO authenticated;
-- No INSERT for end users: rows are written by revise_fee_records() alone, so
-- the audit trail cannot be authored directly.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.fee_record_revisions FROM authenticated, anon;

ALTER TABLE public.fee_record_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_record_revisions FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_fee_revisions" ON public.fee_record_revisions;
CREATE POLICY "afritech_admin_all_fee_revisions"
ON public.fee_record_revisions FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "finance_read_fee_revisions" ON public.fee_record_revisions;
CREATE POLICY "finance_read_fee_revisions"
ON public.fee_record_revisions FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:accountant')
);

-- A parent may see revisions to their own child's fees. Being told the amount
-- changed, and why, is the point of recording it.
DROP POLICY IF EXISTS "parent_read_own_fee_revisions" ON public.fee_record_revisions;
CREATE POLICY "parent_read_own_fee_revisions"
ON public.fee_record_revisions FOR SELECT
USING (parent_can_access_fee_record(fee_record_id));

-- ---------------------------------------------------------------------------
-- revise_fee_records
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revise_fee_records(
  p_academic_year TEXT,
  p_term_number   INT,
  p_fee_label     TEXT,
  p_new_amount    NUMERIC(12,2),
  p_reason        TEXT
)
RETURNS TABLE (revised_count INT, skipped_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school   UUID := public.current_school_uuid();
  v_role     TEXT := public.get_user_role();
  v_actor    TEXT := public.get_user_id();
  v_blocked  INT;
  v_revised  INT := 0;
  v_skipped  INT := 0;
BEGIN
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'No school in session' USING ERRCODE = '42501';
  END IF;

  IF NOT (v_role IN ('org:owner', 'org:accountant')
          OR public.has_permission_grant('fees', 'write')) THEN
    RAISE EXCEPTION 'Only the owner or accountant may revise fee records'
      USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A revision requires a reason' USING ERRCODE = '23514';
  END IF;

  IF p_new_amount IS NULL OR p_new_amount < 0 THEN
    RAISE EXCEPTION 'The revised amount must be zero or greater' USING ERRCODE = '22023';
  END IF;

  -- REFUSAL: never revise a fee below what has already been verified as paid.
  -- Doing so would manufacture a credit the school never agreed to, and on a
  -- 'paid' record it would silently reopen a settled account. The whole
  -- revision is refused rather than partially applied, so the caller sees one
  -- consistent outcome.
  SELECT count(*) INTO v_blocked
  FROM public.fee_records fr
  WHERE fr.school_id     = v_school
    AND fr.academic_year = p_academic_year
    AND fr.term_number   = p_term_number
    AND fr.fee_label     = p_fee_label
    AND fr.is_deleted    = FALSE
    AND fr.amount_paid   > p_new_amount;

  IF v_blocked > 0 THEN
    RAISE EXCEPTION
      'Refusing to revise: % record(s) already have verified payments exceeding %. Issue a refund or reversal instead.',
      v_blocked, p_new_amount
      USING ERRCODE = '23514';
  END IF;

  -- Audit first, so a revision cannot be applied without being recorded.
  INSERT INTO public.fee_record_revisions
    (school_id, fee_record_id, old_amount, new_amount, reason, revised_by)
  SELECT fr.school_id, fr.id, fr.amount_due, p_new_amount, p_reason, v_actor
  FROM public.fee_records fr
  WHERE fr.school_id     = v_school
    AND fr.academic_year = p_academic_year
    AND fr.term_number   = p_term_number
    AND fr.fee_label     = p_fee_label
    AND fr.is_deleted    = FALSE
    AND fr.amount_due   <> p_new_amount;

  -- Apply, and re-derive status in the same statement. A record settled at the
  -- old amount must fall back to 'partial' when the fee rises, or the ledger
  -- would show a paid record with money still owing.
  WITH updated AS (
    UPDATE public.fee_records fr
    SET amount_due = p_new_amount,
        status = CASE
                   WHEN fr.status IN ('waived', 'loan_pending', 'loan_paid') THEN fr.status
                   WHEN fr.amount_paid <= 0                                  THEN 'unpaid'
                   WHEN fr.amount_paid <  (p_new_amount - fr.discount_amount) THEN 'partial'
                   WHEN fr.amount_paid =  (p_new_amount - fr.discount_amount) THEN 'paid'
                   ELSE 'overpaid'
                 END
    WHERE fr.school_id     = v_school
      AND fr.academic_year = p_academic_year
      AND fr.term_number   = p_term_number
      AND fr.fee_label     = p_fee_label
      AND fr.is_deleted    = FALSE
      AND fr.amount_due   <> p_new_amount
    RETURNING 1
  )
  SELECT count(*)::INT INTO v_revised FROM updated;

  SELECT count(*)::INT INTO v_skipped
  FROM public.fee_records fr
  WHERE fr.school_id     = v_school
    AND fr.academic_year = p_academic_year
    AND fr.term_number   = p_term_number
    AND fr.fee_label     = p_fee_label
    AND fr.is_deleted    = FALSE
    AND fr.amount_due    = p_new_amount;

  RETURN QUERY SELECT v_revised, v_skipped;
END;
$$;

COMMENT ON FUNCTION public.revise_fee_records(TEXT, INT, TEXT, NUMERIC, TEXT) IS
  'Corrects an issued term fee. Refuses to drop below verified payments, audits every change, and re-derives status. Not a gate — it only changes amounts (ADR-038).';

GRANT EXECUTE ON FUNCTION public.revise_fee_records(TEXT, INT, TEXT, NUMERIC, TEXT) TO authenticated;

-- === MIGRATION END ===
