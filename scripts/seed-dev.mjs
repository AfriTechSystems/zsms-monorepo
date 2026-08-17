/**
 * Loads `supabase/seed/dev_seed.sql` into the linked Supabase project.
 *
 * **Refuses to run against anything but `zsms-dev`.** The seed is synthetic
 * fixtures — invented schools, invented children, invented money — and loading
 * it into staging or production would put fake pupils alongside real ones in a
 * system schools bill from. The project ref is checked against the one in
 * `supabase/.temp/project-ref`, which is what `supabase link` writes, so the
 * guard follows whatever the CLI is actually pointed at rather than an
 * assumption in this file.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const DEV_REF = 'tevblmcebsqqjgzjptgw'
const SEED = 'supabase/seed/dev_seed.sql'

let linked
try {
  linked = readFileSync('supabase/.temp/project-ref', 'utf8').trim()
} catch {
  console.error('Not linked to a Supabase project. Run: npx supabase link --project-ref ' + DEV_REF)
  process.exit(1)
}

if (linked !== DEV_REF) {
  console.error(
    `\nRefusing to seed.\n\n` +
      `  linked project : ${linked}\n` +
      `  expected (dev) : ${DEV_REF}\n\n` +
      `dev_seed.sql contains synthetic schools and pupils. It must never reach\n` +
      `staging or production. Re-link to dev and try again.\n`,
  )
  process.exit(1)
}

console.log(`Seeding ${linked} from ${SEED} ...\n`)
// `db query`, not `db execute` — the latter does not exist, and `--file` must
// come after the subcommand. `--linked` matters more than it looks: without it
// the CLI targets the LOCAL database on 127.0.0.1:54322, which needs Docker and
// is not what is linked. The failure mode without it is a connection refused,
// which reads as an environment problem rather than a wrong target.
execFileSync('npx', ['supabase', 'db', 'query', '--linked', '--file', SEED], {
  stdio: 'inherit',
  shell: true,
})
