/**
 * The ZSMS mark, for documents a school has not branded.
 *
 * Every school-facing PDF carries a logo. Where the school has uploaded one the
 * worker fetches it from R2 and passes `logoBytes`; where it has not, a receipt
 * with an empty header looks like a draft rather than a record of money
 * received, so the ZSMS lockup stands in.
 *
 * **Read from disk, not embedded as base64.** The asset is ~44 KB, which is
 * ~59 KB of base64 in a source file that no one can diff and every tool has to
 * parse on import. This package only ever runs server-side — a Railway worker or
 * an Edge Function — so a file read is available, and `import.meta.url` keeps it
 * correct regardless of the working directory the worker happens to start in.
 *
 * The file is written by `npm run brand:assets`, which is also what produced the
 * favicon and the web lockup, so all of them move together when the logo is
 * redrawn.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let cached: Uint8Array | null | undefined

/**
 * Returns the ZSMS lockup as PNG bytes, or `null` if the asset is missing.
 *
 * Cached after the first call: a report-card batch renders 400 documents in one
 * process and re-reading the file 400 times would be 400 syscalls for a constant.
 * `null` is cached too — a missing asset is not going to appear mid-batch, and
 * retrying the read per document would turn one deployment mistake into 400.
 *
 * Never throws. A missing logo is cosmetic; a receipt that fails to render
 * because of it is not.
 */
export function zsmsLogoBytes(): Uint8Array | null {
  if (cached !== undefined) return cached

  try {
    const path = fileURLToPath(new URL('./assets/zsms-lockup-pdf.png', import.meta.url))
    cached = new Uint8Array(readFileSync(path))
  } catch {
    cached = null
  }

  return cached
}

/** Test seam. Not used in production paths. */
export function resetLogoCache(): void {
  cached = undefined
}
