/**
 * POST /api/admin/curriculum/extract — a syllabus PDF or Word file in, proposed topic rows out.
 *
 * Spec: `Official Documentation/18 AI Module/LESSON_PLANNER.md`
 *       `Official Documentation/18 AI Module/AI_CAPTURE.md` — extract, verify, then write
 *
 * ## This route writes nothing
 *
 * It proposes. The rows come back to the screen, a person checks and corrects them, and the
 * existing `POST /api/admin/curriculum` does the writing. That separation is the whole design: a
 * misread topic code does not look misread — it looks exactly like a correct one, and it would end
 * up cited in a lesson plan a teacher hands to their head of department.
 *
 * ## Not metered against AI credits
 *
 * Every other AI action charges the caller's wallet. This one does not, deliberately: an AfriTech
 * administrator has no school and no Teacher Hub plan, so `ai_credit_account_for_caller()` would
 * create them a personal wallet with a zero allowance and the extraction would be refused on its
 * first use. Curriculum ingestion is AfriTech's own platform work rather than a customer action,
 * and the cost is AfriTech's either way.
 *
 * The real dollar cost still comes back in the response and is shown on screen, so an operator can
 * see what a 200-page syllabus costs before doing eleven more.
 *
 * ## Text extraction, not vision
 *
 * `unpdf` and `mammoth` pull text out locally, and only the text goes to the model. That keeps the
 * cost low, works with both providers, and avoids sending a whole document to a vision model.
 *
 * The limitation is honest and stated to the user: a **scanned** syllabus is images of pages with
 * no text layer, so extraction returns nothing. Anthropic reads PDFs natively and would handle
 * that case — a reason to put credit on that key — but it is not built here.
 */

import { getAuthProvider } from '@zsms/auth-provider'
import {
  CURRICULUM_EXTRACTION_SCHEMA,
  CURRICULUM_EXTRACTION_SYSTEM_PROMPT,
  curriculumExtractionPrompt,
  liveGenerationEnabled,
  runChain,
  type CurriculumExtraction,
  type IncidentReport,
  type ModelSpec,
} from '@zsms/ai'

import { createUserClient } from '../../../../../lib/supabase'
import { resolveAdminContext } from '../../../../../lib/admin-context'
import { fail, fromPostgrestError, guard, ok } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * A syllabus PDF is large. Capped so a wrong file — a scanned textbook, a video — is refused here
 * rather than becoming a very slow request and a surprising bill.
 */
const MAX_BYTES = 15 * 1024 * 1024

/**
 * Roughly 60k characters, comfortably inside every model's window with room for the reply.
 *
 * Truncation is REPORTED rather than silent. A syllabus cut off at topic 40 of 60 that claims to
 * be complete is worse than one that says it stopped, because the missing topics are invisible
 * and nothing downstream can tell.
 */
const MAX_CHARS = 60_000

