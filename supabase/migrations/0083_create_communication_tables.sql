-- Migration: 0083_create_communication_tables.sql
-- Created: 2026-08-15
-- Description: Message log, per-school monthly quotas, and admin-editable
--              notification templates.
-- Related documents: Official Documentation/12 Communication System/MESSAGE_LOG.md
--                    Official Documentation/12 Communication System/WHATSAPP.md
--                    Official Documentation/12 Communication System/TEMPLATES.md
--                    Official Documentation/01 Foundation Layer/DYNAMIC_CONFIG.md
--
-- NUMBERING: 0083. Depends on 0082, which creates afritech.subscription_tiers
--            where the per-tier WhatsApp quota ceiling lives.
--
-- NOTHING HERE IS HARDCODED CONTENT. Message bodies live in
-- notification_templates and are editable by an admin; quota ceilings come from
-- afritech.subscription_tiers. A template string in application code would make
-- a wording change a deployment, and a wording change is the single most common
-- request a school makes.

-- === MIGRATION START ===

-- ---------------------------------------------------------------------------
-- notification_templates — the message content, as data
-- ---------------------------------------------------------------------------
-- school_id NULL is a PLATFORM DEFAULT. A school row with the same
-- template_key overrides it. Resolution is school-first, platform-fallback —
-- the same shape as the feature-flag precedence in DYNAMIC_CONFIG.md.
CREATE TABLE IF NOT EXISTS public.notification_templates (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID REFERENCES public.schools(id),
  -- NULL = AfriTech platform default, available to every school.

  template_key      TEXT NOT NULL,
  -- 'fee_payment_confirmed', 'fee_reminder', 'absence_alert',
  -- 'results_published', 'school_announcement', 'receipt_ready'.

  channel           TEXT NOT NULL
                    CHECK (channel IN ('whatsapp', 'sms', 'email', 'push', 'in_app')),
  -- One row per key per channel: a WhatsApp template and its SMS fallback say
  -- the same thing in very different lengths.

  language_code     TEXT NOT NULL DEFAULT 'en',
  -- Zambia has seven official local languages besides English. Multilingual
  -- templates are not built now, but keying on language from the start avoids
  -- a table rewrite later.

  subject           TEXT,
  -- Email only. NULL for WhatsApp and SMS.

  body              TEXT NOT NULL,
  -- Supports {{variable}} placeholders resolved at send time.

  meta_template_name TEXT,
  -- Meta-approved template name for WhatsApp. Meta requires pre-approval, so
  -- the body here is for preview and audit; the wire format uses this name.

  variables         TEXT[] NOT NULL DEFAULT '{}',
  -- Declared placeholders, so the admin UI can validate before saving.

  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by        TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active template per (school, key, channel, language). Partial unique
-- indexes because school_id is nullable and NULLs do not collide in a plain
-- UNIQUE — the platform default would otherwise be duplicable without limit.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_tmpl_school
  ON public.notification_templates(school_id, template_key, channel, language_code)
  WHERE school_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_tmpl_platform
  ON public.notification_templates(template_key, channel, language_code)
  WHERE school_id IS NULL;

DROP TRIGGER IF EXISTS update_timestamp_on_notification_templates ON public.notification_templates;
CREATE TRIGGER update_timestamp_on_notification_templates
  BEFORE UPDATE ON public.notification_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- school_message_quotas — one row per school per billing period
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.school_message_quotas (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID NOT NULL REFERENCES public.schools(id),

  billing_period    TEXT NOT NULL CHECK (billing_period ~ '^\d{4}-\d{2}$'),
  -- 'YYYY-MM'. Resets on the 1st at 00:00 UTC regardless of billing cycle
  -- date (WHATSAPP.md) — so the period is a calendar month, not a subscription
  -- anniversary.

  quota_limit       INT,
  -- NULL means UNLIMITED and is not an absent value: a school using its own
  -- WhatsApp Business number is governed by its own Meta billing, and ZSMS
  -- enforces nothing. Enterprise tier is also unlimited.

  messages_used     INT NOT NULL DEFAULT 0 CHECK (messages_used >= 0),
  overage_credits   INT NOT NULL DEFAULT 0 CHECK (overage_credits >= 0),
  -- Purchased pay-as-you-go blocks, consumed after quota_limit is reached.

  alert_80_sent_at  TIMESTAMPTZ,
  -- Set once when usage crosses 80%, so the warning is not re-sent per message.

  last_updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, billing_period)
);

