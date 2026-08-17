-- Migration: 0093_theme_worker_payment_context.sql
-- Created: 2026-08-16
-- Description: Carries the school's brand colours into the receipt job's
--              context, so a themed portal and its receipts match.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-043
--                    Official Documentation/13 Document and PDF System/PDF_GENERATION.md

-- === MIGRATION START ===

-- `0092` themed `worker_school_branding()`, which covers report cards and
-- statements. Receipts take a different route: `worker_payment_context()`
-- assembles the whole receipt from a payment id in one call, and its embedded
-- `school` object predates `school_branding`. Left alone, a maroon school would
-- send maroon report cards and ZSMS-blue receipts — and the receipt is the
-- document a parent is most likely to keep and to question.
--
-- Only the `school` object changes. Every join stays anchored to the payment's
-- own `school_id`, which is the property `worker_boundary_test.sql` asserts;
-- `school_branding` is joined on `s.id`, so it cannot introduce a second
-- school. The added keys are additive — no existing key is renamed or removed.
CREATE OR REPLACE FUNCTION public.worker_payment_context(p_payment_id UUID)
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'paymentId',     p.id,
    'schoolId',      p.school_id,
    'receiptNumber', p.receipt_number,
    'paidAt',        to_char(p.paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'),
    'amount',        to_char(p.amount, 'FM999999990.00'),
    'currency',      p.currency_code,
    'paymentMethod', p.payment_method,
    'recordedBy',    p.recorded_by_user_id,
    'verifiedBy',    p.verified_by,
    'school', jsonb_build_object(
      'name',         s.name,
      'schoolCode',   s.school_id,
      'address',      s.address,
      'logoUrl',      COALESCE(b.logo_url, s.logo_url),
      'anchorColor',  b.anchor_color,
      'primaryColor', b.primary_color
    ),
    'student', jsonb_build_object(
      'id',   st.id,
      'name', st.first_name || ' ' || st.last_name,
      'code', st.student_id
    ),
    'fee', jsonb_build_object(
      'label',            fr.fee_label,
      'academicYear',     fr.academic_year,
      'termNumber',       fr.term_number,
      'amountPaidToDate', to_char(fr.amount_paid, 'FM999999990.00'),
      'outstanding',      to_char(GREATEST(fr.amount_due - fr.amount_paid - fr.discount_amount, 0), 'FM999999990.00')
    ),
    'parent', (
      SELECT jsonb_build_object(
        'userId',    pa.clerk_user_id,
        'name',      COALESCE(pa.full_name, 'Parent or Guardian'),
        'phoneE164', pa.phone_e164,
        'email',     pa.email
      )
      FROM public.student_parent_links spl
      JOIN public.parents pa ON pa.id = spl.parent_id
      WHERE spl.student_id = st.id
        AND spl.is_active = TRUE
      -- The primary guardian receives automated notifications; fall back to the
      -- oldest link so a student with guardians but no designated primary is
      -- still reachable.
      ORDER BY spl.is_primary DESC, spl.created_at ASC
      LIMIT 1
    )
  )
  FROM public.payments p
  JOIN public.schools    s  ON s.id  = p.school_id
  JOIN public.fee_records fr ON fr.id = p.fee_record_id AND fr.school_id = p.school_id
  JOIN public.students   st ON st.id = p.student_id     AND st.school_id = p.school_id
  LEFT JOIN public.school_branding b ON b.school_id = s.id
  WHERE p.id = p_payment_id;
$$;

COMMENT ON FUNCTION public.worker_payment_context(UUID) IS
  'Receipt job context by payment ID, including school brand colours. Every join is anchored to the payment school_id, so a cross-school row cannot appear even though the caller bypasses RLS (ADR-042).';

-- CREATE OR REPLACE preserves grants, but stating them is cheap and a silent
-- widening here would hand an end-user role a receipt for any payment.
REVOKE ALL ON FUNCTION public.worker_payment_context(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.worker_payment_context(UUID) TO service_role;

DO $$
DECLARE
  v_leaked INT;
BEGIN
  SELECT count(*) INTO v_leaked
  FROM information_schema.routine_privileges
  WHERE routine_schema = 'public'
    AND routine_name LIKE 'worker\_%'
    AND grantee IN ('authenticated','anon','PUBLIC');

  IF v_leaked > 0 THEN
    RAISE EXCEPTION
      '0093: % worker_* grant(s) reachable by an end-user role — ADR-042 violated', v_leaked;
  END IF;
END;
$$;

-- === MIGRATION END ===
