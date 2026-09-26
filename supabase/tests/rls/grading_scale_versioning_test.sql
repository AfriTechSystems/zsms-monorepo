-- ===========================================================================
-- Grading scale versioning — ADR-041, the claim that a grade stays explainable.
--
-- Spec: Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-041, ADR-020
--       Official Documentation/16 Testing and Launch/TEST_STRATEGY.md — Layer 2
--
-- THIS SUITE IS ADVERSARIAL BY DESIGN.
--
-- The defect ADR-041 records is not a crash. It is a school moving its
-- distinction boundary from 80 to 75 in August and thereby making every grade
-- awarded in March unexplainable — the letter says "A", the scale on file says
-- an A needs 75, and nothing anywhere records that in March it needed 80.
--
-- So the load-bearing assertion in this file is not that versions exist. It is
-- that after a revision, a March result still resolves to the March letter.
-- Everything else guards the route to that:
--
--   * bands cannot be edited in place — the whole defect in one UPDATE;
--   * a version that has graded anything is frozen;
--   * a version cannot be deleted, which would orphan the explanation;
--   * a revision must say why;
--   * exactly one version is ever current;
--   * a new scale cannot exist without a version (the gap 0107 closed);
--   * a teacher reads bands but cannot revise them;
--   * another school's versions are invisible, not merely read-only.
--
-- Run: npm run db:test
-- ===========================================================================

BEGIN;

SELECT plan(20);

INSERT INTO public.schools (id, school_id, clerk_org_id, name, type, level, city_code, status)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'ZM-LSK-0001', 'org_school_a',
   'Alpha Academy', 'day', 'combined', 'LSK', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'ZM-NDL-0002', 'org_school_b',
   'Beta School',   'day', 'combined', 'NDL', 'active');

INSERT INTO public.students (id, student_id, school_id, first_name, last_name, grade_id, class_id)
VALUES
  ('aaaa0000-0000-0000-0000-000000000001', 'STU-ZM-LSK-0001-00001',
   '11111111-1111-1111-1111-111111111111', 'Alice', 'Alpha', 'grade_9', 'grade_9a');

-- The March scale: a distinction needs 80.
INSERT INTO public.school_grading_scales
  (id, school_id, scale_name, scale_type, grade_bands, pass_mark, credit_mark)
VALUES
  ('cccc0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'ECZ Secondary', 'letter',
   '[{"letter":"A","min":80,"max":100,"points":1,"descriptor":"Distinction"},
     {"letter":"B","min":70,"max":79.99,"points":2,"descriptor":"Merit"},
     {"letter":"C","min":50,"max":69.99,"points":3,"descriptor":"Credit"},
     {"letter":"F","min":0,"max":49.99,"points":9,"descriptor":"Fail"}]'::jsonb,
   50, 50);

-- Beta's own scale, so cross-tenant reads have something to fail to find.
INSERT INTO public.school_grading_scales
  (id, school_id, scale_name, scale_type, grade_bands, pass_mark)
VALUES
  ('dddd0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   'Beta Scale', 'letter',
   '[{"letter":"A","min":75,"max":100,"points":1}]'::jsonb, 40);

-- ---------------------------------------------------------------------------
-- 1. The invariant 0107 exists to hold: a scale is never versionless.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.school_grading_scale_versions
    WHERE grading_scale_id = 'cccc0000-0000-0000-0000-000000000001'),
  1,
  'creating a scale creates its version 1 automatically'
);

SELECT is(
  (SELECT count(*)::int FROM public.school_grading_scales s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.school_grading_scale_versions v
      WHERE v.grading_scale_id = s.id AND v.superseded_at IS NULL)),
  0,
  'no scale anywhere lacks a current version'
);

-- ---------------------------------------------------------------------------
-- 2. The scale grades a mark the way its bands say.
--    82% is a distinction under the March scale.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT grade_letter FROM public.grade_from_scale_version(
     public.current_grading_scale_version('cccc0000-0000-0000-0000-000000000001'),
     82, 100)),
  'A',
  '82 out of 100 is an A while a distinction needs 80'
);

