-- ===========================================================================
-- The public school directory — the first surface in ZSMS an anonymous caller may read.
--
-- Spec: Official Documentation/06 School and Tenant Management/PUBLIC_DIRECTORY.md
--       Official Documentation/15 Super Admin and Platform/SCHOOL_HEALTH_SCORES.md
--
-- Every other read path here resolves through a Clerk claim. This one has no caller identity at all,
-- so the questions are different and the suite is organised around them:
--
--   1. Can `anon` reach ONLY the two functions intended, and nothing beneath them?
--   2. Does a school that has published nothing leak anything?
--   3. Is each published figure behind its own switch, or does one flag open several?
--   4. Is the ratio computed from people who actually teach?
--   5. Can the withheld roll be reconstructed from what IS published?
--
-- Question 5 is the one worth stating plainly. `PUBLIC_DIRECTORY.md` withholds student count as
-- competitively sensitive, and publishing a teacher count beside a 1:22 ratio would hand it straight
-- back — multiply and you have the roll. So the public functions return derived figures only, and the
-- function that knows the counts is not reachable without an account.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(27);

-- ---------------------------------------------------------------------------
-- What `anon` may and may not reach.
-- ---------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('anon',
    'public.search_schools(text,text,text,text,text,text,boolean,boolean,numeric,integer,integer)',
    'EXECUTE'),
  'anon may search the directory — a parent looking for their child''s school has no account'
);

SELECT ok(
  has_function_privilege('anon', 'public.school_public_profile(text)', 'EXECUTE'),
  '...and may read one school''s profile'
);

/**
 * THE RECONSTRUCTION GUARD. `school_verified_metrics()` returns the raw pupil and teacher counts.
 * Reachable by `anon`, it would hand back the exact number `PUBLIC_DIRECTORY.md` withholds — and
 * would also make the careful ratio-only design of the two functions above pointless.
 *
 * `0155` granted it to `authenticated` only; `0156` revoked the inherited PUBLIC grant and verified
 * the result, because `0151` had made the same revoke and not checked it.
 */
SELECT ok(
  NOT has_function_privilege('anon', 'public.school_verified_metrics(uuid)', 'EXECUTE'),
  'but NOT the function holding the raw counts — a count beside a ratio reconstructs the roll'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.schools', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.school_public_profiles', 'SELECT'),
  'and no table beneath them — the boundary is named columns, not a widened policy'
);

-- ---------------------------------------------------------------------------
-- Four schools: listed, unlisted by status, published, and withheld.
-- ---------------------------------------------------------------------------
INSERT INTO public.schools
  (id, school_id, clerk_org_id, name, type, level, city_code, province_code,
   status, subscription_tier)
VALUES
  ('11111111-1111-1111-1111-111111111111','ZM-LSK-0001','org_open','Open Academy',
   'day','combined','LSK','LSK','active','starter'),
  ('22222222-2222-2222-2222-222222222222','ZM-LSK-0002','org_quiet','Quiet School',
   'day','primary','LSK','LSK','active','starter'),
  ('33333333-3333-3333-3333-333333333333','ZM-NDL-0001','org_gone','Terminated College',
   'day','combined','NDL','CBR','terminated','starter'),
  ('44444444-4444-4444-4444-444444444444','ZM-KIT-0001','org_unverified','Awaiting Verification',
   'boarding','secondary','KIT','CBR','pending_verification','starter');

