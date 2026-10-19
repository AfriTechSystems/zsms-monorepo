/**
 * Walk the authenticated chain end to end, as a real signed-in user.
 *
 * `npm run e2e:walk`            (needs `npm run dev` on port 3000)
 * `npm run e2e:walk -- --base https://staging.example`
 *
 * ## What this proves that nothing else does
 *
 * Every other check in this repository stops one link short of the whole chain:
 *
 *   * `db:verify` and the 41 pgTAP suites exercise the database with a synthetic
 *     session set by `set_config`, never a token Clerk actually issued.
 *   * `clerk:check` mints a real token and decodes it, but never spends it.
 *   * `ci:checks` compiles and lints; a route that 500s on first contact compiles.
 *   * `gaps` proves a route is REFERENCED by a screen, never that it answers.
 *
 * So the one thing nobody had evidence for was the join: a token Clerk minted,
 * carried through `middleware.ts`, resolved by `getSessionUser()`, spent against
 * PostgREST, filtered by RLS, and returned as JSON the envelope admits. This spends
 * a real token against the running app and reports what each route actually said.
 *
 * `JOURNAL.md` recorded on 2026-08-23 that **no portal screen had ever been seen
 * rendering real data**, because every seeded school's `clerk_org_id` was a
 * placeholder (`org_test_d`) and no session could resolve to one. Three schools now
 * carry real organisation ids, so the walk is finally possible.
 *
 * ## It reports, it does not assert a shape
 *
 * Each route is called and its status and a short shape summary printed. A 403 is
 * not a failure here: this walks as whoever is signed in, and an AfriTech operator
 * SHOULD be refused the school endpoints. What would be a failure is a 500, a 404 on
 * a route `gaps` says exists, or an envelope that is neither `{data}` nor `{error}`.
 * Those three are counted and set the exit code.
 *
 * ## A first call may be refused, and it is the clock
 *
 * On the very first walk after minting, one route answered 401 and then served on
 * every run afterwards. That is the Clerk/Supabase sub-second clock skew this
 * repository already knows about — `fromPostgrestError` remaps PostgREST's
 * `PGRST303 JWT not yet valid` to CONFLICT for the same reason. A token whose `nbf`
 * is a fraction of a second in the future is not yet valid when it arrives.
 *
 * So: a single refusal on the first run is worth repeating before investigating. A
 * refusal that survives a second run is not this.
 *
 * ## It only reads
 *
 * Every call is a GET. Nothing here enrols a pupil, records a payment or sends a
 * message — a walk that writes is a walk nobody runs twice on a database that
 * matters.
 */

const BASE = (() => {
  const i = process.argv.indexOf('--base')
  return (i > -1 ? process.argv[i + 1] : null) ?? 'http://localhost:3000'
})()

const KEY = process.env['CLERK_SECRET_KEY']
if (!KEY) {
  console.error('CLERK_SECRET_KEY is not set. Run through `npm run e2e:walk`, which loads .env.local.')
  process.exit(1)
}

const clerk = async (path, init) => {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}

const rows = (body) => (Array.isArray(body) ? body : (body?.data ?? []))

// ---------------------------------------------------------------------------
// A real token, from a real session. Same approach as `clerk:check`.
// ---------------------------------------------------------------------------
const users = await clerk('/users?limit=20')
if (users.status !== 200) {
  console.error('Could not list Clerk users:', users.status)
  process.exit(1)
}

let session = null
for (const user of rows(users.body)) {
  const found = await clerk(`/sessions?user_id=${user.id}&status=active&limit=5`)
  if (found.status === 200 && rows(found.body).length > 0) {
    session = rows(found.body)[0]
    break
  }
}

if (!session) {
  console.log(
    'No active Clerk session to walk as.\n' +
      'Sign in to the app in a browser, then run this again.',
  )
  process.exit(2)
}

const minted = await clerk(`/sessions/${session.id}/tokens`, { method: 'POST', body: '{}' })
if (minted.status !== 200 || !minted.body?.jwt) {
  console.error('Could not mint a session token:', minted.status)
  process.exit(1)
}