-- Bands are matched on percentage, so the denominator does not matter.
SELECT is(
  (SELECT grade_letter FROM public.grade_from_scale_version(
     public.current_grading_scale_version('cccc0000-0000-0000-0000-000000000001'),
     24.6, 30)),
  'A',
  'a subject marked out of 30 uses the same boundaries — 24.6/30 is 82%'
);

-- ---------------------------------------------------------------------------
-- 3. March's result, graded and published under version 1.
-- ---------------------------------------------------------------------------
INSERT INTO public.exam_results
  (id, school_id, student_id, class_id, academic_year, term_number, subject_code,
   subject_name, entered_by_user_id, marks_obtained, marks_total,
   grade_letter, grade_points, grading_scale_version_id,
   results_published, published_at)
SELECT
  'eeee0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
  'aaaa0000-0000-0000-0000-000000000001', 'grade_9a', '2026', 1, 'MATH',
  'Mathematics', 'user_teacher_a', 82, 100,
  g.grade_letter, g.grade_points,
  public.current_grading_scale_version('cccc0000-0000-0000-0000-000000000001'),
  TRUE, NOW()
FROM public.grade_from_scale_version(
  public.current_grading_scale_version('cccc0000-0000-0000-0000-000000000001'),
  82, 100) g;

SELECT is(
  (SELECT grade_letter FROM public.exam_results
    WHERE id = 'eeee0000-0000-0000-0000-000000000001'),
  'A',
  'the March result is stored as an A'
);

-- ---------------------------------------------------------------------------
-- 4. THE DEFECT ITSELF. Editing bands in place is refused.
--    This single UPDATE is what made history unexplainable before ADR-041.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ UPDATE public.school_grading_scales
     SET grade_bands = '[{"letter":"A","min":75,"max":100,"points":1}]'::jsonb
     WHERE id = 'cccc0000-0000-0000-0000-000000000001' $$,
  -- 23001 = restrict_violation, which is what `USING ERRCODE = 'restrict_violation'`
  -- actually raises. An earlier draft of this suite expected 2F004
  -- (reading_sql_data_not_permitted) — a different error family altogether. The
  -- guard fired correctly both times; only the expectation was wrong.
  '23001',
  NULL,
  'grade bands cannot be edited in place — the defect ADR-041 records'
);

-- A change to something that is not a band is still allowed. The guard is about
-- what a grade means, not about freezing the row.
SELECT lives_ok(
  $$ UPDATE public.school_grading_scales
     SET scale_name = 'ECZ Secondary (2026)'
     WHERE id = 'cccc0000-0000-0000-0000-000000000001' $$,
  'renaming a scale is still allowed — only the bands are versioned'
);

-- ---------------------------------------------------------------------------
-- 5. A revision must say why, and produces a new version rather than an edit.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ SELECT public.revise_grading_scale(
       'cccc0000-0000-0000-0000-000000000001',
       '[{"letter":"A","min":75,"max":100,"points":1}]'::jsonb, 50, 50, NULL) $$,
  '23514',
  NULL,
  'a revision with no reason is refused'
);

-- August: the distinction boundary moves to 75.
SELECT lives_ok(
  $$ SELECT public.revise_grading_scale(
       'cccc0000-0000-0000-0000-000000000001',
       '[{"letter":"A","min":75,"max":100,"points":1,"descriptor":"Distinction"},
         {"letter":"B","min":65,"max":74.99,"points":2,"descriptor":"Merit"},
         {"letter":"C","min":50,"max":64.99,"points":3,"descriptor":"Credit"},
         {"letter":"F","min":0,"max":49.99,"points":9,"descriptor":"Fail"}]'::jsonb,
       50, 50, 'Aligned with the 2026 ECZ circular on distinction boundaries') $$,
  'a scale can be revised with a reason'
);

SELECT is(
  (SELECT count(*)::int FROM public.school_grading_scale_versions
    WHERE grading_scale_id = 'cccc0000-0000-0000-0000-000000000001'),
  2,
  'the revision created a second version rather than editing the first'
);

SELECT is(
  (SELECT version_number FROM public.school_grading_scale_versions
    WHERE grading_scale_id = 'cccc0000-0000-0000-0000-000000000001'
      AND superseded_at IS NULL),
  2,
  'exactly one version is current, and it is the new one'
);

