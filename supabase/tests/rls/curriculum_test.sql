-- ===========================================================================
-- The curriculum store — the grounding that stops a lesson plan inventing a syllabus code.
--
-- Spec: Official Documentation/18 AI Module/LESSON_PLANNER.md
--       Official Documentation/04 Country and Configuration/ZM.md
--       Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-040
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- The whole point of this table is that an AI-written lesson plan can cite a REAL ECZ topic code.
-- The failure that matters is not a missing citation — it is a plausible invented one, because a
-- teacher will repeat it to a head of department in good faith. So the assertions are about the
-- properties that make invention impossible:
--
--   * `curriculum_slice()` returns the WHOLE slice for a subject and grade, not a matched topic.
--     The model picks from a complete list of valid codes, so there is nothing to invent from.
--   * It returns them in **syllabus order**, because that is teaching order, and a plan that
--     tackles topic 7.3 before 7.1 is wrong in a way a grade-level filter would not catch.
--   * An unknown subject returns **nothing**, not a nearest match. Empty is a state the prompt
--     handles explicitly — "cite nothing" — and a nearest match is how the wrong grade's outcomes
--     end up in a Grade 9 plan.
--   * Re-importing a revised syllabus **replaces** rather than duplicating, or a topic would have
--     two competing sets of outcomes and no way to tell which is current.
--   * A teacher may READ the syllabus — it is a public document — and may not write it.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SET search_path TO public, extensions;

SELECT plan(16);

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_afritech", "role": "authenticated",
  "o": {"id": "org_afritech", "rol": "afritech:super_admin", "slg": "afritech-systems-admin"}
}';

-- ---------------------------------------------------------------------------
-- Import, including two rows that are deliberately broken.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT inserted FROM public.import_curriculum_topics('[
     {"subject":"Mathematics","grade_level":"Grade 9","topic_code":"7.1",
      "topic_name":"Linear equations",
      "learning_outcomes":["Solve a linear equation in one unknown"],
      "source":"Test syllabus","display_order":1},
     {"subject":"Mathematics","grade_level":"Grade 9","topic_code":"7.3",
      "topic_name":"Simultaneous equations",
      "sub_topics":["Substitution","Elimination"],
      "learning_outcomes":["Solve a pair by substitution","Solve a pair by elimination"],
      "suggested_periods":6,"source":"Test syllabus","syllabus_year":2023,"display_order":3},
     {"subject":"Mathematics","grade_level":"Grade 9","topic_code":"7.2",
      "topic_name":"Inequalities",
      "learning_outcomes":["Represent an inequality on a number line"],
      "source":"Test syllabus","display_order":2},
     {"subject":"","grade_level":"Grade 9","topic_code":"9.9","topic_name":"No subject",
      "source":"x"},
     {"subject":"Mathematics","grade_level":"Grade 9","topic_code":"","topic_name":"No code",
      "source":"x"}
   ]'::jsonb)),
  3,
  'three valid syllabus topics import'
);

/**
 * A bad row is skipped, not fatal. A syllabus is hundreds of rows transcribed by hand; aborting
 * the file on row 214 means the operator fixes one typo per round trip. `import_students()` IS
 * atomic, and the difference is deliberate: a partial pupil roll is a real problem, a partial
 * syllabus is visible in `curriculum_coverage()` and simply gets re-imported.
 */
SELECT is(
  (SELECT skipped FROM public.import_curriculum_topics('[
     {"subject":"","grade_level":"Grade 9","topic_code":"9.9","topic_name":"No subject","source":"x"}
   ]'::jsonb)),
  1,
  'a row missing a required field is skipped rather than aborting the import'
);

SELECT is(
  (SELECT jsonb_array_length(errors) FROM public.import_curriculum_topics('[
     {"subject":"","grade_level":"x","topic_code":"x","topic_name":"x","source":"x"}
   ]'::jsonb)),
  1,
  '...and is reported, so every problem in a file comes back at once'
);

-- ---------------------------------------------------------------------------
-- THE SLICE. The whole thing, in syllabus order.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.curriculum_slice('ecz', 'Mathematics', 'Grade 9')),
  3,
  'the slice returns every topic for the subject and grade, not one matched topic'
);

