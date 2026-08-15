-- Migration: 0087_create_document_and_job_tables.sql
-- Created: 2026-08-15
-- Description: Generated-document records (receipts, statements, report cards)
--              and the tenant-scoped job audit trail.
-- Related documents: Official Documentation/13 Document and PDF System/PDF_GENERATION.md
--                    Official Documentation/03 Infrastructure Services/BULLMQ.md
--
-- WHY JOBS ARE RECORDED IN POSTGRES AT ALL
-- ----------------------------------------
-- BullMQ already tracks jobs in Redis, and Bull Board shows them. That view is
-- AfriTech's, is not tenant-scoped, and disappears when Redis is flushed.
--
-- job_runs is the school-visible, RLS-isolated record: a principal asking "did
-- the receipt go out?" must get an answer without an AfriTech engineer opening
-- a dashboard. It is an audit trail, not a queue — nothing is dequeued from it.

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- generated_documents — what was produced, for whom, and where it lives
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generated_documents (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID NOT NULL REFERENCES public.schools(id),

  doc_type        TEXT NOT NULL
                  CHECK (doc_type IN (
                    'payment_receipt', 'fee_statement', 'report_card',
                    'attendance_certificate', 'transfer_letter'
                  )),

  student_id      UUID REFERENCES public.students(id),
  payment_id      UUID REFERENCES public.payments(id),
  -- Whichever record the document is about. Both nullable: a fee statement is
  -- per student with no payment, a bulk report card run has neither at the
  -- batch level.

  academic_year   TEXT,
  term_number     INT CHECK (term_number IS NULL OR term_number BETWEEN 1 AND 4),

  storage_path    TEXT,
  -- R2 private bucket path. NULL until generation completes.

  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'generating', 'ready', 'failed')),
  failure_reason  TEXT,

  generated_by    TEXT,
  -- Clerk user ID when a person asked for it; NULL when a job did.

  byte_size       INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_generated_docs_school  ON public.generated_documents(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_docs_student ON public.generated_documents(student_id);
CREATE INDEX IF NOT EXISTS idx_generated_docs_payment ON public.generated_documents(payment_id);
CREATE INDEX IF NOT EXISTS idx_generated_docs_pending
  ON public.generated_documents(status) WHERE status IN ('pending', 'generating');

DROP TRIGGER IF EXISTS update_timestamp_on_generated_documents ON public.generated_documents;
CREATE TRIGGER update_timestamp_on_generated_documents
  BEFORE UPDATE ON public.generated_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- job_runs — the tenant-visible job audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.job_runs (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id       UUID REFERENCES public.schools(id),
  -- NULL for platform-wide jobs (metrics, health scores).

  job_type        TEXT NOT NULL,
  -- Matches the JobType union in packages/queue. Deliberately not a CHECK
  -- constraint: the union changes with every new worker, and a migration per
  -- job type would make adding one a schema change.

  queue_job_id    TEXT,
  -- The BullMQ (or QStash) job ID, so a row here can be traced to the queue.

  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'dead_letter')),

  reference_type  TEXT,
  reference_id    UUID,
  -- What the job is about — 'payment', 'announcement', 'fee_record'.
  -- IDs ONLY. See the payload note below.

  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT,

  queued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.job_runs IS
  'Tenant-visible job audit trail. Carries reference IDs only — never PII, never amounts. The worker fetches full data by ID.';
COMMENT ON COLUMN public.job_runs.reference_id IS
  'An ID, never a value. A queue and its audit trail are not access-controlled storage; a job row naming an amount or a phone number leaks it to anyone who can read the queue.';

