/**
 * GET /api/documents/[id] — a short-lived link to one generated PDF.
 *
 * Spec: `Official Documentation/13 Document and PDF System/STORAGE.md`
 *       `Official Documentation/13 Document and PDF System/PDF_GENERATION.md`
 *
 * ## Signed, never proxied
 *
 * The route returns a URL rather than the bytes. Streaming a 400-card term through a
 * Next.js route would put every download through the application server for no benefit —
 * R2 serves the object directly, and `STORAGE.md` names a short-lived signed URL as the
 * only way private content is ever served.
 *
 * Sixty seconds. Long enough for a browser to follow a redirect on a slow Zambian link,
 * short enough that a URL pasted into a WhatsApp group is dead before it is read.
 *
 * ## The policy decides who may have it
 *
 * `generated_documents` carries `school_id` and `student_id`, and its RLS admits the
 * school's own staff and the pupil's linked parents. This route performs the SELECT as the
 * caller, so a row that comes back is one they were entitled to — a parent reaching another
 * family's report card gets the same NOT_FOUND as a row that does not exist.
 *
 * Deliberately NOT a service-role fetch: that would move the entitlement decision out of
 * the policies and into this file, where it would be the only copy and the easiest to get
 * wrong.
 */

import { createUserClient } from '../../../../lib/supabase'
import { fail, fromPostgrestError, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return guard(async () => {
    const { id } = await params
    if (!UUID_RE.test(id)) return fail('VALIDATION_ERROR', 'Document id must be a UUID.')

    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const { data, error } = await client
      .from('generated_documents')
      .select('id, doc_type, status, storage_path, byte_size, failure_reason')
      .eq('id', id)
      .maybeSingle()

    if (error) return fromPostgrestError(error)
    if (!data) return fail('NOT_FOUND', 'That document is not available to you.')

    if (data.status === 'failed') {
      return fail(
        'CONFLICT',
        data.failure_reason
          ? `That document could not be produced: ${data.failure_reason}`
          : 'That document could not be produced.',
      )
    }

    if (data.status !== 'ready' || !data.storage_path) {
      // Still rendering. A distinct code so the screen can keep polling rather than
      // telling somebody the document does not exist.
      return fail('CONFLICT', 'That document is still being produced. Try again shortly.')
    }

    try {
      const { getStorage, StorageBucket } = await import('@zsms/storage')
      const url = await getStorage(StorageBucket.PRIVATE).getSignedUrl(data.storage_path, {
        expiresIn: 60,
      })
      return ok({ url, expiresIn: 60, byteSize: data.byte_size })
    } catch (err) {
      /*
        The object store is not configured, or is unreachable.

        Said plainly rather than as a 500: until the four `R2_PRIVATE_*` variables exist,
        every document link fails this way, and "server error" would send somebody looking
        for a bug in the renderer instead of at the credentials.
      */
      console.error('[api] signed URL failed for document', id, err)
      return fail(
        'SERVER_ERROR',
        'Document storage is not available. The file exists but cannot be served yet.',
      )
    }
  })
}
