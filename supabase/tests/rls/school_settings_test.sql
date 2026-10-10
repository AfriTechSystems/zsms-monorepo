-- ===========================================================================
-- School settings — the profile grant, and the term calendar nothing used to hold.
--
-- Spec: Official Documentation/06 School and Tenant Management/SCHOOL_CONFIG.md
--       Official Documentation/04 Country and Configuration/ZM.md
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- `0141` widened the profile grant on `schools` to add the two columns `SCHOOL_CONFIG.md`
-- specified and the schema never had. **The first assertions check that widening it did not
-- reopen what `0140` closed** — a school owner could set their own subscription tier, and the way
-- that comes back is somebody re-issuing the grant list with one more column and forgetting to
-- omit `subscription_tier`. `GRANT UPDATE (cols)` is additive per column, so it cannot happen by
-- accident here; it is asserted because the next person may not know that.
--
-- The rest is the term calendar. `fee_structures`, `exam_results` and `attendance_records` have
-- all carried `academic_year` and `term_number` since the fee module, while nothing in the schema
-- knew when a term started. So:
--
--   * terms may not overlap, because two terms covering one day makes `current_term()` ambiguous
--     and the ambiguity propagates into fee issuing and mark entry;
--   * `current_term()` returns the NEXT term during the holidays rather than nothing, so callers
--     do not each special-case a third of the year;
--   * leadership sets the calendar and everyone reads it.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(16);

INSERT INTO public.schools
  (id, school_id, clerk_org_id, name, type, level, city_code, status, subscription_tier)
VALUES ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
        'Alpha Academy', 'day', 'combined', 'LSK', 'active', 'starter');

-- ---------------------------------------------------------------------------
-- The grant, after 0141 widened it.
-- ---------------------------------------------------------------------------
SELECT ok(
  has_column_privilege('authenticated', 'public.schools', 'display_name', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.schools', 'ministry_reg_number', 'UPDATE'),
  'the two columns SCHOOL_CONFIG.md specified — and the schema never had — are now writable'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.schools', 'subscription_tier', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.schools', 'trial_ends_at', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.schools', 'max_students', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.schools', 'whatsapp_enabled', 'UPDATE'),
  'and widening the grant did NOT reopen what 0140 closed'
);

-- ---------------------------------------------------------------------------
-- The owner edits the profile.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_owner_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "owner", "slg": "alpha-academy"}
}';

SELECT lives_ok(
  $$ UPDATE public.schools
        SET display_name = 'Alpha Acad.', ministry_reg_number = 'MOE/2019/4471'
      WHERE clerk_org_id = 'org_school_a' $$,
  'the owner can set the short name and the ministry number'
);

SELECT throws_ok(
  $$ UPDATE public.schools SET subscription_tier = 'enterprise'
      WHERE clerk_org_id = 'org_school_a' $$,
  '42501',
  NULL,
  '...and still cannot price their own school'
);

-- ---------------------------------------------------------------------------
-- Term dates.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ INSERT INTO public.school_term_dates
       (school_id, academic_year, term_number, starts_on, ends_on) VALUES
       ('11111111-1111-1111-1111-111111111111', '2026', 1, '2026-01-12', '2026-04-10'),
       ('11111111-1111-1111-1111-111111111111', '2026', 2, '2026-05-11', '2026-08-07'),
       ('11111111-1111-1111-1111-111111111111', '2026', 3, '2026-09-07', '2026-12-04') $$,
  'an owner sets three terms'
);

SELECT throws_ok(
  $$ INSERT INTO public.school_term_dates
       (school_id, academic_year, term_number, starts_on, ends_on)
     VALUES ('11111111-1111-1111-1111-111111111111', '2026', 4, '2026-03-01', '2026-06-01') $$,
  '23514',
  NULL,
  'an overlapping term is refused — two terms on one day makes current_term() ambiguous'
);

SELECT throws_ok(
  $$ INSERT INTO public.school_term_dates
       (school_id, academic_year, term_number, starts_on, ends_on)
     VALUES ('11111111-1111-1111-1111-111111111111', '2027', 1, '2027-04-01', '2027-01-01') $$,
  '23514',
  NULL,
  'a term ending before it starts is refused'
);

SELECT throws_ok(
  $$ INSERT INTO public.school_term_dates
       (school_id, academic_year, term_number, starts_on, ends_on)
     VALUES ('11111111-1111-1111-1111-111111111111', '2026', 1, '2030-01-01', '2030-04-01') $$,
  '23505',
  NULL,
  'and the same term twice in one year is refused, so a re-save corrects rather than duplicates'
);

-- `term_number` is deliberately NOT capped at three. Zambia runs three terms, but that is a fact
-- about Zambia — ADR-040 already tracks five hardcoded CHECKs needing a migration per country.
SELECT lives_ok(
  $$ INSERT INTO public.school_term_dates
       (school_id, academic_year, term_number, starts_on, ends_on)
     VALUES ('11111111-1111-1111-1111-111111111111', '2027', 4, '2027-01-05', '2027-03-05') $$,
  'a fourth term is allowed — three is a fact about Zambia, not a constraint'
);

-- ---------------------------------------------------------------------------
-- current_term().
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT term_number FROM public.current_term(
     '11111111-1111-1111-1111-111111111111', '2026-06-20')),
  2,
  'a date inside term 2 resolves to term 2'
);

SELECT is(
  (SELECT is_between FROM public.current_term(
     '11111111-1111-1111-1111-111111111111', '2026-06-20')),
  false,
  '...and is not reported as a holiday'
);

/**
 * THE HOLIDAY CASE. 20 April is between terms 1 and 2.
 *
 * Returning nothing would be defensible and would make every caller special-case roughly a third
 * of the year. Returning the NEXT term with `is_between` set lets a screen say "term 2 starts on
 * 11 May" instead of leaving a blank where a term name belongs.
 */
SELECT is(
  (SELECT term_number FROM public.current_term(
     '11111111-1111-1111-1111-111111111111', '2026-04-20')),
  2,
  'a date in the holidays returns the NEXT term rather than nothing'
);

SELECT is(
  (SELECT is_between FROM public.current_term(
     '11111111-1111-1111-1111-111111111111', '2026-04-20')),
  true,
  '...flagged as between terms, so a screen can say which and when'
);

-- ---------------------------------------------------------------------------
-- Who may do what.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_teacher_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "teacher", "slg": "alpha-academy"}
}';

SELECT ok(
  (SELECT count(*) FROM public.school_term_dates) > 0,
  'a teacher reads the term calendar — they need to know when the term ends'
);

SELECT throws_ok(
  $$ INSERT INTO public.school_term_dates
       (school_id, academic_year, term_number, starts_on, ends_on)
     VALUES ('11111111-1111-1111-1111-111111111111', '2028', 1, '2028-01-10', '2028-04-10') $$,
  '42501',
  NULL,
  '...and cannot set one: term dates move fee issuing, marks and attendance at once'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.school_term_dates', 'DELETE'),
  'nobody holds DELETE — fees and marks reference a term by number, so removal orphans them'
);

SELECT * FROM finish();
ROLLBACK;
