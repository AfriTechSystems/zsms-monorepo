-- ===========================================================================
-- 0242 — seed the Zambian subject reference list (ZM.md)
--
-- Spec: `04 Country and Configuration/ZM.md` → *Subjects Reference List*
--
-- ## What was wrong
--
-- `reference_subjects_zm` is what a school picks from during onboarding. ZM.md
-- lists **62** subjects across five sections; the table held **16**, and **none
-- at A-level** despite the `level_type` CHECK admitting it.
--
-- So a secondary school setting up found roughly a quarter of its curriculum and
-- typed the rest by hand — at exactly the moment it is deciding whether ZSMS
-- knows anything about Zambian schooling. A sixth-form had nothing at all.
--
-- ## Extracted, not transcribed
--
-- These rows were read out of ZM.md's own tables by a script rather than typed.
-- Transcribing 62 codes by hand is how one gets mistyped, and a mistyped code
-- does not fail — it quietly never appears in onboarding, which is the same
-- symptom as it not being there at all.
--
-- The level and curriculum come from the section heading each subject sits
-- under, so `Advanced Level — … (A-Level Specialisation)` yields `a_level` and
-- `Primary — Grades 1 to 6 (ECZ Traditional)` yields `primary`/`ecz`.
--
-- ## The same code at two levels is intended
--
-- The unique key is `(country_code, subject_code, level_type)`, so `mathematics`
-- exists once for primary and once for secondary — and must, because onboarding
-- filters by level and a secondary school that could not find mathematics would
-- reasonably conclude the list was broken.
--
-- A first draft of this migration de-duplicated on the code alone and would have
-- dropped every subject taught at more than one level. Caught by reading the
-- constraint before writing the INSERT, which is the only thing that catches it:
-- `ON CONFLICT (subject_code)` would also have failed outright, since no such
-- unique constraint exists.
--
-- ## Idempotent
--
-- `ON CONFLICT DO NOTHING`, so re-running changes nothing and the 16
-- existing rows keep whatever a human may since have corrected about them. A seed
-- that overwrites is a seed that undoes somebody's fix.
-- ===========================================================================

INSERT INTO public.reference_subjects_zm
  (subject_code, subject_name, is_core, level_type, curriculum_type)