-- ---------------------------------------------------------------------------
-- 6. THE WHOLE POINT OF ADR-041.
--
--    The March result still points at version 1, and version 1 still says a
--    distinction needs 80. So the March A is explainable in August — which is
--    precisely what was impossible before.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT v.version_number
     FROM public.exam_results r
     JOIN public.school_grading_scale_versions v ON v.id = r.grading_scale_version_id
    WHERE r.id = 'eeee0000-0000-0000-0000-000000000001'),
  1,
  'the March result still points at the version that graded it'
);

SELECT is(
  (SELECT grade_letter FROM public.grade_from_scale_version(
     (SELECT grading_scale_version_id FROM public.exam_results
       WHERE id = 'eeee0000-0000-0000-0000-000000000001'),
     82, 100)),
  'A',
  'ADR-041: re-running the March mark through ITS version still gives an A'
);

-- And the same mark under the NEW version is still an A — but a mark that sits
-- between the two boundaries proves the versions genuinely differ. 77% was a B
-- in March and is an A in August.
SELECT is(
  (SELECT grade_letter FROM public.grade_from_scale_version(
     (SELECT id FROM public.school_grading_scale_versions
       WHERE grading_scale_id = 'cccc0000-0000-0000-0000-000000000001'
         AND version_number = 1),
     77, 100)),
  'B',
  '77 was a B under version 1'
);

SELECT is(
  (SELECT grade_letter FROM public.grade_from_scale_version(
     (SELECT id FROM public.school_grading_scale_versions
       WHERE grading_scale_id = 'cccc0000-0000-0000-0000-000000000001'
         AND version_number = 2),
     77, 100)),
  'A',
  '77 is an A under version 2 — the two versions really do disagree'
);

-- ---------------------------------------------------------------------------
-- 7. A version that has graded something is frozen, and can never be deleted.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$ UPDATE public.school_grading_scale_versions
     SET grade_bands = '[{"letter":"A","min":1,"max":100,"points":1}]'::jsonb
     WHERE grading_scale_id = 'cccc0000-0000-0000-0000-000000000001'
       AND version_number = 1 $$,
  '23001',
  NULL,
  'a version that has graded a result cannot be rewritten'
);

SELECT throws_ok(
  $$ DELETE FROM public.school_grading_scale_versions
     WHERE grading_scale_id = 'cccc0000-0000-0000-0000-000000000001'
       AND version_number = 1 $$,
  NULL,
  NULL,
  'a used version cannot be deleted — that would orphan the explanation'
);

-- ---------------------------------------------------------------------------
-- 8. Roles. A teacher needs the bands to enter marks and must not move them.
-- ---------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims TO '{
  "sub": "user_teacher_a", "role": "authenticated",
  "o": {"id": "org_school_a", "rol": "teacher", "slg": "alpha-academy"}
}';

SELECT is(
  (SELECT count(*)::int FROM public.school_grading_scale_versions
    WHERE grading_scale_id = 'cccc0000-0000-0000-0000-000000000001'),
  2,
  'a teacher reads scale versions — they need the bands to enter a mark'
);

SELECT throws_ok(
  $$ SELECT public.revise_grading_scale(
       'cccc0000-0000-0000-0000-000000000001',
       '[{"letter":"A","min":10,"max":100,"points":1}]'::jsonb, 10, 10, 'nope') $$,
  NULL,
  NULL,
  'a teacher cannot revise a scale — that is a management act'
);

-- ---------------------------------------------------------------------------
-- 9. Cross-tenant. Beta cannot see Alpha's versions at all.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims TO '{
  "sub": "user_principal_b", "role": "authenticated",
  "o": {"id": "org_school_b", "rol": "principal", "slg": "beta-school"}
}';

SELECT is(
  (SELECT count(*)::int FROM public.school_grading_scale_versions
    WHERE grading_scale_id = 'cccc0000-0000-0000-0000-000000000001'),
  0,
  'another school''s scale versions are invisible, not merely read-only'
);

SELECT * FROM finish();
ROLLBACK;
