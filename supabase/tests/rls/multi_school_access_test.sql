-- ===========================================================================
-- Multi-school access — parents span schools, staff do not.
--
-- Spec: Official Documentation/02 Authentication and Identity/AUTH.md
--       Official Documentation/07 Student and Parent Modules/PARENTS.md
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- ## The asymmetry it protects
--
-- Every parent policy in this schema is keyed on the PARENT, not on the active
-- school: all twelve resolve through `is_linked_parent_of()`,
-- `parent_can_access_fee_record()` or `parent_has_child_at_school()`, and not one
-- mentions `current_school_uuid()`. So a parent with children at two ZSMS schools
-- already reads both from one session, with no organisation switching.
--
-- That was established by asserting the opposite and being wrong — the first
-- version of this suite expected a parent to see one child and it saw two. Worth
-- recording, because the asymmetry is easy to "tidy up" into school-scoping and
-- that would silently break every two-school family.
--
-- Staff are the opposite: their policies DO scope on `current_school_uuid()`, so a
-- teacher employed at two schools sees one at a time and needs a switcher. Both
-- halves are asserted here so neither can drift into the other.
--
-- ## The boundary that must not move
--
-- Cross-school for a parent means THEIR OWN children, and nothing else. A parent
-- with no child at a school reads none of its notices — asserted directly, because
-- that single condition is what separates "convenient" from "a cross-tenant leak".
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SELECT plan(11);

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES
 ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_a','Alpha Academy','day','combined','LSK','active'),
 ('22222222-2222-2222-2222-222222222222','ZM-NDL-0002','org_b','Beta School','day','combined','NDL','active');

INSERT INTO public.students (id, student_id, school_id, first_name, last_name, grade_id, class_id)
VALUES
 ('aaaa0000-0000-0000-0000-000000000001','STU-A-1','11111111-1111-1111-1111-111111111111','Alice','Mwale','grade_7','grade_7a'),
 ('bbbb0000-0000-0000-0000-000000000001','STU-B-1','22222222-2222-2222-2222-222222222222','Ben','Mwale','grade_4','grade_4a'),
 -- Another family at Alpha, so "only my own children" has something to fail on.
 ('dddd0000-0000-0000-0000-000000000001','STU-A-2','11111111-1111-1111-1111-111111111111','Other','Family','grade_7','grade_7a');

INSERT INTO public.parents (id, clerk_user_id, phone_e164, full_name, preferred_contact)
VALUES
 ('eeee0000-0000-0000-0000-000000000001','user_parent_m','+260970000001','M Mwale','whatsapp'),
 -- A parent with a child at Alpha ONLY. The control for the leak assertion.
 ('eeee0000-0000-0000-0000-000000000002','user_parent_x','+260970000002','X Other','whatsapp');

INSERT INTO public.student_parent_links (student_id, parent_id, parent_user_id, is_active, is_primary)
VALUES
 ('aaaa0000-0000-0000-0000-000000000001','eeee0000-0000-0000-0000-000000000001','user_parent_m',TRUE,TRUE),
 ('bbbb0000-0000-0000-0000-000000000001','eeee0000-0000-0000-0000-000000000001','user_parent_m',TRUE,TRUE),
 ('dddd0000-0000-0000-0000-000000000001','eeee0000-0000-0000-0000-000000000002','user_parent_x',TRUE,TRUE);

-- One person employed at both schools.
INSERT INTO public.staff_members (school_id, clerk_user_id, first_name, last_name)
VALUES
 ('11111111-1111-1111-1111-111111111111','user_teach_t','T','Teacher'),
 ('22222222-2222-2222-2222-222222222222','user_teach_t','T','Teacher');

INSERT INTO public.announcements
  (id, school_id, title, body, importance, target_audience, target_scope,
   target_ids, created_by, status, sent_at)
VALUES
 ('ccc00000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111',
  'Alpha closure','...','important','parents','school','{}','u','sent',NOW()),
 ('ccc00000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222',
  'Beta sports day','...','regular','parents','school','{}','u','sent',NOW()),
 ('ccc00000-0000-0000-0000-0000000000b2','22222222-2222-2222-2222-222222222222',
  'Beta staff only','...','regular','staff','school','{}','u','sent',NOW());

SET LOCAL ROLE authenticated;

-- ---------------------------------------------------------------------------
-- The two-school parent, signed into Alpha only. Beta is the other school.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub":"user_parent_m","role":"authenticated",
  "o":{"id":"org_a","rol":"parent","slg":"alpha-academy"}}';

SELECT is(
  (SELECT count(*)::int FROM public.students),
  2,
  'a parent already reads children at BOTH schools from one session'
);

SELECT is(
  (SELECT count(*)::int FROM public.my_children()),
  2,
  'my_children() agrees with the ordinary policy'
);

SELECT is(
  (SELECT count(*)::int FROM public.students WHERE last_name = 'Family'),
  0,
  'and never another family''s child'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-0000000000a1'),
  1,
  'reads a notice from the school the session is acting in'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-0000000000b1'),
  1,
  'and from the OTHER school where they have a child — notices now match children'
);

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-0000000000b2'),
  0,
  'but not that school''s staff notice — the audience filter still applies'
);

SELECT lives_ok(
  $$ INSERT INTO public.announcement_reads
       (school_id, announcement_id, reader_user_id, reader_type)
     VALUES ('22222222-2222-2222-2222-222222222222',
             'ccc00000-0000-0000-0000-0000000000b1','user_parent_m','parent') $$,
  'and can mark the other school''s notice read, so escalation stops chasing it'
);

-- ---------------------------------------------------------------------------
-- THE BOUNDARY. A parent with no child at Beta gets nothing from Beta.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub":"user_parent_x","role":"authenticated",
  "o":{"id":"org_a","rol":"parent","slg":"alpha-academy"}}';

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-0000000000b1'),
  0,
  'a parent with no child at Beta reads no Beta notice — the whole boundary'
);

SELECT is(
  (SELECT count(*)::int FROM public.students),
  1,
  'and reads only their own one child'
);

-- ---------------------------------------------------------------------------
-- Staff remain school-scoped. This is why THEY need a switcher and parents do not.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub":"user_teach_t","role":"authenticated",
  "o":{"id":"org_a","rol":"teacher","slg":"alpha-academy"}}';

SELECT is(
  (SELECT count(*)::int FROM public.announcements
    WHERE id='ccc00000-0000-0000-0000-0000000000b2'),
  0,
  'a teacher employed at both does NOT read the other school''s staff notice'
);

SELECT is(
  (SELECT count(*)::int FROM public.my_schools()),
  2,
  'but my_schools() offers both, which is exactly what the switcher needs'
);

SELECT * FROM finish();
ROLLBACK;
