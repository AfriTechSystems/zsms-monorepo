#!/usr/bin/env node
/**
 * Generates `Official Documentation/01 Foundation Layer/SCHEMA_INVENTORY.md`
 * from the live database.
 *
 * Run: npm run db:inventory
 *
 * ## Why this is generated rather than written
 *
 * The 2026-10-06 Foundation Layer audit scored `DATABASE.md` at 55% for one reason: it
 * documents 49 tables and the schema has 93. The obvious fix is to hand-write the other
 * 52, and it is the wrong fix — they would be correct for about a week, until the next
 * migration, and then they would be another document that confidently describes something
 * the schema cannot do. That failure mode is named in `CLAUDE.md` and has cost this
 * repository real time more than once.
 *
 * So `DATABASE.md` keeps its hand-written DDL and commentary for the core tables, where
 * the *reasoning* is the value, and this file answers "what exists right now", where
 * freshness is the value. A generated file cannot drift.
 *
 * ## What it reports that a table list would not
 *
 * Per table: whether RLS is enabled AND forced, how many policies, and the table's
 * COMMENT. A table with no RLS is a defect by `CONVENTIONS.md` prohibition 4, and a table
 * with no comment is undocumented in the only place that cannot go stale — so both are
 * counted and called out at the end.
 */

import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = 'Official Documentation/01 Foundation Layer/SCHEMA_INVENTORY.md'

const SQL = `
SELECT n.nspname                           AS sch,
       c.relname                           AS tbl,
       c.relrowsecurity                    AS rls,
       c.relforcerowsecurity               AS forced,
       (SELECT COUNT(*) FROM pg_policies p
         WHERE p.schemaname = n.nspname AND p.tablename = c.relname) AS policies,
       (SELECT COUNT(*) FROM information_schema.columns col
         WHERE col.table_schema = n.nspname AND col.table_name = c.relname) AS cols,
       COALESCE(obj_description(c.oid), '') AS note
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname IN ('public', 'afritech', 'private')
ORDER BY n.nspname, c.relname;
`

function query(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'zsms-inv-'))
  const file = join(dir, 'q.sql')
  writeFileSync(file, sql, 'utf8')
  /*
    `execSync` with a shell, not `execFileSync`.

    Windows refuses to spawn a `.cmd` shim directly — `execFileSync('npx.cmd')` raises
    EINVAL. `scripts/describe-table.mjs` hit this first and says the same thing; the path
    here is a temp file this script just wrote, not user input.
  */
  const raw = execSync(`npx supabase db query --linked --file "${file}"`, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('no JSON in the query output')
  return JSON.parse(match[0]).rows ?? []
}

const rows = query(SQL)

const bySchema = new Map()
for (const r of rows) {
  if (!bySchema.has(r.sch)) bySchema.set(r.sch, [])
  bySchema.get(r.sch).push(r)
}

/** Why each schema exists — the part a generated file still has to be told. */
const SCHEMA_NOTE = {
  public:
    'Everything a route can reach. `supabase/config.toml` sets `schemas = ["public"]`, so PostgREST resolves `from()` and `rpc()` here and nowhere else.',
  afritech:
    "AfriTech's own books — pricing, tiers, feature flags, invoices, commissions. **Unreachable from any API route**, by design: these tables are touched from SQL, a migration, or a `public` wrapper function.",
  private:
    'Data that must never be reachable from a client at all, even through a policy. `CONVENTIONS.md` prohibition 9 forbids referencing this schema in client-side code; access goes through `public` SECURITY DEFINER functions.',
}

const noRls = rows.filter((r) => r.sch === 'public' && !r.rls)
const notForced = rows.filter((r) => r.sch === 'public' && r.rls && !r.forced)
const undocumented = rows.filter((r) => !r.note)

