/**
 * POST /api/uploads/photo — store a profile picture or a school logo.
 *
 * Spec: `19 Design System/ZSMS_UI_REDESIGN_MASTER_PROMPT.md`; the 2MB ceiling and the
 *       permission split are the agreed rules.
 *
 * ## This route stores the file. It does not decide whose photo it becomes.
 *
 * It returns a URL. Attaching that URL to a person is a separate, permission-checked
 * call — `set_student_photo()`, `set_my_parent_photo()`, `update_my_staff_profile()` or
 * the school branding setter — each of which enforces who may change whose.
 *
 * Splitting them matters: if this route also wrote the column, every permission rule
 * would have to be restated here, and this is the copy a direct call would bypass.
 *
 * ## The public bucket, deliberately
 *
 * A profile picture is rendered in an `<img>` on a class register that may be open for
 * a whole lesson. Signing every avatar would mean a signed URL per pupil per page load,
 * expiring mid-lesson. The key is unguessable, nothing else about the person is in it,
 * and no document ever goes here — report cards and receipts stay in the private bucket
 * behind signed URLs.
 */

import { randomUUID } from 'node:crypto'

import { getStorage, StorageBucket } from '@zsms/storage'

import { createUserClient } from '../../../../lib/supabase'
import { fail, guard, ok } from '../../../../lib/api-response'

export const dynamic = 'force-dynamic'

/** 2MB. A phone photo is 3–5MB, so the message has to say what to do about it. */
const MAX_BYTES = 2 * 1024 * 1024

/**
 * Only formats a browser renders in an `<img>`, and only ones we can identify from
 * their own bytes.
 *
 * **SVG is excluded on purpose.** It is a document, not an image: it can carry script,
 * and serving one from our own origin would run that script with our origin's
 * privileges. A logo that must be vector can be a PNG at twice the size.
 */
const ALLOWED: Record<string, { ext: string; magic: number[][] }> = {
  'image/jpeg': { ext: 'jpg', magic: [[0xff, 0xd8, 0xff]] },
  'image/png': { ext: 'png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  'image/webp': { ext: 'webp', magic: [[0x52, 0x49, 0x46, 0x46]] },
}

function matchesMagic(bytes: Uint8Array, magics: number[][]): boolean {
  return magics.some((m) => m.every((b, i) => bytes[i] === b))
}

export async function POST(request: Request): Promise<Response> {
  return guard(async () => {
    /*
      Signed in, and that is the whole authorisation this route performs.

      Anyone with an account may put a file in the bucket; nobody gains anything by
      doing so until a permission-checked setter attaches it to a record.
    */
    const client = await createUserClient()
    if (!client) return fail('UNAUTHORIZED', 'Authentication required.')

    const form = await request.formData().catch(() => null)
    const file = form?.get('file')

    if (!(file instanceof File)) {
      return fail('VALIDATION_ERROR', 'Choose an image to upload.')
    }

    if (file.size === 0) {
      return fail('VALIDATION_ERROR', 'That file is empty.')
    }

    if (file.size > MAX_BYTES) {
      return fail(
        'VALIDATION_ERROR',
        `That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 2MB — most phones can shrink a photo when you share it.`,
      )
    }

    const declared = ALLOWED[file.type]
    if (!declared) {
      return fail('VALIDATION_ERROR', 'Use a JPG, PNG or WebP image.')
    }

    const bytes = new Uint8Array(await file.arrayBuffer())

    /*
      The bytes must agree with the declared type.

      `Content-Type` on a multipart part is whatever the client said. Checking the magic
      number is what stops a file being stored as `.png` and served as something else —
      and it is cheap, since the bytes are already in hand.
    */
    if (!matchesMagic(bytes, declared.magic)) {
      return fail('VALIDATION_ERROR', 'That file is not the image type it claims to be.')
    }

    /*
      A random key, not the person's name or id.

      The bucket is public, so the key is the only thing standing between a URL and
      whoever guesses it. `students/<uuid>.jpg` would let anyone who knows a pupil id
      fetch their face; a random name carries nothing.
    */
    const key = `photos/${randomUUID()}.${declared.ext}`

    const storage = getStorage(StorageBucket.PUBLIC)

    try {
      await storage.put(key, bytes, {
        contentType: file.type,
        // A year. The key is unique per upload, so a replacement is a new URL and
        // there is never a stale cached image to invalidate.
        cacheControl: 'public, max-age=31536000, immutable',
      })
    } catch (error) {
      /*
        The common cause is the R2 variables being unset, and saying so is more useful
        than "something went wrong" — it is the one failure an operator can fix.
      */
      return fail(
        'SERVER_ERROR',
        error instanceof Error && error.message.includes('R2_PUBLIC')
          ? error.message
          : 'The image could not be stored. Nothing was changed.',
      )
    }

    /*
      The serving URL, which is NOT the S3 endpoint.

      `R2_PUBLIC_ENDPOINT` is where the SDK writes; `R2_PUBLIC_BASE_URL` is the domain a
      browser fetches from. Returning the endpoint would produce a URL that needs
      credentials to read, so every avatar would 403 and the fallback initials would
      appear — looking exactly like an upload that silently failed.
    */
    const base = process.env['R2_PUBLIC_BASE_URL']
    if (!base) {
      return fail(
        'SERVER_ERROR',
        'R2_PUBLIC_BASE_URL is not set, so the stored image has no address a browser could load.',
      )
    }

    return ok({
      url: `${base.replace(/\/$/, '')}/${key}`,
      message: 'Uploaded. It is not attached to anybody until you save.',
    })
  })
}