INSERT INTO public.school_grade_levels
  (school_id, level_id, display_name, level_order, level_type, examination_type, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','grade_1','Grade 1',1,'primary','internal',TRUE),
  ('11111111-1111-1111-1111-111111111111','grade_2','Grade 2',2,'primary','internal',TRUE);

-- Four pupils across two classes.
INSERT INTO public.students
  (student_id, school_id, first_name, last_name, grade_id, class_id)
VALUES
  ('STU-ZM-LSK-0001-00001','11111111-1111-1111-1111-111111111111','A','One','grade_1','grade_1a'),
  ('STU-ZM-LSK-0001-00002','11111111-1111-1111-1111-111111111111','B','Two','grade_1','grade_1a'),
  ('STU-ZM-LSK-0001-00003','11111111-1111-1111-1111-111111111111','C','Three','grade_2','grade_2a'),
  ('STU-ZM-LSK-0001-00004','11111111-1111-1111-1111-111111111111','D','Four','grade_2','grade_2a');

-- Two people who actually teach.
INSERT INTO public.teacher_assignments
  (school_id, class_id, teacher_user_id, academic_year, scope, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111','grade_1a','user_teacher_1','2026','class',TRUE),
  ('11111111-1111-1111-1111-111111111111','grade_2a','user_teacher_2','2026','class',TRUE);

-- ---------------------------------------------------------------------------
-- The metrics, before anything is published.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT out_pupils_per_teacher
     FROM public.school_verified_metrics('11111111-1111-1111-1111-111111111111')),
  2.0::NUMERIC,
  'four pupils and two teachers is a ratio of 1 to 2'
);

/**
 * THE VANITY-METRIC GUARD.
 *
 * A school's staff list holds the bursar, the matron and the driver. Counting them would improve
 * every ratio in the directory without a single extra teacher being hired, which would make the
 * number worthless — and worse than worthless, since it would be badged as verified.
 */
INSERT INTO public.staff_members
  (school_id, clerk_user_id, first_name, last_name, employment_type)
VALUES
  ('11111111-1111-1111-1111-111111111111','user_bursar','Bea','Bursar','full_time'),
  ('11111111-1111-1111-1111-111111111111','user_driver','Dan','Driver','full_time');

SELECT is(
  (SELECT out_pupils_per_teacher
     FROM public.school_verified_metrics('11111111-1111-1111-1111-111111111111')),
  2.0::NUMERIC,
  '...and hiring a bursar and a driver does not improve it — teachers come from assignments'
);

SELECT is(
  (SELECT out_avg_class_size
     FROM public.school_verified_metrics('11111111-1111-1111-1111-111111111111')),
  2.0::NUMERIC,
  'average class size is counted over the classes pupils are actually in'
);

SELECT is(
  (SELECT out_pupils_per_teacher
     FROM public.school_verified_metrics('22222222-2222-2222-2222-222222222222')),
  NULL,
  'a school with no assignments reports NULL, not zero — "we cannot say" is the honest answer'
);

-- ---------------------------------------------------------------------------
-- Who is listed at all. Business rule 1.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT COUNT(*)::INT FROM public.search_schools('ZM')),
  2,
  'only the two active schools are listed'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.search_schools('ZM') WHERE out_school_code = 'ZM-NDL-0001'),
  'a terminated school does not appear'
);

/**
 * And neither does an unverified one. `PUBLIC_DIRECTORY.md` business rule 1 lists
 * `pending_verification` among the excluded, and the reason is stronger than the rule: AfriTech has
 * not confirmed the school exists, and listing it would lend ZSMS's name to that claim.
 */
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.search_schools('ZM') WHERE out_school_code = 'ZM-KIT-0001'),
  'nor one still awaiting verification — a listing is ZSMS vouching that the school is real'
);

-- ---------------------------------------------------------------------------
-- A school that has published nothing leaks nothing.
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT out_about IS NULL AND out_pupils_per_teacher IS NULL
          AND out_avg_class_size IS NULL AND out_fee_band_min IS NULL
          AND out_has_boarding IS NULL
     FROM public.search_schools('ZM') WHERE out_school_code = 'ZM-LSK-0001'),
  'a school with no profile row publishes nothing beyond its listing'
);

SELECT ok(
  (SELECT out_name = 'Open Academy' AND out_city_code = 'LSK' AND out_level = 'combined'
     FROM public.search_schools('ZM') WHERE out_school_code = 'ZM-LSK-0001'),
  '...but the mandatory listing is always there — a school cannot hide from it (business rule 6)'
);

-- ---------------------------------------------------------------------------
-- Publishing, one switch at a time.
-- ---------------------------------------------------------------------------
INSERT INTO public.school_public_profiles
  (school_id, is_published, about, publish_ratio, publish_class_sizes,
   publish_fee_band, fee_band_min, fee_band_max, has_boarding, has_transport)
