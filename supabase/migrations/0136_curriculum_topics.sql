-- Migration: 0136_curriculum_topics.sql
-- Created: 2026-09-28
-- Description: The curriculum store — syllabus topics and learning outcomes as structured
--              relational data, for grounding AI generation in the real ECZ syllabus.
-- Related documents: Official Documentation/18 AI Module/LESSON_PLANNER.md
--                    Official Documentation/04 Country and Configuration/ZM.md
--                    Official Documentation/01 Foundation Layer/DECISIONS.md — ADR-040
--
-- ===========================================================================
-- WHY THIS IS A TABLE AND NOT A VECTOR INDEX
--
-- `LESSON_PLANNER.md` specifies a `knowledge_base` table with pgvector and a RAG pipeline, and
-- calls the knowledge base "the moat". It is right that it is the moat. It is wrong about the
-- tool, at least for this part of it.
--
-- Look at what the retrieval actually has to answer: *what does the ECZ Grade 9 Mathematics
-- syllabus say about simultaneous equations?* Subject, grade, topic. Those are three **exact**
-- keys. Similarity search over embedded chunks is slower, fuzzier, needs a chunking strategy and
-- retrieval tuning, and — the disqualifying part — can return Grade 7 content for a Grade 9
-- request, which is a wrong answer that reads as a right one.
--
-- A syllabus is not prose. It is a structured outline: subject → grade → topic → outcomes. That
-- is a few thousand rows across every subject and grade, and it belongs in a table with a unique
-- key on it.
--
-- pgvector still earns its place later, when the corpus IS prose — textbook content under a
-- publisher agreement, past papers, teacher-contributed material. Build `knowledge_base` then.
--
-- ---------------------------------------------------------------------------
-- THE WHOLE SLICE IS PASSED TO THE MODEL, NOT THE MATCHING TOPIC
-- ---------------------------------------------------------------------------
-- The obvious design is to match the teacher's typed topic against `topic_name` and pass the one
-- that matches. `curriculum_slice()` deliberately does not do that. It returns **every topic for
-- that subject and grade** — typically ten to thirty rows, a few hundred tokens.
--
-- Three reasons, and the third is the one that matters:
--
--   1. No fuzzy matching to tune, and no `pg_trgm` dependency. A teacher typing "simultaneous
--      equations", "Simultaneous Eqns" or "solving two equations at once" all work, because the
--      model does the matching rather than a similarity threshold.
--   2. A lesson often spans two syllabus topics, and a matcher returning one would silently drop
--      the other.
--   3. **The model cannot invent a topic code**, because the complete set of valid ones is in
--      front of it. An invented ECZ reference is the worst possible failure here — worse than no
--      citation — because a teacher will repeat it to a head of department in good faith.
--
-- The prompt already handles the empty case explicitly: with no outcomes supplied it is told to
-- cite nothing at all rather than to do its best.
--
-- ---------------------------------------------------------------------------
-- `country_code` IS A COLUMN, AND THAT IS DELIBERATE
-- ---------------------------------------------------------------------------
-- `reference_subjects_zm` bakes the country into its table name and is on the ADR-040 tracked
-- list as needing a migration to admit a second country. There is no reason to repeat that here:
-- Zimbabwe's ZIMSEC syllabus is rows in this table, not a new table.
--
-- ---------------------------------------------------------------------------
-- NOTHING IS SEEDED, AND THAT IS NOT AN OVERSIGHT
-- ---------------------------------------------------------------------------
-- This migration creates the store and the import path. It inserts **no syllabus content**,
-- because inventing ECZ topic codes to make a demo look complete would put fabricated curriculum
-- references into the product — the exact failure the whole design is arranged to prevent,
-- committed by the person who arranged it.
--
-- Real content comes from the ECZ syllabus PDFs, which are publicly available from the
-- Examinations Council of Zambia, via `import_curriculum_topics()` and the admin screen. Until
-- then `curriculum_slice()` returns nothing, generation stays ungrounded, and the product says so.
-- ===========================================================================

-- === MIGRATION START ===

CREATE TABLE IF NOT EXISTS public.curriculum_topics (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A column, not a table-name suffix. See the header.
  country_code       TEXT NOT NULL DEFAULT 'ZM',
  curriculum_type    TEXT NOT NULL,
  /**
   * Free text rather than a foreign key to `reference_subjects_zm`. That table is country-suffixed
   * (ADR-040) and its codes are the school-facing subject list, while a syllabus names subjects in
   * its own words. Coupling them would mean a syllabus row could not be imported until somebody
   * reconciled two naming schemes, and the import is AfriTech-controlled anyway.
   */
  subject            TEXT NOT NULL,
  grade_level        TEXT NOT NULL,
  -- The syllabus's own reference: '7.3', 'B2.4'. What a citation points at.
  topic_code         TEXT NOT NULL,
  topic_name         TEXT NOT NULL,
  sub_topics         TEXT[] NOT NULL DEFAULT '{}',
  /**
   * The specific outcomes the syllabus states. This is the substance — a topic name alone tells a
   * model almost nothing it did not already know, whereas "solve a pair of simultaneous linear
   * equations by substitution and by elimination" is the thing that makes the plan syllabus-aligned
   * rather than merely plausible.
   */
  learning_outcomes  TEXT[] NOT NULL DEFAULT '{}',
  -- Teaching periods the syllabus allots, where it says. Lets a plan respect the real pacing.
  suggested_periods  INT CHECK (suggested_periods IS NULL OR suggested_periods > 0),
  -- Where this came from, so a citation is checkable rather than merely printed.
  source             TEXT NOT NULL,
  source_url         TEXT,
  syllabus_year      INT CHECK (syllabus_year IS NULL OR syllabus_year BETWEEN 1990 AND 2100),
  -- Syllabus order, which is teaching order. Not alphabetical.
  display_order      INT NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per topic code within a subject, grade, curriculum and country. This is what makes
  -- re-importing a corrected syllabus an update rather than a duplicate.
  UNIQUE (country_code, curriculum_type, subject, grade_level, topic_code)
);

