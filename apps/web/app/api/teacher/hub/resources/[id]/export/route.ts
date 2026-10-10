/**
 * GET /api/teacher/hub/resources/[id]/export?format=pdf|docx
 *
 * Spec: `Official Documentation/06 School and Tenant Management/TEACHER_PORTAL.md`
 *
 * ## Exporting is free, and synchronous
 *
 * Rendering consumes no model tokens, so there is nothing to recover — a teacher who took the PDF
 * and now wants Word has already paid for the content, and charging twice for the same words reads
 * as a trick. No credit check, no ledger row.
 *
 * It also renders in the request rather than through a worker. Report cards are queued because it
 * is four hundred at once; this is one document a teacher is waiting for, and queuing it would make
 * a download depend on Redis, which does not exist yet.
 *
 * ## Ownership is the policy's job, not this file's
 *
 * `teacher_read_own_resources` scopes on `get_user_id()`, so a request for somebody else's
 * resource returns nothing and this route answers NOT_FOUND. Deliberately indistinguishable from a
 * resource that does not exist: telling the difference would confirm another teacher's work
 * exists, which is precisely what the owner-scoping is for.
 */

import {
  renderTeachingResourceDocx,
  renderTeachingResourcePdf,
  type TeachingResourceDocument,
} from '@zsms/documents'
import { getAuthProvider } from '@zsms/auth-provider'

import { createUserClient } from '../../../../../../../lib/supabase'
import { fail, fromPostgrestError, guard } from '../../../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

interface ResourceRow {
  id: string
  resource_kind: string
  title: string
  subject: string
  grade_level: string
  topic: string
  curriculum_type: string
  duration_minutes: number | null
  lesson_type: string | null
  teacher_notes: string | null
  generator_name: string
  generator_version: string
  prompt_template_version: number | null
  school_id: string | null
  created_at: string
  content: TeachingResourceDocument['content']
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const session = await getAuthProvider().getSessionUser()
    if (!session) return fail('UNAUTHORIZED', 'Authentication required.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { id } = await params
    const format = new URL(request.url).searchParams.get('format') ?? 'pdf'

    if (format !== 'pdf' && format !== 'docx') {
      // Named rather than silently defaulting, so a typo in a link is visible instead of quietly
      // handing back the wrong format.
      return fail('VALIDATION_ERROR', 'Choose pdf or docx.')
    }

    const { data, error } = await client
      .from('teaching_resources')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!data) return fail('NOT_FOUND', 'No such resource.')

    const row = data as unknown as ResourceRow

    /**
     * The school name, only when the resource carries one. `school_id` on a resource is provenance
     * — where it was made — and printing a school's name on a plan made there is right. A
     * standalone teacher's plan simply has no school line, rather than an empty one.
     *
     * Read through the caller's own policy: a teacher who has left that school no longer resolves
     * it, and the export then omits the line rather than failing. Their plan stays theirs, which is
     * business rule 2.
     */
    let schoolName: string | null = null
    if (row.school_id) {
      const school = await client
        .from('schools')
        .select('name')
        .eq('id', row.school_id)
        .maybeSingle()
      schoolName = (school.data as { name?: string } | null)?.name ?? null
    }

    const document: TeachingResourceDocument = {
      title: row.title,
      resourceKind: row.resource_kind,
      subject: row.subject,
      gradeLevel: row.grade_level,
      topic: row.topic,
      curriculumType: row.curriculum_type,
      durationMinutes: row.duration_minutes,
      lessonType: row.lesson_type,
      teacherNotes: row.teacher_notes,
      schoolName,
      // The provenance travels onto the page. A plan made by the scaffold and one written by a
      // model are different things, and a year from now the footer is the only way to tell.
      generatedBy: `${row.generator_name} ${row.generator_version}`
        + (row.prompt_template_version ? ` (prompt v${row.prompt_template_version})` : ''),
      createdAt: row.created_at,
      content: row.content,
    }

    const rendered =
      format === 'docx'
        ? await renderTeachingResourceDocx(document)
        : await renderTeachingResourcePdf(document)

    return new Response(new Uint8Array(rendered.bytes), {
      headers: {
        'Content-Type': rendered.contentType,
        /**
         * `attachment` so it downloads rather than rendering in a tab — a `.docx` shown inline is a
         * page of binary. The filename is quoted because it contains spaces, and `filename*` in
         * UTF-8 so a school or topic with an accent survives; some Android browsers ignore the
         * plain `filename` and read only the starred one.
         */
        'Content-Disposition':
          `attachment; filename="${rendered.suggestedFilename.replace(/"/g, '')}"; `
          + `filename*=UTF-8''${encodeURIComponent(rendered.suggestedFilename)}`,
        // A teacher's own document. Never a shared cache.
        'Cache-Control': 'private, no-store',
      },
    })
  })
}
