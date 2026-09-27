/**
 * Points seeded parent links at a REAL Clerk account, so the parent portal can
 * actually be signed into on a developer machine.
 *
 * **Refuses to run against anything but `zsms-dev`.** Same guard and same reason
 * as `seed-dev.mjs`: this rewrites who is recorded as a child's parent, which in
 * any real environment is among the most damaging edits available. It exists only
 * because synthetic fixtures cannot be logged into.
 *
 * ## The problem it solves
 *
 * `dev_seed.sql` creates parents with invented Clerk ids — `user_test_parent_90`
 * — and `.invalid` email addresses. They are rows, not accounts. Parent access is
 * decided by `is_linked_parent_of()`, which compares
 * `student_parent_links.parent_user_id` to `get_user_id()` from the JWT, so a real
 * person signing in matches nothing and sees **zero children**. The portal is
 * correct and empty, which is indistinguishable from broken.
 *
 * This repoints a few seeded links at the Clerk id you are actually signed in as.
 *
 * ## Usage
 *
 *   1. Sign in to the app, then open /api/session/whoami and copy `userId`
 *      (it looks like `user_2abc...`).
 *   2. npm run dev:link-parent -- user_2abc... [howManyChildren]
 *
 * Re-running with a different id moves the links rather than accumulating them,
 * so you never end up as the parent of half the school by accident.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'

const DEV_REF = 'tevblmcebsqqjgzjptgw'
const TMP = 'supabase/.temp/link-dev-parent.sql'

const clerkId = process.argv[2]
const howMany = Number(process.argv[3] ?? 2)

if (!clerkId || !/^user_[A-Za-z0-9]+$/.test(clerkId)) {
  console.error(
    '\nUsage: npm run dev:link-parent -- <clerk-user-id> [children]\n\n' +
      '  Sign in, open /api/session/whoami, copy `userId`.\n' +
      '  It looks like: user_2abcDEF...\n',
  )
  process.exit(1)
}

if (!Number.isInteger(howMany) || howMany < 1 || howMany > 5) {
  console.error('\nChildren must be a whole number between 1 and 5.\n')
  process.exit(1)
}

let linked
try {
  linked = readFileSync('supabase/.temp/project-ref', 'utf8').trim()
} catch {
  console.error('Not linked to a Supabase project. Run: npx supabase link --project-ref ' + DEV_REF)
  process.exit(1)
}

if (linked !== DEV_REF) {
  console.error(
    `\nRefusing to run.\n\n` +
      `  linked project : ${linked}\n` +
      `  expected (dev) : ${DEV_REF}\n\n` +
      `This rewrites parent-child links. It must never reach staging or production.\n`,
  )
  process.exit(1)
}

/**
 * Chooses children from ONE school, deliberately.
 *
 * A parent with children at two different schools is a legitimate case the
 * portal must eventually handle, but making it the default fixture would mean
 * every screen is first built against the hardest variant. Pick the school with
 * the most pupils so there is fee, attendance and results history attached.
 */
const sql = `
-- Release any links this account already holds, so re-running moves rather
-- than accumulates.
UPDATE public.student_parent_links
SET    parent_user_id = 'user_test_parent_released_' || left(md5(random()::text), 8)
WHERE  parent_user_id = '${clerkId}';

UPDATE public.parents
SET    clerk_user_id = 'user_test_parent_released_' || left(md5(random()::text), 8)
WHERE  clerk_user_id = '${clerkId}';

WITH target_school AS (
  SELECT school_id
  FROM   public.students
  WHERE  is_deleted = FALSE
  GROUP  BY school_id
  ORDER  BY count(*) DESC
  LIMIT  1
),
chosen AS (
  SELECT spl.id, spl.parent_id
  FROM   public.student_parent_links spl
  JOIN   public.students s  ON s.id = spl.student_id
  JOIN   target_school ts   ON ts.school_id = s.school_id
  WHERE  spl.is_active = TRUE
    AND  spl.parent_user_id LIKE 'user_test_parent_%'
  ORDER  BY s.student_id
  LIMIT  ${howMany}
)
UPDATE public.student_parent_links spl
SET    parent_user_id = '${clerkId}'
FROM   chosen
WHERE  spl.id = chosen.id;

-- The parents row carries the contact details the portal reads, so it has to
-- point at the same account.
UPDATE public.parents p
SET    clerk_user_id = '${clerkId}'
WHERE  p.id IN (
  SELECT parent_id FROM public.student_parent_links WHERE parent_user_id = '${clerkId}'
);

SELECT s.student_id, s.first_name, s.last_name, sc.school_id AS school, sc.name
FROM   public.student_parent_links spl
JOIN   public.students s  ON s.id = spl.student_id
JOIN   public.schools  sc ON sc.id = s.school_id
WHERE  spl.parent_user_id = '${clerkId}';
`

writeFileSync(TMP, sql, 'utf8')

console.log(`Linking ${clerkId} to ${howMany} seeded pupil(s) on ${linked} ...\n`)

try {
  execFileSync('npx', ['supabase', 'db', 'query', '--linked', '--file', TMP], {
    stdio: 'inherit',
    shell: true,
  })
  console.log(
    '\nDone. Sign in as that account and open /parent — the pupils listed above\n' +
      'should appear. If the list above is empty, the seed has no spare test\n' +
      'parents left: run `npm run db:seed` first.\n',
  )
} finally {
  // The file embeds a user id; there is no reason to leave it lying around.
  try {
    unlinkSync(TMP)
  } catch {
    /* already gone */
  }
}
