/**
 * Assert the invariants a Supabase project must satisfy before it holds real school
 * data.
 *
 * `npm run db:verify`
 *
 * Runs against whatever project is currently linked. **Read-only** — every statement
 * is a SELECT over the catalogue. Nothing is created, dropped, reset or seeded, so it
 * is safe to point at any environment including production.
 *
 * ## Why this exists
 *
 * Prohibition 10 says nothing reaches production without being applied to an
 * intermediate environment and verified. "Verified" has never had a definition, and
 * `zsms-staging` does not exist yet, so the rule has had nothing to check.
 *
 * This is that definition, written against the invariants the repository has actually
 * paid for. Each check below exists because its absence cost something real:
 *
 * | Check | What it cost when it was absent |
 * |---|---|
 * | migrations applied and contiguous | `0022`–`0068` were written onto numbers `db push` silently skips |
 * | RLS enabled AND forced | a table without a policy is a defect (CONVENTIONS #4) |
 * | policy present but no GRANT | `0213` — seven tables where Postgres refused before RLS was consulted, so the feature failed closed and looked like a permissions bug |
 * | anon cannot execute a DEFINER function | `0272` — 67 of them, one returning parents' device push tokens |
 * | anon can read no table | the premise that makes the three public directory functions the whole disclosure boundary |
 * | every DEFINER function pins `search_path` | an unpinned one is hijackable by anybody who can create an object in a schema it resolves through |
 * | no school-scoped table missing its status guard | `0270` — fourteen of them, and the omission has no symptom because the writes simply succeed |
 *
 * Six of the seven are catalogue facts, so they are cheap and they cannot be faked by
 * a passing test suite. The seventh reads the migration ledger.
 *
 * ## What it deliberately does not do
 *
 * It does not reset, migrate or seed anything. An earlier sketch of this script ran
 * `supabase db reset --linked`, which drops and recreates the database — correct for
 * a fresh staging project and catastrophic one careless `--linked` away from anywhere
 * else. A verifier that can destroy the thing it verifies is not a verifier.
 *
 * It also does not check the region, which is project metadata rather than schema.
 * `COMPLIANCE.md` requires `af-south-1` for staging and production; confirm that in
 * the dashboard when the project is created, because it cannot be changed afterwards.
 */

import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Runs one SQL file through the linked project and returns the parsed rows. */
function query(sql) {
  const dir = mkdtempSync(join(tmpdir(), 'zsms-verify-'))
  const file = join(dir, 'q.sql')
  writeFileSync(file, sql, 'utf8')
  try {
    const out = execSync(`npx supabase db query --linked --file "${file}"`, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const start = out.indexOf('[')
    const end = out.lastIndexOf(']')
    if (start === -1 || end === -1) return []
    return JSON.parse(out.slice(start, end + 1))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

let failures = 0

function check(label, ok, detail = '') {
  if (!ok) failures++
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
}

/*
  One round trip for the six catalogue invariants. Six separate queries would be six
  CLI invocations, each spawning a process and opening a connection.
*/
const CATALOGUE = `
SELECT
  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('public','afritech','private')
      AND c.relkind = 'r'
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity))                AS rls_gaps,

  (SELECT count(*) FROM public.anon_executable_definer_functions())           AS anon_definer,

  (SELECT count(*) FROM public.unguarded_school_tables())                     AS unguarded,

  (SELECT count(*) FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m')
      AND has_table_privilege('anon', c.oid, 'SELECT'))                       AS anon_readable,

  (SELECT count(*) FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}')) cfg
         WHERE cfg LIKE 'search\\_path=%'))                                   AS unpinned,

  -- The 0213 class: a policy that Postgres never reaches, because the GRANT it
  -- needs first is absent. Reads as a permissions bug and is not one.
  (SELECT count(*) FROM (
     SELECT DISTINCT p.schemaname, p.tablename
       FROM pg_policies p
       JOIN pg_class c ON c.relname = p.tablename
       JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.schemaname
      WHERE p.schemaname = 'public'
        AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')
        AND NOT has_table_privilege('authenticated', c.oid, 'INSERT')
        AND NOT has_table_privilege('authenticated', c.oid, 'UPDATE')
        AND NOT has_table_privilege('authenticated', c.oid, 'DELETE')
   ) AS t)                                                                    AS policy_no_grant;
`

const APPLIED = `
SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;
`

console.log('ZSMS environment verification\n')
console.log('Catalogue invariants')

const [row] = query(CATALOGUE)
if (!row) {
  console.log('  FAIL  could not read the catalogue — is a project linked?')
  process.exit(1)
}

check('RLS enabled AND forced on every table', Number(row.rls_gaps) === 0, `${row.rls_gaps} without`)
check(
  'no SECURITY DEFINER function reachable by anon',
  Number(row.anon_definer) === 0,
  `${row.anon_definer} reachable (the public directory three are excluded)`,
)
check('every school-scoped table has its status guard', Number(row.unguarded) === 0, `${row.unguarded} unguarded`)
check(
  'anon can read no relation in public',
  Number(row.anon_readable) === 0,
  `${row.anon_readable} readable`,
)
check('every SECURITY DEFINER function pins search_path', Number(row.unpinned) === 0, `${row.unpinned} unpinned`)
check(
  'no table has a policy without a GRANT',
  Number(row.policy_no_grant) === 0,
  `${row.policy_no_grant} unreachable (the 0213 class)`,
)

console.log('\nMigration ledger')

const applied = query(APPLIED).map((r) => String(r.version))
const onDisk = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .map((f) => f.slice(0, 4))
  .sort()

const missing = onDisk.filter((v) => !applied.includes(v))
const extra = applied.filter((v) => !onDisk.includes(v))

check(`every migration on disk is applied`, missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${onDisk.length} applied`)
check(
  'no applied version is absent from the tree',
  extra.length === 0,
  extra.length ? `unknown: ${extra.slice(0, 5).join(', ')}` : '',
)
/*
  A timestamp version sorts AFTER every four-digit one, so one recorded by the MCP's
  apply_migration silently reorders the sequence for every environment built later.
*/
const timestamped = applied.filter((v) => v.length > 4)
check('no timestamp-versioned migrations', timestamped.length === 0, timestamped.join(', '))

console.log(
  `\n${failures === 0 ? 'OK' : 'FAILED'} — ${failures} failure(s).` +
    (failures === 0
      ? '\n  Region is NOT checked here: confirm af-south-1 in the dashboard for staging\n  and production, because it cannot be changed after the project is created.'
      : ''),
)
process.exit(failures === 0 ? 0 : 1)