SELECT is(
  (SELECT string_agg(topic_code, ' ') FROM public.curriculum_slice('ecz', 'Mathematics', 'Grade 9')),
  '7.1 7.2 7.3',
  'in SYLLABUS order, which is teaching order — 7.3 before 7.1 would be a wrong plan'
);

SELECT is(
  (SELECT array_length(learning_outcomes, 1) FROM public.curriculum_slice('ecz', 'Mathematics', 'Grade 9')
    WHERE topic_code = '7.3'),
  2,
  'the outcomes come with it — a topic name alone grounds nothing'
);

SELECT is(
  (SELECT suggested_periods FROM public.curriculum_slice('ecz', 'Mathematics', 'Grade 9')
    WHERE topic_code = '7.3'),
  6,
  'and the syllabus pacing, so a plan can respect the periods actually allotted'
);

-- Free text from a teacher, or a school's own grade label. An exact match would return nothing,
-- and nothing is indistinguishable from "this subject has not been ingested yet".
SELECT is(
  (SELECT count(*)::int FROM public.curriculum_slice('ECZ', 'mathematics', 'grade 9')),
  3,
  'subject and grade match case-insensitively'
);

-- THE ONE THAT PREVENTS AN INVENTED CITATION. No nearest match, no fallback.
SELECT is(
  (SELECT count(*)::int FROM public.curriculum_slice('ecz', 'Astrophysics', 'Grade 9')),
  0,
  'an unknown subject returns NOTHING — a nearest match is how the wrong outcomes reach a plan'
);

SELECT is(
  (SELECT count(*)::int FROM public.curriculum_slice('ecz', 'Mathematics', 'Grade 7')),
  0,
  'and a grade with nothing ingested returns nothing rather than another grade''s topics'
);

-- ---------------------------------------------------------------------------
-- A revised syllabus replaces what it revises.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT updated FROM public.import_curriculum_topics('[
     {"subject":"Mathematics","grade_level":"Grade 9","topic_code":"7.3",
      "topic_name":"Simultaneous equations (2024 revision)",
      "learning_outcomes":["Revised outcome"],
      "source":"Test syllabus 2024","display_order":3}
   ]'::jsonb)),
  1,
  're-importing an existing topic code updates it'
);

SELECT is(
  (SELECT count(*)::int FROM public.curriculum_slice('ecz', 'Mathematics', 'Grade 9')),
  3,
  '...rather than adding a fourth row, which would leave two competing sets of outcomes'
);

SELECT is(
  (SELECT topic_name FROM public.curriculum_slice('ecz', 'Mathematics', 'Grade 9')
    WHERE topic_code = '7.3'),
  'Simultaneous equations (2024 revision)',
  'and the revision is what the slice now carries'
);

-- ---------------------------------------------------------------------------
-- Coverage — what is grounded, and what only looks grounded.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT outcome_count FROM public.curriculum_coverage()
    WHERE subject = 'Mathematics' AND grade_level = 'Grade 9'),
  3::bigint,
  'coverage counts OUTCOMES, not just topics — topic names with no outcomes are useless and would otherwise look ingested'
);

-- ---------------------------------------------------------------------------
-- A teacher reads the syllabus. A teacher does not write it.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{"sub": "user_teacher", "role": "authenticated"}';

/**
 * Readable by any authenticated session, including a standalone Hub teacher with no school. The
 * ECZ syllabus is a published government document carrying no school or pupil data — gating it
 * per school would mean the teachers most in need of grounding could not have it.
 */
SELECT is(
  (SELECT count(*)::int FROM public.curriculum_slice('ecz', 'Mathematics', 'Grade 9')),
  3,
  'a teacher with no school at all can read the syllabus — it is a public document'
);

SELECT throws_ok(
  $$ SELECT public.import_curriculum_topics('[
       {"subject":"X","grade_level":"Y","topic_code":"Z","topic_name":"N","source":"S"}
     ]'::jsonb) $$,
  '42501',
  NULL,
  '...and cannot import, because a wrong syllabus is worse than no syllabus'
);

SELECT * FROM finish();
ROLLBACK;
