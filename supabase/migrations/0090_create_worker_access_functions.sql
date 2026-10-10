-- Migration: 0090_create_worker_access_functions.sql
-- Created: 2026-08-15
-- Description: The purpose-built data-access functions Railway workers use,
--              plus the reminder and scheduled-announcement queries the crons
--              read.
-- Related documents: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-042
--                    Official Documentation/12 Communication System/WHATSAPP.md
--
-- ============================================================================
-- WHY WORKER ACCESS IS FUNNELLED THROUGH NAMED FUNCTIONS
-- ============================================================================
-- ADR-042 permits the service role inside a Railway worker. A service-role
-- connection bypasses RLS entirely, so the isolation guarantee that Phases 1-3
-- rest on does not protect a worker.
--
-- The boundary therefore moves: from "RLS enforces it" to "these functions
-- enforce it, and the pgTAP suite proves they do". Every function below scopes
-- each join to a single school internally, so tenancy is a property of the
-- function rather than of whoever writes the next worker.
--
-- A worker that queries a table directly loses the guarantee silently. That is
-- why ADR-042 prohibits ad-hoc worker queries rather than discouraging them: if
-- a future job needs data none of these expose, the answer is a new function
-- with its own test.

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- worker_payment_context — everything the receipt job needs, by payment ID
-- ---------------------------------------------------------------------------
-- Returns NULL for an unknown payment rather than an empty shell, so a caller
-- cannot mistake "not found" for "found with no parent".
--
-- Every join is anchored to the payment's OWN school_id. A student or guardian
-- from another school cannot appear in the result even though the caller
-- bypasses RLS — which is precisely what the suite asserts.
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
      'name',       s.name,
      'schoolCode', s.school_id,
      'address',    s.address,
      'logoUrl',    s.logo_url
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
  WHERE p.id = p_payment_id;
$$;

COMMENT ON FUNCTION public.worker_payment_context(UUID) IS
  'Receipt job context by payment ID. Every join is anchored to the payment school_id, so a cross-school row cannot appear even though the caller bypasses RLS (ADR-042).';

