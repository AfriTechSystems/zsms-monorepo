import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Load the monorepo-root `.env.local` before Next builds its config.
 *
 * ## Why this exists
 *
 * Next reads `.env.local` from its own project directory — `apps/web` — because
 * that is the cwd Turborepo runs `next dev` in. A file at the repo root is
 * simply never seen. The failure is quiet in the worst way: `NEXT_PUBLIC_*`
 * comes back undefined and the app reports a *missing Supabase URL* or an
 * invalid Clerk key, which reads as a broken integration rather than a file in
 * the wrong folder.
 *
 * The obvious fix is to copy the file into `apps/web`. This deliberately does
 * not do that. Two copies of a credentials file drift, and the copy that drifts
 * is always the one you are not looking at — so a stale secret becomes a
 * debugging session rather than an error. `apps/workers` and `scripts/` also
 * read the root file, so keeping one authoritative file is the only arrangement
 * where "I updated the key" means every consumer got it.
 *
 * ## Precedence
 *
 * A variable already present in `process.env` always wins. That keeps the real
 * environment — Vercel, Railway, CI, or a shell export — authoritative in
 * deployment, where this file does not exist at all. It is a local-development
 * convenience, never a source of production configuration.
 *
 * ## Timing
 *
 * This runs at module scope, so it completes before `nextConfig` is exported
 * and therefore before Next assembles the webpack `DefinePlugin` entries that
 * inline `NEXT_PUBLIC_*` into client bundles. Server-side reads of
 * `process.env` are unaffected either way.
 *
 * Not a dotenv dependency, because the parsing needed here is a dozen lines and
 * a credentials path is a poor place to add a transitive dependency surface.
 */
function loadRootEnv() {
  const path = fileURLToPath(new URL('../../.env.local', import.meta.url))

  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    // Absent is normal — in deployment the platform supplies the environment.
    // Anything else (a permissions problem, a directory) is worth surfacing
    // rather than swallowing into a confusing "not set" downstream.
    if (error.code !== 'ENOENT') {
      console.warn(`[env] could not read ${path}: ${error.message}`)
    }
    return
  }

  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue

    const [, key, rest] = match
    let value = rest.trim()

    // Quoted values keep everything inside the quotes, including any `#`.
    // Unquoted values stop at an unescaped `#`, which is how a trailing comment
    // is written. Getting this backwards truncates a secret at the first `#` it
    // happens to contain — silently, and only for some keys.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    } else {
      value = value.split(/\s+#/)[0].trim()
    }

    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadRootEnv()

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Next's dev-tools badge — the floating "N" — defaults to `bottom-left`,
  // where it sits on top of the page gutter and reads as a stray avatar bleeding
  // out of the layout. It is injected by the dev server and never ships to
  // production, so this is purely so it stops being mistaken for our own
  // markup. Moved rather than disabled: it reports route type, compilation
  // state, and errors, which are worth keeping.
  devIndicators: { position: 'bottom-right' },
  // Workspace packages ship TypeScript source — Next compiles them.
  transpilePackages: [
    '@zsms/auth-provider',
    '@zsms/config',
    '@zsms/queue',
    '@zsms/storage',
    '@zsms/types',
    '@zsms/utils',
  ],
}
export default nextConfig
