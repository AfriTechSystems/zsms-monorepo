/**
 * Does every endpoint the phone app calls actually exist?
 *
 * `npm run gaps:mobile`
 *
 * ## Why this is separate from `npm run gaps`
 *
 * `check-reachability.mjs` asks the opposite question — which API routes no WEB screen
 * references — and it treats a route the mobile app will use as an accepted exception.
 * That leaves the mobile direction unchecked in both scripts: the phone app can call a
 * path that does not exist, and nothing fails.
 *
 * It fails at runtime, on a phone, as an empty screen with no error — because
 * `useApi` reports a 404 the same way it reports "no data yet". That is the worst
 * possible place to discover a typo in a URL.
 *
 * ## What counts as a match
 *
 * Next.js dynamic segments (`[id]`) match any single path segment, and template
 * placeholders in the app (`${classId}`) are treated the same way. A query string is
 * ignored — it does not change which route handles the request.
 */

import fs from 'node:fs'
import path from 'node:path'

const MOBILE = 'apps/mobile'
const API_ROOT = 'apps/web/app/api'

/** Every `/api/...` string literal in the phone app, with its file. */
function mobileCalls() {
  const found = new Map()

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue

      const source = fs.readFileSync(full, 'utf8')
      // Quote, then /api/, then anything that can appear in a path or a placeholder.
      const re = /['"`](\/api\/[^'"`\s]*)['"`]/g
      for (const m of source.matchAll(re)) {
        const clean = m[1].split('?')[0].replace(/\/$/, '')
        if (!found.has(clean)) found.set(clean, full)
      }
    }
  }

  walk(MOBILE)
  return found
}

/** Every route the web app actually serves, as a path with `[id]` segments intact. */
function apiRoutes() {
  const routes = []

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (entry.name !== 'route.ts') continue
      const rel = path.relative('apps/web/app', path.dirname(full))
      routes.push('/' + rel.split(path.sep).join('/'))
    }
  }

  walk(API_ROOT)
  return routes
}

/**
 * Turns a route path into a matcher.
 *
 * `[id]` and a `${...}` placeholder both stand for exactly one segment — not for a
 * slash-containing tail, which would make `/api/x/[id]` wrongly match `/api/x/a/b`.
 */
function matcher(routePath) {
  const pattern = routePath
    .split('/')
    .map((seg) => (/^\[.+\]$/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/')
  return new RegExp('^' + pattern + '$')
}

const calls = mobileCalls()
const routes = apiRoutes()
const matchers = routes.map((r) => ({ route: r, re: matcher(r) }))

const missing = []
let matched = 0

for (const [called, file] of calls) {
  /*
    Where the placeholder sits decides what it means, and the first version of this
    script got that wrong — it reported all five parent endpoints as missing.

    `/api/parent/fees${childQuery(id)}` appends a QUERY STRING to the path with no
    slash between, so the route is `/api/parent/fees`. Treating the placeholder as a
    path segment turned a working call into a false alarm, which is worse than no check
    at all: a list that cries wolf gets ignored, and then the real one is ignored too.

    So: a placeholder after a slash is one path segment; a placeholder glued to the end
    of a segment is a suffix or a query and contributes nothing to the route.
  */
  const probe = called
    .replace(/\/\$\{[^}]*\}/g, '/PLACEHOLDER')
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/\?.*$/, '')
    .replace(/\/$/, '')
  const hit = matchers.find((m) => m.re.test(probe))
  if (hit) matched++
  else missing.push({ called, file })
}

console.log(`Mobile calls ${calls.size} distinct endpoints; ${matched} resolve to a route.`)

if (missing.length > 0) {
  console.log('\nNo route serves these — each is an empty screen on a phone:')
  for (const m of missing) {
    console.log(`  ${m.called}`)
    console.log(`      called from ${m.file}`)
  }
  process.exit(1)
}

console.log('Every endpoint the phone app calls exists.')
