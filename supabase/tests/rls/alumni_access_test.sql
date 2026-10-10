-- ===========================================================================
-- ADR-015 — a graduated pupil's parent keeps read-only historical access.
--
-- ## Why this file replaces `supabase/tests/adr015_graduation_access.sql`
--
-- That one was a plain SQL script meant for `supabase db query`, and it sat
-- inside `supabase/tests/`, which `supabase test db` globs. The runner expected
-- TAP, found no `plan()`, and failed the whole database job with
-- "Parse errors: No plan found in TAP output" — after every one of the 37 real
-- suites had passed.
--
-- Converting it rather than moving it is the better answer: ADR-015's guarantee
-- is permanent and load-bearing, so it belongs in CI rather than in a script
-- somebody has to remember to run.
--
-- It also had to grow its own fixture. The original searched for an existing
-- linked parent, which works against seeded `zsms-dev` and finds nothing at all
-- in CI, where every migration is applied to an EMPTY database.
--
-- ## What it proves
--
-- ADR-015: "When a student graduates or leaves, their ZSMS account remains
-- active permanently with read-only historical access."
--
-- A first reading of that ADR took it to mean a new `alumni_profiles` table. It
-- does not describe a new entity — it describes an account that is NOT revoked,
-- which is a property of the existing policies. No parent policy filters on
-- `students.status`, so the guarantee should already hold. "Should already hold"
-- is exactly the kind of claim this repository has been wrong about, so it is
-- exercised rather than asserted.
-- ===========================================================================

BEGIN;

-- pgTAP lives in `extensions` (migration 0001); see the note in `audit_logs_test`.
SET search_path TO public, extensions;

SELECT plan(8);

-- ---------------------------------------------------------------------------
-- One school, one pupil, one linked parent, and some history worth keeping.
-- ---------------------------------------------------------------------------
INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES ('a0000000-0000-4000-8000-00000000a015', 'ZM-LSK-9015', 'org_alumni_a',
        'Alumni Academy', 'day', 'combined', 'LSK', 'active');

INSERT INTO public.students
  (id, student_id, school_id, first_name, last_name, grade_id, class_id, status)
VALUES ('a0000000-0000-4000-8000-00000000b015', 'STU-ZM-LSK-9015-00001',
        'a0000000-0000-4000-8000-00000000a015', 'Grad', 'Uate',
        'grade_12', 'grade_12a', 'active');

INSERT INTO public.parents (id, clerk_user_id, full_name, email, phone_e164)
VALUES ('a0000000-0000-4000-8000-00000000c015', 'user_alumni_parent',
        'Pa Rent', 'parent@example.test', '+260970000015');

INSERT INTO public.student_parent_links
  (student_id, parent_id, parent_user_id, relationship, is_primary)
VALUES ('a0000000-0000-4000-8000-00000000b015',
        'a0000000-0000-4000-8000-00000000c015', 'user_alumni_parent',
        'mother', TRUE);

-- A published result, which is the history ADR-015 exists to preserve.
INSERT INTO public.exam_results
  (school_id, student_id, class_id, academic_year, term_number,
   subject_code, subject_name, entered_by_user_id,
   marks_obtained, marks_total, results_published, published_at)
VALUES ('a0000000-0000-4000-8000-00000000a015',
        'a0000000-0000-4000-8000-00000000b015', 'grade_12a', '2026', 3,
        -- `exam_results_published_has_timestamp` requires the date alongside the
        -- flag: a result marked published with no publication date cannot answer
        -- "when did the parent become entitled to see this".
        'MAT', 'Mathematics', 'user_a_teacher', 78, 100, TRUE, NOW());

-- ---------------------------------------------------------------------------
-- While enrolled.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_alumni_parent", "role": "authenticated",
  "email": "parent@example.test",
  "o": {"id": "org_alumni_a", "rol": "parent", "slg": "alumni-academy"}
}';

SELECT is(
  (SELECT count(*)::INT FROM public.students
    WHERE id = 'a0000000-0000-4000-8000-00000000b015'),
  1,
  'the parent sees their child while enrolled'
);

SELECT is(
  (SELECT count(*)::INT FROM public.exam_results
    WHERE student_id = 'a0000000-0000-4000-8000-00000000b015'),
  1,
  'and the published result'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Graduate them. This is the whole point of the ADR.
-- ---------------------------------------------------------------------------
UPDATE public.students SET status = 'graduated'
WHERE id = 'a0000000-0000-4000-8000-00000000b015';

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_alumni_parent", "role": "authenticated",
  "email": "parent@example.test",
  "o": {"id": "org_alumni_a", "rol": "parent", "slg": "alumni-academy"}
}';

SELECT is(
  (SELECT count(*)::INT FROM public.students
    WHERE id = 'a0000000-0000-4000-8000-00000000b015'),
  1,
  'ADR-015 the parent STILL sees their child after graduation'
);

SELECT is(
  (SELECT count(*)::INT FROM public.exam_results
    WHERE student_id = 'a0000000-0000-4000-8000-00000000b015'),
  1,
  'ADR-015 past results survive graduation — the record is not revoked with the enrolment'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Marketing consent: off until given, and separate from service messages.
-- ---------------------------------------------------------------------------

-- ADR-015 is explicit that the two are independent, so the defaults are asserted
-- rather than trusted: a later migration flipping either would silently change
-- the legal basis for every message AfriTech sends.
SELECT is(
  (SELECT marketing_opt_in FROM public.parents
    WHERE id = 'a0000000-0000-4000-8000-00000000c015'),
  FALSE,
  'ADR-015 marketing consent is OFF until explicitly given'
);

SELECT is(
  (SELECT whatsapp_opted_in FROM public.parents
    WHERE id = 'a0000000-0000-4000-8000-00000000c015'),
  TRUE,
  'ADR-015 service messages stay ON — that is what the parent enrolled for'
);

-- Consent needs evidence, not just a flag: "prove they agreed" is the only
-- question that matters if a regulator asks, and a boolean cannot answer it.
UPDATE public.parents SET marketing_opt_in = TRUE
WHERE id = 'a0000000-0000-4000-8000-00000000c015';

SELECT isnt(
  (SELECT marketing_opt_in_at FROM public.parents
    WHERE id = 'a0000000-0000-4000-8000-00000000c015'),
  NULL,
  'giving consent stamps WHEN, so the evidence exists and cannot be client-supplied'
);

-- ---------------------------------------------------------------------------
-- AfriTech counts the opted-in. It must never be handed the list.
-- ---------------------------------------------------------------------------

-- `0169` set this precedent for AI credits. It holds harder here: a function
-- returning the opted-in parents would be a marketing list assembled out of every
-- school's roll, which is not what a school agreed to by signing up.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_school_owner", "role": "authenticated",
  "o": {"id": "org_alumni_a", "rol": "owner", "slg": "alumni-academy"}
}';

SELECT throws_ok(
  $$SELECT * FROM public.admin_marketing_consent_summary()$$,
  '42501',
  NULL,
  'a school owner cannot read the marketing consent summary — it spans every school'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
