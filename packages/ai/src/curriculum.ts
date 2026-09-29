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
        required: ['topic_code', 'code_inferred', 'topic_name', 'sub_topics',
                   'learning_outcomes', 'suggested_periods', 'display_order'],
        properties: {
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

export function curriculumExtractionPrompt(params: {
  curriculumType: string
  subject: string
  gradeLevel: string
  documentText: string
}): string {
  return `Extract the syllabus topics for ONE subject and grade from the document below.

Curriculum: ${params.curriculumType}
Subject: ${params.subject}
Grade: ${params.gradeLevel}

Return ONLY topics for that subject and grade. A syllabus document often covers several grades or
several subjects; everything outside the one named above must be left out, not summarised.

If the document contains nothing for that subject and grade, return an empty topics array and say
so in notes. An empty result is a correct answer — inventing topics to fill the table is not.

--- DOCUMENT ---
${params.documentText}
--- END DOCUMENT ---`
}
