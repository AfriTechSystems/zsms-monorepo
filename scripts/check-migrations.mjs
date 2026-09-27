/**
 * Guards the migration sequence against the three ways it has actually gone wrong
 * in this repository.
 *
 * `MIGRATIONS.md` documents each of these as something that happened, not something
 * imagined:
 *
 *   1. **A timestamp-named migration.** `supabase migration new` generates one, and
 *      the MCP's `apply_migration` records a timestamp version regardless of
 *      filename. A timestamp sorts AFTER every four-digit version, silently
 *      reordering the sequence. This already had to be corrected by hand for `0001`.
 *
 *   2. **A number in the void range.** `0022`–`0068` sort BELOW the applied
 *      high-water mark, so `supabase db push` skips anything written there — the
 *      migration is not merely taken, it is unreachable. `0019`–`0021` were once
 *      written onto numbers already claimed, which is how the range became void.
 *
 *   3. **A duplicate number.** Two files claiming `0107` means one of them never
 *      applies, and which one depends on filesystem ordering.
 *
 * None of these produces an error at the time. They produce a database that is
 * missing a migration nobody notices is missing — which is exactly what CI is for.
 */

import { readdirSync } from 'node:fs'

const DIR = 'supabase/migrations'
const VOID_FROM = 22
const VOID_TO = 68

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()

if (files.length === 0) {
  console.error(`No migrations found in ${DIR}. That is almost certainly wrong.`)
  process.exit(1)
}

const problems = []
const seen = new Map()

for (const file of files) {
  const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(file)

  if (!match) {
    // Catches a timestamp name specifically, because that is the one that looks
    // plausible and silently reorders everything.
    const looksLikeTimestamp = /^\d{10,}/.test(file)
    problems.push(
      looksLikeTimestamp
        ? `${file} — timestamp-named. It will sort after every four-digit version and reorder the sequence. Rename it NNNN_description.sql and correct the history row.`
        : `${file} — not NNNN_description.sql (four digits, then snake_case).`,
    )
    continue
  }

  const n = Number(match[1])

  if (seen.has(n)) {
    problems.push(
      `${file} — number ${match[1]} is already used by ${seen.get(n)}. One of them will never apply.`,
    )
    continue
  }
  seen.set(n, file)

  if (n >= VOID_FROM && n <= VOID_TO) {
    problems.push(
      `${file} — ${match[1]} is in the void range ${VOID_FROM}–${VOID_TO}. It sorts below the applied high-water mark, so db push will skip it entirely. Take the next number from MIGRATIONS.md.`,
    )
  }
}

if (problems.length > 0) {
  console.error('\nMigration sequence problems:\n')
  for (const p of problems) console.error(`  ✗ ${p}`)
  console.error(
    '\nSee "Next Available Sequence Number" in ' +
      'Official Documentation/05 Core Database and API Reference/MIGRATIONS.md.\n',
  )
  process.exit(1)
}

const numbers = [...seen.keys()].sort((a, b) => a - b)
console.log(
  `✓ ${files.length} migrations, ${String(numbers[0]).padStart(4, '0')}–` +
    `${String(numbers[numbers.length - 1]).padStart(4, '0')}, all four-digit and unique.`,
)
