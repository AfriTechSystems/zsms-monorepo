/**
 * Guards the migration files against the four ways they have actually gone wrong
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

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'supabase/migrations'
const VOID_FROM = 22
const VOID_TO = 68

/**
 * A fourth failure, added 2026-09-29 after it happened twice in one session: an **unterminated
 * string literal**.
 *
 * Both times a scripted edit rewrote a multi-line `COMMENT ON ... IS 'a' 'b';` and dropped the
 * closing quote of one line. The literal then swallows everything after it, so the error Postgres
 * reports names a word from the prose somewhere else entirely — in the case that prompted this,
 * `syntax error at or near "never"`.
 *
 * Nothing else in `ci:checks` reads SQL: type-check, lint and the pgTAP plan counter all ignore
 * these files, so the first thing to notice was CI, three minutes and a round trip later.
 *
 * This walks the file as a small state machine — line comment, block comment, dollar-quoted body,
 * single-quoted literal — and reports anything still open at the end. It is not a SQL parser and
 * does not try to be. It catches the specific thing that goes wrong when prose is edited inside
 * SQL, which is the only editing these files get.
 */
function unterminated(sql) {
  const NEWLINE = '\n'
  const QUOTE = "'"
  let i = 0
  let line = 1
  let openedAt = 0

  while (i < sql.length) {
    const c = sql[i]
    const next = sql[i + 1]

    if (c === NEWLINE) {
      line++
      i++
      continue
    }

    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== NEWLINE) i++
      continue
    }

    if (c === '/' && next === '*') {
      openedAt = line
      i += 2
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) {
        if (sql[i] === NEWLINE) line++
        i++
      }
      if (i >= sql.length) return { kind: 'block comment', line: openedAt }
      i += 2
      continue
    }

    // Dollar quoting, `$$` or `$tag$`. Its body may legally contain apostrophes — which is exactly
    // why it has to be skipped wholesale rather than scanned.
    if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))
      if (tag) {
        openedAt = line
        const close = sql.indexOf(tag[0], i + tag[0].length)
        if (close === -1) return { kind: `dollar-quoted body ${tag[0]}`, line: openedAt }
        for (let k = i; k < close; k++) if (sql[k] === NEWLINE) line++
        i = close + tag[0].length
        continue
      }
    }

    if (c === QUOTE) {
      openedAt = line
      i++
      for (;;) {
        if (i >= sql.length) return { kind: 'string literal', line: openedAt }
        if (sql[i] === QUOTE) {
          // A doubled quote is an escaped quote, not the end of the literal.
          if (sql[i + 1] === QUOTE) {
            i += 2
            continue
          }
          i++
          break
        }
        // A newline inside a literal is legal SQL, so it cannot be the signal on its own. Only
        // reaching the end of the file with one still open can be.
        if (sql[i] === NEWLINE) line++
        i++
      }
      continue
    }

    i++
  }

  return null
}

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

  const open = unterminated(readFileSync(join(DIR, file), 'utf8'))
  if (open) {
    problems.push(
      `${file} — unterminated ${open.kind} opened at line ${open.line}. Postgres will report a ` +
        `syntax error at some unrelated word later in the file.`,
    )
  }

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
