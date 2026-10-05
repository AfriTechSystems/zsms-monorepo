/**
 * Turning a syllabus document into topic rows.
 *
 * ## Extract, verify, then write — never extract and write
 *
 * This is the pattern `AI_CAPTURE.md` specifies for photographed mark sheets, and it applies here
 * for the same reason: the model is reading a document it can misread, and the cost of a silent
 * misreading is high. A wrong topic code does not look wrong. It looks exactly like a right one,
 * and it ends up cited in a lesson plan a teacher hands to their head of department.
 *
 * So this function **proposes**. Nothing reaches `curriculum_topics` until a person has looked at
 * the table and pressed import.
 *
 * ## Fidelity, not fluency
 *
 * The single most important instruction in the prompt is to copy rather than compose. A model
 * asked to extract learning outcomes will happily improve them — tightening the wording, merging
 * two into one, inventing a fourth that "obviously belongs". Every one of those makes the
 * grounding worse, because the whole value of this store is that it says what the syllabus says.
 *
 * ## A missing code is reported, not invented
 *
 * Some syllabuses number their topics and some do not. `import_curriculum_topics()` requires a
 * `topic_code`, so the tempting move is to have the model produce one. It does — but marked
 * `code_inferred`, so the verification table can show which codes came from the document and
 * which came from counting. An inferred code is fine as an internal key and must never be
 * presented to a teacher as a syllabus reference.
 */

export interface ExtractedTopic {
  /**
   * Which subject and grade this topic belongs to, from the sets the request named.
   *
   * Per topic, not per extraction, because `curriculum_topics` is unique on
   * (country, curriculum, subject, grade_level, topic_code) — the table's grain is one
   * topic in one subject in one grade.
   */
  subject: string
  grade_level: string
  topic_code: string
  /** TRUE when the document had no code and the position was used instead. */
  code_inferred: boolean
  topic_name: string
  sub_topics: string[]
  learning_outcomes: string[]
  suggested_periods: number | null
  display_order: number
}

export interface CurriculumExtraction {
  topics: ExtractedTopic[]
  /** What the document calls itself — becomes `source` on every row. */
  detected_source: string
  detected_syllabus_year: number | null
  /** Anything the model could not parse, or chose not to guess at. Shown to the operator. */
  notes: string
}

export const CURRICULUM_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['topics', 'detected_source', 'detected_syllabus_year', 'notes'],
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['subject', 'grade_level', 'topic_code', 'code_inferred', 'topic_name',
                   'sub_topics', 'learning_outcomes', 'suggested_periods', 'display_order'],
        properties: {
          /*
            Which subject and grade this topic belongs to.

            Added 2026-10-05, when extraction stopped being one-subject-one-grade. An ECZ
            syllabus covers a subject across a band of grades, and a single document is
            often the only copy a school has — so an operator must be able to say
            "Mathematics, Grades 8 to 9" once rather than run the same PDF four times.

            Per TOPIC rather than per extraction, because `curriculum_topics` is unique on
            (country, curriculum, subject, grade_level, topic_code): the grain of the table
            is one topic in one subject in one grade, and that is what the model must
            produce. Tagging the extraction as a whole would make every row ambiguous.
          */
          subject: {
            type: 'string',
            description:
              'EXACTLY one of the subjects named in the request, spelled as the request '
              + 'spells it. Never a subject the request did not name.',
          },
          grade_level: {
            type: 'string',
            description:
              'EXACTLY one of the grades named in the request, spelled as the request '
              + 'spells it. A topic taught across two grades is returned TWICE, once per '
              + 'grade, because a syllabus row belongs to a grade.',
          },
          topic_code: {
            type: 'string',
            description:
              'The code the DOCUMENT gives this topic — "7.3", "B2.4", "Unit 5". If the document '
              + 'gives none, use the position ("1", "2") and set code_inferred true.',
          },
          code_inferred: {
            type: 'boolean',
            description: 'TRUE only when the document had no code of its own for this topic.',
          },
          topic_name: { type: 'string' },
          sub_topics: { type: 'array', items: { type: 'string' } },
          learning_outcomes: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Copied from the document as closely as the wording allows. Do not tighten, merge '
              + 'or add. An outcome that is not in the document must not be in this array.',
          },
          suggested_periods: {
            type: ['integer', 'null'],
            description: 'Teaching periods the document allots, or null if it says nothing.',
          },
          display_order: {
            type: 'integer',
            description: 'Position in the document, from 1. This is teaching order.',
          },
        },
      },
    },
    detected_source: {
      type: 'string',
      description:
        'What the document calls itself, as printed on it — "ECZ Mathematics Syllabus Grades 8-9".',
    },
    detected_syllabus_year: { type: ['integer', 'null'] },
    notes: {
      type: 'string',
      description:
        'Anything unclear, unreadable, or deliberately not guessed at. Empty string if none.',
    },
  },
} as const

