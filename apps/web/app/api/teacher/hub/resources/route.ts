/**
 * The library, and the act of generating into it.
 *
 *   GET  /api/teacher/hub/resources — the teacher's library, filterable
 *   POST /api/teacher/hub/resources — generate a resource and save it
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *       `Official Documentation/18 AI Module/LESSON_PLANNER.md`
 *
 * ## The order of operations on POST, and why it is this way round
 *
 * Generate first, then save through `create_teaching_resource()`. The function re-resolves
 * entitlement **inside a row lock** and increments the counter in the same statement, so
 * the meter cannot be beaten by two requests arriving together.
 *
 * That means a teacher on their last trial resource who submits twice at once will have
 * one generation thrown away after the fact. That is the right way round: the alternative
 * is checking the meter first and then generating, which leaves a gap where both requests
 * pass the check. Wasting a few milliseconds of a deterministic template — or one model
 * call later — is cheaper than handing out a free resource, and the teacher sees a clear
 * refusal either way.
 *
 * ## Nothing here trusts the client about entitlement
 *
 * The screen reads the entitlement and disables the button, which is a courtesy, not a
 * control. The refusal that matters is the `42501` this route translates below.
 */

import { createUserClient } from '../../../../../lib/supabase'
import { getAuthProvider } from '@zsms/auth-provider'
import {
  created,
  fail,
  fromPostgrestError,
  guard,
  ok,
  validationFailed,
} from '../../../../../lib/api-response'
import {
  AllProvidersFailedError,
  generateTeachingResource,
  isModelBacked,
  liveGenerationEnabled,
  type IncidentReport,
  type LiveGeneratorConfig,
} from '@zsms/ai'
import { generateSchema, resourceKindSchema } from '../../../../../lib/teacher-hub'

export const dynamic = 'force-dynamic'

interface ResourceListRow {
  id: string
  resource_kind: string
  title: string
  subject: string
  grade_level: string
  topic: string
  curriculum_type: string
  duration_minutes: number | null
  lesson_type: string | null
  is_shared: boolean
  generator_name: string
  generator_version: string
  school_id: string | null
  created_at: string
  updated_at: string
}

/** The list view never needs `content`, which is the largest column by far. */
const LIST_COLUMNS =
  'id, resource_kind, title, subject, grade_level, topic, curriculum_type, ' +
  'duration_minutes, lesson_type, is_shared, generator_name, generator_version, ' +
  'school_id, created_at, updated_at'