const jwt = minted.body.jwt
const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'))

console.log(`Walking ${BASE}`)
console.log(
  `  as ${claims.sub}` +
    (claims.o?.slg ? `, org ${claims.o.slg}` : ', no organisation') +
    (claims.o?.rol ? `, role ${claims.o.rol}` : ''),
)
console.log('')

// ---------------------------------------------------------------------------
// The walk.
// ---------------------------------------------------------------------------
let broken = 0
let refused = 0
let served = 0

/** A one-line shape, so a 200 that returned nothing is visibly different from one
 *  that returned a roll of forty pupils. */
function shapeOf(body) {
  if (body == null) return 'no body'
  if (body.error) return `error: ${String(body.error).slice(0, 60)}`
  const data = body.data
  if (data == null) return 'no data key'
  if (Array.isArray(data)) return `array(${data.length})`
  const keys = Object.keys(data)
  const counted = keys
    .filter((k) => Array.isArray(data[k]))
    .map((k) => `${k}(${data[k].length})`)
  return counted.length > 0 ? counted.join(' ') : `{${keys.slice(0, 5).join(', ')}}`
}

/*
  `/api/health` is deliberately not in the envelope.

  AVAILABILITY.md has it return component-level status so an alert can tell "the app
  is down" from "the app is up but cannot reach the database", and a monitor polling
  it wants that shape rather than `{data:{…}}`. Exempting it here is the honest fix:
  the rule below is right for every route a screen calls, and this route is for
  machines.
*/
const NOT_ENVELOPED = new Set(['/api/health'])

async function walk(path) {
  let response
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${jwt}` },
    })
  } catch (error) {
    broken++
    console.log(`  BROKEN  ${path} — ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  const body = await response.json().catch(() => null)

  /*
    A 500 is always a failure: it means the route threw rather than deciding. So is a
    404 on a route `gaps` says exists, and a 200 carrying neither `data` nor `error`,
    because the envelope is the contract every screen is written against.
  */
  const envelopeOk =
    NOT_ENVELOPED.has(path) || (body != null && ('data' in body || 'error' in body))
  if (response.status >= 500 || response.status === 404 || (response.ok && !envelopeOk)) {
    broken++
    console.log(`  BROKEN  ${response.status} ${path} — ${shapeOf(body)}`)
    return
  }

  if (response.status === 401 || response.status === 403) {
    refused++
    console.log(`  refused ${response.status} ${path} — ${shapeOf(body)}`)
    return
  }

  served++
  console.log(`  ok      ${response.status} ${path} — ${shapeOf(body)}`)
}

console.log('Session')
await walk('/api/session/whoami')
await walk('/api/session/schools')
await walk('/api/session/notices')

console.log('\nAfriTech')
await walk('/api/admin/overview')
await walk('/api/admin/schools')

console.log('\nSchool')
await walk('/api/school/overview')
await walk('/api/school/structure')
await walk('/api/school/staff')
await walk('/api/school/teaching')
await walk('/api/school/fees')
await walk('/api/school/results')
await walk('/api/school/announcements')

console.log('\nParent')
await walk('/api/parent/overview')
await walk('/api/parent/fees')
await walk('/api/parent/attendance')

console.log('\nTeacher Hub')
await walk('/api/teacher/overview')
await walk('/api/teacher/hub')

console.log('\nPublic (no token needed, but it should still answer)')
await walk('/api/health')
await walk('/api/public/schools?countryCode=ZM&limit=2')

console.log(
  `\n${broken === 0 ? 'OK' : 'FAILED'} — ${served} served, ${refused} refused by role, ${broken} broken.`,
)
if (broken === 0 && refused > 0) {
  console.log(
    '  A refusal is not a fault here: this walks as whoever is signed in, and an\n' +
      '  AfriTech operator should be refused the school endpoints.',
  )
}
process.exit(broken === 0 ? 0 : 1)
