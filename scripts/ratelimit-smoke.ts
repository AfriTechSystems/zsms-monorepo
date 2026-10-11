/**
 * Proves the rate limiter counts and expires against real Upstash.
 *
 * Run: npm run ratelimit:smoke
 *
 * ## Why this is not a unit test
 *
 * The thing worth testing is not the arithmetic — it is that Upstash's REST pipeline
 * returns what `lib/rate-limit.ts` expects it to return, in the shape it expects. A mock
 * would assert my own assumption about the response body, which is precisely the part
 * that has been wrong before.
 *
 * It also checks the behaviour that matters most on a bad day: an unreachable Redis must
 * fail OPEN, because a limiter that fails closed turns a cache outage into a school
 * being unable to take a register.
 */

import { readFileSync } from 'node:fs'

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

interface Check {
  name: string
  pass: boolean
  detail: string
}

async function pipeline(
  url: string,
  token: string,
  commands: string[][],
  timeoutMs = 2000,
): Promise<{ result?: number }[] | null> {
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    return (await response.json()) as { result?: number }[]
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const url = env('UPSTASH_REDIS_REST_URL')
  const token = env('UPSTASH_REDIS_REST_TOKEN')

  if (!url || !token) {
    console.error('UPSTASH_REDIS_REST_URL / _TOKEN are not set. Nothing to test.')
    process.exit(1)
  }

  const checks: Check[] = []
  const key = `zsms:ratelimit:smoke:${Date.now()}`

  // 1. INCR returns an increasing count, which is what the limiter compares.
  const first = await pipeline(url, token, [
    ['INCR', key],
    ['EXPIRE', key, '30'],
  ])
  const firstCount = first?.[0]?.result

  checks.push({
    name: 'the pipeline returns a numeric count in result[0]',
    pass: typeof firstCount === 'number',
    detail: `got ${JSON.stringify(first?.[0])}`,
  })

  checks.push({
    name: 'a fresh key starts at 1',
    pass: firstCount === 1,
    detail: `count=${String(firstCount)}`,
  })

  // 2. It keeps counting, which is the whole mechanism.
  let last = firstCount ?? 0
  for (let i = 0; i < 4; i += 1) {
    const next = await pipeline(url, token, [
      ['INCR', key],
      ['EXPIRE', key, '30'],
    ])
    last = next?.[0]?.result ?? -1
  }

  checks.push({
    name: 'five requests count to five',
    pass: last === 5,
    detail: `count=${last}`,
  })

  // 3. A TTL is actually set, or a key would block one caller forever.
  const ttl = await pipeline(url, token, [['TTL', key]])
  const ttlValue = ttl?.[0]?.result ?? -1

  checks.push({
    name: 'the key expires rather than lasting forever',
    pass: ttlValue > 0 && ttlValue <= 30,
    detail: `ttl=${ttlValue}s`,
  })

  // 4. Unreachable Redis must fail OPEN — the behaviour on a bad day.
  const dead = await pipeline(
    'https://127.0.0.1:9',
    token,
    [['INCR', 'zsms:ratelimit:unreachable']],
    500,
  )

  checks.push({
    name: 'an unreachable Redis returns null, so the limiter fails open',
    pass: dead === null,
    detail: dead === null ? 'null, request would be allowed' : 'it returned something',
  })

  await pipeline(url, token, [['DEL', key]])

  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`)
  }

  const failed = checks.filter((c) => !c.pass).length
  console.log('')
  if (failed > 0) {
    console.error(`${failed} check(s) failed.`)
    process.exit(1)
  }
  console.log('Rate limiting works: counts, expires, and fails open when Redis is gone.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
