-- ===========================================================================
-- Announcement audience — an announcement reaches who it was addressed to.
--
-- Spec: Official Documentation/12 Communication System/ANNOUNCEMENTS.md
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- `school_members_read_sent_announcements` filtered on school and `status='sent'`
-- and consulted `target_type` not at all. Parents and pupils are members of the
-- school's Clerk organisation (`org:parent`, `org:student`), so
-- `current_school_uuid()` resolves for them — which means **every parent could
-- read every notice addressed to `all_staff`**.
--
-- That matters because of what a staff notice contains: a disciplinary process, a
-- salary meeting, a safeguarding concern, which teacher is leaving. The compose
-- screen offers "All staff" and a school reasonably believes it means staff.
--
-- The first assertion is that exact case. The rest establish that narrowing it
-- did not break the audiences that should receive things, and that a notice the
-- school has not released stays with management.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SELECT plan(12);

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_school_a',
        'Alpha Academy','day','combined','LSK','active');

INSERT INTO public.students
  (id, student_id, school_id, first_name, last_name, grade_id, class_id, clerk_user_id)
VALUES
 ('aaaa0000-0000-0000-0000-000000000001','STU-ZM-LSK-0001-00001',
  '11111111-1111-1111-1111-111111111111','Alice','Alpha','grade_7','grade_7a','user_pupil_alice'),
 -- A pupil in a DIFFERENT grade, with no parent link. Exists so a grade-targeted
 -- notice has a grade the test parent is not in.
 ('aaaa0000-0000-0000-0000-000000000002','STU-ZM-LSK-0001-00002',
  '11111111-1111-1111-1111-111111111111','Ben','Banda','grade_9','grade_9b',NULL);

INSERT INTO public.parents (id, clerk_user_id, phone_e164, full_name, preferred_contact)
VALUES ('bbbb0000-0000-0000-0000-000000000001','user_parent_p','+260970000001',
        'P Parent','whatsapp');

INSERT INTO public.student_parent_links
  (student_id, parent_id, parent_user_id, is_active, is_primary)
VALUES ('aaaa0000-0000-0000-0000-000000000001',
        'bbbb0000-0000-0000-0000-000000000001','user_parent_p',TRUE,TRUE);

INSERT INTO public.announcements
  (id, school_id, title, body, importance, target_type, target_ids, created_by, status, sent_at)
VALUES
 ('ccc00000-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111',
  'Staff salary meeting','...','regular','all_staff','{}','user_prin','sent',NOW()),
 ('ccc00000-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111',
  'School closed Friday','...','important','all_parents','{}','user_prin','sent',NOW()),
 ('ccc00000-0000-0000-0000-00000000000c','11111111-1111-1111-1111-111111111111',
  'Grade 7 trip','...','regular','grade','{grade_7}','user_prin','sent',NOW()),
 ('ccc00000-0000-0000-0000-00000000000d','11111111-1111-1111-1111-111111111111',
  'Grade 9 exams','...','regular','grade','{grade_9}','user_prin','sent',NOW()),
 ('ccc00000-0000-0000-0000-00000000000e','11111111-1111-1111-1111-111111111111',
  'Draft notice','...','regular','all_parents','{}','user_prin','draft',NULL),
 ('ccc00000-0000-0000-0000-00000000000f','11111111-1111-1111-1111-111111111111',
  'Pupils assembly','...','regular','all_students','{}','user_prin','sent',NOW());

SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------------------
-- The parent.
-- ---------------------------------------------------------------------------
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
  1,
  'a parent reads a notice addressed to all parents'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000c'),
  1,
  'a parent reads a grade notice for a grade their own child is in'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000d'),
  0,
  'a parent cannot read a grade notice for a grade none of their children is in'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000e'),
  0,
  'a parent cannot read a draft — unsent means unreleased'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000f'),
  0,
  'a parent cannot read a notice addressed to pupils'
);

-- ---------------------------------------------------------------------------
-- The pupil.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub":"user_pupil_alice","role":"authenticated",
  "o":{"id":"org_school_a","rol":"student","slg":"alpha-academy"}}';

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000f'),
  1,
  'a pupil reads a notice addressed to all pupils'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000a'),
  0,
  'a pupil cannot read a notice addressed to all staff'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000b'),
  0,
  'a pupil does not read notices written to their parents'
);

-- ---------------------------------------------------------------------------
-- The teacher.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub":"user_tea","role":"authenticated",
  "o":{"id":"org_school_a","rol":"teacher","slg":"alpha-academy"}}';

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000a'),
  1,
  'a teacher reads a notice addressed to all staff'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-00000000000b'),
  0,
  'a teacher does not read notices written to parents — "all parents" is not "everyone"'
);

-- ---------------------------------------------------------------------------
-- Management. Narrowing the member policy must not narrow theirs.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub":"user_prin","role":"authenticated",
  "o":{"id":"org_school_a","rol":"principal","slg":"alpha-academy"}}';

SELECT is(
  (SELECT count(*)::int FROM public.announcements),
  6,
  'management still sees every notice at its school, including the draft'
);

SELECT * FROM finish();
ROLLBACK;