export async function GET(request: Request): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const url = new URL(request.url)
    const kind = url.searchParams.get('kind')
    const subject = url.searchParams.get('subject')
    const grade = url.searchParams.get('grade')
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 200)

    // No `created_by` filter. `teacher_read_own_resources` scopes on get_user_id(), so
    // adding one here would duplicate a rule the policy already enforces — and a
    // duplicated rule is one that can drift.
    let query = client
      .from('teaching_resources')
      .select(LIST_COLUMNS)
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (kind) {
      const parsedKind = resourceKindSchema.safeParse(kind)
      if (!parsedKind.success) return fail('VALIDATION_ERROR', 'Unknown resource kind.')
      query = query.eq('resource_kind', parsedKind.data)
    }
    if (subject) query = query.eq('subject', subject)
    if (grade) query = query.eq('grade_level', grade)

    const { data, error } = await query
    if (error) return fromPostgrestError(error)

    /**
     * PostgREST widens an inferred row type to a union including its error shape when the
     * select list is a built string rather than a literal. The narrowing is safe because
     * `error` was checked immediately above — the documented recurring cast in this
     * codebase, and the reason `no-explicit-any` is a warning rather than an error.
     */
    const rows = (data ?? []) as unknown as ResourceListRow[]

    return ok(
      {
        resources: rows,
        // The filter options the teacher actually has, derived from what they own rather
        // than from a fixed list — a teacher who only does Grade 9 maths should not be
        // offered eleven other grades.
        subjects: [...new Set(rows.map((r) => r.subject))].sort(),
        grades: [...new Set(rows.map((r) => r.grade_level))].sort(),
        counts: {
          lesson_plan: rows.filter((r) => r.resource_kind === 'lesson_plan').length,
          quiz: rows.filter((r) => r.resource_kind === 'quiz').length,
          homework: rows.filter((r) => r.resource_kind === 'homework').length,
        },
      },
      { total: rows.length },
    )
  })
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const parsed = generateSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return validationFailed(parsed.error)
    const body = parsed.data

    /**
     * The model chain, the active prompt and the credit price, in one round trip. Absent or
     * incomplete, `generateTeachingResource()` falls back to the scaffold rather than failing —
     * a school with no published prompt gets a working lesson structure, not a 500.
     */
    const feature =
      body.kind === 'quiz'
        ? 'ai_quiz_generator'
        : body.kind === 'homework'
          ? 'ai_homework_creator'
          : 'ai_lesson_planner'

    let liveConfig: LiveGeneratorConfig | null = null

    if (liveGenerationEnabled()) {
      const cfg = await client.rpc('ai_generation_config', { p_feature_key: feature })
      const config = cfg.data as {
        models?: LiveGeneratorConfig['models']
        prompt?: LiveGeneratorConfig['prompt']
      } | null

      if (config?.prompt && config.models && config.models.length > 0) {
        /**
         * The syllabus slice for this subject and grade — the WHOLE slice, not a matched topic.
         *
         * Ten to thirty rows, a few hundred tokens. Passing all of them means the model does the
         * topic matching (so a teacher typing "Simultaneous Eqns" still lands correctly) and,
         * more importantly, **it cannot cite a code that was not in front of it**. An invented
         * ECZ reference is the worst output this product could produce, because the teacher
         * repeats it in good faith and is blamed for it.
         *
         * Empty is a normal state, not an error: the prompt is told explicitly that none were
         * supplied and to cite nothing at all.
         */
        const slice = await client.rpc('curriculum_slice', {
          p_curriculum_type: body.curriculumType,
          p_subject: body.subject,
          p_grade_level: body.gradeLevel,
        })

        const outcomes = ((slice.data ?? []) as Array<{
          topic_code: string
          topic_name: string
          learning_outcomes: string[] | null
          suggested_periods: number | null
          source: string
        }>).flatMap((t) =>
          (t.learning_outcomes ?? []).map(
            (o) =>
              `[${t.topic_code}] ${t.topic_name} — ${o}`
              + (t.suggested_periods ? ` (${t.suggested_periods} periods)` : '')
              + ` · ${t.source}`,
          ),
        )

        liveConfig = {
          models: config.models,
          prompt: config.prompt,
          curriculumOutcomes: outcomes,
          /**
           * How a provider failure reaches AfriTech. `@zsms/ai` never imports Supabase, so the
           * chain hands the report back and this closure persists it.
           *
           * Deliberately not awaited into the failure path: `record_platform_incident()` is an
           * UPSERT on `dedupe_key`, so two hundred failures of one dead key become one incident
           * with a count of two hundred rather than two hundred rows.
           */
          onFailure: async (report: IncidentReport) => {
            await client.rpc('record_platform_incident', {
              p_source: report.source,
              p_kind: report.kind,
              p_title: report.title,
              p_dedupe_key: report.dedupeKey,
              p_severity: report.severity,
              p_detail: report.detail,
              p_school_id: null,
              p_feature_key: feature,
              // AfriTech's plumbing. A school does not need to know its lesson plan came from
              // the second provider in the chain.
              p_is_school_visible: false,
              p_metadata: report.metadata,
            })
          },
        }
      }
    }

    const result = await generateTeachingResource({
      kind: body.kind,
      subject: body.subject,
      gradeLevel: body.gradeLevel,
      topic: body.topic,
      curriculumType: body.curriculumType,
      durationMinutes: body.durationMinutes,
      lessonType: body.lessonType,
      questionCount: body.questionCount,
      questionStyle: body.questionStyle,
      difficulty: body.difficulty,
      context: body.context,
    }, liveConfig).catch((error: unknown) => {
      /**
       * Every provider failed. The chain has already raised the incident, so the teacher is
       * told the one thing that matters to them: nothing was generated and nothing was charged.
       * The charge happens after this point, so "not charged" is a fact rather than a promise.
       */
      if (error instanceof AllProvidersFailedError) return null
      throw error
    })

    if (result === null) {
      return fail(
        'SERVER_ERROR',
        'The AI service is unavailable right now. You have not been charged — please try again '
          + 'in a few minutes.',
      )
    }

    const { data, error } = await client.rpc('create_teaching_resource', {
      p_resource_kind: body.kind,
      p_title: result.title,
      p_subject: body.subject,
      p_grade_level: body.gradeLevel,
      p_topic: body.topic,
      p_curriculum_type: body.curriculumType,
      p_content: result.content as unknown as Record<string, unknown>,
      p_generator_name: result.generatorName,
      p_generator_version: result.generatorVersion,
      p_duration_minutes: body.durationMinutes ?? null,
      p_lesson_type: body.lessonType ?? null,
      // The request, kept beside the output so a regeneration can be compared with what
      // was originally asked for.
      p_generation_params: {
        questionCount: body.questionCount ?? null,
        questionStyle: body.questionStyle ?? null,
        difficulty: body.difficulty ?? null,
        context: body.context ?? null,
      },
      p_knowledge_sources: result.knowledgeSources as unknown as Record<string, unknown> | null,
      p_school_id: body.schoolId ?? null,
      /**
       * The cost side, recorded on the credit ledger row by `ai_credit_consume()` inside the
       * RPC. Absent for the scaffold, which costs nothing to run; a model adapter fills it in
       * and nothing here changes.
       */
      p_model_name: result.usage?.modelName ?? null,
      p_input_tokens: result.usage?.inputTokens ?? null,
      p_output_tokens: result.usage?.outputTokens ?? null,
      p_cost_usd: result.usage?.costUsd ?? null,
      p_idempotency_key: null,
      // Which prompt produced this. NULL for the scaffold, which has no prompt — ADR-041.
      p_prompt_version: liveConfig?.prompt.version ?? null,
    })

    if (error) {
      /**
       * `42501` covers every refusal: out of AI credits, subscription lapsed, account
       * suspended, a school the caller is not in, or a personal monthly cap reached. The
       * message is written for a teacher to read, so it is passed through rather than
       * replaced with something generic — "Not enough AI credits: 1 needed, 0 available"
       * tells them what to do and a bare "Forbidden" does not.
       */
      if (error.code === '42501') return fail('FORBIDDEN', error.message)
      if (error.code === 'P0002') {
        return fail('NOT_FOUND', 'Set up your Teacher Hub profile before creating resources.')
      }
      return fromPostgrestError(error)
    }

    const { data: row, error: readError } = await client
      .from('teaching_resources')
      .select(`${LIST_COLUMNS}, content, generation_params, teacher_notes`)
      .eq('id', data as unknown as string)
      .single()

    if (readError) return fromPostgrestError(readError)

    return created({
      resource: row,
      // Travels with the result so the screen can label a scaffold honestly at the moment the
      // teacher first sees it, not only in a settings page. Per-request rather than global: a
      // school whose prompt row is missing gets a scaffold and is told so, even while another
      // request is model-backed.
      modelBacked: isModelBacked(liveConfig),
    })
  })
}
