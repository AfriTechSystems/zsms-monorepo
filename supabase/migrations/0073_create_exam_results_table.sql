-- Migration: 0073_create_exam_results_table.sql
-- Created: 2026-08-15
-- Description: Marks per student per subject per term, and the bulk report
--              generation progress table.
-- Related documents: Official Documentation/01 Foundation Layer/DATABASE.md — exam_results
--                    Official Documentation/11 Exams and Results/

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS public.exam_results (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id           UUID NOT NULL REFERENCES public.schools(id),
  student_id          UUID NOT NULL REFERENCES public.students(id),

  class_id            TEXT NOT NULL,
  academic_year       TEXT NOT NULL,
  term_number         INT  NOT NULL CHECK (term_number BETWEEN 1 AND 4),

  subject_code        TEXT NOT NULL,
  subject_name        TEXT NOT NULL,

  entered_by_user_id  TEXT NOT NULL,

  marks_obtained      NUMERIC(6,2) CHECK (marks_obtained IS NULL OR marks_obtained >= 0),
  marks_total         NUMERIC(6,2) NOT NULL DEFAULT 100 CHECK (marks_total > 0),

  grade_letter        TEXT,
  grade_points        INT,
  class_position      INT,
  class_size          INT,

  results_published   BOOLEAN NOT NULL DEFAULT FALSE,
  published_at        TIMESTAMPTZ,
  -- Publication is the lock. Once TRUE the teacher can no longer edit the mark;
  -- the UPDATE policy in 0074 enforces that, not the application alone.

  comments            TEXT,

  sync_source         TEXT NOT NULL DEFAULT 'web'
                      CHECK (sync_source IN ('web', 'mobile_online', 'mobile_offline')),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, student_id, academic_year, term_number, subject_code),

  -- A mark above the maximum is a data-entry error, not a distinction.
  CONSTRAINT exam_results_marks_within_total CHECK (
    marks_obtained IS NULL OR marks_obtained <= marks_total
  ),
  CONSTRAINT exam_results_published_has_timestamp CHECK (
    results_published = FALSE OR published_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_results_school      ON public.exam_results(school_id);
CREATE INDEX IF NOT EXISTS idx_results_student     ON public.exam_results(student_id);
CREATE INDEX IF NOT EXISTS idx_results_class_term  ON public.exam_results(school_id, class_id, academic_year, term_number);
CREATE INDEX IF NOT EXISTS idx_results_published   ON public.exam_results(school_id, academic_year, term_number, results_published);

DROP TRIGGER IF EXISTS update_timestamp_on_exam_results ON public.exam_results;
CREATE TRIGGER update_timestamp_on_exam_results
  BEFORE UPDATE ON public.exam_results
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- report_generation_jobs — bulk PDF progress
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.report_generation_jobs (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id          UUID NOT NULL REFERENCES public.schools(id),

  run_id             UUID NOT NULL,
  -- Groups every class batch belonging to one generation action.

  class_id           TEXT NOT NULL,
  academic_year      TEXT NOT NULL,
  term_number        INT  NOT NULL CHECK (term_number BETWEEN 1 AND 4),

  total_students     INT NOT NULL DEFAULT 0,
  completed_students INT NOT NULL DEFAULT 0,

  status             TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'processing', 'complete', 'failed')),
  error_message      TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_jobs_school ON public.report_generation_jobs(school_id, status);
CREATE INDEX IF NOT EXISTS idx_report_jobs_run    ON public.report_generation_jobs(run_id);

DROP TRIGGER IF EXISTS update_timestamp_on_report_generation_jobs ON public.report_generation_jobs;
CREATE TRIGGER update_timestamp_on_report_generation_jobs
  BEFORE UPDATE ON public.report_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON public.exam_results           FROM anon;
REVOKE ALL ON public.report_generation_jobs FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.exam_results           TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.report_generation_jobs TO authenticated;
REVOKE DELETE, TRUNCATE ON public.exam_results           FROM authenticated, anon;
REVOKE DELETE, TRUNCATE ON public.report_generation_jobs FROM authenticated, anon;

ALTER TABLE public.exam_results           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_results           FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.report_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_generation_jobs FORCE  ROW LEVEL SECURITY;

-- === MIGRATION END ===
