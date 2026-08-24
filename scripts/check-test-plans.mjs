/**
 * Verifies that every pgTAP suite's `plan(N)` matches the number of assertions
 * it actually contains.
 *
 * Why this exists: `fees_attendance_results_test.sql` was committed with 44
 * assertions under `plan(45)` and reported as "45/45 passing". The report came
 * from an adapted run through the Supabase MCP, which executes statements
 * individually and never evaluates the plan. Under `pg_prove` the same file
 * fails.
 *
 * A wrong plan is worse than a missing one. `plan(45)` against 44 assertions is
 * how a suite silently loses coverage — delete an assertion and the count that
 * is supposed to notice has to be edited by hand, which is exactly what does
 * not happen. This check is mechanical so it cannot be forgotten.
 *
 * Runs before `supabase test db`. No database or Docker required.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'supabase/tests/rls'

// pgTAP assertion functions used in this repository. Add to this list when a
// new one is used, or the count silently drifts low.
// Longer names first: `is` would otherwise be tried before `is_empty` at the
// same position. JS backtracks and gets it right either way, but the ordering
// makes that independent of the engine.
const ASSERTIONS = [
  'is_empty', 'isnt', 'is',
  'throws_ok', 'lives_ok', 'results_eq', 'set_eq',
  // `matches` was missing and cost exactly what this script exists to prevent:
  // fees_attendance_results_test.sql carried 45 assertions under plan(44) and
  // was reported clean. An under-counting checker is worse than none, because
  // it is trusted. Longer names stay ahead of shorter prefixes.
  'matches', 'imatches', 'alike', 'ialike', 'cmp_ok',
  'ok',
]

const CALL = new RegExp(String.raw`\bSELECT\s+(?:${ASSERTIONS.join('|')})\s*\(`, 'g')

let failed = 0

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.sql'))) {
  const path = join(DIR, file)

  // Drop comment lines so a commented-out example never counts as an assertion.
  const body = readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')

  const found = (body.match(CALL) ?? []).length
  const planMatch = body.match(/\bplan\((\d+)\)/)

  if (!planMatch) {
    console.error(`✗ ${file}: no plan() call`)
    failed += 1
    continue
  }

  const planned = Number(planMatch[1])

  if (planned !== found) {
    console.error(`✗ ${file}: plan(${planned}) but ${found} assertions`)
    failed += 1
  } else {
    console.log(`✓ ${file}: ${found} assertions`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} suite(s) with a plan mismatch. pg_prove would fail these.`)
  process.exit(1)
}

console.log('\nAll pgTAP plans match their assertion counts.')
