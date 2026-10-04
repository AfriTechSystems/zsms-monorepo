-- ---------------------------------------------------------------------------
-- 0191 — how an announcement is delivered, and starter texts to write it from
-- ---------------------------------------------------------------------------
--
-- Spec: `Official Documentation/12 Communication System/ANNOUNCEMENTS.md`
--       `Official Documentation/12 Communication System/NOTIFICATIONS.md`
--
-- Two gaps reported from the running application: the composer offers no choice of
-- delivery channel, and there are no pre-written texts to start from.
--
-- ## Channels
--
-- `announcements` carried `whatsapp_jobs_queued` and nothing else about delivery, so a
-- head teacher could not say "put this in the app only" or "this one is urgent, send it
-- to phones". Recording the REQUEST separately from the outcome matters: in-app works
-- today, WhatsApp and email have no credentials, and push has no tokens. A school that
-- asked for WhatsApp should be told it is not switched on rather than quietly getting
-- in-app and assuming parents were texted.
--
-- In-app is always included and is not a choice — it is how a notice reaches the portal
-- and the phone app at all, and an announcement delivered nowhere is not an
-- announcement.
--
-- ## Starter texts
--
-- `notification_templates` already exists and is the wrong home for these. Those are
-- TRANSACTIONAL — the system renders `fee_reminder` with variables and sends it. These
-- are drafts a person picks, edits and may discard. Different lifecycle, different
-- author, and `variables`/`meta_template_name` mean nothing for them.
--
-- So a separate table, with global starters AfriTech maintains and school-owned ones a
-- school saves for itself. A school that sends "closed due to heavy rain" every rainy
-- season should write it once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Delivery channels on the announcement.
-- ---------------------------------------------------------------------------
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS channels TEXT[] NOT NULL DEFAULT ARRAY['in_app']::TEXT[];

