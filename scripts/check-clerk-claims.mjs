/**
 * Does the Clerk session token carry the claims ZSMS depends on?
 *
 * Run: npm run clerk:check
 *
 * ## Why this script exists
 *
 * `CLAUDE.md` tracks an open issue: "Clerk instance settings are undocumented configuration
 * ... CLERK.md needs an instance-settings section that a new environment is checked against."
 * This is the checkable half of that, for the settings that are load-bearing in SQL.
 *
 * Two claims matter, and both fail silently rather than loudly when missing:
 *
 *   * `role` — PostgREST treats a token without `role: "authenticated"` as ANONYMOUS, so
 *     every policy denies and the app looks like a permissions bug rather than a
 *     configuration one.
 *   * `email` — `claim_parent_links()` (0170) reads `auth.jwt() ->> 'email'` to match a
 *     parent against the address their school recorded. Without it, no parent can ever be
 *     connected to their children, and the portal renders CORRECTLY EMPTY.
 *
 * Neither is in Clerk's default session token. Both are set under
 * **Sessions → Customize session token**, which is per-instance — and the development and
 * production instances are configured separately, which is the usual reason a change
 * appears not to have taken.
 *
 * ## It reads the real token
 *
 * A token is minted for a live session through the Backend API and its payload decoded.
 * That is the actual artefact SQL will see, rather than a dashboard screenshot or a UI
 * click. No secret and no token value is ever printed; the email's local part is masked,
 * because the question is whether the claim arrives, not whose address it is.
 */

const KEY = process.env.CLERK_SECRET_KEY

if (!KEY) {
  console.error('CLERK_SECRET_KEY is not set. Add it to .env.local.')
  process.exit(1)
}

const instance = KEY.startsWith('sk_live') ? 'PRODUCTION' : 'development'

const api = async (path, init) => {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

const rows = (body) => (Array.isArray(body) ? body : (body?.data ?? []))

console.log(`Clerk instance: ${instance}  (from the key prefix)`)
if (instance === 'PRODUCTION') {
  console.log('NOTE: this is the production instance. Settings are configured per instance.')
}

// `/sessions` requires a user_id or client_id, so walk the users to find a live session.
const users = await api('/users?limit=20')
if (users.status !== 200) {
  console.error('Could not list users:', users.status, JSON.stringify(users.body))
  process.exit(1)
}

let session = null
for (const user of rows(users.body)) {
  const found = await api(`/sessions?user_id=${user.id}&status=active&limit=5`)
  if (found.status === 200 && rows(found.body).length > 0) {
    session = rows(found.body)[0]
    break
  }
}

if (!session) {
  console.log(
    '\nNo active session to mint a token from.\n'
    + 'Sign in to the app in a browser, then run this again.',
  )
  process.exit(2)
}

const minted = await api(`/sessions/${session.id}/tokens`, { method: 'POST', body: '{}' })
if (minted.status !== 200 || !minted.body?.jwt) {
  console.error('Could not mint a token:', minted.status, JSON.stringify(minted.body))
  process.exit(1)
}

// Payload only. The signature is irrelevant here — the question is which claims the
// template emits.
const payload = JSON.parse(
  Buffer.from(minted.body.jwt.split('.')[1], 'base64url').toString('utf8'),
)

console.log(`\nClaims on the session token: ${Object.keys(payload).sort().join(', ')}\n`)

const checks = [
  {
    claim: 'role',
    ok: payload.role === 'authenticated',
    needed: 'PostgREST treats a token without it as anonymous — every policy denies.',
    fix: '"role": "authenticated"',
  },
  {
    claim: 'email',
    ok: typeof payload.email === 'string' && payload.email.includes('@'),
    needed: 'claim_parent_links() matches a parent on it. Without it no parent can be linked.',
    fix: '"email": "{{user.primary_email_address}}"',
  },
]

let failed = 0
for (const check of checks) {
  if (check.ok) {
    const shown =
      check.claim === 'email'
        ? `${payload.email.split('@')[0].slice(0, 2)}***@${payload.email.split('@')[1]}`
        : JSON.stringify(payload[check.claim])
    console.log(`  ✓ ${check.claim.padEnd(6)} present — ${shown}`)
  } else {
    failed += 1
    console.log(`  ✗ ${check.claim.padEnd(6)} MISSING (value: ${JSON.stringify(payload[check.claim])})`)
    console.log(`      why it matters: ${check.needed}`)
    console.log(`      add to the token: ${check.fix}`)
  }
}

if (failed > 0) {
  console.log(
    '\nClerk Dashboard → Configure → Sessions → Customize session token.\n'
    + `Make sure you are on the ${instance} instance — it is switched at the top of the\n`
    + 'dashboard, and the two are configured separately. The claims object must contain\n'
    + 'EVERY claim at once; saving only the new one removes the others:\n\n'
    + '  {\n    "role": "authenticated",\n    "email": "{{user.primary_email_address}}"\n  }\n',
  )
  process.exit(3)
}

console.log('\nAll required claims are present.')