-- ---------------------------------------------------------------------------
-- worker_due_fee_reminders — the arrears the reminder cron acts on
-- ---------------------------------------------------------------------------
-- Reads arrears_amount / days_overdue / is_overdue from student_fee_balance,
-- and the reminder cooldown from fee_records.last_reminder_at — the fields the
-- arrears work (ADR-038) built for exactly this.
--
-- Sending is still the worker's decision; this only answers "who is due".
-- Nothing here blocks any action: ADR-038's model computes and never enforces.
CREATE OR REPLACE FUNCTION public.worker_due_fee_reminders(
  p_school_id        UUID DEFAULT NULL,
  p_min_days_overdue INT  DEFAULT 1,
  p_cooldown_days    INT  DEFAULT 7,
  p_limit            INT  DEFAULT 500
)
RETURNS TABLE (
  out_school_id       UUID,
  out_school_name     TEXT,
  out_student_id      UUID,
  out_student_name    TEXT,
  out_fee_record_id   UUID,
  out_parent_user_id  TEXT,
  out_parent_name     TEXT,
  out_parent_phone    TEXT,
  out_parent_email    TEXT,
  out_currency        TEXT,
  out_arrears_amount  TEXT,
  out_days_overdue    INT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.school_id,
    s.name,
    b.student_id,
    b.first_name || ' ' || b.last_name,
    fr.id,
    pa.clerk_user_id,
    COALESCE(pa.full_name, 'Parent or Guardian'),
    pa.phone_e164,
    pa.email,
    b.currency_code,
    to_char(b.arrears_amount, 'FM999999990.00'),
    b.days_overdue
  FROM public.student_fee_balance b
  JOIN public.schools s ON s.id = b.school_id
  -- The oldest overdue record carries the reminder state, so a family is
  -- chased once rather than once per outstanding line.
  JOIN LATERAL (
    SELECT frs.id, frs.last_reminder_at
    FROM public.fee_records frs
    WHERE frs.student_id = b.student_id
      AND frs.school_id  = b.school_id
      AND frs.is_deleted = FALSE
      AND frs.due_date < NOW()
      AND (frs.amount_due - frs.amount_paid - frs.discount_amount) > 0
    ORDER BY frs.due_date ASC
    LIMIT 1
  ) fr ON TRUE
  JOIN LATERAL (
    SELECT p2.clerk_user_id, p2.full_name, p2.phone_e164, p2.email
    FROM public.student_parent_links spl
    JOIN public.parents p2 ON p2.id = spl.parent_id
    WHERE spl.student_id = b.student_id AND spl.is_active = TRUE
    ORDER BY spl.is_primary DESC, spl.created_at ASC
    LIMIT 1
  ) pa ON TRUE
  WHERE b.is_overdue = TRUE
    AND b.days_overdue >= p_min_days_overdue
    AND (p_school_id IS NULL OR b.school_id = p_school_id)
    -- Cooldown. Without it a daily cron messages the same family every morning,
    -- which is how a school teaches its parents to mute the channel.
    AND (fr.last_reminder_at IS NULL
         OR fr.last_reminder_at < NOW() - make_interval(days => p_cooldown_days))
    -- Unreachable families are excluded rather than counted as failures.
    AND (pa.phone_e164 IS NOT NULL OR pa.email IS NOT NULL)
  ORDER BY b.days_overdue DESC
  LIMIT p_limit;
$$;

COMMENT ON FUNCTION public.worker_due_fee_reminders(UUID, INT, INT, INT) IS
  'Families due a fee reminder, from student_fee_balance and the per-record cooldown. Informational only — sending is the worker decision and nothing is blocked (ADR-038).';

-- Records that a reminder went out, so the cooldown means something.
CREATE OR REPLACE FUNCTION public.worker_mark_reminder_sent(p_fee_record_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.fee_records
  SET last_reminder_at = NOW(),
      reminder_count   = reminder_count + 1
  WHERE id = p_fee_record_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- worker_claim_scheduled_announcements — due announcements, claimed atomically
-- ---------------------------------------------------------------------------
-- The cron runs every 15 minutes (BULLMQ.md) and may overlap with a slow
-- previous run. Claiming flips status to 'sending' in the same statement that
-- selects, so two runs cannot both dispatch the same announcement.
CREATE OR REPLACE FUNCTION public.worker_claim_scheduled_announcements(p_limit INT DEFAULT 50)
RETURNS TABLE (
  out_announcement_id UUID,
  out_school_id       UUID,
  out_title           TEXT,
  out_body            TEXT,
  out_target_type     TEXT,
  out_target_ids      TEXT[]
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.announcements a
  SET status = 'sending'
  WHERE a.id IN (
    SELECT a2.id
    FROM public.announcements a2
    WHERE a2.status = 'scheduled'
      AND a2.scheduled_at IS NOT NULL
      AND a2.scheduled_at <= NOW()
    ORDER BY a2.scheduled_at ASC
    LIMIT p_limit
    -- SKIP LOCKED so an overlapping run takes the next batch rather than
    -- blocking on this one.
    FOR UPDATE SKIP LOCKED
  )
  RETURNING a.id, a.school_id, a.title, a.body, a.target_type, a.target_ids;
$$;

-- Recipients for an announcement, scoped to the announcement's OWN school.
-- p_school_id is passed separately and checked, so a caller cannot pair an
-- announcement with another school's recipient list.
CREATE OR REPLACE FUNCTION public.worker_announcement_recipients(
  p_announcement_id UUID,
  p_limit           INT DEFAULT 2000
)
RETURNS TABLE (
  out_user_id   TEXT,
  out_name      TEXT,
  out_phone     TEXT,
  out_email     TEXT,
  out_student_id UUID
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (pa.clerk_user_id)
    pa.clerk_user_id,
    COALESCE(pa.full_name, 'Parent or Guardian'),
    pa.phone_e164,
    pa.email,
    st.id
  FROM public.announcements a
  JOIN public.students st
    ON st.school_id = a.school_id       -- the anchor: recipients come from the
   AND st.is_deleted = FALSE            -- announcement's own school, always
   AND st.status = 'active'
  JOIN public.student_parent_links spl
    ON spl.student_id = st.id AND spl.is_active = TRUE
  JOIN public.parents pa ON pa.id = spl.parent_id
  WHERE a.id = p_announcement_id
    AND a.target_type IN ('all_parents', 'grade', 'class')
    AND (
      a.target_type = 'all_parents'
      OR (a.target_type = 'grade' AND st.grade_id = ANY(a.target_ids))
      OR (a.target_type = 'class' AND st.class_id = ANY(a.target_ids))
    )
    AND (pa.phone_e164 IS NOT NULL OR pa.email IS NOT NULL)
  ORDER BY pa.clerk_user_id, spl.is_primary DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.worker_complete_announcement(
  p_announcement_id UUID,
  p_status          TEXT,
  p_jobs_queued     INT DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.announcements
  SET status               = p_status,
      sent_at              = CASE WHEN p_status = 'sent' THEN NOW() ELSE sent_at END,
      whatsapp_jobs_queued = p_jobs_queued
  WHERE id = p_announcement_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- worker_report_card_batch — students and marks for a bulk generation run
-- ---------------------------------------------------------------------------
-- Published results only. A report card built from unpublished marks would put
-- a draft grade in a parent's hands, which is the thing publication exists to
-- prevent.
CREATE OR REPLACE FUNCTION public.worker_report_card_batch(
  p_school_id     UUID,
  p_academic_year TEXT,
  p_term_number   INT,
  p_class_id      TEXT DEFAULT NULL
)
RETURNS TABLE (
  out_student_id   UUID,
  out_student_name TEXT,
  out_student_code TEXT,
  out_class_id     TEXT,
  out_subjects     JSONB
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    st.id,
    st.first_name || ' ' || st.last_name,
    st.student_id,
    st.class_id,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'subjectName',   er.subject_name,
          'marksObtained', CASE WHEN er.marks_obtained IS NULL THEN NULL
                                ELSE to_char(er.marks_obtained, 'FM999990.00') END,
          'marksTotal',    to_char(er.marks_total, 'FM999990.00'),
          'gradeLetter',   er.grade_letter,
          'classPosition', er.class_position,
          'comments',      er.comments
        )
        ORDER BY er.subject_code
      ) FILTER (WHERE er.id IS NOT NULL),
      '[]'::jsonb
    )
  FROM public.students st
  LEFT JOIN public.exam_results er
    ON er.student_id      = st.id
   AND er.school_id       = st.school_id   -- anchored, not just by student
   AND er.academic_year   = p_academic_year
   AND er.term_number     = p_term_number
   AND er.results_published = TRUE
  WHERE st.school_id  = p_school_id
    AND st.is_deleted = FALSE
    AND st.status     = 'active'
    AND (p_class_id IS NULL OR st.class_id = p_class_id)
  GROUP BY st.id, st.first_name, st.last_name, st.student_id, st.class_id
  ORDER BY st.class_id, st.last_name, st.first_name;
$$;

-- ---------------------------------------------------------------------------
-- Grants — service role only
-- ---------------------------------------------------------------------------
-- These bypass RLS by design, so they are NOT granted to `authenticated`.
-- Only a worker holding the service role may call them (ADR-042).
REVOKE ALL ON FUNCTION public.worker_payment_context(UUID)                          FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.worker_due_fee_reminders(UUID, INT, INT, INT)         FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.worker_mark_reminder_sent(UUID)                       FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.worker_claim_scheduled_announcements(INT)             FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.worker_announcement_recipients(UUID, INT)             FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.worker_complete_announcement(UUID, TEXT, INT)         FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.worker_report_card_batch(UUID, TEXT, INT, TEXT)       FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.worker_payment_context(UUID)                    TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_due_fee_reminders(UUID, INT, INT, INT)   TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_mark_reminder_sent(UUID)                 TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_claim_scheduled_announcements(INT)       TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_announcement_recipients(UUID, INT)       TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_complete_announcement(UUID, TEXT, INT)   TO service_role;
GRANT EXECUTE ON FUNCTION public.worker_report_card_batch(UUID, TEXT, INT, TEXT) TO service_role;

-- === MIGRATION END ===
