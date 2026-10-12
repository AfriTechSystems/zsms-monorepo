#!/usr/bin/env node
/**
 * Generates `Official Documentation/05 Core Database and API Reference/ENDPOINT_INVENTORY.md`
 * from the routes on disk.
 *
 * Run: npm run api:inventory
 *
 * ## Why generated
 *
 * `ENDPOINTS.md` catalogues 74 routes and 124 exist. The same arithmetic as
 * `DATABASE.md`'s 49 tables of 93, and the same right answer: hand-writing the other
 * 110 produces a document accurate for about a week.
 *
 * So `ENDPOINTS.md` keeps the request and response shapes, the auth requirements and
 * the reasoning — the parts worth writing by hand — and this answers "what exists right
 * now", where only freshness matters.
 *
 * ## What it reports that a list of paths would not
 *
 * The HTTP methods each route exports, whether it is `force-dynamic`, and which rate
 * limit policy `lib/rate-limit.ts` would apply to it. That last one is the useful
 * column: a policy table in one file and a route tree in another drift silently, and
 * the first symptom is a bulk import refused as though it were a dashboard read.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const ROOT = 'apps/web/app/api'
const OUT = 'Official Documentation/05 Core Database and API Reference/ENDPOINT_INVENTORY.md'

/**
 * Mirrors the policy order in `lib/rate-limit.ts`.
 *
 * A second copy, and the cost is real — but the alternative is importing TypeScript
 * into a plain Node script. The inventory states the risk in its own output so a reader
 * knows to trust the code over this table if they ever disagree.
 */
const POLICIES = [
  {
    name: 'enumeration (10/min)',
    test: (p) =>
      p.startsWith('/api/register') ||
      p.startsWith('/api/school/join-requests') ||
      p.startsWith('/api/teacher/school-link') ||
      p.startsWith('/api/parent/claims') ||
      p.includes('/lookup'),
  },
  {
    name: 'bulk (5/min)',
    test: (p) =>
      p.includes('/import') ||
      p.includes('/export') ||
      p.startsWith('/api/admin/curriculum/extract') ||
      p.includes('/report-cards'),
  },
  {
    name: 'communication (10/min)',
    test: (p) =>
      p.startsWith('/api/announcements') ||
      p.startsWith('/api/messages') ||
      p.startsWith('/api/school/announcements'),
  },
  {
    name: 'financial (20/min)',
    test: (p) =>
      p.startsWith('/api/payments') ||
      p.startsWith('/api/fees') ||
      p.startsWith('/api/school/fees'),
  },
  {
    name: 'expensive (30/min)',
    test: (p) =>
      p.startsWith('/api/assistant') ||
      p.startsWith('/api/teacher/hub/resources') ||
      p.startsWith('/api/documents'),
  },
  { name: 'admin (200/min)', test: (p) => p.startsWith('/api/admin/') },
  { name: 'api (120/min)', test: (p) => p.startsWith('/api/') },
]

const EXEMPT = ['/api/health']

function policyFor(path) {
  if (EXEMPT.some((e) => path.startsWith(e))) return 'exempt'
  return POLICIES.find((p) => p.test(path))?.name ?? 'none'
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else if (entry.name === 'route.ts') acc.push(full)
  }
  return acc
}

const routes = walk(ROOT)
  .map((file) => {
    const source = readFileSync(file, 'utf8')
    const path = '/' + relative('apps/web/app', file).split(sep).slice(0, -1).join('/')
    const methods = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].filter((m) =>
      new RegExp(`export\\s+async\\s+function\\s+${m}\\b`).test(source),
    )
    return {
      path,
      methods,
      dynamic: /export const dynamic = 'force-dynamic'/.test(source),
      policy: policyFor(path),
      // The first line of the JSDoc, which by convention says what the route is for.
      summary: (source.match(/^\s*\*\s+(?:GET|POST|PATCH|PUT|DELETE)[^\n]*—\s*([^\n]+)/m) ?? [])[1] ?? '',
    }
  })
  .sort((a, b) => a.path.localeCompare(b.path))

const groups = new Map()
for (const r of routes) {
  const group = r.path.split('/')[2] ?? 'root'
  if (!groups.has(group)) groups.set(group, [])
  groups.get(group).push(r)
}

const lines = []
lines.push('# Endpoint Inventory')
lines.push('')
lines.push('> **This file is generated. Do not edit it.**')
lines.push('> Run `npm run api:inventory` to refresh it from the route tree.')
lines.push('')
lines.push('## Related Documents')
lines.push('')
lines.push('- `ENDPOINTS.md` — request and response shapes, auth requirements, reasoning')
lines.push('- `ERROR_CODES.md` — the error vocabulary every route returns')
lines.push('- `RATE_LIMITS.md` — the policy each route falls under')
lines.push('')
lines.push('## Purpose')
lines.push('')
lines.push(
  'To answer "what endpoints exist right now" without anybody keeping a list by hand.',
)
lines.push('')
lines.push(
  '`ENDPOINTS.md` documents the shapes and the reasoning, which is worth writing and worth reading. It does not cover every route — an audit on 2026-10-11 found it describing 74 of 124 — and hand-writing the rest would produce something accurate for about a week.',
)
lines.push('')
lines.push('## Overview')
lines.push('')
lines.push(`Generated on ${new Date().toISOString().slice(0, 10)}.`)
lines.push('')
lines.push(`**${routes.length} routes** across ${groups.size} groups.`)
lines.push('')

const byPolicy = new Map()
for (const r of routes) byPolicy.set(r.policy, (byPolicy.get(r.policy) ?? 0) + 1)

lines.push('| Rate limit policy | Routes |')
lines.push('|---|---:|')
for (const [name, count] of [...byPolicy].sort((a, b) => b[1] - a[1])) {
  lines.push(`| ${name} | ${count} |`)
}
lines.push('')

for (const [group, list] of [...groups].sort()) {
  lines.push(`## \`/api/${group}\``)
  lines.push('')
  lines.push('| Path | Methods | Rate limit |')
  lines.push('|---|---|---|')
  for (const r of list) {
    lines.push(
      `| \`${r.path}\` | ${r.methods.join(', ') || '—'} | ${r.policy} |`,
    )
  }
  lines.push('')
}

lines.push('## Business Rules')
lines.push('')
lines.push(
  '- Every route returns the fixed envelope: `{ data, meta? }` on success, `{ error, code, details? }` on failure.',
)
lines.push(
  '- The rate limit column is computed by mirroring the policy order in `apps/web/lib/rate-limit.ts`. **That file is authoritative** — if the two ever disagree, this table is the one that is wrong.',
)
lines.push(
  '- `/api/v1/*` is the external integration surface and is additionally limited per API key by `rate_limit_rpm` (`0241`), which the IP-based policy above does not replace.',
)
lines.push('')
lines.push('## Change Log')
lines.push('')
lines.push('| Date | Change |')
lines.push('|---|---|')
lines.push(
  '| 2026-10-11 | Generated for the first time, after an audit found `ENDPOINTS.md` describing 74 of 124 routes. |',
)
lines.push('')

writeFileSync(OUT, lines.join('\n'), 'utf8')

console.log(OUT)
console.log(`  ${routes.length} routes, ${groups.size} groups`)
for (const [name, count] of [...byPolicy].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${name}`)
}

const unlimited = routes.filter((r) => r.policy === 'none')
if (unlimited.length > 0) {
  console.log('\nRoutes under NO policy (should be none — middleware covers /api/*):')
  for (const r of unlimited) console.log('  ' + r.path)
}
