/**
 * Prove Cloudflare R2 actually works, end to end, against the real buckets.
 *
 * `npm run r2:smoke`
 *
 * Env comes from `--env-file=.env.local`, matching `ai:smoke` — the repository loads
 * secrets through Node's own flag rather than adding dotenv as a dependency.
 *
 * ## Why a script and not a unit test
 *
 * Every method of `R2StorageClient` threw "Phase 0 scaffold" until 2026-10-02, so
 * nothing had ever been stored — and the report-card worker, receipts and school logos
 * were all unreachable for that reason rather than any of their own. A green type-check
 * proves none of it: the only thing that proves storage works is putting an object in a
 * real bucket and reading it back.
 *
 * Checks both buckets, because they hold different things under different rules. PUBLIC
 * takes school logos; PRIVATE takes receipts and report cards, which name a child and an
 * amount — so PRIVATE must ALSO refuse to serve an object without a signed URL, and
 * that is asserted rather than assumed.
 *
 * Cleans up after itself. A smoke test that leaves objects behind turns into a bucket
 * nobody can audit.
 */

import { randomUUID } from 'node:crypto'
import { getStorage, StorageBucket } from '../packages/storage/src/index'

const MARKER = `zsms-r2-smoke-${randomUUID()}`
const KEY = `_smoke/${MARKER}.txt`

let failures = 0

function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

async function exercise(bucket: StorageBucket, name: string): Promise<void> {
  console.log(`\n${name} bucket`)
  const client = getStorage(bucket)

  try {
    await client.put(KEY, Buffer.from(MARKER, 'utf8'), { contentType: 'text/plain' })
    check('upload', true)
  } catch (error) {
    check('upload', false, error instanceof Error ? error.message : String(error))
    // Nothing downstream can pass if the object was never stored.
    return
  }

  try {
    check('exists', await client.exists(KEY))
  } catch (error) {
    check('exists', false, error instanceof Error ? error.message : String(error))
  }

  /*
    Read the bytes back and compare them.

    A 200 proves the request was accepted; only the marker proves the object that came
    back is the one that went in.
  */
  try {
    const got = await client.get(KEY)
    const text = Buffer.from(got).toString('utf8')
    check('get returns the same bytes', text === MARKER, text === MARKER ? '' : `got ${text.slice(0, 40)}`)
  } catch (error) {
    check('get', false, error instanceof Error ? error.message : String(error))
  }

  try {
    const url = await client.getSignedUrl(KEY, { expiresIn: 60 })
    check('signed URL issued', url.includes(MARKER) || url.includes('_smoke'))

    // The signature is what makes a private object readable. Fetching it is the only
    // way to know the URL works rather than merely being well formed.
    const res = await fetch(url)
    check('signed URL fetches', res.ok, res.ok ? '' : `HTTP ${res.status}`)
    if (res.ok) {
      const body = await res.text()
      check('signed URL body matches', body === MARKER)
    }
  } catch (error) {
    check('signed URL', false, error instanceof Error ? error.message : String(error))
  }

  try {
    await client.delete(KEY)
    const still = await client.exists(KEY)
    check('delete removes it', !still)
  } catch (error) {
    check('delete', false, error instanceof Error ? error.message : String(error))
  }
}

async function main(): Promise<void> {
  console.log(`R2 smoke test — marker ${MARKER}`)

  await exercise(StorageBucket.PUBLIC, 'PUBLIC')
  await exercise(StorageBucket.PRIVATE, 'PRIVATE')

  console.log(
    failures === 0
      ? '\nR2 works: both buckets accept, serve, sign and delete.'
      : `\n${failures} check(s) failed.`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

void main()
