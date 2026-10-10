/**
 * The scaffold generator.
 *
 * ## Why this exists rather than a Claude call
 *
 * The Teacher Hub's documented core is a lesson planner using RAG over a Zambian
 * curriculum knowledge base. Two things that needs do not exist on this project: an LLM
 * (no SDK, no `ANTHROPIC_API_KEY`) and the knowledge base itself (no syllabus content has
 * ever been ingested, and `supabase/functions/` is empty). Neither is a small gap, and
 * neither can be closed by writing more TypeScript.
 *
 * So this is the same decision Phase 3 took for communications: build the entire flow
 * against a provider seam with a working stand-in, so that entitlement metering, saving,
 * the library, and export are all real and exercised, and the model is one adapter.
 *
 * ## What it must not do
 *
 * It must not pretend. `modelGenerated: false` travels with every result and the screens
 * say so in words. A teacher who has paid K300 for AI lesson planning and receives a
 * template presented as AI output has been misled, and that is worse than an empty state.
 *
 * ## What it actually does
 *
 * Real work, not lorem ipsum: it lays out a time-boxed lesson spine whose phase minutes
 * sum exactly to the requested duration, in the shape Zambian schemes of work use, and
 * seeds each section with the questions a teacher fills in. That is genuinely useful — it
 * is the paper structure, typed — and it is honestly labelled.
 */

import type {
  GeneratedContent,
  GenerationRequest,
  GenerationResult,
  Generator,
  LessonPhase,
  LessonType,
  QuizQuestion,
} from '../types'

const NAME = 'template-scaffold'
const VERSION = '1.0.0'

/**
 * Phase weights by lesson type. An introduction spends longer on orientation; a revision
 * lesson spends almost nothing on it and most of the time on practice. These are the
 * proportions, and `distribute` turns them into whole minutes.
 */
const PHASE_WEIGHTS = {
  introduction: [
    ['Introduction and prior knowledge', 0.25],
    ['New concept — teacher exposition', 0.3],
    ['Guided practice', 0.25],
    ['Consolidation and plenary', 0.2],
  ],
  core: [
    ['Recap and objectives', 0.15],
    ['Teacher exposition with worked examples', 0.3],
    ['Guided practice', 0.25],
    ['Independent practice', 0.2],
    ['Plenary and next steps', 0.1],
  ],
  revision: [
    ['Diagnostic questions', 0.2],
    ['Targeted reteaching of weak areas', 0.3],
    ['Mixed practice', 0.35],
    ['Plenary — what to revise tonight', 0.15],
  ],
  assessment_prep: [
    ['Exam technique and command words', 0.2],
    ['Worked past-paper question', 0.3],
    ['Timed practice', 0.35],
    ['Mark scheme walkthrough', 0.15],
  ],
  // `satisfies` rather than a `Record<string, …>` annotation: with
  // `noUncheckedIndexedAccess` on, a string-keyed record makes every lookup
  // `T | undefined` — including `PHASE_WEIGHTS.core`, the fallback itself. Keyed by
  // `LessonType`, the lookup is total and needs no guard.
} as const satisfies Record<LessonType, ReadonlyArray<readonly [string, number]>>

/**
 * Splits `total` across `weights` so the parts are whole minutes that sum to exactly
 * `total`. Rounding each weight independently does not — four phases of a 40-minute
 * lesson can easily come to 39 or 41, and a plan whose phases do not add up to its own
 * duration is the first thing a head of department notices. The remainder goes to the
 * largest phase, which is where a minute matters least.
 */
function distribute(total: number, weights: readonly number[]): number[] {
  const raw = weights.map((w) => Math.max(1, Math.floor(total * w)))
  const drift = total - raw.reduce((a, b) => a + b, 0)
  if (drift !== 0) {
    const biggest = raw.indexOf(Math.max(...raw))
    // `?? 0` only because an index signature is not narrowed by `indexOf`; `biggest` is
    // always in range for a non-empty array, and every weight list here is non-empty.
    raw[biggest] = Math.max(1, (raw[biggest] ?? 0) + drift)
  }
  return raw
}

