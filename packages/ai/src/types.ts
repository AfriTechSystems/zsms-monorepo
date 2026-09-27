/**
 * Shapes for teaching-resource generation.
 *
 * These types are the contract between a caller and whatever generator is configured, so
 * that swapping the deterministic scaffold for Claude-over-RAG changes one file and not
 * the API routes or the screens.
 */

export type ResourceKind = 'lesson_plan' | 'quiz' | 'homework'

export type LessonType = 'introduction' | 'core' | 'revision' | 'assessment_prep'

/** Matches the `curriculum_type` values the rest of the schema already uses. */
export type CurriculumType = 'ecz' | 'cambridge_igcse' | 'cambridge_alevel' | 'custom'

export interface GenerationRequest {
  kind: ResourceKind
  subject: string
  gradeLevel: string
  topic: string
  curriculumType: CurriculumType
  /** Lesson plans and homework only. */
  durationMinutes?: number
  lessonType?: LessonType
  /** Quizzes only. */
  questionCount?: number
  questionStyle?: 'multiple_choice' | 'mixed' | 'short_answer' | 'extended_response'
  difficulty?: 'standard' | 'exam_style'
  /** Whatever the teacher wants the generator to know — prior coverage, known struggles. */
  context?: string
}

/** One phase of a lesson — the time-boxed spine of the plan. */
export interface LessonPhase {
  phase: string
  minutes: number
  teacherActivity: string
  pupilActivity: string
}

export interface QuizQuestion {
  number: number
  type: 'multiple_choice' | 'short_answer' | 'extended_response'
  prompt: string
  options?: string[]
  marks: number
  /** Kept out of any pupil-facing render. */
  answer: string
  markingNotes?: string
}

/**
 * The generated document. Stored verbatim in `teaching_resources.content`, so a change
 * here is a change to stored data — add fields, do not repurpose them.
 */
export interface GeneratedContent {
  /** Present on every kind, so a library row can always show something meaningful. */
  summary: string
  objectives?: string[]
  priorKnowledge?: string
  materials?: string[]
  outline?: LessonPhase[]
  assessment?: { formative: string; questions: string[] }
  homework?: string
  differentiation?: { support: string; extension: string }
  reflectionPrompts?: string[]
  questions?: QuizQuestion[]
  totalMarks?: number
  instructions?: string
  estimatedMinutes?: number
}

export interface GenerationResult {
  title: string
  content: GeneratedContent
  /**
   * Which generator produced this, recorded on the row. ADR-041's rule in a third place:
   * a derived artefact carries its basis.
   */
  generatorName: string
  generatorVersion: string
  /**
   * Which knowledge-base chunks were retrieved. NULL until a knowledge base exists —
   * and its absence is exactly how a reader can tell this was not RAG-grounded.
   */
  knowledgeSources: unknown[] | null
  /**
   * TRUE when a real model wrote this, FALSE when it is a structured scaffold. The screens
   * MUST surface this: presenting a template as AI-generated curriculum-aligned content
   * would misrepresent the product to a paying teacher.
   */
  modelGenerated: boolean
}

export interface Generator {
  name: string
  version: string
  generate(request: GenerationRequest): Promise<GenerationResult>
}