-- The only query shape this table has: give me the slice for one subject and grade.
CREATE INDEX IF NOT EXISTS idx_curriculum_topics_slice
  ON public.curriculum_topics(country_code, curriculum_type, subject, grade_level, display_order)
  WHERE is_active = TRUE;

COMMENT ON TABLE public.curriculum_topics IS
  'Syllabus topics and learning outcomes as structured data. Deliberately relational rather than '
  'embedded: subject + grade + topic are exact keys, and similarity search can return the wrong '
  'grade, which is a wrong answer that reads like a right one.';

COMMENT ON COLUMN public.curriculum_topics.learning_outcomes IS
  'The specific outcomes the syllabus states. The substance of the grounding — a topic name alone '
  'tells a model little it did not already know.';

CREATE TRIGGER set_updated_at_on_curriculum_topics
  BEFORE UPDATE ON public.curriculum_topics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 1. The slice a generation is grounded in.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.curriculum_slice(
  p_curriculum_type TEXT,
  p_subject         TEXT,
  p_grade_level     TEXT,
  p_country_code    TEXT DEFAULT 'ZM'
)
RETURNS TABLE (
  topic_code        TEXT,
  topic_name        TEXT,
  sub_topics        TEXT[],
  learning_outcomes TEXT[],
  suggested_periods INT,
  source            TEXT,
  syllabus_year     INT
)
LANGUAGE sql
-- INVOKER is sufficient and preferable: this is reference data every authenticated user may read,
-- so there is no reason to run it with elevated rights.
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
  /**
   * Case-insensitive on subject and grade, because the caller is a teacher's free text or a
   * school's own grade label — "Mathematics" against "mathematics", "Grade 9" against "grade 9".
   * An exact match here would silently return nothing, and nothing is indistinguishable from
   * "this subject is not in the syllabus yet".
   */
  SELECT t.topic_code, t.topic_name, t.sub_topics, t.learning_outcomes,
         t.suggested_periods, t.source, t.syllabus_year
  FROM   public.curriculum_topics t
  WHERE  t.is_active
    AND  t.country_code    = upper(p_country_code)
    AND  t.curriculum_type = lower(p_curriculum_type)
    AND  lower(t.subject)     = lower(p_subject)
    AND  lower(t.grade_level) = lower(p_grade_level)
  -- Syllabus order, which is teaching order.
  ORDER BY t.display_order, t.topic_code;
$$;