export const CURRICULUM_EXTRACTION_SYSTEM_PROMPT =
  `You extract syllabus structure from curriculum documents. You COPY; you do not compose.

THE RULE THAT MATTERS MOST
Every topic name and every learning outcome you return must appear in the document. Copy the
wording as closely as the format allows. Do not tighten it, do not merge two outcomes into one,
and do not add an outcome because it obviously belongs. The value of this extraction is that it
says what the syllabus says — an improved outcome is a wrong outcome.

CODES
Use the code the document gives each topic. If the document numbers its topics, that number is the
code. If it gives no codes at all, use the position and set code_inferred to true so a person can
see the difference. Never construct a code that looks official when it is not.

WHAT NOT TO INCLUDE
Skip front matter, aims, rationale, assessment policy, appendices and anything that is not a
teaching topic. A syllabus contains a lot of prose that is not the outline.

WHEN THE DOCUMENT IS UNCLEAR
Say so in notes and leave the field out. A gap a person can see and fill is far better than a
plausible guess they cannot spot. If the extract is only part of the document — a single grade
from a multi-grade syllabus, say — note that too.

ORDER
Preserve the document's order. That is teaching order, and it matters.`

/** A literal newline, named so it survives being edited by a script. */
const NEWLINE = String.fromCharCode(10)

export function curriculumExtractionPrompt(params: {
  curriculumType: string
  /** One or more. A syllabus often covers a band of grades, sometimes several subjects. */
  subjects: string[]
  grades: string[]
  documentText: string
}): string {
  const subjects = params.subjects.map((x) => `- ${x}`).join(NEWLINE)
  const grades = params.grades.map((x) => `- ${x}`).join(NEWLINE)

  /*
    The instruction is deliberately about EXCLUSION first.

    The failure that matters is not a missed topic — an operator checks the table before
    importing and can see a gap. It is a FABRICATED one, or a real topic filed under the
    wrong grade, because both look correct in the review table and become a citation the
    lesson planner presents to a teacher as the national syllabus.
  */
  return `Extract syllabus topics from the document below.

Curriculum: ${params.curriculumType}

Subjects to extract (use these spellings exactly):
${subjects}

Grades to extract (use these spellings exactly):
${grades}

Tag EVERY topic with the one subject and the one grade it belongs to, chosen from the lists above.

Rules, in order of importance:

1. A topic whose subject or grade is not in the lists above must be LEFT OUT. Not summarised,
   not reassigned to the nearest listed grade, not merged. Left out.
2. Never invent a topic, a code or an outcome. If the document is unclear, return less.
3. A topic the document teaches across two of the listed grades is returned TWICE, once per
   grade — the table's grain is one topic in one subject in one grade.
4. If the document contains nothing for a listed subject or grade, simply return nothing for it
   and say so in notes. An empty result is a correct answer. Filling the table is not.

--- DOCUMENT ---
${params.documentText}
--- END DOCUMENT ---`
}
