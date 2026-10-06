/**
 * `npm run gaps` — backend that nothing can reach.
 *
 * ## Why this exists
 *
 * A gap audit on 2026-10-02 found a consistent, expensive pattern: work that was
 * built, tested and correct, and that **no user could get to**. Not bugs —
 * missing links in a chain nobody was checking.
 *
 *   * `unlock_result_for_correction()` — a whole migration for correcting a
 *     published mark, with no route and no screen.
 *   * `generated_documents`, the report-card worker and the PDF renderer — three
 *     pieces that met nowhere, so no school could produce a report card.
 *   * `revise_fee_records()`, `notification_templates`, `school_message_quotas`
 *     — no caller at all.
 *   * `generate-receipt` was enqueued from a route **no screen has ever called**,
 *     so receipts had never been generated for anybody.
 *
 * Each was invisible because every individual piece was fine. Only the CHAIN was
 * broken, and nothing looked at chains.
 *
 * ## What it checks
 *
 *   1. `public` functions with no `rpc('name')` anywhere in source.
 *   2. API routes with no `fetch`/`apiSend`/`useApi` reference from a screen.
 *
 * ## Why it warns rather than fails
 *
 * Plenty of entries are legitimate: RLS predicates are called by policies, not
 * code; trigger functions are called by triggers; `ENDPOINTS.md` documents routes
 * the mobile app will use before mobile exists. A hard failure would train
 * everybody to pass `--force`.
 *
 * So it prints, and `--strict` makes it exit non-zero for CI once the known list
 * is curated. The value is the diff: a NEW unreachable function is a chain
 * somebody forgot to finish this week.
 */

import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'

const STRICT = process.argv.includes('--strict')

/* ---------------------------------------------------------------------------
 * Names that are called by Postgres itself, not by application code.
 *
 * A policy calls an RLS predicate; a trigger calls a trigger function. Neither
 * appears as `rpc(...)` and neither is a gap. Matched as prefixes because the
 * naming convention in this schema is consistent about them.
 * ------------------------------------------------------------------------- */
const CALLED_BY_POSTGRES = [
  /^(get|is|current|my|has)_/, // RLS predicates and claim readers
  /^(update|set|trg|audit|touch)_/, // trigger functions
  /^(refuse|reject|prevent|block|enforce|validate|check)_/, // guard triggers
  /^(mask|log_audit|normalize|generate|grade_from|assign_receipt)_/, // helpers
  /^(relock|mark)_/,
  /^(srgb|wcag)_/, // colour maths used by the design audit
  /_test$/,
]

/* ---------------------------------------------------------------------------
 * Known and deliberate. Each needs a REASON, so the list cannot quietly become
 * a place to hide things.
 * ------------------------------------------------------------------------- */