async function extractText(file: File): Promise<{ text: string; kind: string }> {
  const buffer = new Uint8Array(await file.arrayBuffer())
  const name = file.name.toLowerCase()

  if (name.endsWith('.pdf')) {
    const { extractText: extractPdfText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(buffer)
    const { text } = await extractPdfText(pdf, { mergePages: true })
    return { text: Array.isArray(text) ? text.join('\n') : text, kind: 'pdf' }
  }

  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer: Buffer.from(buffer) })
    return { text: result.value, kind: 'docx' }
  }

  if (name.endsWith('.txt') || name.endsWith('.md')) {
    return { text: new TextDecoder().decode(buffer), kind: 'text' }
  }

  // `.doc` is the old binary format and is deliberately not supported: it needs a different
  // library entirely, and Word has exported .docx by default since 2007.
  throw new Error('Upload a PDF, a .docx Word file, or plain text.')
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const admin = await resolveAdminContext()
    if (!admin) {
      return fail('FORBIDDEN', 'This area is restricted to AfriTech platform administrators.')
    }

    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    if (!liveGenerationEnabled()) {
      // Named plainly. The alternative is an operator uploading a file and getting an empty table
      // with no idea that the model was never switched on.
      return fail(
        'SERVER_ERROR',
        'AI extraction is switched off. Set AI_GENERATOR=live to enable it.',
      )
    }

    const form = await request.formData().catch(() => null)
    if (!form) return fail('VALIDATION_ERROR', 'Send the file as multipart form data.')

    const file = form.get('file')
    const curriculumType = String(form.get('curriculumType') ?? '').trim()
    /*
      Sets, not single values.

      An ECZ syllabus covers a subject across a band of grades, and a school usually has
      exactly one copy of the PDF — so running the same document four times to get Grades
      8 to 11 was the cost of the old one-subject-one-grade contract.

      Sent as repeated form fields, which is what a multi-select produces natively.
    */
    const subjects = form
      .getAll('subjects')
      .map((v) => String(v).trim())
      .filter((v) => v !== '')
    const grades = form
      .getAll('grades')
      .map((v) => String(v).trim())
      .filter((v) => v !== '')

    if (!(file instanceof File)) return fail('VALIDATION_ERROR', 'No file was uploaded.')
    if (!curriculumType || subjects.length === 0 || grades.length === 0) {
      /**
       * All three are required BEFORE extraction, not after. A syllabus document usually covers
       * several grades and sometimes several subjects, and telling the model which slice to take
       * is the difference between a clean extract and a merged one nobody can untangle.
       */
      return fail(
        'VALIDATION_ERROR',
        'Choose the curriculum, at least one subject and at least one grade first.',
      )
    }

    /*
      Capped. The cross product is what the model is asked to tag against, and a request
      naming nine subjects across twelve grades is 108 combinations in one call — which
      produces a worse extraction than four careful ones and costs more.
    */
    if (subjects.length * grades.length > 24) {
      return fail(
        'VALIDATION_ERROR',
        `That is ${subjects.length * grades.length} subject-and-grade combinations in one pass. ` +
          'Keep it under 24 — a smaller extraction is more accurate, and you can run the same ' +
          'document again for the rest.',
      )
    }
    if (file.size > MAX_BYTES) {
      return fail('VALIDATION_ERROR', `That file is larger than ${MAX_BYTES / 1024 / 1024}MB.`)
    }

    let text: string
    let kind: string
    try {
      ;({ text, kind } = await extractText(file))
    } catch (error) {
      return fail(
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'That file could not be read.',
      )
    }

    if (text.trim().length < 200) {
      /**
       * Almost certainly a scanned document: images of pages with no text layer. Said explicitly,
       * because "no topics found" would send an operator hunting for a problem in the syllabus
       * rather than in the file.
       */
      return fail(
        'VALIDATION_ERROR',
        'Almost no text could be read from that file. If it is a scan rather than a digital '
          + 'document, the pages are images and the text cannot be extracted.',
      )
    }

    const truncated = text.length > MAX_CHARS
    const documentText = truncated ? text.slice(0, MAX_CHARS) : text

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const cfg = await client.rpc('ai_generation_config', { p_feature_key: 'ai_lesson_planner' })
    if (cfg.error) return fromPostgrestError(cfg.error)

    const models = (cfg.data as { models?: ModelSpec[] } | null)?.models ?? []
    if (models.length === 0) {
      return fail('SERVER_ERROR', 'No AI model is configured. Check afritech.ai_models.')
    }

    try {
      const result = await runChain({
        models,
        request: {
          systemPrompt: CURRICULUM_EXTRACTION_SYSTEM_PROMPT,
          userPrompt: curriculumExtractionPrompt({
            curriculumType,
            subjects,
            grades,
            documentText,
          }),
          schema: CURRICULUM_EXTRACTION_SCHEMA,
          schemaName: 'curriculum_extraction',
          // Low, because this is transcription. Creativity is the failure mode here, not the goal.
          temperature: 0.1,
          // A long document takes longer than a lesson plan.
          timeoutMs: 180_000,
        },
        onFailure: async (report: IncidentReport) => {
          await client.rpc('record_platform_incident', {
            p_source: report.source,
            p_kind: report.kind,
            p_title: report.title,
            p_dedupe_key: report.dedupeKey,
            p_severity: report.severity,
            p_detail: report.detail,
            p_school_id: null,
            p_feature_key: 'ai_lesson_planner',
            p_is_school_visible: false,
            p_metadata: report.metadata,
          })
        },
      })

      const extraction = result.json as unknown as CurriculumExtraction

      return ok({
        // Rows the operator edits. NOTHING is written until they press import.
        /*
          Rows the operator edits. NOTHING is written until they press import.

          Anything the model tagged with a subject or grade the request did not name is
          dropped here rather than shown. The prompt forbids it, but a model that ignores
          that instruction would otherwise put a row the operator never asked for into a
          review table they are likely to approve wholesale — and the result is a
          fabricated syllabus citation presented to a teacher as national curriculum.
        */
        topics: (extraction.topics ?? [])
          .filter((t) => subjects.includes(t.subject) && grades.includes(t.grade_level))
          .map((t, i) => ({
            ...t,
            display_order: t.display_order || i + 1,
          })),
        /*
          Said out loud rather than silently dropped, so an operator who gets 40 topics
          from a 60-topic document knows why instead of assuming the extraction is thin.
        */
        discarded: (extraction.topics ?? []).filter(
          (t) => !subjects.includes(t.subject) || !grades.includes(t.grade_level),
        ).length,
        detectedSource: extraction.detected_source ?? '',
        detectedSyllabusYear: extraction.detected_syllabus_year ?? null,
        notes: extraction.notes ?? '',
        context: { curriculumType, subjects, grades },
        document: {
          name: file.name,
          kind,
          characters: text.length,
          // Surfaced so an operator knows to split a long syllabus rather than wondering why the
          // last third is missing.
          truncated,
        },
        cost: {
          provider: result.provider,
          model: result.modelName,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          usd: result.costUsd,
          recoveredFrom: result.recoveredFrom.length,
        },
      })
    } catch (error) {
      return fail(
        'SERVER_ERROR',
        error instanceof Error
          ? `Extraction failed: ${error.message}`
          : 'Extraction failed and no provider could be reached.',
      )
    }
  })
}