CREATE INDEX IF NOT EXISTS idx_quotas_school_period
  ON public.school_message_quotas(school_id, billing_period);

-- ---------------------------------------------------------------------------
-- message_log — append-only record of every dispatch attempt
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_log (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id           UUID REFERENCES public.schools(id),
  -- NULL for AfriTech platform messages (alumni, platform announcements).

  recipient_phone     TEXT,
  recipient_email     TEXT,
  -- Email dispatch has no phone. MESSAGE_LOG.md's schema predates the email
  -- channel being first-class in the fallback chain; recipient_phone is
  -- therefore nullable here rather than NOT NULL.

  recipient_user_id   TEXT,
  student_id          UUID REFERENCES public.students(id),

  channel             TEXT NOT NULL
                      CHECK (channel IN ('whatsapp', 'sms', 'email', 'push', 'in_app')),

  template_key        TEXT NOT NULL,
  message_body        TEXT,
  -- Stored for SMS and free-form only. A WhatsApp body is derivable from
  -- template + variables, and storing it duplicates PII for no gain.

  variables           JSONB,

  status              TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN (
                        'queued', 'sent', 'delivered', 'read',
                        'failed', 'fallback_sent', 'quota_exceeded',
                        'opted_out', 'bounced'
                      )),

  provider_message_id TEXT,
  -- Meta wamid, Twilio SID, Resend message ID.

  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  read_at             TIMESTAMPTZ,
  failed_at           TIMESTAMPTZ,
  failure_reason      TEXT,

  retry_count         INT NOT NULL DEFAULT 0,

  is_fallback         BOOLEAN NOT NULL DEFAULT FALSE,
  fallback_of_id      UUID REFERENCES public.message_log(id),
  -- The message this one is standing in for, so a WhatsApp→email→SMS chain is
  -- reconstructable rather than appearing as three unrelated attempts.

  consumed_quota      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Whether this dispatch counted against the monthly quota. Only WhatsApp on
  -- AfriTech's shared number does.

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT message_log_has_a_recipient CHECK (
    recipient_phone IS NOT NULL OR recipient_email IS NOT NULL OR recipient_user_id IS NOT NULL
  )
);

COMMENT ON TABLE public.message_log IS
  'Append-only dispatch record. Never updated except by delivery-status callbacks; never deleted.';

CREATE INDEX IF NOT EXISTS idx_message_log_school     ON public.message_log(school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_log_student    ON public.message_log(student_id);
CREATE INDEX IF NOT EXISTS idx_message_log_status     ON public.message_log(school_id, status);
CREATE INDEX IF NOT EXISTS idx_message_log_provider   ON public.message_log(provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_message_log_recipient  ON public.message_log(recipient_user_id)
  WHERE recipient_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Privileges and RLS enablement (policies in 0084)
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.notification_templates   FROM anon;
REVOKE ALL ON public.school_message_quotas    FROM anon;
REVOKE ALL ON public.message_log              FROM anon;

GRANT SELECT, INSERT, UPDATE ON public.notification_templates TO authenticated;
GRANT SELECT ON public.school_message_quotas TO authenticated;
-- Quota rows are written only by the SECURITY DEFINER consume function in
-- 0083. A role that could UPDATE its own messages_used could reset it to zero
-- and send without limit.
GRANT SELECT ON public.message_log TO authenticated;
-- message_log is written by workers through a SECURITY DEFINER function, not
-- by end users. A user who could INSERT here could fabricate a delivery record.

REVOKE DELETE, TRUNCATE ON public.notification_templates FROM authenticated, anon;
REVOKE DELETE, TRUNCATE ON public.school_message_quotas  FROM authenticated, anon;
REVOKE DELETE, TRUNCATE ON public.message_log            FROM authenticated, anon;

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_templates FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.school_message_quotas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_message_quotas  FORCE  ROW LEVEL SECURITY;
ALTER TABLE public.message_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_log            FORCE  ROW LEVEL SECURITY;

-- === MIGRATION END ===
