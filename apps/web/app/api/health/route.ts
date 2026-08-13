/**
 * Health endpoint.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/AVAILABILITY.md`
 *
 * Returns component-level status rather than a bare 200 so an alert can
 * distinguish "the app is down" from "the app is up but cannot reach the
 * database". Redis unavailability reports `degraded`, never `down` — a cache
 * outage degrades latency but the application remains correct (CACHING_CDN.md).
 */

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type ComponentStatus = 'ok' | 'degraded' | 'down' | 'not_configured'

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down'
  checks: {
    database: ComponentStatus
    redis: ComponentStatus
    queue: ComponentStatus
    storage: ComponentStatus
  }
  version: string
  timestamp: string
}

function configured(...vars: string[]): ComponentStatus {
  return vars.every((v) => Boolean(process.env[v])) ? 'ok' : 'not_configured'
}

export async function GET(): Promise<NextResponse<HealthResponse>> {
  // Phase 0: connectivity probes land with the services they check. This
  // reports configuration presence so the endpoint is wired end to end now.
  const checks: HealthResponse['checks'] = {
    database: configured('NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    redis: configured('UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'),
    queue:
      process.env['JOB_QUEUE_PROVIDER'] === 'qstash'
        ? configured('QSTASH_TOKEN')
        : configured('BULLMQ_REDIS_URL'),
    storage: configured('R2_PUBLIC_ENDPOINT', 'R2_PRIVATE_ENDPOINT'),
  }

  // Redis is a performance dependency, never a correctness one.
  const criticalDown = [checks.database, checks.queue, checks.storage].includes('down')
  const anyDegraded = Object.values(checks).some((c) => c !== 'ok')

  const status: HealthResponse['status'] = criticalDown
    ? 'down'
    : anyDegraded
      ? 'degraded'
      : 'ok'

  return NextResponse.json(
    {
      status,
      checks,
      version: process.env['VERCEL_GIT_COMMIT_SHA'] ?? 'dev',
      timestamp: new Date().toISOString(),
    },
    { status: status === 'down' ? 503 : 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
