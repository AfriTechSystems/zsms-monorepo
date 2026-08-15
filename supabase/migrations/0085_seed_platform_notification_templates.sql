-- Migration: 0085_seed_platform_notification_templates.sql
-- Created: 2026-08-15
-- Description: Platform-default message wording for every Phase 3 notification.
-- Related documents: Official Documentation/12 Communication System/TEMPLATES.md
--
-- These are DEFAULTS, not constants. Every row is editable by a super admin,
-- and any school may override a key with its own wording (0083's
-- school_id-nullable design). They are seeded so that a school which has
-- configured nothing still sends something coherent — an unconfigured school
-- must not silently send an empty message.
--
-- Placeholders are {{variable}} and are listed in `variables` so the admin UI
-- can validate a saved body before it reaches a parent.
--
-- WhatsApp bodies are stored for preview and audit only. Meta requires
-- templates to be pre-approved in its own console, so the wire format uses
-- meta_template_name; the body here is what a human reads when deciding
-- whether the wording is right.

-- === MIGRATION START ===

INSERT INTO public.notification_templates
  (school_id, template_key, channel, language_code, subject, body, meta_template_name, variables)
VALUES
  -- Payment confirmed ------------------------------------------------------
  (NULL, 'fee_payment_confirmed', 'whatsapp', 'en', NULL,
   'Dear {{parent_name}}, we have received {{currency}} {{amount}} for {{student_name}}. Receipt {{receipt_number}}. Outstanding balance: {{currency}} {{outstanding}}. Thank you — {{school_name}}.',
   'fee_payment_confirmed',
   ARRAY['parent_name','currency','amount','student_name','receipt_number','outstanding','school_name']),

  (NULL, 'fee_payment_confirmed', 'email', 'en',
   'Payment received — {{student_name}} ({{receipt_number}})',
   E'Dear {{parent_name}},\n\nWe have received a payment of {{currency}} {{amount}} for {{student_name}}.\n\nReceipt number: {{receipt_number}}\nOutstanding balance: {{currency}} {{outstanding}}\n\nYour receipt is attached.\n\n{{school_name}}',
   NULL,
   ARRAY['parent_name','currency','amount','student_name','receipt_number','outstanding','school_name']),

  (NULL, 'fee_payment_confirmed', 'sms', 'en', NULL,
   '{{school_name}}: Received {{currency}} {{amount}} for {{student_name}}. Receipt {{receipt_number}}. Balance {{currency}} {{outstanding}}.',
   NULL,
   ARRAY['school_name','currency','amount','student_name','receipt_number','outstanding']),
   -- Deliberately terse: SMS is the last-resort fallback and is charged per
   -- segment, so the wording is trimmed rather than truncated at 160 by accident.

  -- Fee reminder -----------------------------------------------------------
  (NULL, 'fee_reminder', 'whatsapp', 'en', NULL,
   'Dear {{parent_name}}, {{student_name}} has an outstanding balance of {{currency}} {{arrears_amount}}, now {{days_overdue}} days past due. Please contact the school office. — {{school_name}}',
   'fee_reminder',
   ARRAY['parent_name','student_name','currency','arrears_amount','days_overdue','school_name']),

  (NULL, 'fee_reminder', 'email', 'en',
   'Outstanding school fees — {{student_name}}',
   E'Dear {{parent_name}},\n\n{{student_name}} has an outstanding balance of {{currency}} {{arrears_amount}}, now {{days_overdue}} days past due.\n\nA full statement is attached.\n\nIf you have already paid, please disregard this message and contact the office so we can reconcile it.\n\n{{school_name}}',
   NULL,
   ARRAY['parent_name','student_name','currency','arrears_amount','days_overdue','school_name']),
   -- The "if you have already paid" line is not politeness. A reminder sent
   -- against a payment still pending verification is the most likely false
   -- positive in the system, and the message should say so.

  (NULL, 'fee_reminder', 'sms', 'en', NULL,
   '{{school_name}}: {{student_name}} has {{currency}} {{arrears_amount}} outstanding, {{days_overdue}} days overdue. Please contact the office.',
   NULL,
   ARRAY['school_name','student_name','currency','arrears_amount','days_overdue']),

  -- Absence alert ----------------------------------------------------------
  (NULL, 'absence_alert', 'whatsapp', 'en', NULL,
   'Dear {{parent_name}}, {{student_name}} was marked absent on {{attendance_date}}. If this is unexpected, please contact the school. — {{school_name}}',
   'absence_alert',
   ARRAY['parent_name','student_name','attendance_date','school_name']),

  (NULL, 'absence_alert', 'email', 'en',
   'Absence recorded — {{student_name}} on {{attendance_date}}',
   E'Dear {{parent_name}},\n\n{{student_name}} was marked absent on {{attendance_date}}.\n\nIf this is unexpected, please contact the school office.\n\n{{school_name}}',
   NULL,
   ARRAY['parent_name','student_name','attendance_date','school_name']),

  -- Results published ------------------------------------------------------
  (NULL, 'results_published', 'whatsapp', 'en', NULL,
   'Dear {{parent_name}}, {{term_label}} results for {{student_name}} are now available in the ZSMS parent portal. — {{school_name}}',
   'results_published',
   ARRAY['parent_name','student_name','term_label','school_name']),

  (NULL, 'results_published', 'email', 'en',
   '{{term_label}} results available — {{student_name}}',
   E'Dear {{parent_name}},\n\n{{term_label}} results for {{student_name}} are now available.\n\nThe report card is attached.\n\n{{school_name}}',
   NULL,
   ARRAY['parent_name','student_name','term_label','school_name']),

  -- School announcement ----------------------------------------------------
  (NULL, 'school_announcement', 'whatsapp', 'en', NULL,
   '{{school_name}}: {{title}}\n\n{{body}}',
   'school_announcement',
   ARRAY['school_name','title','body']),

  (NULL, 'school_announcement', 'email', 'en',
   '{{title}} — {{school_name}}',
   E'{{body}}\n\n—\n{{school_name}}',
   NULL,
   ARRAY['school_name','title','body']),

  -- Quota warning (to the school, not a parent) ----------------------------
  (NULL, 'quota_warning_80', 'email', 'en',
   'WhatsApp quota 80% used — {{school_name}}',
   E'You have used {{messages_used}} of your {{quota_limit}} WhatsApp messages for {{billing_period}}.\n\nWhen the quota is reached, WhatsApp messages stop and the system falls back to email and SMS. You can purchase additional credits or upgrade your plan at any time.\n\nZSMS',
   NULL,
   ARRAY['school_name','messages_used','quota_limit','billing_period'])
ON CONFLICT DO NOTHING;

-- === MIGRATION END ===
