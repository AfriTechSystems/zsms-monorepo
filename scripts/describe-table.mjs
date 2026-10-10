/**
 * `npm run db:cols <table> [...]` — what a table ACTUALLY has.
 *
 * ## Why this exists
 *
 * Four separate bugs in one development session came from writing SQL against a
 * column that was not there, or ignoring one that was:
 *
 *   * `schools.school_code` — assumed; the column is `school_id`, and the UUID is
 *     `id`. Cost a migration to correct.
 *   * `student_parent_links.school_id` — assumed. That table scopes through the
 *     pupil, deliberately, because a parent may have children at several schools.
 *   * `student_parent_links.updated_at` — assumed because nearly every other
 *     table has one. Raised `42703` on the first call, so no guardian could be
 *     linked at all. The same migration ALSO ignored `unlinked_at` and
 *     `unlinked_by`, which do exist — the worse failure, because it succeeded and
 *     quietly recorded less than the schema was designed to hold.
 *   * `students.class_id` — assumed nullable. It is NOT NULL, so the first real
 *     promotion run raised `23502` and promoted nobody.
 *
 * Every one was found by running the code, never by reading it. The shape was
 * inferred from what the table *ought* to hold, which is exactly the failure
 * `CLAUDE.md` warns about for documentation — applied to the schema itself.
 *
 * ## Why a script rather than a rule
 *
 * "Check the columns first" is advice, and advice is forgotten under momentum.
 * One command that prints the answer in two seconds is not. Use it before writing
 * a line of SQL against any table, including one you believe you know.
 *
 * ## What it prints beyond column names
 *
 * Nullability, defaults, and the CHECK constraints — because `class_id` being NOT
 * NULL and `status` admitting exactly five values are the facts that break code,
 * and a bare column list would have prevented only two of the four bugs above.
 */

import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tables = process.argv.slice(2)

if (tables.length === 0) {
  console.error('Usage: npm run db:cols -- <table> [table...]')
  console.error('       npm run db:cols -- students student_parent_links')
  process.exit(1)
}

// Identifiers, not values — they are interpolated into SQL, so they are checked
// rather than escaped. A table name is never user input here, but a typo that
// silently becomes valid SQL is worth refusing too.
const BAD = tables.filter((t) => !/^[a-z_][a-z0-9_]*$/.test(t))
if (BAD.length > 0) {
  console.error(`Not table names: ${BAD.join(', ')}`)
  process.exit(1)
}

const list = tables.map((t) => `'${t}'`).join(', ')

const sql = `
SELECT
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable,
  COALESCE(c.column_default, '') AS column_default
FROM information_schema.columns AS c
WHERE c.table_schema = 'public' AND c.table_name IN (${list})
ORDER BY c.table_name, c.ordinal_position;
`

const constraintsSql = `
SELECT
  rel.relname AS table_name,
  con.conname AS name,
  pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint AS con
JOIN pg_class AS rel ON rel.oid = con.conrelid
JOIN pg_namespace AS n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public' AND rel.relname IN (${list})
  AND con.contype IN ('c', 'f', 'u', 'p')
ORDER BY rel.relname, con.contype, con.conname;
`

function query(text) {
  const dir = mkdtempSync(join(tmpdir(), 'zsms-cols-'))
  const file = join(dir, 'q.sql')
  try {
    writeFileSync(file, text, 'utf8')
    // `shell: true` because Windows refuses to spawn a `.cmd` shim directly —
    // `execFileSync('npx.cmd')` raises EINVAL. The arguments are not user input
    // (the table names are regex-checked above), so quoting the path is enough.
    const out = execSync(`npx supabase db query --linked --file "${file}"`, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // The CLI wraps results in a JSON envelope with a random boundary and a
    // warning about untrusted data. The rows are what we want.
    const start = out.indexOf('"rows"')
    if (start === -1) return []
    const arrayStart = out.indexOf('[', start)
    let depth = 0
    for (let i = arrayStart; i < out.length; i += 1) {
      if (out[i] === '[') depth += 1
      else if (out[i] === ']') {
        depth -= 1
        if (depth === 0) return JSON.parse(out.slice(arrayStart, i + 1))
      }
    }
    return []
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

let columns
let constraints
try {
  columns = query(sql)
  constraints = query(constraintsSql)
} catch (err) {
  console.error('Could not reach the database.')
  console.error(String(err.message ?? err).split('\n').slice(0, 3).join('\n'))
  process.exit(1)
}

if (columns.length === 0) {
  console.error(`No such table in schema "public": ${tables.join(', ')}`)
  console.error('Tables in `afritech` are NOT in public — PostgREST cannot reach those at all.')
  process.exit(1)
}

const byTable = new Map()
for (const row of columns) {
  if (!byTable.has(row.table_name)) byTable.set(row.table_name, [])
  byTable.get(row.table_name).push(row)
}

for (const [table, cols] of byTable) {
  console.log(`\n${table}`)
  console.log('='.repeat(table.length))

  const nameWidth = Math.max(...cols.map((c) => c.column_name.length))
  const typeWidth = Math.max(...cols.map((c) => c.data_type.length))

  for (const c of cols) {
    const required = c.is_nullable === 'NO' ? 'NOT NULL' : ''
    const def = c.column_default ? `default ${c.column_default}` : ''
    console.log(
      `  ${c.column_name.padEnd(nameWidth)}  ${c.data_type.padEnd(typeWidth)}  ` +
        `${required.padEnd(9)}${def}`,
    )
  }

  const mine = constraints.filter((k) => k.table_name === table)
  if (mine.length > 0) {
    console.log('  --')
    for (const k of mine) {
      // Wrapped, because a CHECK listing five allowed statuses is the thing most
      // worth reading and the thing most likely to run off the terminal.
      console.log(`  ${k.definition}`)
    }
  }
}

console.log('')
