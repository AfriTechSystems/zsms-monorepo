/**
 * The JSON schema the model fills in.
 *
 * ## One document, many renderings
 *
 * This is the single structured artefact every output format is rendered FROM — PDF, Word,
 * later PowerPoint. That is what makes the format dropdown cheap: adding "slides" is a
 * renderer over this shape, not another model call, another prompt, or another credit price.
 *
 * ## Diagrams are text, and that is the whole trick
 *
 * `diagrams[].source` is Mermaid or SVG **emitted by the text model in this same call**. No
 * image model, no extra cost, no second round trip. It prints legibly in black and white on a
 * school photocopier, a teacher can correct a mislabelled part, and it embeds in all three
 * export formats. A diffusion-model illustration does none of those things and costs an order
 * of magnitude more.
 *
 * ## Changing this shape changes stored data
 *
 * Every generated document is persisted in `teaching_resources.content` verbatim. So fields
 * may be ADDED, and must never be repurposed or narrowed — an old lesson plan has to keep
 * rendering. Anything genuinely incompatible is a new field plus a prompt version, and the
 * version is recorded on the row.
 */

/** Kept in sync with `GeneratedContent` in `types.ts`, which is what callers consume. */
export const TEACHING_PACK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'objectives', 'priorKnowledge', 'materials', 'outline', 'assessment',
             'homework', 'differentiation', 'reflectionPrompts', 'diagrams', 'charts'],
  properties: {
    summary: {
      type: 'string',
      description: 'Two sentences a head of department could read to know what this lesson is.',
    },
    objectives: {
      type: 'array',
      // Two well-chosen objectives beat five vague ones, and a capped array stops the model
      // padding to look thorough.
      minItems: 2,
      maxItems: 4,
      items: { type: 'string' },
      description: 'Each starts "By the end of the lesson, pupils can…" and is observable.',
    },
    priorKnowledge: {
      type: 'string',
      description: 'What the class must already know for this to land.',
    },
    materials: { type: 'array', items: { type: 'string' } },
    outline: {
      type: 'array',
      minItems: 3,
      maxItems: 7,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phase', 'minutes', 'teacherActivity', 'pupilActivity'],
        properties: {
          phase: { type: 'string' },
          minutes: { type: 'integer' },
          teacherActivity: { type: 'string' },
          pupilActivity: { type: 'string' },
        },
      },
      description:
        'Phases whose minutes sum EXACTLY to the requested duration. A plan whose phases do '
        + 'not add up to its own length is the first thing a head of department notices.',
    },
    assessment: {
      type: 'object',
      additionalProperties: false,
      required: ['formative', 'questions'],
      properties: {
        formative: {
          type: 'string',
          description: 'How understanding is checked DURING the lesson, not after it.',
        },
        questions: { type: 'array', items: { type: 'string' } },
      },
    },
    homework: { type: 'string' },
    differentiation: {
      type: 'object',
      additionalProperties: false,
      required: ['support', 'extension'],
      properties: {
        support: { type: 'string', description: 'For pupils who will struggle.' },
        extension: { type: 'string', description: 'For pupils who finish early.' },
      },
    },
    reflectionPrompts: { type: 'array', items: { type: 'string' } },
    diagrams: {
      type: 'array',
      // Zero is a valid answer. A model told it must produce a diagram will invent one for a
      // poetry lesson, and a pointless diagram is worse than none.
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'kind', 'source', 'caption'],
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: ['mermaid', 'svg'] },
          source: {
            type: 'string',
            description:
              'Valid Mermaid source or a self-contained SVG. No external references, no '
              + 'images, no scripts — it is embedded in a PDF and a Word file.',
          },
          caption: { type: 'string' },
        },
      },
    },
    charts: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'kind', 'labels', 'series'],
        properties: {
          title: { type: 'string' },
          kind: { type: 'string', enum: ['bar', 'line', 'pie'] },
          labels: { type: 'array', items: { type: 'string' } },
          series: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'values'],
              properties: {
                name: { type: 'string' },
                values: { type: 'array', items: { type: 'number' } },
              },
            },
          },
        },
      },
      description:
        'A chart SPEC, not a rendered image — so the renderer draws it correctly for each '
        + 'output format and a teacher can change a number.',
    },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'reference'],
        properties: {
          source: { type: 'string' },
          reference: { type: 'string' },
        },
      },
      description:
        'Curriculum references, populated ONLY from the syllabus outcomes supplied in the '
        + 'prompt. Never invented — an invented topic code is worse than no citation, because '
        + 'a teacher will repeat it to a head of department.',
    },
  },
} as const
