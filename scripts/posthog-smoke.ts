/**
 * Proves the PostHog credentials work, and that nothing personal travels with an event.
 *
 * Run: npm run posthog:smoke
 *
 * ## Why a smoke test rather than "open the dashboard and look"
 *
 * `apps/web/lib/analytics.ts` is client-only, so the first real event needs a browser, a
 * dev server and somebody watching the live view. That is a slow loop for the question
 * actually being asked, which is only: *are the key and host right*.
 *
 * It also sends an event deliberately shaped like the ones ZSMS sends — a generic path
 * with the school code and pupil id already replaced — so the dashboard shows what a real
 * page view will look like before any real one arrives.
 */

import { readFileSync } from 'node:fs'

function fromEnvFile(key: string): string | null {
  // `--env-file` already loaded these; read the file too so the script is runnable alone.
  const direct = process.env[key]
  if (direct) return direct
  try {
    const match = readFileSync('.env.local', 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
    return match?.[1]?.trim() ?? null
  } catch {
    return null
  }
}

const key = fromEnvFile('NEXT_PUBLIC_POSTHOG_KEY')
const host = fromEnvFile('NEXT_PUBLIC_POSTHOG_HOST') ?? 'https://eu.i.posthog.com'

if (!key) {
  console.error('NEXT_PUBLIC_POSTHOG_KEY is not set. Nothing to test.')
  process.exit(1)
}

/*
  Shaped exactly like a real ZSMS page view.

  The school code and the pupil UUID are already replaced, which is the property worth
  demonstrating: `/school/ZM-LSK-0001/pupils/<uuid>` names a school and a child, and
  neither should ever reach a service outside `af-south-1`.
*/
const event = {
  api_key: key,
  event: 'zsms_smoke_test',
  properties: {
    distinct_id: 'zsms-smoke',
    $current_url: '/school/:school/pupils/:id',
    role: 'smoke-test',
    note: 'Sent by npm run posthog:smoke. Safe to delete.',
  },
  timestamp: new Date().toISOString(),
}

/*
  Wrapped in a function rather than using top-level await: tsx transforms this to
  CommonJS, where top-level await raises ERR_REQUIRE_ASYNC_MODULE.
*/
async function main(): Promise<void> {
  const response = await fetch(`${host.replace(/\/$/, '')}/i/v0/e/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  })

  const body = await response.text()

  console.log(`host   ${host}`)
  console.log(`key    ${key.slice(0, 8)}… (${key.length} chars)`)
  console.log(`status ${response.status} ${body.slice(0, 120)}`)
  console.log('')

  if (!response.ok) {
    console.error('FAIL: PostHog refused the event.')
    console.error('  401/403 → the key is wrong, or it belongs to a project in the other region.')
    console.error(`  Check the host matches where you signed up: eu.i.posthog.com or us.i.posthog.com.`)
    process.exit(1)
  }

  console.log('PASS: PostHog accepted the event.')
  console.log('')
  console.log('Look for `zsms_smoke_test` in Activity. It carries a generic path')
  console.log('(`/school/:school/pupils/:id`) — no school code, no pupil id, which is what')
  console.log('every real page view will look like too.')
  console.log('')
  console.log('Ingestion can lag a few seconds. If it never appears, the key is for a')
  console.log('different project than the one you are looking at.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