const lines = []
lines.push('# Schema Inventory')
lines.push('')
lines.push('> **This file is generated. Do not edit it.**')
lines.push('> Run `npm run db:inventory` to refresh it from the live `zsms-dev` schema.')
lines.push('')
lines.push('## Related Documents')
lines.push('')
lines.push('- `DATABASE.md` — hand-written DDL and the reasoning behind the core tables')
lines.push('- `RLS.md` — the tenant-isolation model these policies implement')
lines.push('- `../05 Core Database and API Reference/MIGRATIONS.md` — the applied sequence')
lines.push('')
lines.push('## Purpose')
lines.push('')
lines.push(
  'To answer "what exists in the database right now" without anybody having to keep a list up to date by hand.',
)
lines.push('')
lines.push(
  '`DATABASE.md` documents the core tables with their DDL and, more importantly, *why they are shaped that way* — which is worth writing and worth reading. It does not cover every table, and an audit on 2026-10-06 found it describing 49 of 93.',
)
lines.push('')
lines.push(
  'Hand-writing the other 52 would have produced a document that was accurate for about a week. This one cannot go stale, because it is read from the schema each time it is generated.',
)
lines.push('')
lines.push('## Overview')
lines.push('')
lines.push(`Generated from \`zsms-dev\` on ${new Date().toISOString().slice(0, 10)}.`)
lines.push('')
lines.push('| Schema | Tables | Reachable from a route |')
lines.push('|---|---:|---|')
for (const [sch, list] of [...bySchema].sort()) {
  lines.push(`| \`${sch}\` | ${list.length} | ${sch === 'public' ? 'Yes' : 'No'} |`)
}
lines.push(`| **Total** | **${rows.length}** | |`)
lines.push('')

for (const [sch, list] of [...bySchema].sort()) {
  lines.push(`## \`${sch}\``)
  lines.push('')
  lines.push(SCHEMA_NOTE[sch] ?? '')
  lines.push('')
  lines.push('| Table | Cols | RLS | Policies | Purpose |')
  lines.push('|---|---:|---|---:|---|')
  for (const r of list) {
    const rls = r.rls ? (r.forced ? 'forced' : 'on') : '**none**'
    const note = (r.note || '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
    lines.push(`| \`${r.tbl}\` | ${r.cols} | ${rls} | ${r.policies} | ${note} |`)
  }
  lines.push('')
}

lines.push('## Business Rules')
lines.push('')
lines.push(
  '- Every `public` table carries `school_id` and is filtered by RLS through `get_school_id()`. A `public` table without a policy is a defect (`CONVENTIONS.md` prohibition 4).',
)
lines.push(
  '- RLS is **forced**, not merely enabled, so the table owner is subject to it too. "on" rather than "forced" in the table above is worth a look.',
)
lines.push(
  '- A table with no `COMMENT` is undocumented in the one place that cannot drift. New tables should set one in their migration.',
)
lines.push('')
lines.push('## Edge Cases and Error Handling')
lines.push('')
if (noRls.length === 0) {
  lines.push('**No `public` table is missing RLS.**')
} else {
  lines.push('**These `public` tables have NO row-level security, which is a defect:**')
  lines.push('')
  for (const r of noRls) lines.push(`- \`${r.tbl}\``)
}
lines.push('')
if (notForced.length > 0) {
  lines.push('These have RLS enabled but **not forced**:')
  lines.push('')
  for (const r of notForced) lines.push(`- \`${r.tbl}\``)
  lines.push('')
}
lines.push(
  `${undocumented.length} of ${rows.length} tables have no \`COMMENT\`. That is the backlog this file makes visible:`,
)
lines.push('')
for (const r of undocumented) lines.push(`- \`${r.sch}.${r.tbl}\``)
lines.push('')
lines.push('## Change Log')
lines.push('')
lines.push('| Date | Change |')
lines.push('|---|---|')
lines.push('| 2026-10-06 | Generated for the first time, after the Foundation Layer audit scored `DATABASE.md` 55% for documenting 49 of 93 tables. |')
lines.push('')

const body = lines.join('\n')
writeFileSync(OUT, body, 'utf8')

console.log(`${OUT}`)
console.log(`  ${rows.length} tables across ${bySchema.size} schemas`)
console.log(`  ${noRls.length} public tables without RLS`)
console.log(`  ${notForced.length} with RLS enabled but not forced`)
console.log(`  ${undocumented.length} without a COMMENT`)

// A public table with no RLS is a defect, not a note. Fail so CI can catch it.
if (noRls.length > 0) {
  console.error('\nFAIL: a public table has no row-level security.')
  process.exit(1)
}
