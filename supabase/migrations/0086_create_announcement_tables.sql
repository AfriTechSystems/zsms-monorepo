-- Migration: 0086_create_announcement_tables.sql
-- Created: 2026-08-15
-- Description: School and platform announcements, with per-user read tracking.
-- Related documents: Official Documentation/12 Communication System/ANNOUNCEMENTS.md
--                    Official Documentation/05 Core Database and API Reference/SCHEMA.md

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS public.announcements (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id            UUID REFERENCES public.schools(id),
  -- NULL = an AfriTech PLATFORM announcement addressed to school owners.
  -- This is why the read policies below cannot be written as a plain
  -- school_id = current_school_uuid() check.

  title                TEXT NOT NULL,
  body                 TEXT NOT NULL,

  importance           TEXT NOT NULL DEFAULT 'regular'
                       CHECK (importance IN ('regular', 'important')),

  target_type          TEXT NOT NULL
                       CHECK (target_type IN (
                         'all_parents', 'all_students', 'all_staff',
                         'grade', 'class', 'platform'
                       )),

  target_ids           TEXT[] NOT NULL DEFAULT '{}',
  -- Grade or class identifiers when target_type narrows to them.

  created_by           TEXT NOT NULL,

  scheduled_at         TIMESTAMPTZ,
  -- NULL = send immediately. A future time is picked up by the
  -- check-scheduled-announcements cron (every 15 minutes, BULLMQ.md).

  sent_at              TIMESTAMPTZ,

  status               TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),

  whatsapp_jobs_queued INT NOT NULL DEFAULT 0,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A platform announcement is AfriTech's, and must not claim a school target.
  CONSTRAINT announcement_platform_shape CHECK (
    (target_type = 'platform' AND school_id IS NULL)
    OR (target_type <> 'platform' AND school_id IS NOT NULL)
  ),
  CONSTRAINT announcement_sent_has_timestamp CHECK (
    status <> 'sent' OR sent_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_announcements_school   ON public.announcements(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_status   ON public.announcements(status);
CREATE INDEX IF NOT EXISTS idx_announcements_schedule
  ON public.announcements(scheduled_at) WHERE status = 'scheduled';

DROP TRIGGER IF EXISTS update_timestamp_on_announcements ON public.announcements;
CREATE TRIGGER update_timestamp_on_announcements
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- announcement_reads — one row per user per announcement
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcement_reads (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id        UUID REFERENCES public.schools(id),
  announcement_id  UUID NOT NULL REFERENCES public.announcements(id),

  reader_user_id   TEXT NOT NULL,
  reader_type      TEXT NOT NULL
                   CHECK (reader_type IN ('parent', 'student', 'staff')),

  read_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (announcement_id, reader_user_id)
  -- One read per user per announcement (SCHEMA.md). Opening it twice is not
  -- two reads, and the upsert in the API relies on this.
);

CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement
  ON public.announcement_reads(announcement_id);
CREATE INDEX IF NOT EXISTS idx_announcement_reads_reader
  ON public.announcement_reads(reader_user_id);

-- ---------------------------------------------------------------------------
-- Privileges and RLS
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.announcements       FROM anon;
REVOKE ALL ON public.announcement_reads  FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.announcements      TO authenticated;
GRANT SELECT, INSERT          ON public.announcement_reads TO authenticated;
-- No UPDATE on reads: a read event is a fact with a timestamp, not a mutable row.
REVOKE DELETE, TRUNCATE ON public.announcements      FROM authenticated, anon;
REVOKE DELETE, TRUNCATE ON public.announcement_reads FROM authenticated, anon;

ALTER TABLE public.announcements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements      FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "afritech_admin_all_announcements" ON public.announcements;
CREATE POLICY "afritech_admin_all_announcements"
ON public.announcements FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Anyone at the school may read a SENT announcement addressed to their school.
-- Drafts and scheduled items stay with management until they are sent.
DROP POLICY IF EXISTS "school_members_read_sent_announcements" ON public.announcements;
CREATE POLICY "school_members_read_sent_announcements"
ON public.announcements FOR SELECT
USING (
  school_id = current_school_uuid()
  AND status = 'sent'
);

DROP POLICY IF EXISTS "management_read_all_announcements" ON public.announcements;
CREATE POLICY "management_read_all_announcements"
ON public.announcements FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

-- Platform announcements are readable by any authenticated user; they are
-- AfriTech speaking to its customers and carry no school data.
DROP POLICY IF EXISTS "read_platform_announcements" ON public.announcements;
CREATE POLICY "read_platform_announcements"
ON public.announcements FOR SELECT
USING (school_id IS NULL AND status = 'sent');

DROP POLICY IF EXISTS "management_write_announcements" ON public.announcements;
CREATE POLICY "management_write_announcements"
ON public.announcements FOR INSERT
WITH CHECK (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  AND created_by = get_user_id()
  -- Attribution is pinned: an announcement is a statement made by a named
  -- person, and the audit value disappears if the author can be forged.
);

DROP POLICY IF EXISTS "management_update_announcements" ON public.announcements;
CREATE POLICY "management_update_announcements"
ON public.announcements FOR UPDATE
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
)
WITH CHECK (school_id = current_school_uuid());

-- announcement_reads --------------------------------------------------------

DROP POLICY IF EXISTS "afritech_admin_all_reads" ON public.announcement_reads;
CREATE POLICY "afritech_admin_all_reads"
ON public.announcement_reads FOR ALL
USING (is_afritech_admin())
WITH CHECK (is_afritech_admin());

-- Management see who has read what — that is the point of tracking.
DROP POLICY IF EXISTS "management_read_announcement_reads" ON public.announcement_reads;
CREATE POLICY "management_read_announcement_reads"
ON public.announcement_reads FOR SELECT
USING (
  school_id = current_school_uuid()
  AND get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
);

DROP POLICY IF EXISTS "reader_read_own_reads" ON public.announcement_reads;
CREATE POLICY "reader_read_own_reads"
ON public.announcement_reads FOR SELECT
USING (reader_user_id = get_user_id());

-- A user may only record their OWN read. Without pinning reader_user_id, one
-- user could mark an announcement read on another's behalf, which is exactly
-- the record a school would rely on to claim a parent was informed.
DROP POLICY IF EXISTS "reader_record_own_read" ON public.announcement_reads;
CREATE POLICY "reader_record_own_read"
ON public.announcement_reads FOR INSERT
WITH CHECK (reader_user_id = get_user_id());

-- === MIGRATION END ===