const ACCEPTED = new Map([
  /*
    A trigger function. Called by `a_assign_payment_references_on_insert_on_payments`
    and the matching update trigger (`0211`) — the catalogue knows about those and a
    source grep cannot.
  */
  ['assign_payment_references', 'trigger function on payments (0211)'],
  /*
    Called from SQL rather than from source.

    `school_feature_resolution()` (`0215`) invokes it once per feature key, so the
    revoke/grant/tier-override/matrix order lives in exactly one place. The TypeScript
    wrapper calls the set-returning function instead, which is why nothing greps for
    this one any more — and widening the grep would hide a real orphan.
  */
  ['school_has_feature', 'called by school_feature_resolution() (0215)'],
  ['worker_parent_push_tokens', 'worker boundary, called by apps/workers'],
  ['worker_retire_push_token', 'worker boundary, called by apps/workers'],
  ['ai_credit_consume', 'called by other SQL functions, not by a route'],
  ['platform_setting', 'read by request_my_erasure and my_erasure_status, not by a route'],
  ['ai_credit_balance', 'called by other SQL functions, not by a route'],
  ['ai_allowance_for_account', 'called by ai_credit_balance'],
  ['ai_credit_account_for_caller', 'called by other SQL functions'],
  ['school_credit_period', 'called by the school credit functions'],
  ['school_credit_unassigned', 'called by the school credit functions'],
  ['school_student_limit', 'called by school_student_capacity and a trigger'],
  ['school_can_enrol', 'called by the enrolment ceiling trigger'],
  ['school_can_write', 'called by the status-enforcement trigger'],
  ['recalculate_fee_record_balance', 'called by a trigger on payments'],
  ['record_job_run', 'worker boundary'],
  ['complete_job_run', 'worker boundary'],
  ['consume_message_quota', 'worker boundary — the sender decrements it'],
  ['teacher_hub_entitlement', 'RLS predicate'],
  ['teacher_school_entitlement', 'RLS predicate'],
  ['teacher_reaches_class', 'RLS predicate'],
  ['teacher_teaches_subject', 'RLS predicate'],
  ['teacher_teaches_subject_in_year', 'RLS predicate'],
  ['teaching_resource_feature_key', 'RLS predicate'],
  ['student_in_current_school', 'RLS predicate'],
  ['network_reaches_school', 'RLS predicate'],
  ['parent_can_access_fee_record', 'RLS predicate'],
  ['parent_has_child_at_school', 'RLS predicate'],
  ['parent_has_student_in_current_school', 'RLS predicate'],
  ['announcement_addressed_to_me', 'RLS predicate'],
  ['academic_year_is_current', 'RLS predicate'],
  ['academics_years_match', 'RLS predicate'],
  ['academic_years_match', 'RLS predicate'],
  ['sync_link_parent_user_id', 'trigger'],
  ['create_initial_grading_scale_version', 'trigger'],
  ['province_for_city', 'reference lookup used in SQL'],
  ['ensure_onboarding_checklist', 'called by provisioning SQL'],
])

const ACCEPTED_ROUTES = new Map([
  // A SECOND implementation of marking a notice read. The parent portal uses
  // `POST /api/parent/notices`, which inserts the same `announcement_reads` row —
  // verified on 2026-10-02 after this script's own listing led to the wrong
  // conclusion that receipts were never recorded. Kept rather than deleted because
  // `ENDPOINTS.md` names it and the mobile parent client may use it; the duplication
  // is the thing to watch, not the absence.
  ['announcements/[id]/read', 'duplicate of POST /api/parent/notices, which the portal uses'],
  /*
    No longer excepted — R2 works as of 2026-10-05 and three screens now call it:
    the school and parent fees tables for receipts, and the results screen for report
    cards. Left as a comment rather than deleted so the next person reading this list
    sees that an exception was retired rather than lost.
  */
  // Half superseded, half a tracked gap. `/welcome` calls `claim_parent_links()`
  // directly server-side, so the email retry is redundant there — but this route also
  // raises a PHONE-ONLY claim for a parent whose school recorded no email, and that
  // has no UI anywhere. Tracked in CLAUDE.md rather than deleted.
  ['parent/link', 'email retry superseded by /welcome; the phone-claim half has no UI yet'],
  ['school/parent-claims', 'phone-only parent claim approval — UI not built yet'],
  ['payments/[id]/verify', 'superseded by /api/school/fees/verify; the receipt enqueue moved there'],
  ['health', 'uptime probe, called by infrastructure'],
  ['session/whoami', 'diagnostic'],
  ['announcements', 'ENDPOINTS.md contract — the mobile surface'],
  ['attendance', 'ENDPOINTS.md contract — offline mobile attendance (ADR-004)'],
  ['results', 'ENDPOINTS.md contract — the mobile surface'],
  ['results/publish', 'ENDPOINTS.md contract'],
  ['staff', 'ENDPOINTS.md contract'],
  ['students', 'ENDPOINTS.md contract'],
  ['payments', 'ENDPOINTS.md contract'],
  ['fees/records', 'ENDPOINTS.md contract'],
  ['messages', 'ENDPOINTS.md contract'],
])

// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(full)
  }
  return out
}

/*
  `apps/mobile` joined this list on 2026-10-03, and the omission was already producing a
  false positive: `/api/session/notices` is called only from the phone, so the script
  reported a route nothing reaches while the chain was complete.

  A checker that cries wolf is worse than no checker — the value here is the diff, and
  noise is what trains everybody to stop reading it.
*/
const SOURCE_DIRS = [
  'apps/web/app',
  'apps/web/lib',
  'apps/web/components',
  'apps/mobile/app',
  'apps/mobile/lib',
  'apps/mobile/components',
  'apps/workers/src',
  'packages',
]
const sources = SOURCE_DIRS.flatMap((d) => {
  try {
    return walk(d)
  } catch {
    return []
  }
})