VALUES
  ('11111111-1111-1111-1111-111111111111', TRUE, 'A small school in Chelston.',
   TRUE, FALSE, TRUE, 1500.00, 3000.00, FALSE, TRUE);

SELECT is(
  (SELECT out_pupils_per_teacher FROM public.search_schools('ZM')
    WHERE out_school_code = 'ZM-LSK-0001'),
  2.0::NUMERIC,
  'publishing the ratio publishes the ratio'
);

/**
 * And publishes nothing else. Each figure is behind its own flag, which matters because they say
 * different things: a school may be happy with 1:22 overall and not want it known that one Grade 7
 * room holds fifty-eight children.
 */
SELECT is(
  (SELECT out_avg_class_size FROM public.search_schools('ZM')
    WHERE out_school_code = 'ZM-LSK-0001'),
  NULL,
  '...and class size stays withheld, because that is a separate switch'
);

SELECT ok(
  (SELECT out_fee_band_min = 1500.00 AND out_fee_band_max = 3000.00
     FROM public.search_schools('ZM') WHERE out_school_code = 'ZM-LSK-0001'),
  'the fee band appears as the school stated it'
);

-- ---------------------------------------------------------------------------
-- Filtering.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT COUNT(*)::INT FROM public.search_schools('ZM', p_transport => TRUE)),
  1,
  'a transport filter finds the school that said yes'
);

/**
 * THE ABSENCE-IS-NOT-A-NO RULE.
 *
 * `Quiet School` has published nothing, so it has not said whether it has boarding. A filter must
 * narrow to a confirmed yes rather than treat silence as a no — otherwise a school is penalised in
 * search for not having filled in a form, and the directory quietly becomes a completeness contest.
 */
SELECT is(
  (SELECT COUNT(*)::INT FROM public.search_schools('ZM', p_boarding => TRUE)),
  0,
  'and a boarding filter finds nobody — one said no, the other never answered'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.search_schools('ZM', p_fee_max => 2000)),
  1,
  'a fee ceiling matches a band that starts below it'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.search_schools('ZM', p_fee_max => 1000)),
  0,
  '...and excludes one that starts above it'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.search_schools('ZM', p_search => 'quiet')),
  1,
  'text search is case-insensitive and partial'
);

-- ---------------------------------------------------------------------------
-- One school's profile.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT out_name FROM public.school_public_profile('zm-lsk-0001')),
  'Open Academy',
  'a profile is found by code regardless of case — a code gets typed by hand'
);

SELECT is(
  (SELECT out_grade_levels FROM public.school_public_profile('ZM-LSK-0001')),
  ARRAY['Grade 1','Grade 2'],
  'grade levels are always public — whether a school takes a child of this age is question one'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.school_public_profile('ZM-NDL-0001')),
  0,
  'and a terminated school has no profile page at all'
);

-- ---------------------------------------------------------------------------
-- Who may change what a school says about itself.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_teacher_1", "role": "authenticated",
  "o": {"id": "org_open", "rol": "teacher", "slg": "open-academy"}
}';

/**
 * A teacher may not. What a school publishes about its fees and its class sizes is a commercial
 * decision with consequences in the market it competes in — not a data-entry task, and not something
 * that should turn on which member of staff happened to open the settings screen.
 */
SELECT throws_ok(
  $$ SELECT * FROM public.set_school_public_profile(p_publish_fee_band => TRUE) $$,
  '42501',
  NULL,
  'a teacher cannot change what the school publishes'
);

SET LOCAL request.jwt.claims TO '{
  "sub": "user_owner", "role": "authenticated",
  "o": {"id": "org_open", "rol": "owner", "slg": "open-academy"}
}';

SELECT ok(
  (SELECT publish_class_sizes
     FROM public.set_school_public_profile(p_publish_class_sizes => TRUE)),
  'the owner can, and a single field changes without resending the rest'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.school_public_profiles),
  1,
  '...and sees only their own profile row, never another school''s'
);

SELECT * FROM finish();
ROLLBACK;