function lessonPlan(request: GenerationRequest): GeneratedContent {
  const duration = request.durationMinutes ?? 40
  const type = request.lessonType ?? 'core'
  const spec = PHASE_WEIGHTS[type]
  const minutes = distribute(
    duration,
    spec.map(([, w]) => w),
  )

  const outline: LessonPhase[] = spec.map(([phase], i) => {
    const phaseMinutes = minutes[i] ?? 1
    return {
      phase,
      minutes: phaseMinutes,
      teacherActivity: `[${phase}] — plan what you will do for ${phaseMinutes} minutes on ${request.topic}.`,
      pupilActivity: 'What will the class be doing, and how will you know they are doing it?',
    }
  })

  return {
    summary:
      `A ${duration}-minute ${type.replace('_', ' ')} lesson on ${request.topic} ` +
      `for ${request.gradeLevel} ${request.subject}.`,
    objectives: [
      `By the end of the lesson, pupils can state what ${request.topic} is and why it matters.`,
      `By the end of the lesson, pupils can work through a ${request.topic} problem unaided.`,
      'Add a third objective, or delete this line — two well-chosen objectives beat three vague ones.',
    ],
    priorKnowledge:
      request.context?.trim() ||
      `What must the class already know before ${request.topic} makes sense? Write it here — ` +
        'this is the line that decides whether the lesson lands.',
    materials: ['Chalkboard or whiteboard', 'Exercise books', 'Add the textbook and page range'],
    outline,
    assessment: {
      formative:
        'How will you check understanding DURING the lesson, not at the end of it? ' +
        'Name the moment and the question.',
      questions: [
        `Ask one pupil to explain ${request.topic} in their own words.`,
        `Set one question on ${request.topic} that a pupil who was not listening would get wrong.`,
      ],
    },
    homework: `Set 3–5 questions on ${request.topic}. Note which ones you will mark.`,
    differentiation: {
      support: 'Who will struggle, and what will you give them instead? Name the pupils.',
      extension: 'What will the fastest finishers do? Have it ready before the lesson starts.',
    },
    reflectionPrompts: [
      'Did the class meet the objectives? What is the evidence?',
      'Which phase ran over, and what will you cut next time?',
    ],
  }
}

function quiz(request: GenerationRequest): GeneratedContent {
  const count = Math.min(Math.max(request.questionCount ?? 10, 1), 50)
  const style = request.questionStyle ?? 'mixed'
  const questions: QuizQuestion[] = []

  for (let i = 1; i <= count; i += 1) {
    /**
     * A mixed paper is mostly multiple choice with short answers through it and one
     * extended question at the end — the shape an ECZ paper actually takes, rather than
     * an even split that no real paper uses.
     */
    const type =
      style === 'mixed'
        ? i === count && count >= 5
          ? 'extended_response'
          : i % 3 === 0
            ? 'short_answer'
            : 'multiple_choice'
        : style === 'multiple_choice'
          ? 'multiple_choice'
          : style === 'short_answer'
            ? 'short_answer'
            : 'extended_response'

    const marks = type === 'extended_response' ? 6 : type === 'short_answer' ? 2 : 1

    questions.push({
      number: i,
      type,
      prompt: `Question ${i} on ${request.topic} — write the question here (${marks} mark${marks === 1 ? '' : 's'}).`,
      options:
        type === 'multiple_choice'
          ? ['A — ', 'B — ', 'C — ', 'D — ']
          : undefined,
      marks,
      answer: 'Write the answer.',
      markingNotes:
        type === 'extended_response'
          ? 'Break the marks down — one per step, so the marking is defensible.'
          : undefined,
    })
  }

  return {
    summary:
      `A ${count}-question ${request.difficulty === 'exam_style' ? 'exam-style' : 'standard'} ` +
      `${request.subject} quiz on ${request.topic} for ${request.gradeLevel}.`,
    questions,
    totalMarks: questions.reduce((sum, q) => sum + q.marks, 0),
    instructions: `Answer all ${count} questions. Show your working.`,
  }
}

function homework(request: GenerationRequest): GeneratedContent {
  const minutes = request.durationMinutes ?? 20
  /** Roughly four minutes a question is what homework actually takes at this level. */
  const count = Math.max(3, Math.min(10, Math.round(minutes / 4)))

  return {
    summary: `${minutes} minutes of ${request.subject} homework on ${request.topic} for ${request.gradeLevel}.`,
    instructions:
      `Complete all ${count} questions in your exercise book. Show your working. ` +
      'Bring it to the next lesson.',
    estimatedMinutes: minutes,
    questions: Array.from({ length: count }, (_, i) => ({
      number: i + 1,
      type: 'short_answer' as const,
      prompt: `Question ${i + 1} on ${request.topic} — write it here.`,
      marks: 2,
      answer: 'Write the answer — this stays on the teacher copy.',
    })),
    totalMarks: count * 2,
  }
}

export const templateGenerator: Generator = {
  name: NAME,
  version: VERSION,

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const content =
      request.kind === 'lesson_plan'
        ? lessonPlan(request)
        : request.kind === 'quiz'
          ? quiz(request)
          : homework(request)

    const label =
      request.kind === 'lesson_plan' ? '' : request.kind === 'quiz' ? ' — Quiz' : ' — Homework'

    return {
      title: `${request.gradeLevel} ${request.subject}: ${request.topic}${label}`,
      content,
      generatorName: NAME,
      generatorVersion: VERSION,
      // No knowledge base exists, so nothing was retrieved. NULL rather than `[]`: an
      // empty array would claim a retrieval happened and returned nothing.
      knowledgeSources: null,
      modelGenerated: false,
    }
  },
}
