#!/usr/bin/env node
/**
 * Lists everything in the schema that assumes Zambia.
 *
 * Run: npm run country:check
 *
 * ## Why this exists
 *
 * `ADDING_COUNTRY.md` is a runbook — eight steps, from writing a config file to
 * configuring DNS. Followed today it would fail, not at step one but gradually: the first
 * school created in the new country would be refused by a CHECK constraint admitting
 * `ecz_grades`, then by one admitting `ecz_percentage`, then by a reference table with
 * `_zm` in its name. One at a time, each looking like a bug.
 *
 * ADR-040 deliberately defers hardening these until a second country is real, and that is
 * the right call — widening constraints for a country that does not exist is speculation,
 * and every widened constraint is a validation ZSMS no longer performs for Zambia.
 *
 * What was missing is not the hardening. It is that **the list was nowhere**, so the
 * runbook promised a path it had not walked. This prints the list from the live schema, so
 * it is accurate today and stays accurate as tables are added.
 *
 * ## It never fails the build
 *
 * Exit 0 always. Country coupling is not a defect while ZSMS serves one country — it is an
 * inventory. Making it fail CI would turn a deliberate deferral into daily noise, and the
 * noise would be ignored long before the second country arrived.
 */

import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SQL = `
-- CHECK constraints whose allowed values name a Zambian institution.
SELECT 'constraint' AS kind,
       rel.relname AS object,
       con.conname AS detail,
       pg_get_constraintdef(con.oid) AS body
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid = rel.relnamespace
WHERE n.nspname = 'public' AND con.contype = 'c'
  AND pg_get_constraintdef(con.oid) ~* '(ecz|cambridge)'

UNION ALL

-- Tables and columns with a country baked into the name.
SELECT 'table name', c.relname, c.relname, 'country code in the identifier'
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname ~* '_(zm|zambia)$'

UNION ALL

-- Columns defaulting to a country code.
SELECT 'column default', table_name, column_name, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_default ILIKE '%''ZM''%'

ORDER BY 1, 2, 3;
`

function query(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'zsms-country-'))
  const file = join(dir, 'q.sql')
  writeFileSync(file, sql, 'utf8')
  // `shell: true` via execSync — Windows refuses to spawn a `.cmd` shim directly.
  // See `scripts/describe-table.mjs`, which hit this first.
  const out = execSync(`npx supabase db query --linked --file "${file}"`, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const match = out.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('no JSON in the query output')
  return JSON.parse(match[0]).rows ?? []
}

const rows = query(SQL)

const byKind = new Map()
for (const r of rows) {
  if (!byKind.has(r.kind)) byKind.set(r.kind, [])
  byKind.get(r.kind).push(r)
}

console.log('')
console.log('Country coupling — what a second country would meet')
console.log('='.repeat(56))

if (rows.length === 0) {
  console.log('\nNothing found. Either the schema is country-neutral, or this')
  console.log('query needs widening for a pattern it does not yet look for.')
} else {
  for (const [kind, list] of [...byKind].sort()) {
    console.log(`\n${kind.toUpperCase()} (${list.length})`)
    for (const r of list) {
      console.log(`  ${r.object}`)
      const body = String(r.body).replace(/\s+/g, ' ').trim()
      console.log(`    ${body.length > 110 ? body.slice(0, 107) + '…' : body}`)
    }
  }
}

console.log('')
console.log('-'.repeat(56))
console.log(`${rows.length} place(s) assume Zambia.`)
console.log('')
console.log('This is an INVENTORY, not a defect list. ADR-040 defers widening these')
console.log('until a second country is real — a constraint widened for a country that')
console.log('does not exist is a validation ZSMS stops performing for the one that does.')
console.log('')
console.log('`term_number` is deliberately absent: it admits 1-4 already, so a country')
console.log('with four terms needs no change. ADR-040 listed it and was wrong.')
console.log('')
console.log('Before adding a country, work through 04 Country and Configuration/')
console.log('ADDING_COUNTRY.md with this list beside it.')

// Always 0. See the header.
process.exit(0)
