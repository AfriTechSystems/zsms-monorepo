-- ===========================================================================
-- 0253 — the final-notice template REMINDERS.md names but nothing seeded
--
-- Spec: `09 Fee and Financial Management/REMINDERS.md` → *Reminder Message
--       Content*
--
-- REMINDERS.md specifies **two** templates: `fee_overdue_reminder` for the 7-
-- and 14-day messages, and `fee_overdue_final` for 30 days. Only one was ever
-- seeded, under the key `fee_reminder`, so every rung sent the same words — a
-- family thirty days in arrears received the same gentle nudge as one seven days
-- in, three times.
--
-- `0252` now tells the worker which rung a message is for and whether it is the
-- last one. This gives it something different to say.
--
-- ## The existing key is kept
--
-- `fee_reminder` stays as the name for the ordinary rungs rather than being
-- renamed to the document's `fee_overdue_reminder`. Renaming a template key is a
-- silent break: any school that has already overridden the platform default
-- carries a row keyed on the old name, and the override would stop being found
-- while still appearing in their settings. The document's intent is two
-- messages, not two particular strings, and `REMINDERS.md` is corrected to the
-- implemented names in the same pass.
--
-- ## What a final notice may and may not say
--
-- No threat of exclusion, no mention of withholding results. Zambian private
-- schools do both, and the product must not put words in a school's mouth that
-- a parent could read as policy — that is the school's decision, made by a
-- person, in a letter they sign. The template states the position plainly and
-- asks the parent to come in.
-- ===========================================================================

INSERT INTO public.notification_templates
  (school_id, template_key, channel, language_code, subject, body, variables)
VALUES
  (
    NULL, 'fee_overdue_final', 'whatsapp', 'en', NULL,
    'Dear {{parent_name}}, this is a final reminder that {{student_name}} has an outstanding balance of {{currency}} {{arrears_amount}}, now {{days_overdue}} days past due. Please visit the school office so we can agree how to settle it. — {{school_name}}',
    ARRAY['parent_name', 'student_name', 'currency', 'arrears_amount', 'days_overdue', 'school_name']
  ),
  (
    NULL, 'fee_overdue_final', 'sms', 'en', NULL,
    '{{school_name}}: FINAL REMINDER. {{student_name}} has {{currency}} {{arrears_amount}} outstanding, {{days_overdue}} days overdue. Please visit the office.',
    ARRAY['school_name', 'student_name', 'currency', 'arrears_amount', 'days_overdue']
  ),
  (
    NULL, 'fee_overdue_final', 'email', 'en',
    'Final reminder: outstanding fees for {{student_name}}',
    'Dear {{parent_name}},' || chr(10) || chr(10) ||
    'This is a final reminder that {{student_name}} has an outstanding balance of {{currency}} {{arrears_amount}}, now {{days_overdue}} days past due.' || chr(10) || chr(10) ||
    'We would rather agree a way forward than keep sending reminders. Please visit the school office, or reply to this message, so we can discuss it.' || chr(10) || chr(10) ||
    'If you have already paid, please contact the office with your receipt so we can reconcile it.' || chr(10) || chr(10) ||
    '{{school_name}}',
    ARRAY['parent_name', 'student_name', 'currency', 'arrears_amount', 'days_overdue', 'school_name']
  ),
  (
    NULL, 'fee_overdue_final', 'in_app', 'en', NULL,
    'Final reminder: {{student_name}} has {{currency}} {{arrears_amount}} outstanding, {{days_overdue}} days past due. Please visit the school office.',
    ARRAY['student_name', 'currency', 'arrears_amount', 'days_overdue']
  )
ON CONFLICT DO NOTHING;

/*
  `fee_reminder` has no `in_app` row either, though `0251` lets a school choose
  in-app as its only channel — which would have sent nothing at all, silently.
*/
INSERT INTO public.notification_templates
  (school_id, template_key, channel, language_code, subject, body, variables)
SELECT
  NULL, 'fee_reminder', 'in_app', 'en', NULL,
  '{{student_name}} has {{currency}} {{arrears_amount}} outstanding, {{days_overdue}} days past due. Please contact the school office.',
  ARRAY['student_name', 'currency', 'arrears_amount', 'days_overdue']
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates
  WHERE template_key = 'fee_reminder' AND channel = 'in_app' AND school_id IS NULL
);

-- ---------------------------------------------------------------------------
-- Every channel a school can choose must have a template on both rungs.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_missing TEXT;
BEGIN
  /*
    `0251` offers WhatsApp, email and in-app. A school picking one and finding
    nothing arrives is the exact failure this asserts against — and it would look
    like a delivery problem rather than a missing row.
  */
  SELECT string_agg(k || '/' || c, ', ')
  INTO v_missing
  FROM (VALUES ('fee_reminder'), ('fee_overdue_final')) AS keys(k)
  CROSS JOIN (VALUES ('whatsapp'), ('email'), ('in_app')) AS chans(c)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notification_templates t
    WHERE t.template_key = keys.k
      AND t.channel = chans.c
      AND t.school_id IS NULL
      AND t.is_active
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      '0253: a school could choose a channel with no template: %', v_missing;
  END IF;

  RAISE NOTICE '0253: verified — both rungs have a template on all three channels';
END;
$$;
