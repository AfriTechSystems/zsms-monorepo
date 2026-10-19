/**
 * Fetch a file from the API and hand it to the phone's share sheet.
 *
 * Spec: `Official Documentation/13 Document and PDF System/PDF_GENERATION.md`
 *       `Official Documentation/10 Attendance/ATTENDANCE.md` → *The register as a PDF*
 *
 * ## Why this is not `api.get`
 *
 * Everything in `lib/api.ts` parses a JSON envelope. A PDF is bytes, and running it
 * through `response.json()` throws on the first one. So this is its own path. It still
 * carries the session token the same way; only the body differs.
 *
 * ## Share rather than save
 *
 * Android and iOS disagree about what "download" means, and neither has a folder a
 * teacher can reliably find afterwards. `expo-sharing` opens the system sheet, which
 * lets them send the register to WhatsApp, email it to the office, or save it to Files
 * — whichever they were going to do next anyway. A file written silently into app
 * storage is a file nobody sees again.
 *
 * It lands in the cache directory because the sheet needs a URI, and cache is the right
 * place: the register is reproducible from the server at any time, so keeping a copy
 * would be a second and staler truth on the device. That is the same reasoning the
 * export route uses for storing nothing in R2.
 *
 * ## The SDK 54+ file API, and why it is safer here
 *
 * `expo-file-system` v57 replaced `downloadAsync` with `File.downloadFileAsync`, which
 * **rejects on a non-2xx response and creates no file**. That matters more than the
 * rename: the older call wrote whatever came back, so an API refusal would have landed
 * on disk as a `.pdf` containing `{"error":"Your role does not include attendance."}`
 * and opened as a corrupt document. The failure now arrives as an exception carrying
 * the status, which is mapped to a sentence below.
 */

import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'

import { apiBaseUrl } from './api'

export interface DownloadResult {
  ok: boolean
  /** Why it failed, in words a teacher can act on. Null when it worked. */
  error: string | null
}

/**
 * The status is all the new API gives us, so it is all we can explain from.
 *
 * Deliberately not "something went wrong": a teacher refused the register because of
 * their role needs to ask their school, and one hitting a server fault does not. The
 * two sentences send them to different places.
 */
function explain(message: string): string {
  if (/\b401\b|\b403\b/.test(message)) {
    return 'You do not have access to this register. Your school sets who may see it.'
  }
  if (/\b404\b/.test(message)) {
    return 'There is no register for this class and date.'
  }
  if (/network|connect|timeout|host/i.test(message)) {
    return 'No connection, so the register could not be downloaded. Try again when you have signal.'
  }
  return 'The register could not be downloaded. Try again in a moment.'
}

/**
 * @param path     API path, e.g. `/api/school/attendance/register/export?classId=…`
 * @param filename What the file is called in the share sheet.
 */
export async function downloadAndShare(
  path: string,
  filename: string,
  getToken: () => Promise<string | null>,
): Promise<DownloadResult> {
  /*
    Checked before the request rather than after.

    On a device with no sharing available there is nothing useful to do with the bytes,
    and spending a teacher's data to fetch a file we cannot then hand them is worse
    than saying so first.
  */
  if (!(await Sharing.isAvailableAsync())) {
    return { ok: false, error: 'This phone cannot share files, so there is nowhere to send it.' }
  }

  let token: string | null = null
  try {
    token = await getToken()
  } catch {
    token = null
  }
  if (!token) {
    return { ok: false, error: 'You are signed out. Sign in and try again.' }
  }

  try {
    const destination = new File(new Directory(Paths.cache), filename)

    const file = await File.downloadFileAsync(`${apiBaseUrl()}${path}`, destination, {
      headers: { Authorization: `Bearer ${token}` },
      // The same register downloaded twice must overwrite rather than fail; a teacher
      // re-sending it to the office is the expected case, not an error.
      idempotent: true,
    })

    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/pdf',
      dialogTitle: filename,
      UTI: 'com.adobe.pdf',
    })
    return { ok: true, error: null }
  } catch (error) {
    return { ok: false, error: explain(error instanceof Error ? error.message : String(error)) }
  }
}