GRANT EXECUTE ON FUNCTION public.curriculum_slice(TEXT, TEXT, TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION public.curriculum_slice(TEXT, TEXT, TEXT, TEXT) IS
  'Every syllabus topic for one subject and grade — the whole slice, not a matched topic. The '
  'model does the matching, which means it cannot cite a code that was not in front of it.';

-- ---------------------------------------------------------------------------
-- 2. What has been ingested, and what has not.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.curriculum_coverage()
RETURNS TABLE (
  country_code    TEXT,
  curriculum_type TEXT,
  subject         TEXT,
  grade_level     TEXT,
  topic_count     BIGINT,
  outcome_count   BIGINT,
  sources         TEXT[],
  last_updated    TIMESTAMPTZ
)
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
  /**
   * The admin screen's only question: which subject-and-grade combinations are actually grounded?
   * `outcome_count` matters as much as `topic_count` — a slice of topic names with no learning
   * outcomes is technically ingested and substantively useless, and that distinction would be
   * invisible from a row count alone.
   */
  SELECT t.country_code, t.curriculum_type, t.subject, t.grade_level,
         count(*)                                   AS topic_count,
         COALESCE(sum(array_length(t.learning_outcomes, 1)), 0) AS outcome_count,
         array_agg(DISTINCT t.source)               AS sources,
         max(t.updated_at)                          AS last_updated
  FROM   public.curriculum_topics t
  WHERE  t.is_active
  GROUP BY t.country_code, t.curriculum_type, t.subject, t.grade_level
  ORDER BY t.country_code, t.curriculum_type, t.subject, t.grade_level;
$$;

GRANT EXECUTE ON FUNCTION public.curriculum_coverage() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Import.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_curriculum_topics(p_rows JSONB)
RETURNS TABLE (inserted INT, updated INT, skipped INT, errors JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r            JSONB;
  v_inserted   INT := 0;
  v_updated    INT := 0;
  v_skipped    INT := 0;
  v_errors     JSONB := '[]'::jsonb;
  v_index      INT := 0;
  v_existing   UUID;
BEGIN
  IF COALESCE(public.is_afritech_admin(), FALSE) IS NOT TRUE THEN
    RAISE EXCEPTION 'Only AfriTech imports curriculum content.' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Expected an array of topic rows.' USING ERRCODE = '22023';
  END IF;

  FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_index := v_index + 1;

    /**
     * A bad row is collected and skipped rather than aborting the import. A syllabus is hundreds
     * of rows transcribed by hand; failing the whole file on row 214 and reporting one message
     * means the operator fixes one typo per round trip. Every problem is returned at once.
     *
     * This is the same shape as `import_students()`, except that one is atomic because a partial
     * pupil roll is a real problem. A partially imported syllabus is not: the missing topics are
     * visible in `curriculum_coverage()` and simply get re-imported.
     */
    IF COALESCE(r ->> 'subject', '') = ''
       OR COALESCE(r ->> 'grade_level', '') = ''
       OR COALESCE(r ->> 'topic_code', '') = ''
       OR COALESCE(r ->> 'topic_name', '') = ''
       OR COALESCE(r ->> 'source', '') = ''
    THEN
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object(
        'row', v_index,
        'reason', 'subject, grade_level, topic_code, topic_name and source are all required',
        'value', r
      );
      CONTINUE;
    END IF;

    SELECT id INTO v_existing FROM public.curriculum_topics
     WHERE country_code    = upper(COALESCE(r ->> 'country_code', 'ZM'))
       AND curriculum_type = lower(COALESCE(r ->> 'curriculum_type', 'ecz'))
       AND subject         = (r ->> 'subject')
       AND grade_level     = (r ->> 'grade_level')
       AND topic_code      = (r ->> 'topic_code');

    IF v_existing IS NOT NULL THEN
      -- A re-import is a correction. Overwriting is the point: a syllabus revision should replace
      -- what it revises rather than sit beside it.
      UPDATE public.curriculum_topics
         SET topic_name        = r ->> 'topic_name',
             sub_topics        = COALESCE(
               ARRAY(SELECT jsonb_array_elements_text(r -> 'sub_topics')), '{}'),
             learning_outcomes = COALESCE(
               ARRAY(SELECT jsonb_array_elements_text(r -> 'learning_outcomes')), '{}'),
             suggested_periods = NULLIF(r ->> 'suggested_periods', '')::INT,
             source            = r ->> 'source',
             source_url        = NULLIF(r ->> 'source_url', ''),
             syllabus_year     = NULLIF(r ->> 'syllabus_year', '')::INT,
             display_order     = COALESCE(NULLIF(r ->> 'display_order', '')::INT, 0),
             is_active         = TRUE
       WHERE id = v_existing;
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO public.curriculum_topics (
        country_code, curriculum_type, subject, grade_level, topic_code, topic_name,
        sub_topics, learning_outcomes, suggested_periods, source, source_url,
        syllabus_year, display_order
      ) VALUES (
        upper(COALESCE(r ->> 'country_code', 'ZM')),
        lower(COALESCE(r ->> 'curriculum_type', 'ecz')),
        r ->> 'subject',
        r ->> 'grade_level',
        r ->> 'topic_code',
        r ->> 'topic_name',
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(r -> 'sub_topics')), '{}'),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(r -> 'learning_outcomes')), '{}'),
        NULLIF(r ->> 'suggested_periods', '')::INT,
        r ->> 'source',
        NULLIF(r ->> 'source_url', ''),
        NULLIF(r ->> 'syllabus_year', '')::INT,
        COALESCE(NULLIF(r ->> 'display_order', '')::INT, 0)
      );
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN QUERY SELECT v_inserted, v_updated, v_skipped, v_errors;
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_curriculum_topics(JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS.
-- ---------------------------------------------------------------------------
ALTER TABLE public.curriculum_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.curriculum_topics FORCE  ROW LEVEL SECURITY;

/**
 * Readable by every authenticated user, and that is right rather than lax.
 *
 * This is published government curriculum — the ECZ syllabus is a public document. It carries no
 * school data, no pupil data and no commercial secret. A teacher browsing what the syllabus says
 * about their topic is a legitimate use of the product in its own right, and gating it per school
 * would mean a standalone Hub teacher (who has no school) could not be grounded at all.
 *
 * Contrast `ai_prompt_templates`, which IS restricted: the prompt is accumulated product work a
 * competitor could copy. The syllabus is not ours to withhold.
 */
CREATE POLICY authenticated_read_curriculum_topics
  ON public.curriculum_topics FOR SELECT TO authenticated
  USING (is_active = TRUE OR COALESCE(public.is_afritech_admin(), FALSE));

-- SELECT only. Import goes through the function, which is the single place the validation and the
-- AfriTech check live; a table grant would be a second way in with neither.
GRANT SELECT ON public.curriculum_topics TO authenticated;

-- === MIGRATION END ===
