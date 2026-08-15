-- Migration: 0072_create_attendance_table.sql
-- Created: 2026-08-15
-- Description: Daily attendance records.
-- Related documents: Official Documentation/01 Foundation Layer/DATABASE.md — attendance_records
--                    Official Documentation/10 Attendance/

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS public.attendance_records (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id             UUID NOT NULL REFERENCES public.schools(id),
  student_id            UUID NOT NULL REFERENCES public.students(id),

  class_id              TEXT NOT NULL,
  -- Denormalised from the student's class at the time of marking. Preserved if
  -- the student later changes class, so a historical register still reflects
  -- who was actually in the room — and so the teacher-scope policy keeps
  -- evaluating against the class the mark was made for.

  recorded_by_user_id   TEXT NOT NULL,

  attendance_date       DATE NOT NULL,
  academic_year         TEXT NOT NULL,
  term_number           INT  NOT NULL CHECK (term_number BETWEEN 1 AND 4),

  status                TEXT NOT NULL
                        CHECK (status IN ('present', 'absent', 'late', 'excused', 'holiday')),

  arrival_time          TIME,
  excuse_reason         TEXT,

  parent_notified       BOOLEAN NOT NULL DEFAULT FALSE,
  notification_sent_at  TIMESTAMPTZ,

  sync_source           TEXT NOT NULL DEFAULT 'web'
                        CHECK (sync_source IN ('web', 'mobile_online', 'mobile_offline')),
  local_created_at      TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, student_id, attendance_date),

  -- DATABASE.md states excuse_reason is required when status is 'excused'.
  -- Enforced here rather than left to the application: an excused absence with
  -- no reason is indistinguishable from an unexplained one on a report.
  CONSTRAINT attendance_excused_needs_reason CHECK (
    status <> 'excused' OR excuse_reason IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_attendance_school   ON public.attendance_records(school_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student  ON public.attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_class    ON public.attendance_records(school_id, class_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_date     ON public.attendance_records(school_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_absent
  ON public.attendance_records(school_id, attendance_date)
  WHERE status = 'absent' AND parent_notified = FALSE;

DROP TRIGGER IF EXISTS update_timestamp_on_attendance_records ON public.attendance_records;
CREATE TRIGGER update_timestamp_on_attendance_records
  BEFORE UPDATE ON public.attendance_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

REVOKE ALL ON public.attendance_records FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.attendance_records TO authenticated;
REVOKE DELETE, TRUNCATE ON public.attendance_records FROM authenticated, anon;

ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records FORCE  ROW LEVEL SECURITY;

-- Policies land in 0074, after teacher_teaches_subject() exists. RLS is on now
-- so the gap denies rather than admits.

-- === MIGRATION END ===