CREATE INDEX IF NOT EXISTS idx_job_runs_school ON public.job_runs(school_id, queued_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_runs_status ON public.job_runs(status) WHERE status IN ('queued','processing','failed');
CREATE INDEX IF NOT EXISTS idx_job_runs_ref    ON public.job_runs(reference_type, reference_id);

DROP TRIGGER IF EXISTS update_timestamp_on_job_runs ON public.job_runs;
CREATE TRIGGER update_timestamp_on_job_runs
  BEFORE UPDATE ON public.job_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.generated_documents FROM anon;
REVOKE ALL ON public.job_runs            FROM anon;
GRANT SELECT ON public.generated_documents TO authenticated;
GRANT SELECT ON public.job_runs            TO authenticated;
-- Both are written by SECURITY DEFINER functions called from workers. A user
-- who could INSERT a 'ready' document row could point storage_path at a file
-- of their choosing.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.generated_documents FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.job_runs            FROM authenticated, anon;

ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_documents FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.job_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_runs            FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_documents" ON public.generated_documents;
CREATE POLICY "afritech_admin_all_documents"
ON public.generated_documents FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

DROP POLICY IF EXISTS "school_staff_read_documents" ON public.generated_documents;
CREATE POLICY "school_staff_read_documents"
ON public.generated_documents FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin', 'org:accountant')
);

-- A parent sees documents about their own child, reusing the arrears-era
-- predicate so parent access has exactly one definition.
DROP POLICY IF EXISTS "parent_read_own_child_documents" ON public.generated_documents;
CREATE POLICY "parent_read_own_child_documents"
ON public.generated_documents FOR SELECT
USING (student_id IS NOT NULL AND is_linked_parent_of(student_id));

DROP POLICY IF EXISTS "afritech_admin_all_job_runs" ON public.job_runs;
CREATE POLICY "afritech_admin_all_job_runs"
ON public.job_runs FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Management only. A job trail shows operational detail — failure reasons,
-- retry counts — that a parent has no business reading.
DROP POLICY IF EXISTS "management_read_job_runs" ON public.job_runs;
CREATE POLICY "management_read_job_runs"
ON public.job_runs FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- ---------------------------------------------------------------------------
-- Writer functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_job_run(
  p_school_id      UUID,
  p_job_type       TEXT,
  p_queue_job_id   TEXT DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id   UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.job_runs (school_id, job_type, queue_job_id, reference_type, reference_id)
  VALUES (p_school_id, p_job_type, p_queue_job_id, p_reference_type, p_reference_id)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_job_run(
  p_job_run_id UUID,
  p_status     TEXT,
  p_error      TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.job_runs
  SET status      = p_status,
      last_error  = p_error,
      attempts    = attempts + 1,
      started_at  = COALESCE(started_at, NOW()),
      finished_at = CASE WHEN p_status IN ('completed','failed','dead_letter') THEN NOW() ELSE finished_at END
  WHERE id = p_job_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_generated_document(
  p_school_id     UUID,
  p_doc_type      TEXT,
  p_student_id    UUID DEFAULT NULL,
  p_payment_id    UUID DEFAULT NULL,
  p_academic_year TEXT DEFAULT NULL,
  p_term_number   INT  DEFAULT NULL,
  p_generated_by  TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.generated_documents
    (school_id, doc_type, student_id, payment_id, academic_year, term_number, generated_by)
  VALUES
    (p_school_id, p_doc_type, p_student_id, p_payment_id, p_academic_year, p_term_number, p_generated_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_generated_document(
  p_document_id  UUID,
  p_status       TEXT,
  p_storage_path TEXT DEFAULT NULL,
  p_byte_size    INT  DEFAULT NULL,
  p_error        TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.generated_documents
  SET status         = p_status,
      storage_path   = COALESCE(p_storage_path, storage_path),
      byte_size      = COALESCE(p_byte_size, byte_size),
      failure_reason = p_error
  WHERE id = p_document_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_job_run(UUID, TEXT, TEXT, TEXT, UUID)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_job_run(UUID, TEXT, TEXT)                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_generated_document(UUID, TEXT, UUID, UUID, TEXT, INT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_generated_document(UUID, TEXT, TEXT, INT, TEXT)          TO authenticated;

-- === MIGRATION END ===