VALUES
  ('literacy', 'Literacy and Language', TRUE, 'primary', 'both'),
  ('numeracy', 'Numeracy', TRUE, 'primary', 'both'),
  ('creative_arts', 'Creative Arts', FALSE, 'primary', 'both'),
  ('physical_dev', 'Physical Development', FALSE, 'primary', 'both'),
  ('social_skills', 'Social and Emotional Development', FALSE, 'primary', 'both'),
  ('english_primary', 'English', TRUE, 'primary', 'ecz'),
  ('mathematics', 'Mathematics', TRUE, 'primary', 'ecz'),
  ('integrated_science', 'Integrated Science', TRUE, 'primary', 'ecz'),
  ('social_studies', 'Social Studies', TRUE, 'primary', 'ecz'),
  ('religious_education', 'Religious Education', FALSE, 'primary', 'ecz'),
  ('local_language', 'Local Language', TRUE, 'primary', 'ecz'),
  ('expressive_arts', 'Expressive Arts', FALSE, 'primary', 'ecz'),
  ('physical_education', 'Physical Education', FALSE, 'primary', 'ecz'),
  ('home_economics', 'Home Economics', FALSE, 'primary', 'ecz'),
  ('agriculture', 'Agriculture', FALSE, 'primary', 'ecz'),
  ('geography_primary', 'Geography', FALSE, 'primary', 'ecz'),
  ('history_primary', 'History', FALSE, 'primary', 'ecz'),
  ('civics_primary', 'Civics', FALSE, 'primary', 'ecz'),
  ('ict_primary', 'ICT / Computer Studies', FALSE, 'primary', 'ecz'),
  ('english_lang', 'English Language', TRUE, 'secondary', 'both'),
  ('english_lit', 'English Literature', FALSE, 'secondary', 'both'),
  ('mathematics_secondary', 'Mathematics', TRUE, 'secondary', 'both'),
  ('additional_maths', 'Additional Mathematics', FALSE, 'secondary', 'both'),
  ('biology', 'Biology', TRUE, 'secondary', 'both'),
  ('physics', 'Physics', TRUE, 'secondary', 'both'),
  ('chemistry', 'Chemistry', TRUE, 'secondary', 'both'),
  ('combined_science', 'Combined Science', FALSE, 'secondary', 'both'),
  ('geography_secondary', 'Geography', FALSE, 'secondary', 'both'),
  ('history_secondary', 'History', FALSE, 'secondary', 'both'),
  ('civics_secondary', 'Civic Education', FALSE, 'secondary', 'both'),
  ('religious_ed_secondary', 'Religious Education', FALSE, 'secondary', 'both'),
  ('ict_secondary', 'ICT / Computer Studies', FALSE, 'secondary', 'both'),
  ('business_studies', 'Business Studies', FALSE, 'secondary', 'both'),
  ('commerce', 'Commerce', FALSE, 'secondary', 'both'),
  ('accounts', 'Principles of Accounts', FALSE, 'secondary', 'both'),
  ('economics', 'Economics', FALSE, 'secondary', 'both'),
  ('french', 'French', FALSE, 'secondary', 'both'),
  ('physical_education_sec', 'Physical Education', FALSE, 'secondary', 'both'),
  ('art_design', 'Art and Design', FALSE, 'secondary', 'both'),
  ('music', 'Music', FALSE, 'secondary', 'both'),
  ('food_nutrition', 'Food and Nutrition', FALSE, 'secondary', 'both'),
  ('technical_drawing', 'Technical Drawing', FALSE, 'secondary', 'both'),
  ('woodwork', 'Woodwork', FALSE, 'secondary', 'both'),
  ('metalwork', 'Metalwork', FALSE, 'secondary', 'both'),
  ('agriculture_secondary', 'Agriculture', FALSE, 'secondary', 'both'),
  ('bemba', 'Bemba', FALSE, 'secondary', 'both'),
  ('nyanja', 'Nyanja', FALSE, 'secondary', 'both'),
  ('tonga', 'Tonga', FALSE, 'secondary', 'both'),
  ('lozi', 'Lozi', FALSE, 'secondary', 'both'),
  ('mathematics_alevel', 'Mathematics', FALSE, 'a_level', 'both'),
  ('further_maths', 'Further Mathematics', FALSE, 'a_level', 'both'),
  ('physics_alevel', 'Physics', FALSE, 'a_level', 'both'),
  ('chemistry_alevel', 'Chemistry', FALSE, 'a_level', 'both'),
  ('biology_alevel', 'Biology', FALSE, 'a_level', 'both'),
  ('economics_alevel', 'Economics', FALSE, 'a_level', 'both'),
  ('business_alevel', 'Business Studies', FALSE, 'a_level', 'both'),
  ('accounts_alevel', 'Accounting', FALSE, 'a_level', 'both'),
  ('geography_alevel', 'Geography', FALSE, 'a_level', 'both'),
  ('history_alevel', 'History', FALSE, 'a_level', 'both'),
  ('english_alevel', 'English Language', FALSE, 'a_level', 'both'),
  ('ict_alevel', 'ICT', FALSE, 'a_level', 'both'),
  ('divinity', 'Divinity / Religious Studies', FALSE, 'a_level', 'both')
ON CONFLICT (country_code, subject_code, level_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Verify the shape, not just the count.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_total   INT;
  v_alevel  INT;
  v_primary INT;
  v_core    INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM public.reference_subjects_zm;
  SELECT COUNT(*) INTO v_alevel FROM public.reference_subjects_zm WHERE level_type = 'a_level';
  SELECT COUNT(*) INTO v_primary FROM public.reference_subjects_zm WHERE level_type = 'primary';
  SELECT COUNT(*) INTO v_core FROM public.reference_subjects_zm WHERE is_core;

  -- The gap this migration exists to close.
  IF v_alevel = 0 THEN
    RAISE EXCEPTION '0242: still no A-level subjects, so a sixth form sees nothing';
  END IF;

  IF v_primary = 0 THEN
    RAISE EXCEPTION '0242: no primary subjects';
  END IF;

  /*
    A core subject is one a school cannot drop. If none are marked, the onboarding
    screen has no way to pre-tick the compulsory ones and a school starts from an
    empty list again — which is most of the problem this migration is fixing.
  */
  IF v_core = 0 THEN
    RAISE EXCEPTION '0242: no subject is marked core';
  END IF;

  IF v_total < 60 THEN
    RAISE EXCEPTION
      '0242: only % subjects, expected at least 60 from ZM.md', v_total;
  END IF;

  RAISE NOTICE
    '0242: verified — % subjects (% primary, % a-level, % core)',
    v_total, v_primary, v_alevel, v_core;
END;
$$;
