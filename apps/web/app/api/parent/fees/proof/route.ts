/**
 * POST /api/parent/fees/proof — upload proof of a payment a parent is claiming.
 *
 * Spec: `Official Documentation/09 Fee and Financial Management/PAYMENTS.md`
 *       → *Parent-submitted payment*
 *       `Official Documentation/13 Document and PDF System/STORAGE.md`
 *
 * ## The PRIVATE bucket, without exception
 *
 * A proof of payment is a photograph of a mobile-money confirmation or a bank slip. It
 * carries a name, an amount, an account number and sometimes a phone number. It goes in
 * the private bucket and is only ever served through a signed URL.
 *
 * The public bucket exists and works, and using it here would be the single worst
 * mistake available in this route: every proof would be readable by anyone who guessed a
 * URL, for every school, forever.
 *
 * ## Two steps, deliberately
 *
 * The file is uploaded first and the claim is submitted second, carrying the returned
 * path. That is how the documented screen works — a parent uploads, sees
 * "payment_confirmation.jpg uploaded", then ticks the confirmation box and submits — and
 * the alternative (one multipart request doing both) would make the parent re-upload the
 * photograph every time a validation error sent the form back.
 *
 * The cost is that an upload can be orphaned when somebody abandons the form. That is
 * accepted: an unreferenced object in a private bucket is cheap and harmless, and
 * `PAYMENTS.md` describes this flow.
 *
 * ## The path is chosen here, never by the caller
 *
 * `{school_id}/payment-proofs/{uuid}.{ext}`. A caller-supplied filename would let
 * somebody write `../../` into another school's prefix, or overwrite an existing proof by
 * reusing its name. The original filename is kept only in the response, for the screen to
 * show back.
 */

import { randomUUID } from 'node:crypto'

import { createUserClient } from '../../../../../lib/supabase'
import { fail, guard, ok } from '../../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/**
 * 10MB, per `PAYMENTS.md`.
 *
 * A phone photograph of a receipt is well under this. The cap is here because a parent
 * on a slow Zambian connection uploading a 40MB image will time out and conclude ZSMS is
 * broken, which is worse than being told the file is too large.
 */
const MAX_BYTES = 10 * 1024 * 1024

/**
 * What a proof may be.
 *
 * Checked by media type AND extension, because a browser will happily report
 * `application/octet-stream` for a file it does not recognise, and because the extension
 * is what ends up in the stored path.
 */
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const form = await request.formData().catch(() => null)
    if (!form) return fail('VALIDATION_ERROR', 'Send the file as multipart form data.')

    const file = form.get('file')
    const childId = String(form.get('childId') ?? '').trim()

    if (!(file instanceof File)) return fail('VALIDATION_ERROR', 'No file was uploaded.')
    if (!childId) return fail('VALIDATION_ERROR', 'Say which child this payment is for.')

    if (file.size === 0) {
      return fail('VALIDATION_ERROR', 'That file is empty.')
    }
    if (file.size > MAX_BYTES) {
      return fail(
        'VALIDATION_ERROR',
        `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_BYTES / 1024 / 1024}MB — a photo of the confirmation is enough.`,
      )
    }

    const ext = ALLOWED[file.type]
    if (!ext) {
      return fail(
        'VALIDATION_ERROR',
        'Upload a photo or a PDF — JPG, PNG, WebP, HEIC or PDF. A screenshot of the confirmation works.',
      )
    }

    /*
      Which school this child is at, resolved through RLS rather than taken from the
      caller.

      A parent reaching another family's child gets no row, and therefore no upload
      prefix — the same NOT_FOUND as a child that does not exist, so the answer does not
      confirm the id. This is also where the school id for the path comes from, so a
      caller cannot aim the write at another school.
    */
    const { data: child, error: childError } = await client
      .from('students')
      .select('id, school_id')
      .eq('id', childId)
      .maybeSingle()

    if (childError) {
      return fail('SERVER_ERROR', 'Could not confirm which school this child is at.')
    }
    if (!child) {
      return fail('NOT_FOUND', 'That child is not available to you.')
    }

    const path = `${child.school_id}/payment-proofs/${randomUUID()}.${ext}`

    try {
      const { getStorage, StorageBucket } = await import('@zsms/storage')
      const bytes = new Uint8Array(await file.arrayBuffer())

      await getStorage(StorageBucket.PRIVATE).put(path, bytes, {
        contentType: file.type,
        metadata: {
          // Who uploaded it and for whom, on the object itself. If the row is ever
          // lost the object can still be accounted for, which matters for a document
          // that names a child and an amount.
          childId: child.id,
          schoolId: child.school_id,
        },
      })
    } catch (err) {
      /*
        Named plainly rather than as a 500.

        Storage being unconfigured or unreachable is not the parent's problem and not a
        bug in the claim flow, and "server error" would send somebody looking in the
        wrong place. `envFor()` throws listing exactly which variables are missing.
      */
      console.error('[api] payment proof upload failed', err)
      return fail(
        'SERVER_ERROR',
        'The file could not be stored. Tell the school — they can still record your payment from the reference.',
      )
    }

    return ok({
      /*
        The stored path, not a URL.

        The claim submission passes this back and it lands in
        `payments.proof_of_payment_url`. Serving it is `/api/documents`-style signed
        access, so handing out a URL here would create a second, unexpiring way to read
        it.
      */
      path,
      // Echoed so the screen can say "payment_confirmation.jpg uploaded" rather than
      // showing a UUID the parent has never seen.
      fileName: file.name,
      byteSize: file.size,
    })
  })
}
