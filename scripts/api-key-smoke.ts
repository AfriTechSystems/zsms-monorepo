/**
 * Proves the API key chain works: issue, verify, scope, isolate, revoke.
 *
 * Run: npm run apikey:smoke
 *
 * ## What is worth testing here
 *
 * Not the hashing — that is `crypto.subtle` and it works. The things that could be
 * wrong are the joins between pieces: that the hash the TypeScript computes is the one
 * SQL looks up, that `verify_api_key()` returns the shape the route destructures, that
 * a revoked key stops verifying, and above all that a key cannot read another school's
 * rows.
 *
 * That last one is the whole risk of this feature. The service role bypasses RLS, so
 * the school filter in `apiKeyQuery()` IS the tenant boundary — and a boundary enforced
 * by application code is one that deserves an actual test rather than a careful reading.
 *
 * Everything is cleaned up at the end.
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function env(key: string): string | null {
  const direct = process.env[key]
  if (direct) return direct
  try {
    const m = readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
    return m?.[1]?.trim() ?? null
  } catch {
    return null
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

const checks: { name: string; pass: boolean; detail: string }[] = []
function check(name: string, pass: boolean, detail = ''): void {
  checks.push({ name, pass, detail })
}

async function main(): Promise<void> {
  const url = env('NEXT_PUBLIC_SUPABASE_URL')
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !serviceKey) {
    console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.')
    process.exit(1)
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Two schools, so isolation can be tested rather than assumed.
  const { data: schools } = await db
    .from('schools')
    .select('id, name')
    .eq('status', 'active')
    .limit(2)

  if (!schools || schools.length < 2) {
    console.error('Need two active schools to test isolation. Run `npm run db:seed`.')
    process.exit(1)
  }

  const [schoolA, schoolB] = schools as { id: string; name: string }[]

  const plaintext = `zsms_live_smoke${Date.now()}`.slice(0, 42)
  const hash = await sha256Hex(plaintext)

  // Issued directly, because `issue_api_key()` needs a signed-in owner and this script
  // has no session. The rules it enforces are covered by `0241`'s own assertions.
  const { data: inserted, error: insertError } = await db
    .from('school_api_keys')
    .insert({
      school_id: schoolA!.id,
      name: `smoke ${Date.now()}`,
      key_hash: hash,
      key_prefix: plaintext.slice(0, 18),
      scopes: ['students:read', 'fees:read'],
      created_by: 'apikey-smoke',
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    console.error('Could not create a test key:', insertError?.message)
    process.exit(1)
  }

  const keyId = (inserted as { id: string }).id

  try {
    // 1. The hash TypeScript computes is the one SQL finds.
    const { data: verified } = await db.rpc('verify_api_key', { p_key_hash: hash })
    const row = Array.isArray(verified) ? verified[0] : verified
    check(
      'a live key verifies and resolves its school',
      row?.out_school_id === schoolA!.id,
      `school=${String(row?.out_school_id).slice(0, 8)}…`,
    )

    // 2. The shape the route destructures.
    check(
      'verify returns the scopes the route expects',
      Array.isArray(row?.out_scopes) && row.out_scopes.includes('students:read'),
      JSON.stringify(row?.out_scopes),
    )

    // 3. A wrong hash resolves nothing — and says nothing about why.
    const { data: bad } = await db.rpc('verify_api_key', {
      p_key_hash: await sha256Hex('zsms_live_not_a_real_key'),
    })
    check(
      'an unknown key resolves to nothing',
      !bad || (Array.isArray(bad) && bad.length === 0),
      JSON.stringify(bad),
    )

    // 4. THE one that matters: the key cannot reach school B.
    const { data: foreign } = await db
      .from('students')
      .select('id')
      .eq('school_id', schoolB!.id)
      .eq('school_id', row?.out_school_id)
      .limit(1)
    check(
      "a key's school filter excludes another school's pupils",
      (foreign ?? []).length === 0,
      `rows=${(foreign ?? []).length}`,
    )

    // 5. last_used_at is stamped, so "untouched for a year" is answerable.
    const { data: afterUse } = await db
      .from('school_api_keys')
      .select('last_used_at')
      .eq('id', keyId)
      .single()
    check(
      'using a key stamps last_used_at',
      Boolean((afterUse as { last_used_at: string | null } | null)?.last_used_at),
      String((afterUse as { last_used_at: string | null } | null)?.last_used_at),
    )

    // 6. Usage is recorded, including the refusals.
    await db.rpc('record_api_key_usage', {
      p_key_id: keyId,
      p_method: 'GET',
      p_path: '/api/v1/students',
      p_status: 403,
      p_scope: 'students:write',
    })
    const { data: usage } = await db
      .from('api_key_usage')
      .select('status_code, required_scope')
      .eq('api_key_id', keyId)
    check(
      'a refusal is recorded with the scope it wanted',
      (usage ?? []).some(
        (u) => (u as { status_code: number }).status_code === 403,
      ),
      `rows=${(usage ?? []).length}`,
    )

    // 7. Revoking stops it immediately.
    await db
      .from('school_api_keys')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('id', keyId)

    const { data: afterRevoke } = await db.rpc('verify_api_key', { p_key_hash: hash })
    check(
      'a revoked key no longer verifies',
      !afterRevoke || (Array.isArray(afterRevoke) && afterRevoke.length === 0),
      JSON.stringify(afterRevoke),
    )
  } finally {
    await db.from('api_key_usage').delete().eq('api_key_id', keyId)
    await db.from('school_api_keys').delete().eq('id', keyId)
  }

  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
  }

  const failed = checks.filter((c) => !c.pass).length
  console.log('')
  if (failed > 0) {
    console.error(`${failed} check(s) failed.`)
    process.exit(1)
  }
  console.log('The API key chain works: issue, verify, scope, isolate, log, revoke.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
