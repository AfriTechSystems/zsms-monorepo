/**
 * Prove the document chain works: R2 object in, signed URL out, bytes back.
 *
 * `npm run docs:smoke`
 *
 * ## Why this exists
 *
 * `GET /api/documents/[id]` has issued signed URLs since it was written and no screen
 * ever called it, so no part of this path had been exercised. R2 was also broken until
 * 2026-10-05, which means **no document has ever been produced, stored or served** —
 * the counts on the report-card screen have only ever been zero.
 *
 * Three things have to line up: the worker's `put()` into the PRIVATE bucket, the
 * `generated_documents` row that records where it went, and the signed URL the route
 * issues from `storage_path`. Each works in isolation. This checks them together,
 * which is the only arrangement that matters.
 *
 * Uses the service role deliberately — it is standing in for the WORKER, which is the
 * only thing that writes these rows, and a worker's connection bypasses RLS. The row is
 * removed afterwards.
 */

import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

import { getStorage, StorageBucket } from '../packages/storage/src/index'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!URL_ || !SERVICE) {
  console.error('[docs] NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(1)
}

const db = createClient(URL_, SERVICE, { auth: { persistSession: false } })

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

async function main(): Promise<void> {
  const marker = `docs-smoke-${randomUUID()}`
  console.log(`Document chain smoke test — ${marker}\n`)

  // A school to hang the row on. Any one; this writes nothing a school can see.
  const { data: school } = await db
    .from('schools')
    .select('id, school_id')
    .limit(1)
    .maybeSingle()

  if (!school) {
    console.error('[docs] No schools in the database. Run `npm run db:seed` first.')
    process.exit(1)
  }

  const path = `${school.id}/receipts/${marker}.txt`
  let docId: string | null = null

  try {
    // 1. What the worker does: render, then store.
    const storage = getStorage(StorageBucket.PRIVATE)
    await storage.put(path, Buffer.from(marker, 'utf8'), { contentType: 'text/plain' })
    check('worker stores the file', true, path)

    // 2. What the worker does next: record where it went.
    const { data: row, error } = await db
      .from('generated_documents')
      .insert({
        school_id: school.id,
        doc_type: 'payment_receipt',
        status: 'ready',
        storage_path: path,
        byte_size: marker.length,
      })
      .select('id, storage_path, status')
      .single()

    if (error || !row) {
      check('document row recorded', false, error?.message ?? 'no row')
      return
    }
    docId = row.id
    check('document row recorded', true, `status=${row.status}`)

    /*
      3. What the ROUTE does: sign the recorded path.

      Signing `row.storage_path` rather than the local `path` variable, so a mismatch
      between what was stored and what was recorded would fail here — which is the
      actual failure mode this test is for.
    */
    const url = await storage.getSignedUrl(row.storage_path as string, { expiresIn: 60 })
    check('route signs the recorded path', typeof url === 'string' && url.length > 0)

    // 4. What the BROWSER does: follow it.
    const res = await fetch(url)
    check('the signed URL serves the file', res.ok, res.ok ? '' : `HTTP ${res.status}`)

    if (res.ok) {
      const body = await res.text()
      check('the bytes are the ones stored', body === marker)
    }
  } finally {
    // `generated_documents` is not in the soft-delete list — it is derived output, and
    // the file it points at is being removed too.
    if (docId) await db.from('generated_documents').delete().eq('id', docId)
    try {
      await getStorage(StorageBucket.PRIVATE).delete(path)
    } catch {
      console.log('  note: could not remove the test object; it is under _smoke-style key')
    }
  }

  console.log(
    failures === 0
      ? '\nThe document chain works: stored, recorded, signed, served, byte-identical.'
      : `\n${failures} check(s) failed.`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
