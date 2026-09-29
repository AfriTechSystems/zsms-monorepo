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
  'isnt_empty', 'is_empty', 'isnt', 'is',
  'throws_ok', 'lives_ok', 'results_eq', 'set_eq',
  // `matches` was missing and cost exactly what this script exists to prevent:
  // fees_attendance_results_test.sql carried 45 assertions under plan(44) and
  // was reported clean. An under-counting checker is worse than none, because
  // it is trusted. Longer names stay ahead of shorter prefixes.
  'matches', 'imatches', 'alike', 'ialike', 'cmp_ok',
  // And it happened a SECOND time, in ai_credits_test.sql on 2026-09-27: the
  // throws_* family beyond `throws_ok` was absent, so a suite with 29 assertions
  // was reported clean under plan(28) and pg_prove would have failed it in CI.
  // The whole family is listed now rather than the one that was needed, because
  // the lesson is plainly that adding them one incident at a time does not work.
  'throws_matching', 'throws_imatching', 'throws_ilike', 'throws_like',
  'row_eq', 'bag_eq', 'isa_ok',
  // Third incident, 2026-09-29: the SCHEMA-testing family was absent, so price_bands_test
  // reported 13 assertions under plan(17) and pg_prove would have failed it in CI. The pattern
  // across all three is the same — the list grows one incident at a time, and each incident is
  // discovered by a suite that happens to use a function nobody added yet.
  //
  // So this block is the whole family rather than the four that were needed. `hasnt_*` variants
  // stay ahead of their `has_*` prefixes, and longer names ahead of shorter ones.
  'hasnt_function', 'hasnt_table', 'hasnt_view', 'hasnt_column', 'hasnt_index',
  'has_function', 'has_table', 'has_view', 'has_column', 'has_index',
  'has_pk', 'has_fk', 'has_check', 'has_unique', 'has_trigger', 'has_role', 'has_schema',
  'col_is_pk', 'col_is_fk', 'col_not_null', 'col_is_null', 'col_has_default', 'col_type_is',
  'table_privs_are', 'function_privs_are', 'schema_privs_are',
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