const allText = sources
  // The generated types name every function in the database, so counting them as
  // callers would make this check always pass.
  .filter((f) => !f.endsWith(join('types', 'src', 'database.ts')))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

const calledRpcs = new Set([...allText.matchAll(/rpc\(\s*'([a-z0-9_]+)'/g)].map((m) => m[1]))

// ---------------------------------------------------------------------------
// 1. Functions.
// ---------------------------------------------------------------------------
function dbFunctions() {
  const dir = mkdtempSync(join(tmpdir(), 'zsms-gaps-'))
  const file = join(dir, 'q.sql')
  try {
    writeFileSync(
      file,
      `SELECT p.proname AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prokind = 'f'
         AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
       ORDER BY p.proname;`,
      'utf8',
    )
    const out = execSync(`npx supabase db query --linked --file "${file}"`, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return [...out.matchAll(/"fn":\s*"([a-z0-9_]+)"/g)].map((m) => m[1])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

let functions = []
try {
  functions = dbFunctions()
} catch {
  console.log('! Database unreachable — checking routes only.\n')
}

const orphanFns = functions.filter(
  (fn) =>
    !calledRpcs.has(fn) &&
    !ACCEPTED.has(fn) &&
    !CALLED_BY_POSTGRES.some((re) => re.test(fn)),
)

// ---------------------------------------------------------------------------
// 2. Routes.
// ---------------------------------------------------------------------------
const routeFiles = sources.filter((f) => f.replace(/\\/g, '/').includes('apps/web/app/api/'))
const routes = routeFiles.map((f) =>
  relative('apps/web/app/api', f).replace(/\\/g, '/').replace(/\/route\.ts$/, ''),
)

const callerText = sources
  .filter((f) => !f.replace(/\\/g, '/').includes('apps/web/app/api/'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

const orphanRoutes = routes.filter((r) => {
  if (ACCEPTED_ROUTES.has(r)) return false

  /*
    A route is reached through a template literal — `/api/students/${id}/guardians` —
    so matching the whole path never works and matching only the static segments
    joined together ("students/guardians") never matches either.

    Match the part BEFORE the first dynamic segment, and the part after the last.
    Both must appear somewhere in the caller source. That is loose enough for a
    template literal and tight enough that `/api/students` does not vouch for
    `/api/students/[id]/custom-values`.
  */
  const segments = r.split('/')
  const firstDynamic = segments.findIndex((seg) => seg.startsWith('['))

  if (firstDynamic === -1) return !callerText.includes(`/api/${r}`)

  const prefix = segments.slice(0, firstDynamic).join('/')
  const lastDynamic = segments.map((seg) => seg.startsWith('[')).lastIndexOf(true)
  const suffix = segments.slice(lastDynamic + 1).join('/')

  if (!callerText.includes(`/api/${prefix}`)) return true
  return suffix.length > 0 && !callerText.includes(suffix)
})

// ---------------------------------------------------------------------------

console.log('Reachability\n============\n')

if (orphanFns.length === 0) {
  console.log('✓ Every callable function has a caller in source.')
} else {
  console.log(`! ${orphanFns.length} function(s) nothing calls:\n`)
  for (const fn of orphanFns) console.log(`    ${fn}`)
  console.log('\n  Each is either a gap, or belongs in ACCEPTED with a reason.')
}

console.log('')

if (orphanRoutes.length === 0) {
  console.log('✓ Every API route is referenced by a screen.')
} else {
  console.log(`! ${orphanRoutes.length} route(s) no screen calls:\n`)
  for (const r of orphanRoutes) console.log(`    /api/${r}`)
  console.log('\n  Each is either a gap, or belongs in ACCEPTED_ROUTES with a reason.')
}

console.log('')

if (STRICT && (orphanFns.length > 0 || orphanRoutes.length > 0)) {
  console.error('Failing because --strict was passed.')
  process.exit(1)
}
