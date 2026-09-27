-- ===========================================================================
-- Announcement audience and scope — who is told, and who is actually delivered to.
--
-- Spec: Official Documentation/12 Communication System/ANNOUNCEMENTS.md
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- Three separate defects live behind these assertions, and each was invisible
-- from the screen that caused it.
--
-- 1. **A disclosure.** `school_members_read_sent_announcements` filtered on school
--    and `status='sent'` and consulted the target not at all. Parents and pupils
--    are members of the school's Clerk organisation, so every parent could read
--    every notice addressed to `all_staff` — where a school writes about
--    disciplinary processes, salaries and safeguarding.
--
-- 2. **Silent non-delivery.** `worker_announcement_recipients()` joined only to
--    `parents` and filtered `target_type IN ('all_parents','grade','class')`. A
--    staff or pupil notice resolved ZERO recipients, nothing was queued, and the
--    announcement still reported as sent. "Sent" meant "the queue ran", not
--    "anybody was told".
--
-- 3. **An inversion.** `target_type` conflated audience with scope, so
--    "Grade 7 pupils" was not expressible — `grade` meant parents by accident of
--    implementation. When the columns were split (0114) the policies still called
--    the flattened compatibility wrapper, which guesses parents. A notice written
--    to Grade 7 PUPILS became readable by Grade 7 PARENTS and invisible to the
--    pupils. Both directions are asserted below, which is what rules out a
--    one-sided mistake in the test itself.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SELECT plan(16);

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_school_a',
        'Alpha Academy','day','combined','LSK','active');

INSERT INTO public.students
  (id, student_id, school_id, first_name, last_name, grade_id, class_id, clerk_user_id)
VALUES
 ('aaaa0000-0000-0000-0000-000000000001','STU-ZM-LSK-0001-00001',
  '11111111-1111-1111-1111-111111111111','Alice','Alpha','grade_7','grade_7a','user_pupil_alice'),
 -- A pupil in another grade, so a grade-scoped notice has somewhere to NOT reach.
 ('aaaa0000-0000-0000-0000-000000000002','STU-ZM-LSK-0001-00002',
  '11111111-1111-1111-1111-111111111111','Ben','Banda','grade_9','grade_9b','user_pupil_ben');

INSERT INTO public.parents (id, clerk_user_id, phone_e164, full_name, preferred_contact)
VALUES ('bbbb0000-0000-0000-0000-000000000001','user_parent_p','+260970000001',
        'P Parent','whatsapp');

INSERT INTO public.student_parent_links
  (student_id, parent_id, parent_user_id, is_active, is_primary)
VALUES ('aaaa0000-0000-0000-0000-000000000001',
        'bbbb0000-0000-0000-0000-000000000001','user_parent_p',TRUE,TRUE);

INSERT INTO public.staff_members
  (school_id, clerk_user_id, first_name, last_name, phone_e164, email)
VALUES ('11111111-1111-1111-1111-111111111111','user_staff_s','Sara','Staff',
        '+260970000002','s@x.test');

-- The six shapes that matter. Note the last two: same grade, same ids, different
-- audience — the pair the old model could not tell apart.
INSERT INTO public.announcements
  (id, school_id, title, body, importance, target_audience, target_scope,
   target_ids, created_by, status, sent_at)
VALUES
 ('ccc00000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111',
  'Staff meeting','...','regular','staff','school','{}','user_prin','sent',NOW()),
 ('ccc00000-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111',
  'Assembly','...','regular','students','school','{}','user_prin','sent',NOW()),
 ('ccc00000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111',
  'Grade 7 pupils only','...','regular','students','grade','{grade_7}','user_prin','sent',NOW()),
 ('ccc00000-0000-0000-0000-00000000000d','11111111-1111-1111-1111-111111111111',
  'Private word','...','important','individuals','individual','{user_parent_p}','user_prin','sent',NOW()),
 ('ccc00000-0000-0000-0000-00000000000e','11111111-1111-1111-1111-111111111111',
  'Closure','...','important','parents','school','{}','user_prin','sent',NOW()),
 ('ccc00000-0000-0000-0000-00000000000f','11111111-1111-1111-1111-111111111111',
  'Grade 7 parents','...','regular','parents','grade','{grade_7}','user_prin','sent',NOW());

-- ---------------------------------------------------------------------------
-- Delivery. Defect 2: these four returned nothing for staff and pupils.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.worker_announcement_recipients(
     'ccc00000-0000-0000-0000-00000000000a')),
  1,
  'a staff notice resolves a recipient — it resolved zero before 0115'
);

SELECT is(
  (SELECT count(*)::int FROM public.worker_announcement_recipients(
     'ccc00000-0000-0000-0000-00000000000b')),
  2,
  'an all-pupils notice resolves both pupils — it resolved zero before 0115'
);

SELECT is(
  (SELECT out_user_id FROM public.worker_announcement_recipients(
     'ccc00000-0000-0000-0000-00000000000c')),
  'user_pupil_alice',
  'a grade notice to PUPILS is delivered to the pupil'
);

SELECT is(
  (SELECT out_user_id FROM public.worker_announcement_recipients(
     'ccc00000-0000-0000-0000-00000000000f')),
  'user_parent_p',
  'the same grade, addressed to PARENTS, is delivered to the parent'
);

SELECT is(
  (SELECT count(*)::int FROM public.worker_announcement_recipients(
     'ccc00000-0000-0000-0000-00000000000d')),
  1,
  'an individually addressed notice resolves exactly that person'
);

-- ---------------------------------------------------------------------------
-- The parent. Defects 1 and 3.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub":"user_parent_p","role":"authenticated",
  "o":{"id":"org_school_a","rol":"parent","slg":"alpha-academy"}}';

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000a'),
  0,
  'THE DISCLOSURE: a parent cannot read a notice addressed to all staff'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000b'),
  0,
  'a parent cannot read a notice addressed to all pupils'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000c'),
  0,
  'THE INVERSION: a parent does NOT read a notice addressed to grade 7 pupils'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000f'),
  1,
  'but does read the one addressed to grade 7 parents'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000d'),
  1,
  'and one addressed to them individually'
);

-- ---------------------------------------------------------------------------
-- The pupils.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub":"user_pupil_alice","role":"authenticated",
  "o":{"id":"org_school_a","rol":"student","slg":"alpha-academy"}}';

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000c'),
  1,
  'THE INVERSION, other direction: the grade 7 pupil DOES read it'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000f'),
  0,
  'and does not read the notice written to their parents'
);

SET LOCAL request.jwt.claims TO '{
  "sub":"user_pupil_ben","role":"authenticated",
  "o":{"id":"org_school_a","rol":"student","slg":"alpha-academy"}}';

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000c'),
  0,
  'a pupil in another grade does not read a grade 7 notice'
);

-- ---------------------------------------------------------------------------
-- Staff.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub":"user_staff_s","role":"authenticated",
  "o":{"id":"org_school_a","rol":"teacher","slg":"alpha-academy"}}';

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000a'),
  1,
  'staff read the staff notice'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000f'),
  0,
  'staff do not read notices written to parents — "all parents" is not "everyone"'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000d'),
  0,
  'somebody not named in an individual notice cannot read it'
);

SELECT * FROM finish();
ROLLBACK;