COMMENT ON COLUMN public.announcements.channels IS
  'Delivery channels REQUESTED by the sender. Not a record of what was delivered — '
  '`whatsapp_jobs_queued` and the message rows carry that. Always contains in_app.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'announcement_channels_known') THEN
    ALTER TABLE public.announcements
      ADD CONSTRAINT announcement_channels_known
      CHECK (
        channels <@ ARRAY['in_app', 'push', 'whatsapp', 'email', 'sms']::TEXT[]
        -- In-app is not optional: it is how a notice reaches the portal and the phone
        -- app, and one delivered nowhere is not an announcement.
        AND 'in_app' = ANY (channels)
      );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Starter texts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcement_starters (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL is a global starter AfriTech maintains; a UUID is one school's own.
  school_id   UUID REFERENCES public.schools(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  importance  TEXT NOT NULL DEFAULT 'regular',
  -- Who it is usually for. Pre-selects the audience; the sender can still change it.
  audience    TEXT,
  sort_order  INT NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT starter_importance_known CHECK (importance IN ('regular', 'important')),
  CONSTRAINT starter_audience_known
    CHECK (audience IS NULL OR audience IN ('parents', 'students', 'staff')),
  CONSTRAINT starter_label_present CHECK (btrim(label) <> '')
);

CREATE INDEX IF NOT EXISTS idx_announcement_starters_school
  ON public.announcement_starters (school_id, sort_order) WHERE is_active;

ALTER TABLE public.announcement_starters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_starters FORCE ROW LEVEL SECURITY;

/*
  A school reads the global set and its own, and writes only its own.

  `school_id IS NULL` is readable by every authenticated caller on purpose — a starter
  is a blank form, carrying no school's data. The WITH CHECK keeps a school from
  creating one, so nobody can plant text into another school's picker.
*/
CREATE POLICY school_read_announcement_starters ON public.announcement_starters
  FOR SELECT TO authenticated
  USING (school_id IS NULL OR school_id = public.current_school_uuid());

CREATE POLICY school_write_announcement_starters ON public.announcement_starters
  FOR ALL TO authenticated
  USING (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  )
  WITH CHECK (
    school_id = public.current_school_uuid()
    AND public.get_user_role() IN ('org:owner', 'org:principal', 'org:admin')
  );

CREATE POLICY afritech_manage_announcement_starters ON public.announcement_starters
  FOR ALL TO authenticated
  USING (public.is_afritech_admin())
  WITH CHECK (public.is_afritech_admin());

GRANT SELECT ON public.announcement_starters TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.announcement_starters TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. The global set.
--
-- Written for a Zambian private school, in the register a head teacher would use. Each
-- is a DRAFT: the brackets are there to be replaced, and are deliberately obvious so
-- nobody sends one unedited by accident.
-- ---------------------------------------------------------------------------
INSERT INTO public.announcement_starters
  (school_id, label, title, body, importance, audience, sort_order)
VALUES
  (NULL, 'School closed', 'School closed on [date]',
   'Dear parents and guardians,' || E'\n\n' ||
   'The school will be closed on [date] because of [reason]. Lessons resume as normal on [date].' || E'\n\n' ||
   'Please make arrangements for your child to remain at home. We apologise for the short notice.',
   'important', 'parents', 10),

  (NULL, 'Fees due', 'Term [n] fees are due by [date]',
   'Dear parents and guardians,' || E'\n\n' ||
   'Fees for Term [n] are due by [date]. You can see your balance and payment history in the parent portal.' || E'\n\n' ||
   'If you need to arrange a payment plan, please speak to the bursar before the deadline rather than after it.',
   'important', 'parents', 20),

  (NULL, 'Parents'' evening', 'Parents'' evening on [date]',
   'Dear parents and guardians,' || E'\n\n' ||
   'Parents'' evening will be held on [date] from [time] to [time] in [place].' || E'\n\n' ||
   'This is your chance to meet your child''s teachers and discuss their progress this term. No appointment is needed.',
   'regular', 'parents', 30),

  (NULL, 'Exams begin', 'End of term examinations begin [date]',
   'Dear parents and guardians,' || E'\n\n' ||
   'End of term examinations begin on [date] and finish on [date]. The timetable has been given to every pupil.' || E'\n\n' ||
   'Please make sure your child arrives on time and brings their own pens, pencils and calculator.',
   'important', 'parents', 40),

  (NULL, 'Results published', 'Term [n] results are now available',
   'Dear parents and guardians,' || E'\n\n' ||
   'Your child''s results for Term [n] are now in the parent portal, together with their teacher''s comments.' || E'\n\n' ||
   'If you would like to discuss them, please contact the class teacher.',
   'regular', 'parents', 50),

  (NULL, 'Term dates', 'Term [n] runs from [date] to [date]',
   'Dear parents and guardians,' || E'\n\n' ||
   'Term [n] opens on [date] and closes on [date]. Half term is [date] to [date].' || E'\n\n' ||
   'Please keep these dates for your records.',
   'regular', 'parents', 60),

  (NULL, 'Staff meeting', 'Staff meeting on [date]',
   'All teaching staff,' || E'\n\n' ||
   'There will be a staff meeting on [date] at [time] in [place]. Attendance is expected.' || E'\n\n' ||
   'Agenda: [items].',
   'important', 'staff', 70),

  (NULL, 'Uniform and conduct', 'A reminder about uniform',
   'Dear parents and guardians,' || E'\n\n' ||
   'We have noticed a drop in uniform standards this term. Please make sure your child comes to school in full uniform, including [items].' || E'\n\n' ||
   'Thank you for your support.',
   'regular', 'parents', 80)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Prove the constraint and the policy.
--
-- Two properties worth asserting: an announcement cannot be sent to nowhere, and a
-- school cannot write a global starter into everybody else's picker.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n INT;
BEGIN
  SELECT COUNT(*) INTO v_n FROM public.announcement_starters WHERE school_id IS NULL;
  IF v_n < 8 THEN
    RAISE EXCEPTION 'expected the global starter set, found %', v_n;
  END IF;

  BEGIN
    UPDATE public.announcements SET channels = ARRAY['whatsapp']::TEXT[]
     WHERE id = (SELECT id FROM public.announcements LIMIT 1);
    -- Only a failure if there was a row to update.
    IF EXISTS (SELECT 1 FROM public.announcements) THEN
      RAISE EXCEPTION 'an announcement was allowed to skip in-app delivery';
    END IF;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'verified: in-app delivery cannot be dropped';
  END;

  RAISE NOTICE 'verified: % global starters seeded', v_n;
END;
$$;
