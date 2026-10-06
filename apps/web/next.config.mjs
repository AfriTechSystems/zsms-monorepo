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
  /**
   * Security headers, set at the ORIGIN.
   *
   * Spec: `03 Infrastructure Services/CLOUDFLARE_WAF.md` -> *Security Headers*
   *
   * That document puts these in Cloudflare Transform Rules. They are set here as well,
   * and the reason is the document's own prohibition 1: "The Cloudflare WAF proxy must
   * always be enabled (orange cloud ON) for zsms.co.zm. Disabling it bypasses all WAF
   * protections and exposes Vercel's origin IP."
   *
   * A header that exists only at the edge disappears the moment somebody greys that
   * cloud to debug something — which is exactly when a site is most exposed. Set at the
   * origin they survive it, they are version-controlled, and they can be tested before
   * the zone exists at all.
   *
   * Cloudflare will override with the same values where both apply, so there is no
   * conflict in keeping both.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          /*
            No framing at all. ZSMS has no embedding use case, and a school portal in an
            iframe is a clickjacking surface over fee approval and mark publishing.
          */
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          /*
            `X-XSS-Protection` is in the document and is deliberately NOT set.

            Every current browser ignores it, and in the versions that honoured it the
            auditor itself introduced vulnerabilities — which is why it was removed.
            `Content-Security-Policy` below is what actually prevents this class.
          */
          {
            key: 'Content-Security-Policy',
            /*
              `unsafe-inline` for scripts is what Next's hydration bootstrap needs today;
              removing it requires nonces threaded through the App Router and is its own
              piece of work. Recorded here rather than silently accepted.

              `frame-ancestors 'none'` duplicates X-Frame-Options for browsers that
              prefer CSP, which is all of them now.
            */
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://cdn.clerk.io",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.r2.cloudflarestorage.com https://*.r2.dev https://img.clerk.com",
              "font-src 'self' data:",
              // Supabase over websockets for realtime, Clerk for auth, PostHog for
              // analytics, Sentry for errors. Anything else is a bug or an exfiltration.
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.clerk.accounts.dev https://clerk.zsms.co.zm https://*.posthog.com https://*.sentry.io",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },

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
