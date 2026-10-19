# JOURNAL.md — ZSMS Working Journal

Running log of substantive work on the ZSMS repository. Newest entry first.

---

## 2026-10-19 — The chain closes: a real token, spent against the running app

Branch `rls/anon-execute-boundary`. `scripts/e2e-walk.mjs`, the last two mobile screens,
and the gaps list cleared of its one false positive. `ci:checks` green; `db:verify` 9/9;
41 pgTAP suites / 926 assertions; the 28-check payment E2E green; `security:audit`
15 pass / 0 fail.

### The thing nobody had evidence for

Every check in this repository stopped one link short of the whole chain, and the gap
was in the same place each time:

| Check | What it proves | What it leaves open |
|---|---|---|
| `ci:checks` | it compiles, lints, builds | a route that 500s on first contact compiles |
| `db:verify`, 41 pgTAP suites | the policies are right | the session is synthetic, set by `set_config` |
| `clerk:check` | the token carries the claims | it is never spent |
| `gaps` | a route is REFERENCED by a screen | never that it answers |

So the join was unevidenced: a token Clerk actually minted, carried through
`middleware.ts`, resolved by `getSessionUser()`, spent against PostgREST, filtered by
RLS, and returned as JSON the envelope admits.

`npm run e2e:walk` closes it. **13 served, 6 refused by role, 0 broken**, stable over
three consecutive runs, with real rows coming back — `/api/school/structure` returned 12
grade levels and 4 subjects, `/api/parent/fees` returned a child, two school accounts, a
statement line and a fee record.

### Why it was impossible until now, and what changed

The 2026-08-23 entry recorded that **no portal screen had ever been seen rendering real
data**, because every seeded school's `clerk_org_id` was a placeholder (`org_test_d`) and
no Clerk session could resolve to one. That entry ended: *"That is a two-minute action in
the Clerk dashboard and it is not mine to take."*

Somebody took it. Three schools now carry real organisation ids — `ZM-LSK-9001`,
`ZM-LSK-9004`, `ZM-LSK-9005` — so the walk is finally possible. **This is the first
recorded evidence of a ZSMS portal endpoint serving real rows to a real session.**

### The six refusals are the product working

The session resolves as `staff` at `zm-lsk-9001`, and it is refused the AfriTech
endpoints, the staff list, teaching assignments, fees and results — each with its own
message rather than a generic denial. That is `can()` and RLS agreeing, observed rather
than asserted. A walk that reported those as failures would be measuring the wrong thing,
so a 403 is counted separately and never as a fault.

What IS counted as broken: a 500, a 404 on a route `gaps` says exists, and a 200 whose
body is neither `{data}` nor `{error}` — the envelope every screen is written against.

### Two findings, and one of them was mine

**`/api/health` was reported broken, and the rule was wrong.** It returns component-level
status rather than the envelope, deliberately: `AVAILABILITY.md` has it distinguish "the
app is down" from "the app is up but cannot reach the database", and a monitor polling it
wants that shape. Exempted with the reason inline. Worth stating because the instinct on
a red line is to change the code.

**One route answered 401 on the very first walk and served on every run after.** That is
the Clerk/Supabase sub-second clock skew this repository already handles —
`fromPostgrestError` remaps PostgREST's `PGRST303 JWT not yet valid` for exactly this. A
token whose `nbf` is a fraction of a second ahead is not yet valid when it arrives.
Recorded in the script rather than smoothed over: one first-run refusal is worth
repeating before investigating; one that survives a second run is not this.

### The mobile sweep finished

`create` and `marks` were the last two untouched screens.

`create` had three outline Buttons standing in for a segmented control, with a comment
correctly arguing that a segmented control was right — the control just had to be drawn
by hand, and an unselected outline button reads as an action rather than an option not
taken.

`marks` gained a **Spread** tab, mirroring the register's Pupils | Summary and the web
results screen's distribution, so one question gets one answer on all three surfaces. One
hue for every slice, not a colour per grade: the slices are one measure split by grade, so
colouring by grade would be colouring by rank and would put a traffic light on a class's
results. Saved grades only, with the caption naming the number it is drawn from — a grade
comes from `grade_from_scale_version()` in the database, never the browser.

A grep for the hand-rolled icon tile now returns only `stats.tsx` and `wordmark.tsx`,
which legitimately draw their own.

### `gaps` had one false positive and two real ones

`reminder_days_are_sane` is called by a **CHECK constraint** — Postgres is the caller, so
a source grep can never find it. Accepted with that reason, because listing it every run
trains people to skim the list, which is how a real one gets missed.

The two that remain are real and pre-existing, now tracked in `CLAUDE.md` rather than
recurring as a warning nobody actions:

- **`ai_credit_topup()`** is the PERSONAL credit purchase. Schools are fine — they buy
  through `school_purchase_credits()`, which `/api/school/credits` calls. The gap is that
  **a standalone Teacher Hub teacher cannot buy credits**; they get their plan's monthly
  allowance and nothing more. It needs a payment path, and the 2026-10-18 decision was to
  keep the claim model rather than integrate a gateway, so it waits on that.
- **`admin_publish_prompt_template()`** versions the AI prompts and has no screen. Low
  priority while `AI_GENERATOR` is `template` and no model runs.

### Carried forward

- **PR #3 is green and unmerged.** `gh pr merge` was refused by the permission classifier
  ("Merge Without Review"). It needs a human, from the GitHub UI or by allowing that here.
- **The register PDF is not reachable from the phone.** The route and renderer work and
  are wired on the web attendance screen; saving a file on the device needs
  `expo-file-system` and `expo-sharing`. Given this repository's history with mobile
  dependencies — two copies of gesture-handler at incompatible majors,
  `expo-notifications` killing startup — that is not a decision to take without being able
  to run an Android build.
- **The walk covers 20 routes of 139.** It is a spine, not a sweep: one or two per surface,
  chosen so a broken layer shows up somewhere. Widening it is cheap and worth doing before
  a pilot.
- **Nothing writes in the walk, by design.** The write paths — enrolling a pupil,
  recording a payment, marking a register — are still only proven by pgTAP against a
  synthetic session. Proving those end to end means a walk that writes, which means a
  database it is safe to write to, which means staging.

---

## 2026-10-18 — 64 SECURITY DEFINER functions were executable by `anon`, and four documents reported finished work as missing

Branch `rls/anon-execute-boundary`, PR #3. Migrations `0272` and `0273`, one new pgTAP suite
(`anon_execute_boundary_test.sql`, 12 assertions) taking the total to **41 suites / 926 assertions**.
Both CI jobs green twice, including the `database` job replaying all 226 migrations against an empty
database.

The session began as "analyse where we are and plan what is next". The analysis is what found the
defect, and it was not found by reading anything — it was found by asking the live database a
question no document had asked it.

### The defect

`public` holds 299 functions, 216 of them `SECURITY DEFINER`. **67 could be executed by the `anon`
role** over PostgREST at `/rest/v1/rpc/<name>`. The anon key ships in the browser bundle by design,
so `anon` means anybody with the URL.

The sharpest two were `worker_parent_push_tokens()` and `worker_retire_push_token()`. A `worker_*`
function exists precisely to bypass RLS for a Railway worker holding the service role key, so by
design it carries no tenant clause and no role check — there is nothing inside it to refuse a
caller:

```
POST /rest/v1/rpc/worker_parent_push_tokens
{ "p_parent_user_ids": ["user_...", "user_..."] }
  -> every matching parent's device push token, platform included
```

Confirmed exploitable against `zsms-dev` with the real publishable key, and confirmed refused after
the fix: **HTTP 401, `42501`**.

### Why 914 assertions did not catch it

`parent_push_tokens` has a 22-assertion suite and it passed throughout. It asserts the table's
**policies** — and a `SECURITY DEFINER` function never consults one. Postgres checks `EXECUTE`
*before* RLS is reached, so the exposure sat one layer in front of everything 40 suites covered.

This is the same root as `0213`'s seven tables with policies and no GRANT, with the sign flipped:
there, a missing grant made a policy unreachable and the feature failed closed. Here, a surplus
grant made a function reachable and nothing failed at all. **The grant layer has now been tested
twice by accident and never on purpose.** That is what the new suite changes.

### What the fix had to get right, and nearly got wrong

Three things, each of which would have made this worse rather than better:

- **The revoke needs `FROM PUBLIC` *and* `FROM anon`.** The privileges came from two different
  places and neither statement removes the other: `my_children`, `verify_payment` and
  `audit_row_change` carry a leading `=X/postgres` in `proacl` — the empty grantee is **PUBLIC**,
  Postgres's default on every function ever created — while `worker_parent_push_tokens` had no
  PUBLIC entry and an explicit `anon=X`.
- **`authenticated` must be granted explicitly FIRST.** On a function whose only source of
  `EXECUTE` for `authenticated` is that same PUBLIC default, revoking PUBLIC first removes the
  capability along with the exposure — and *succeeds*. A silent outage across the product, from a
  migration that applied cleanly. The easy assertion is "anon cannot"; the one that matters is
  "authenticated still can", and the migration and the suite both assert the second.
- **Trigger functions keep their `authenticated` grant, deliberately.** All 11 trigger-returning
  functions lose PUBLIC and `anon`. Whether Postgres re-checks `EXECUTE` when a trigger *fires*, as
  opposed to when it is created, was **not verified** — and if it does, revoking would break every
  write in the product. The exposure being closed is `anon`; calling `set_updated_at()` as an RPC
  with a session token discloses nothing. Recorded as open rather than guessed at.

Three functions stay anon-reachable — `search_schools`, `school_public_profile`,
`school_branding_by_slug`. That is correct, and the reason is a fact worth keeping: **`anon` can
`SELECT` 0 of 93 relations in `public`.** Verified, not assumed. The table-grant discipline was
airtight; only the function grants leaked. So those three functions' `RETURNS TABLE` *is* the entire
public disclosure boundary, exactly as `lib/supabase.ts` already said.

Catalogue-driven rather than a list of 64 names, so it replays correctly against an empty database.
The specification ships as `anon_executable_definer_functions()` and the suite asserts it empty —
the `0270` answer, for the same reason: **a gap whose symptom is nothing at all needs an assertion,
not a note.** Advisor count went 67 to 3.

`0273` is comments only: five tables report `rls_enabled_no_policy` and in this schema that is
correct — RLS-forced, zero policies, **no grants at all** (not `anon`, not `authenticated`, not even
`service_role`), in schemas PostgREST cannot resolve, each reached through a named `public` wrapper.
The risk was somebody "fixing" the advisor by adding a permissive policy to a table that is
currently shut. The migration asserts its own premise, so the comment cannot outlive its truth.

### The other half: four documents reported finished work as missing

Checked by running things rather than reading them, and every one of these would have sent somebody
to rebuild or re-buy something that exists:

| Claim | Reality |
|---|---|
| `CREDENTIALS_CHECKLIST.md`: Sentry "**is not installed at all** — no `@sentry/*` dependency" | `@sentry/nextjs ^11.1.0`, both instrumentation files, `lib/report-error.ts`, `global-error.tsx`. Only `NEXT_PUBLIC_SENTRY_DSN` outstanding, by decision |
| Same file: Redis "**the single highest-value credential**… not one job has ever round-tripped" | `npm run queue:smoke` round-tripped a job again this session |
| Same file: service role key "**Missing from `.env.local`**" | Present |
| Same file: Docker Hub needed | `docker/login-action@v3` in CI, authenticating on every run |
| `CLAUDE.md`: "Teacher Hub: Community Library **is not built**… deliberately scoped out" | Built and reachable: `0217`/`0218`, `community_library()`, `/api/teacher/community`, `/teacher/community`, and a nav entry in `teacher-shell.tsx` |
| `api/admin/impersonate/route.ts`: "**Status: NOT FUNCTIONAL**… returns a clear 501" | No 501 in the file. Mints a Clerk actor token, records the session, revokes on refusal |
| `parent/layout.tsx`: a parent with children at two schools "is in two Clerk organisations" | A parent has no organisation. `is_linked_parent_of()` reads `parent_user_id = get_user_id()` and nothing else |
| `MIGRATIONS.md` x2: "NEXT AVAILABLE: `0092`" | Named `0092` for about 180 migrations |

**A stale blocker costs more than a missing one.** It sends somebody to obtain what they already
have, and it makes the accurate rows look untrustworthy too. The Community Library entry is the
fourth false "not built" claim found in `CLAUDE.md` — after the mobile screens, `admin/impersonate`
and ADR-023's webhooks — and I had carried it into my own plan's "deliberately not in scope" list
before checking. **The file that warns about this pattern keeps producing it.**

Also corrected: the dates. `BUILD_SEQUENCE.md` schedules the pilot for **September 2026**, which
passed with no pilot, and launch for January 2027. Neither is live; `CLAUDE.md` now says so, and
says what actually gates a pilot — staging in `af-south-1`, a paid Clerk plan, and one delivery
channel, none of it engineering work.

### Carried forward

- **Does Postgres re-check `EXECUTE` when a trigger fires?** Settle it where a failed write costs
  nothing, then decide whether the 11 trigger functions should lose `authenticated` too.
- **`private.consent_templates` has no reader.** `submit_loan_application()` stores the template
  version and a hash of the wording, so what a parent agreed to is provable — the hard half, built —
  but the wording is never served, so nothing shows a parent the text before they consent to a
  lender seeing their data. `gaps` cannot see it: the missing link is a read no screen asks for.
  Loans are post-launch, and when it appears is a product decision.
- **The 18 `function_search_path_mutable` advisor warnings are all SECURITY INVOKER** —
  `get_user_id`, `get_school_id`, `is_afritech_admin` among them — so there is no escalation path
  and they are cosmetic. Every one of the 216 DEFINER functions pins its `search_path`, and the new
  suite now asserts that too.
- **`MIGRATIONS.md`'s change log stops at `0218`** while migrations run to `0273`. The
  next-available number is right; the per-migration narrative is about 55 migrations behind.
- **This journal was three weeks stale** — see the reconstruction below, and note that the file
  `CLAUDE.md` tells you to read first was the least current in the repository.

---

## 2026-09-28 to 2026-10-13 — RECONSTRUCTED: the three weeks this journal missed

**Read this with its provenance in mind.** The entry above it and the entry below it were written by
the sessions that did the work. **This one was not.** It was assembled on 2026-10-18 from the commit
log (210 commits), `MIGRATIONS.md`'s change log, and `DOC_AUDIT_PROGRESS.md`, because the journal's
newest entry was 2026-09-27 and `CLAUDE.md` instructs every session to read this file first.

It therefore records **what was done, not what was learned** — the reasoning, the dead ends and the
defects-found-while-building that make the other entries worth reading are mostly lost. Where a
session's finding survived, it survived in `MIGRATIONS.md`'s change log, which is unusually detailed
and is the better source for any specific migration. Treat the dates as commit dates.

### What was built (migrations `0131`–`0271`, 141 migrations)

- **AI, end to end** (28 Sept – 6 Oct). The model chain with failover and a platform-wide incident
  record; the curriculum store and prompt versioning; syllabus ingestion by document upload with a
  verification step; PDF and Word export for teaching resources; platform-wide AI credits bought in
  seats and assigned to named teachers; the role-based assistant; the ADR-029 data-completeness
  score; live generation made a toggle AfriTech controls rather than an environment variable.
- **School lifecycle** (29 Sept – 4 Oct). Schools can be created, can register themselves, and
  school status finally binds. The onboarding task queue with the 24-hour rule derived in SQL;
  sign-off by a person with a reason; an unverified school cannot enrol a child. School settings —
  profile, academic structure, term dates — with changes recorded and visible to AfriTech.
- **The public site** (30 Sept). The directory (verified, not ranked), school profiles, a front door,
  navigation, and auth entry points for every audience sized for a phone.
- **Parents and pupils** (1–11 Oct). A parent who signs up finds their own children; a school can
  link a parent to a pupil; one child switcher on every parent screen; marketing consent and
  graduated-account access (ADR-015); the pupil and alumni portal, which ADR-046 settles is one
  portal.
- **Fees and documents** (2–5 Oct). Fee totals that show what they are made of; revising issued
  bills; the parent claim flow as `PAYMENTS.md` specifies it; receipts and report cards nobody could
  previously reach; an object store that actually stores.
- **The timetable** (4–5 Oct). Three tables with clash detection in the database; builder, teacher
  week and parent view; guided setup and drag-and-drop.
- **The mobile app** (3–5 Oct). Both portals, the drawer, marks entry, notices, timetable, push
  registration, a parent recording a fee payment, and an Android build from GitHub Actions.
- **Platform and compliance** (3–11 Oct). ZDPA data subject rights — access, portability, erasure —
  with self-service and requests reaching the people who action them; school-defined staff roles
  (ADR-012); the six AfriTech roles stopping being one role; the permission grant system made
  reachable; impersonation minting a real token; HTTP rate limiting; the external integration API;
  the tier-1 integrations framework; WAF security headers at the origin; the loan module backend and
  screens; the audit trail nobody could read.
- **The UI redesign and the mobile redesign** (11–13 Oct). A validated chart palette, charts, stat
  trends, context rails, global search scoped by RLS, an activity feed, profile photos, forms in
  modals, a print stylesheet, and a Light/System/Dark choice reaching every mobile screen.

### The two findings worth carrying

Both are in `CLAUDE.md` already, and both are the reason that file now says *never report CI status
from this file, ask GitHub*:

1. **The branch was red for about twenty commits while `CLAUDE.md` claimed green**, and a session
   read the claim and repeated it. Nine live defects were sitting behind it — among them
   `allocate_payment()` selecting a column that does not exist, so **every payment recorded without
   explicit allocations had failed since `0213`**, and seven tables whose policies had no GRANT,
   which Postgres refuses before RLS is consulted.
2. **The 18-folder documentation audit** (10–12 Oct) walked all 119 documents and scored every
   folder. Seventeen scored Good (73–88%); folder 12 Communication scored Fair (65%), honestly,
   since no message has ever left this machine. **The dominant finding in eleven of eighteen folders
   was not bugs — it was work that was finished, correct, tested and unreachable**, with one link
   missing in the middle of the chain where `npm run gaps` could not see it.

`main` was brought level with `integration` on 12 Oct as PR #2 — 262 commits, the whole of Phase 4
plus the audit.

---

## 2026-09-27 — The Teacher Hub: the first owner-scoped tables, and a product whose core is honestly absent

Branch `feature/phase-4-design-foundation`. Migration `0130`, `packages/ai`, five API routes, five screens, and
`teacher_hub_test.sql` — **23 assertions, all passing**, taking the suite total to **22 suites / 531 assertions**.
`npm run ci:checks` is green end to end. This was the last unbuilt product surface.

### Every existing policy denies for this user, and that is the foundation rather than a problem

All 32 `public` tables built so far are school-scoped: they carry `school_id` and their policies filter through
`current_school_uuid()`, which reads the Clerk organisation claim. **75 of the 150 policies depend on that one
function.** A standalone `platform:teacher` has no organisation at all, so `current_school_uuid()` is NULL for them and
every one of those policies fails to match.

That is exactly the property the product needs — no school data can leak into the Hub by construction — but it
also means none of the established tenancy machinery applies. These three tables filter on `public.get_user_id()`, the
Clerk `sub` claim, and **the unit of isolation is a person, not a school.** The suite asserts the NULL case directly
(`a standalone teacher reads no pupils`) rather than assuming it, because it is the whole basis of the design.

The consequence that inverts every other table here:

> **A school cannot read its own teacher's lesson plans.**

`teaching_resources.school_id` is *provenance only* — where a resource was made — and deliberately not an access
path. Business rule 2 says plans belong to the teacher and survive their leaving a school, which is only true if the
school never had access in the first place. The headline assertion is that the **principal of the school a plan was
created at reads none of it**. On any other table that principal sees everything carrying their `school_id`.

### The documented DDL contradicted the documented business rules, twice

Found by implementing against it, which is the only way this ever gets found:

- **`standalone_teacher_accounts.linked_school_id` was a single UUID**, while business rule 4 in the *same document*
  says a teacher may be linked to several schools. One column cannot hold two schools. `my_schools()` (`0117`) already
  answers "which schools is this user in", self-scoped on `get_user_id()`, for any number of them — so the column is
  **omitted rather than faked**, the same call `0124` made about the module-subscription step. A second source of truth
  that can disagree with Clerk is worse than none.
- **`trial_plans_limit INT DEFAULT 5`** put a product decision in a column default, and K300/K3,000 lived in prose.
  Prohibition: never hardcode a price or a limit. `afritech.teacher_hub_plans` holds all three — and the trial *is* a
  plan, priced zero with a lifetime cap, which is what it actually is. The allowance resolves **account override →
  plan**, the same order and the same NULL-means-unlimited convention as `school_student_limit()`.

Also: the doc specifies a `lesson_plans` table and three generators. Lesson plans, quizzes and homework take the same
inputs and produce the same shape, so three tables would triple the policy surface for no behavioural difference, and one
table called `lesson_plans` holding quizzes is a name that lies. One `teaching_resources` with `resource_kind`; nine docs
updated rather than left describing something that does not exist.

`0058` and `0060` were the planned numbers for these tables. **Both are in the void range**, so they could never have
applied.

### Column-level grants, which is the whole defence of the meter

`trial_resources_used` decides whether a teacher gets the product free. A plain `GRANT UPDATE` on their own row —
which is what every other self-service table here has — would let them set it back to zero and take the trial
forever.

So the grants are **column-level**: the teacher may write `full_name`, `phone_e164`, `country_code`, `curriculum_types`,
`subjects` and `grade_levels`, and holds no privilege at all on `subscription_status`, `plan_code`, or either counter.
The same for INSERT, so self-registration cannot supply a status. It is a rarely-reached-for Postgres feature and it is
exactly the right tool: the restriction is precise rather than blanket, and `has_column_privilege` makes it assertable.

Three more things the suite pins, each a way the product could have been given away:

- **The check and the increment are in one row lock.** `create_teaching_resource()` re-resolves entitlement *inside*
  `SELECT … FOR UPDATE` and increments in the same statement. Checking first and then inserting leaves a gap where two
  simultaneous requests both see four-of-five used and both proceed. The cost is that a teacher who double-submits their
  last resource has one generation discarded after the fact — the right way round.
- **Nobody activates their own subscription.** Payment is manual, so a teacher-callable activation would make the paid
  product free to anyone who found the endpoint. `teacher_hub_activate_subscription()` raises `42501` for anybody who is
  not AfriTech, and the account screen shows payment instructions rather than a button that cannot take money.
- **Five free resources, ever.** Subscribing does not reset the counter, so subscribe-then-cancel is not an infinite
  supply. Asserted explicitly, because the natural implementation of "activate a subscription" resets the trial.

### The part that is honestly missing

The Hub's documented core is AI lesson planning using RAG over a Zambian curriculum knowledge base. **Neither half
exists.** No Anthropic SDK, no `ANTHROPIC_API_KEY`, and no syllabus content has ever been ingested —
`supabase/functions/` is still empty and there is no `knowledge_base` table. Neither gap closes by writing more
TypeScript.

So this took the Phase 3 communications decision: build the whole flow against a provider seam with a working stand-in,
so entitlement metering, saving, the library and print are all real and exercised, and the model is one adapter.
`packages/ai` is that seam, and nothing outside it imports a model SDK — ADR-032's rule applied to a third
dependency, after Clerk and BullMQ.

Two choices worth recording:

- **It does not pretend.** `modelGenerated: false` travels with every result, every row stores
  `generator_name`/`generator_version`, and the screens say in words that this is a structured plan rather than an
  AI-written one. A teacher paying K300 for AI lesson planning and handed an unlabelled template has been misled, which
  is worse than an empty state. The label disappears on its own when `isModelBacked()` becomes true.
- **`resolveGenerator()` reads `AI_GENERATOR` and deliberately ignores `ANTHROPIC_API_KEY`.** A key appearing in an
  environment is not the same as a knowledge base being ingested and a prompt being reviewed. A generator that switches
  itself on when a variable appears is how an untested path reaches a paying teacher.

The scaffold does real work rather than emitting filler: `distribute()` splits the lesson duration across phase weights
so the parts are whole minutes **summing to exactly the requested length**. Rounding each weight independently does not
— four phases of a 40-minute lesson easily come to 39 or 41 — and a plan whose phases do not add up to its own
duration is the first thing a head of department notices.

### Two small things worth not relearning

- **`.js` extensions in relative imports type-check and then fail the build.** `tsc` resolves
  `./providers/template.js` to the `.ts` file; webpack does not, and the error surfaces as `Module not found` pointing at
  a route rather than at the package. Every sibling package omits the extension. Matched them.
- **`noUncheckedIndexedAccess` makes a `Record<string, T>` lookup `T | undefined` — including the fallback.**
  `PHASE_WEIGHTS[type] ?? PHASE_WEIGHTS.core` does not help, because `.core` is also widened. `as const satisfies
  Record<LessonType, …>` makes the lookup total and needs no guard.

### What the Hub deliberately does not have

Community Library, PDF/Word export, and an invitation-code box. The first is Phase 3 in its own spec, and there is
**no broad SELECT policy on `teaching_resources`** by design: admitting `is_shared = TRUE` rows to other teachers would
expose `created_by`, when the documented design says a shared plan shows a first name and a subject and never an
identity. When it is built it gets a SECURITY DEFINER function returning the non-identifying columns. Export is browser
print; wiring `packages/documents` is a job of its own. And there is no code to redeem — ZSMS invites staff
server-side through the Backend API — so the dashboard says to ask the school to invite you rather than offering a
box that cannot work.

---

## 2026-09-27 — CI exists, and its first complete run found three defects including a live broken route

Branch `feature/phase-4-design-foundation`, pushed to `integration`. **Both CI jobs green** (run `36305510617`): `Types, lint, build` 2m58s, `Migrations and RLS suites` 4m31s. This closes Layer 7, which `THIRTEEN_LAYER_COMPLIANCE.md` has listed as **Thin** since the repository was created.

### `supabase db reset` ran the whole sequence against an empty database for the first time

All 82 migrations had only ever been applied *incrementally* to `zsms-dev`. The full replay from nothing had never once been done, which meant a migration silently depending on dev's existing data would have been discovered during the staging cutover — the worst possible place. It replayed clean. That is the single most useful thing CI has told us, and it de-risks staging directly.

### What it found, and why the shape of all three is the same mistake

**1. `0114` had broken `/api/announcements`, in live application code, since the day it was applied.** It added `target_audience` and `target_scope` as NOT NULL with no default, and derived `target_type` *from* them. Every caller that inserted `target_type` — the only way to do it before — now failed a not-null violation. Two pgTAP suites written before `0114` failed and told me; the route had no test and would have failed for a user.

The fix in `0129` makes the derivation **bidirectional** rather than editing the callers. Editing the two suites to supply the new columns would have turned CI green and left the route broken — the tests were right and the schema change was wrong, and it would have been very easy to conclude the reverse, because the tests were what was visibly failing.

**2 and 3. Two DELETE grants against invariants this repository already asserts.** `tenant_isolation_test` asserts no DELETE exists anywhere in `public` for end-user roles; `communications_test` asserts the same for `afritech` configuration. I granted DELETE in `0110` (`student_custom_values`) and again in `0128` (`tier_student_price_bands`). Both operations are legitimate; both are now named `SECURITY DEFINER` functions instead.

**The common root cause, stated plainly: reasoning about one migration in isolation without re-running the suites that already covered the ground it touched.** `npm run db:test:plans` counts `plan(N)` against the assertion count *without executing anything*, so a suite that errors on its first line still passes the plan check. Only a real database running every suite finds this class of problem, and this machine has no Docker. **Push before assuming a migration is safe** is now the rule, and it is written into CLAUDE.md.

### `npm run lint` had never linted anything

The script was `next lint` with no config present, which **prompts interactively** for one. Under turbo that surfaced as an opaque non-zero exit, and in CI it would have hung on a question nobody could answer. A lint script that has never run is worse than none, because it implies coverage that does not exist.

`eslint-config-next` could not be used: npm hoists it to the repository root while `next` stays in `apps/web/node_modules`, so it cannot resolve its own parser. The plugins are wired directly in `apps/web/eslint.config.mjs`, with rules chosen rather than defaulted — the bar for `error` is *would a human reviewer stop a pull request over it*. It immediately found nine dead imports.

### The first run failed on something that looked nothing like its cause

A malformed Clerk publishable key. `pk_test_placeholder` is not base64-decodable, and Clerk parses its domain out of the key while *compiling the middleware*, so the build failed with no mention of Clerk in the error. It passes locally only because `.env.local` holds a real key. Ruled out first, in order: a dirty tree, a gitignored file, import casing across all 632 relative imports (Linux is case-sensitive, Windows is not), and a missing `globalEnv` in `turbo.json`. The fix was a syntactically valid placeholder.

Also removed: `-x` service exclusions I had invented for `supabase start`. The service names are version-specific and one wrong name fails `start` outright.

### Reading CI without guessing

`gh` is installed and authenticated as `afritech-systems`, but not on PATH in a Git Bash session — it is at `"/c/Program Files/GitHub CLI/gh.exe"`. Before that, every annotation had to be pasted by hand and diagnosed by inference, which is how the Clerk key took three rounds.

### Carried forward

`integration` now holds ~61 commits that have never been through `main`, all of them green. That wants a single pull request so `main` is gated as a unit — a release decision, not an engineering one.

---

## 2026-09-26 — Phase 4 completion: results, custom fields, announcements, parent portal, networks, billing

Branch `feature/phase-4-design-foundation`. Migrations `0106`–`0128`, ten new pgTAP suites (**21 suites, 508 assertions**), and the portals that were missing. Recorded compactly here because CI's arrival is the more consequential event of the two sessions; each migration header carries the full reasoning.

**ADR-041 closed — `0106`–`0108`.** A grade letter was stored without the scale that produced it, so a mid-year scale revision made every historical grade unexplainable. `exam_results` now carries `grading_scale_version_id`; `revise_grading_scale()` creates a new version rather than editing bands in place, and two AFTER triggers freeze a version once it has been used. The guard is phrased as *"must agree with the current version"* rather than as a flag, because `ALTER TABLE ... DISABLE TRIGGER` needs table ownership and a flag would have been bypassable. `0106` backfilled existing scales and left **new** ones versionless — found by probing rather than by reasoning, fixed in `0107`.

**One real bug, fixed in `0109`.** The teacher-scope check compared academic years wrongly, so *nobody could enter marks at all*. Both `teacher_reaches_class()` and `teacher_teaches_subject()` were affected.

**Configurable pupil fields with bulk import — `0110`–`0112`.** `school_custom_fields` + `student_custom_values`, with `sensitivity` driving RLS so a medical note stays with the owner and principal. `import_students()` is atomic. `next_student_sequence()` uses **MAX, not COUNT**: I had claimed the old code reused identifiers after a soft delete and **I was wrong** — there is no `is_deleted` filter — but the real defect was worse, a permanent collision once numbering has any gap at all.

**Announcement audience — `0113`–`0116`.** Split into `target_audience` × `target_scope` with `target_type` as a trigger-derived mirror, so individual recipients work regardless of role and grade→class filters cascade. This is the change that broke a live route; see the `0129` entry above.

**School Networks — `0119`–`0123`.** Named by the user, deliberately not "groups". Schools attach one at a time; permissions are **rows in `school_network_roles`, not code**. `network_school_summary()` does five grouped scans regardless of network size, built for the stated 100-school case. Two lessons: `is_afritech_admin()` returned **NULL, not FALSE**, so my attach guard silently skipped for network members — unexploitable only by accident, and caught only because the assertion pinned `42501` and saw `P0002`. And the two-gate trap, hit twice (`0122`, `0128`): a `SECURITY INVOKER` function or a `security_invoker` view runs as the caller and needs *table privileges as well as* a policy.

**Per-student pricing and invoicing — `0124`–`0128`.** Priced per pupil at an admin-set rate via `afritech.tier_student_price_bands`, with an overlap-rejection trigger. Each school is invoiced separately, with a consolidated network view. `school_subscription_charge()` returns **NULL and a reason** rather than zero, because zero is a real price and "unknown" must not look like "free". Invoices freeze tier, count, unit price and tax rate — the same *a derived value must carry its basis* rule as ADR-041. `0125` dropped the hardcoded `tier_name` CHECKs for a foreign key: tiers are data. Manual payment recording per the user's decision, with gateway idempotency already in place (`idx_invoice_payments_gateway_ref`).

**Also:** the parent portal across multiple schools and children (`0117`, `0118`); and `route.ts` may only export handlers — an illegal `resolveFeeCaller` export **built successfully**, and only `tsc` against the generated `.next/types` caught it. It now lives in `lib/fee-context.ts`.

---

## 2026-08-23 — All seven suites run; three defects in the tests themselves

Branch `feature/phase-4-design-foundation`. **307 assertions, all passing.** Docker is still not installed, so each suite was mechanically rewritten to collect its TAP lines into a temp table and run through the MCP as a single transaction. Three real defects surfaced — none of them regressions from `0103` or `0105`, and all three in the test apparatus rather than the product.

### The plan checker was under-counting, in the file it was written for

`scripts/check-test-plans.mjs` exists because `fees_attendance_results_test.sql` was once committed with 44 assertions under `plan(45)` and reported as passing. It has been reporting that same file clean ever since — while the file carried **45 assertions under `plan(44)`**.

`matches` was missing from the checker's assertion list. It appears exactly once in the whole suite directory, in that file. So the count came out one short, matched the wrong plan, and the script that exists to catch precisely this said ✓.

An under-counting checker is worse than no checker, because it is trusted. Added `matches`, `imatches`, `alike`, `ialike`, `cmp_ok`, and corrected the plan to 45.

### An assertion describing a design that had been superseded

`communications_test.sql` asserted *"afritech.subscription_tiers is unreachable by any end-user role"*. That was true when written — `0082` revoked everything. Then `0095`/`0097`/`0098` deliberately granted `authenticated` SELECT/INSERT/UPDATE on all four `afritech` tables so the admin dashboard could reach them through `public` views, with RLS deciding who may actually read or write. `0095`'s own words: *"Privileges are the outer gate; RLS is the decision."*

So the assertion had to fail; it was describing a model the product had moved past. Deleting it would have discarded the part that still matters, so it became three:

- `anon` holds no privilege on any `afritech` table — pricing is never public.
- `authenticated` can never DELETE or TRUNCATE `afritech` configuration.
- Every `afritech` table has RLS **enabled and forced** — an outer gate is only safe if the inner one is armed.

The third is the one never to weaken. Granting table privileges and relying on RLS is a sound pattern exactly as long as somebody keeps checking that RLS is actually on.

### Three assertions that were only true on an empty database

`count(*)` over a whole table is a fine assertion under `pg_prove` against a fresh local instance and a wrong one against `zsms-dev`, where the seed adds six schools and 252 pupils. "Super admin sees both schools" wanted 2 and got 8; "a platform-wide reminder run sees both schools" wanted 2 and got 17.

Both were **passing tests failing for reasons unrelated to what they test**, which is corrosive: a suite that cries wolf is a suite people stop reading. Scoped to their fixture ids, which preserves the thing being proved — the super admin crosses a boundary every other role cannot — while making the result independent of whatever else is in the database. Verified: 17 unscoped, 2 scoped.

### What running them actually confirmed about 0103 and 0105

The reason for the exercise. `0105` rewrote `get_user_role()`, which every policy in every suite depends on, and `0103` changed when the ceiling trigger fires relative to the RLS `WITH CHECK`. Both could have broken everything quietly.

Neither did. Qualified claims (`org:owner`) pass through `0105` untouched, which is what all six older suites use; `0103`'s AFTER trigger leaves suite-shaped inserts alone because those schools sit far below their ceiling. 72/72 tenant isolation, 45/45 fees-attendance-results, 38/38 fee arrears, 47/47 communications, 26/26 worker boundary, 38/38 school branding, 41/41 student ceiling.

### Role enforcement, against the claim form Clerk actually sends

Separately, the full role matrix was exercised against the **bare** `o.rol` form — nine claims including Clerk's built-in `member`:

| | enrol | edit pupil | mark register | read fees | read staff |
|---|---|---|---|---|---|
| owner / principal / admin | ✅ | ✅ | ✅ | ✅ | ✅ |
| accountant | ❌ | ❌ | ❌ | ✅ | ❌ |
| teacher | ❌ | ❌ | scope only | ❌ | ❌ |
| staff / parent / student / member | ❌ | ❌ | ❌ | ❌ | ❌ |

Every figure matches `lib/roles.ts`, so the nav-gating map and the policies agree.

**Two of my three attempts at that matrix returned false results before the third was right**, and the reason is worth keeping. The first deleted its test row afterwards — `students` has no DELETE privilege, so the same `42501` was caught for every role and every one read "refused". The second used `INSERT … SELECT` from a table a parent sees zero rows in, so it inserted nothing, raised nothing, and reported **ALLOWED** for parent and student.

A test that measures *"did it throw"* rather than *"did it write a row"* passes for the worst possible reason. Both harnesses looked correct and both were lying in the dangerous direction.

---

## 2026-08-23 — School portal, groups 0 and 2: a trigger that spoke before the policy

Branch `feature/phase-4-design-foundation`. **Migration `0103` applied. New adversarial suite: 41 assertions, all passing.** First school-portal screens exist: the shell, the dashboard, and the pupil roll.

### The suite found a cross-tenant disclosure in code written the same day

`0101` attached the ceiling guard as a **BEFORE** ROW trigger, which is the obvious choice and the wrong one. In PostgreSQL a BEFORE ROW trigger runs *ahead of* the RLS `WITH CHECK`. So the ceiling was evaluated before anything had established that the caller could write into that school at all:

```
School B owner → INSERT INTO students (school_id = School A)
→ ZS001: "This school has reached its plan limit of 3 enrolled pupils."
```

Three facts about another tenant, to a caller entitled to none of them: that School A exists, that it is full, and the exact ceiling AfriTech has configured for it. A school's enrolment and its commercial limits are precisely what the tenant boundary exists to keep apart. The correct answer was `42501` — "not permitted", and nothing else.

The same ordering produced a lesser wrong answer *inside* a school: an accountant, who may read the roll but not enrol, was told the school was full rather than that enrolment is not theirs to do. Not a disclosure, but it sends someone to buy a tier upgrade to solve a permissions problem.

`0103` moves the trigger to **AFTER**, which puts the order back: BEFORE triggers → constraints and RLS `WITH CHECK` → the row lands → AFTER triggers. Enforcement is unchanged; an exception in an AFTER trigger aborts the statement just as one in a BEFORE trigger does. The one consequence to get right is that the new row is already counted at AFTER time, so the comparison moves from `>=` to `>` — an off-by-one that is silent in both directions.

**The general rule this stands for, now in `CLAUDE.md`: any trigger that raises a message describing tenant state must be AFTER.** Otherwise it speaks before the policy has decided whether the caller is entitled to hear it.

Worth being plain about how this was found. It was not found by reading the migration, which I had written and reviewed hours earlier, and not by the migration's own verification block. It was found because the suite asserted a *specific SQLSTATE* for a cross-tenant attempt rather than merely asserting that it failed. `throws_ok(..., '42501')` and `throws_ok(..., 'ZS001')` both pass a test that only checks "an error happened".

### And a test that proved nothing

The first draft asserted that undoing a soft delete at a full school is refused — against a pupil who had only been *withdrawn*, and was never soft-deleted. The UPDATE matched a row whose `is_deleted` was already false: a no-op, no exception, and pgTAP correctly reported "caught: no exception". The fixture now soft-deletes an on-roll pupil, has the freed place taken, and only then attempts the restore.

Both escape routes are now covered separately, because they are separate columns: `status` withdrawn→active, and `is_deleted` true→false. A ceiling that watches only one is escapable through the other.

### Group 0 — the shell

`/school/[schoolCode]/…`, where the segment is the lowercase school code — the same string Clerk uses as the organisation slug and the same one `school_branding_by_slug()` takes. One identifier, three consumers, no mapping table.

The segment is **not** what scopes the data; the JWT's `o.id` claim is, through `current_school_uuid()` in every policy. So the segment can only agree or disagree with the session, and `requireSchoolSession()` makes a disagreement a **404**. Not 403: answering "forbidden" for `/school/zm-ndl-0002/students` would confirm that `ZM-NDL-0002` is a school on this platform. Not-found is what a typo gets, and it discloses nothing.

Three things this shell does that the admin shell does not:

- **It is themed.** ADR-043 excludes the admin surface from per-school branding so an operator always knows whose system they are in; here the opposite is right. Resolved on the server and emitted as CSS variables in the first response — no client fetch, no flash of ZSMS blue, no JavaScript needed to render a school's colours. That matters more here: an accountant opening the fee list on a phone over a slow connection is the normal case, not the edge one.
- **The nav is filtered by role, not disabled by it.** A greyed-out "Fees" tab tells a teacher there is a fees section and they are not trusted with it. Omitting it tells them nothing, which is the correct amount. `lib/roles.ts` holds the map, and every entry names the policy it is transcribed from so the two cannot drift silently.
- **Impersonation gets a permanent band**, above the header so it survives scrolling to the top of any screen. Every action an operator takes while signed in as a school user is attributed to that user; the banner is what stands between "I looked" and "I changed something while looking".

`lib/roles.ts` deliberately omits `has_permission_grant()`. Several policies admit it as an alternative to the role check — the custom-role system on the `org:staff` base — but grants are per-user rows, not a property of a JWT claim. A custom-role holder therefore sees the conservative nav and still succeeds at whatever their grants allow. Widening it needs the grant list per session; it is not guesswork this file should do.

### Group 2 — the pupil roll, and where the ceiling shows up

Nothing on these screens contains a pupil limit. The banner's number, the disabled button's explanation, and the number the database enforces are one value, resolved by `school_student_capacity()` and carried in the list response's **`meta`** rather than fetched separately. That placement is the point: a screen that fetched the roll and the ceiling from two endpoints would render "142 pupils" and "of 140" from two different instants, and the disagreement would appear exactly when a school is at the boundary and someone is watching.

The enrolment form checks the ceiling and the trigger checks it again, and the second check is the real one. The case that matters is two registrars taking the last place at once: one submits a form that passed the client check and is refused by the trigger, which returns `CONFLICT` carrying the resolved ceiling in its message. The form renders it and **clears nothing** — a full pupil record retyped because the roll filled up mid-typing is the specific failure `DESIGN_SYSTEM.md` names.

Two smaller decisions worth recording:

- **Grades come from `/api/school/structure`, never a constant.** Zambia runs two education systems at once — traditional ECZ Grades 1–12 and the 2023 reform's Grades 1–6 then Forms 1–6 — and most private schools are mid-transition. A hardcoded list would have offered a Kitwe secondary school twelve options none of which were right. The seed proves it: `ZM-CBE-9001` has Form 1–6 and no grades at all.
- **There is no delete, and the button says so.** The pupil screen offers "remove from the roll" — a status change that frees a place and keeps the record, the fee history, the attendance, and the results. "Delete" would be a promise the database refuses to keep: there is no DELETE policy and no DELETE privilege on `students` for any role, the owner included.

### Also

- `/api/school/*` refuses an AfriTech operator outright. Their policies match *every* school, so `.maybeSingle()` on `schools` raises "multiple rows" — which would have surfaced as an unexplained 500 for a request that is simply addressed to the wrong surface. `resolveSchoolContext()` had the same latent problem and now uses `.limit(2)`, treating "more than one" as "no school", which is the truthful answer for a platform account.
- `P0002` (`no_data_found`, raised by the `admin_*` functions when a row is already in the target state) now maps to `NOT_FOUND` with a reload-and-retry message instead of falling through to "an unexpected error occurred".

### Not yet verified, and why

**No portal screen has been seen rendering real data.** Every seeded school's `clerk_org_id` is a placeholder (`org_test_d`), so no Clerk session can resolve to one — which means the guards are what I could exercise, and I did: an AfriTech session gets 404 on `/school/zm-lsk-9001`, `FORBIDDEN` on `/api/school/overview`, and a redirect to `/admin` from `/school`. All correct, and all the *negative* path.

Rendering the dashboard and the roll needs a real Clerk organisation whose slug is a seeded school code, with a member on it. That is a two-minute action in the Clerk dashboard and it is not mine to take.

---

## 2026-08-23 — Student ceilings: configuration that described a rule nothing applied

Branch `feature/phase-4-design-foundation`. **Migrations `0101` and `0102` applied.** Admin dashboard signed off; this closes the two items raised at that gate before the school portal starts.

### The column existed. Everything around it did not.

`afritech.subscription_tiers.student_limit` has been there since `0082`, and the pricing screen has been editing it since Phase 4 began. That made it look finished. Implementing against it found three separate gaps:

1. **Nothing enforced it.** `whatsapp_quota` has `consume_message_quota()`. `student_limit` had no equivalent — no trigger, no function, no route. It was a number in a table describing a rule the product did not apply. A school on Starter could have enrolled its ten-thousandth pupil.
2. **There was no per-school exception.** Every other commercial value can be varied for one school through `school_feature_overrides` — a tier, a trial, a single feature. A ceiling could not be, so letting one school run thirty pupils over meant raising the ceiling for every school on that tier.
3. **The seeded figures disagreed with both documents.** `PRICING.md` and `DYNAMIC_CONFIG.md` both say 200 / 500 / 1,000 / unlimited. The database said 150 / 500 / **unlimited** / unlimited. This was already a tracked open row, deliberately left alone by `0100` on the grounds that a price is inert until invoicing while a ceiling decides whether a school can enrol its next pupil. That reasoning is exactly why it could not stay open once the ceiling became enforced.

### `0101` — resolve, then enforce

`school_student_limit()` mirrors `school_has_feature()`, deliberately: the same discipline of a fixed order in one function rather than assembled per caller. The order is **student_limit_override → tier_override → tier**. There is no revoke direction, because a ceiling is a number rather than a boolean — an override that lowers it just gives a lower number.

Two decisions in the signature are worth recording:

- **`is_unlimited` is its own column, not an implied NULL.** NULL in `student_limit` means unlimited, but NULL out of a function also reads as "no answer". A caller that ignored the flag and read only the number would see NULL, and if it treated that as zero it would block everything — the wrong direction to fail by accident.
- **A school that does not exist resolves to `0`, not to unlimited.** A missing school must never read as permission to enrol into it.

`school_student_capacity()` adds the current roll in the same call, because every consumer needs both halves and the **counting rule** is the part that must not be reimplemented three times. What counts is pupils on the roll — `status IN ('active','on_leave')`, not soft-deleted. Transferred, graduated, and withdrawn do not, and that is a commercial decision rather than a technicality: counting them would make every school's usage rise monotonically forever, so a school would eventually be billed a tier upgrade for pupils who left years ago. `on_leave` does count; the place is still occupied.

The guard is a trigger, not a check in the students route, for the same reason tenant isolation is in the database: **there is more than one writer.** The API route is one, the CSV import job is another, a support operator with the service role is a third. It fires on INSERT *and* on the UPDATE that puts a pupil back on the roll — undoing a soft delete, or moving `withdrawn` back to `active`. A ceiling that only watches INSERT is one you get around by withdrawing a pupil and re-activating them. An edit to an already-enrolled pupil's name is never blocked, which took an explicit `OLD` check to get right.

`ERRCODE 'ZS001'` rather than a generic raise: the API has to tell this apart from a constraint violation to render the upgrade message, and matching on the text of an error message is not a contract. It maps to `CONFLICT`, not `FORBIDDEN` — the caller has every right to enrol students, and nothing about their permissions would change the outcome.

Verified against the live schema inside a transaction rolled back by a closing `RAISE`: a ceiling equal to the roll refuses with `ZS001`; `'unlimited'` admits; withdraw-then-reactivate is allowed at 11/12 and refused at 11/11; a non-numeric override value is refused by the CHECK; no rows survived.

### The seed realignment is guarded, and that guard matters

Each tier is updated **only if it still holds exactly what `0082` wrote**. Starter 150 → 200 is a loosening. Professional unlimited → 1,000 is a **tightening**, and silently capping a tier an operator had deliberately uncapped is the one direction of this change that could stop a real school enrolling. A no-op UPDATE was also avoided for Growth and Enterprise: it would still bump `updated_at` and `updated_by`, making it look as though a decision had been taken that was not.

### `0102` — and a second ceiling that had been lying for months

The list screens want the resolved ceiling for every school on the page. One RPC per row is the same N+1 already tracked against `/api/admin/schools/[id]`, so `school_capacity` is a `security_invoker` view doing `LATERAL` over the function — one query, one definition of both the order and the counting rule.

Building it surfaced **`schools.max_students`**. It has existed since `0003` as a per-school copy of the tier ceiling. Nothing has ever read it to make a decision — no trigger, no function, no route. But it was *displayed as the cap* on the schools list and the school detail page, and `PATCH /api/admin/schools/[id]` accepted writes to it. An operator editing that field believed they had changed a limit. That is worse than a dead column: it is a control that does nothing, sitting where a real one belongs, with no reason, actor, or expiry attached to it.

It is now deprecated by comment, removed from both screens and from the PATCH schema, and left in the table. Dropping a column is destructive and irreversible, and the seeded values are the only record of what onboarding intended — that is a separate, approved migration.

### Someone reverted Professional while the build was running

Fifteen minutes after `0101` applied, `subscription_tiers.professional.student_limit` went back to NULL, stamped with a real Clerk user id. The cause is benign and instructive: a pricing screen loaded *before* the migration still had "No limit" ticked for Professional, and saving that form sent the unlimited sentinel. The tier form renders every field, so a stale tab silently reverts a value changed elsewhere — `admin_update_tier`'s NULL-means-unchanged design avoids read-modify-write for the other fields, but a checkbox has no "unchanged" state to send.

Restored to 1,000. Not a blocker for a single-operator admin panel and not worth optimistic concurrency today, but it is the mechanism by which a price or a ceiling can be undone by a tab nobody remembers leaving open.

### Also

- `P0002` (`no_data_found`, raised by the `admin_*` functions when a row is already in the target state) mapped to `NOT_FOUND` with a reload-and-retry message. It was falling through to "An unexpected error occurred", which sends an operator looking for a bug behind a screen that is merely stale.
- The override list now shows `override_value`, and only a revoke is red and only a grant is green. Colouring a *lowered* ceiling green would read as a favour.
- The new ceiling field is a number input with a "No limit" checkbox in the field's `footer`, per the form standard — and warns, before saving, when the ceiling is below the current roll. It does not refuse: capping a school at what it already has is legitimate, and the trigger blocks only the *next* enrolment. But it changes what the operator is agreeing to.
- Round-tripped in the browser under a real signed-in session: `POST /api/admin/overrides` 201, the row rendered with its value, and the hint on the same form immediately re-read "Currently 260 from the existing override; 40 enrolled" — the resolver, not the form's own state.

---


## 2026-08-18 — Form layout standard, and four defects only a browser could find

Branch `feature/phase-4-design-foundation`. **Migration `0100` applied. Every admin screen reviewed in a real browser against real data for the first time.**

### The alignment bug had one cause, not many

The pricing form's fields stair-stepped across each row. The instinct is to reach for per-field padding; the actual cause was structural and one line deep:

`Field` rendered **label → hint → control**. A hint is one line for one field and two for its neighbour, so two controls in the same grid row started at different heights. Nothing above a control may vary in height if controls are to align — so the order is now **label → control → hint → error**, and everything above the control is fixed. No subgrid, no measuring, no breakpoint overrides.

Pricing compounded it by building **three grids** — `sm:grid-cols-3` above `sm:grid-cols-2` — which cannot align by construction, because they do not share column tracks. One grid fixed it.

Extracted into `components/ui/form.tsx` (`FormGrid`, `FormSection`, `FormActions`, `CheckboxField`) and documented in `DESIGN_SYSTEM.md` → *Form Layout*, so the next portal inherits aligned forms rather than re-deriving them. One `controlClasses` constant now defines every control's height, padding, and focus state; `Input` and `Select` had already drifted apart.

### The stray "N" was Next's, not ours

The floating avatar bleeding into the left margin was Next's **dev-tools indicator**, whose `devIndicators.position` defaults to `bottom-left`. Injected by the dev server, never shipped. Moved to `bottom-right` rather than disabled — it reports route type and compile state, which are worth keeping.

### `0100` — the price list had no prices

Every tier rendered "K 0/month" with empty inputs. Not a display bug: `monthly_price_zmw`, `monthly_price_usd`, and `annual_price_zmw` were **NULL for all four tiers**, and had been since `0082`, whose seed simply omitted the price columns:

```sql
INSERT INTO afritech.subscription_tiers
  (tier_name, display_name, whatsapp_quota, student_limit, display_order)
```

It survived because nothing read a price until this screen existed. ADR-031 makes the database the price list, and the public pricing page reads these same rows — it would have advertised four free tiers.

`0100` backfills PRICING.md's figures verbatim (Starter K600/$22/K6,480 through Enterprise K3,000/$109/K32,400), fills only where NULL so a super admin's own edit is never overwritten, and sets the three columns **NOT NULL** as PRICING.md's DDL always specified. The gap is now unrepresentable.

**Deliberately not corrected:** PRICING.md and the seed also disagree on two *ceilings* — Starter 200 students vs 150 seeded, Professional 1,000 vs NULL (unlimited). A price is inert until someone is invoiced; a ceiling is enforced, so changing one decides whether a real school can enrol its next pupil. That is a commercial question, not a migration. Tracked in `CLAUDE.md`.

`formatKwacha` also had to be split. It renders absent as `K 0`, which is right for a sum — no payments really is zero — and wrong for a price, where it claims the tier is free. `formatPrice` renders "Not set".

### Saving one tier blanked all four

`reload()` set `loading`, and every screen gated its content on `!loading`, so a refetch discarded what was already on screen. Fixed across all six admin screens: the skeleton now appears only when there is nothing to show yet, and data stays visible while a refetch is in flight.

### `PGRST303 JWT not yet valid`

Intermittent 500s on `/api/admin/tiers`. The Clerk token's `nbf` is fractionally ahead of the database server's clock — Clerk mints, Supabase validates, and a sub-second skew between two third-party clocks is enough. Neither is ours to correct, and it is genuinely transient: the same token succeeds moments later.

It was falling through to `SERVER_ERROR`, which renders as "an unexpected error occurred" with no retry — sending an operator to hunt a fault that has already passed. Now mapped to `CONFLICT` with an accurate message, so the existing "Try again" resolves it.

### Verified in the browser, and what still is not

Signed in as an AfriTech admin at 1358px: overview, schools, school detail, health, features, and pricing all render against seed data. **`PATCH /api/admin/tiers` returned 200 — the authenticated write path is now proven end to end**, which the last gate could only assert. The resolver shows through on the school page: `ZM-LSK-9001` reads *Available* for `per_absence_alerts` on a Growth tier.

**Narrow width was measured, not seen.** Chrome's window is maximised so it ignores `resize_window`, and popups are blocked, so no 375px screenshot was possible. What was measured is the min-content width of every region — `main` collapses to **233px** and each form to **121–143px**, both comfortably inside 375px. The one region over budget was the header, at 237px for the theme toggle alone, leaving the product name ~90px on a phone; its labels are now icon-only below `sm`. A visual check at 375px still needs an unmaximised window.

---

## 2026-08-18 — Admin dashboard: auth was never wired, and the build said so

Branch `feature/phase-4-design-foundation`. **The admin dashboard is complete and running against real seed data over real HTTP. Migration `0099` applied.** The session's headline is not a screen, though — it is that Clerk had never actually been mounted, and three separate layers had to be corrected before a single authenticated request was possible.

### `auth()` threw on every admin route, and had since Phase 0

`/api/admin/overview` answered `500`. The cause was not the route, the policy, or the Clerk configuration — all three were correct. There was **no `middleware.ts` in `apps/web` and no provider in the root layout.** Clerk's `auth()` does not read a cookie by itself; the middleware verifies the session and `auth()` reads what it left behind. With no middleware it does not return "signed out", it *throws*.

That failure mode is worth recording because of how it presents: a valid session, correct claims, correct RLS, and a 500 from every route that asks who the caller is. Nothing points at the missing file. It had been latent since Phase 0 — the auth package was interface-complete and never once executed in a request.

Fixed in `packages/auth-provider`, not in `apps/web`, so ADR-032's single-importer rule survives: `./middleware` exports `authMiddleware`, `./react` re-exports Clerk's client components under neutral names (`SessionProvider`, `SignedIn`), and `apps/web/middleware.ts` is a re-export. `500` → `403`.

### The JWT template was the wrong integration entirely

`getSupabaseToken()` requested `getToken({ template: 'supabase' })`. That is the **deprecated** path — a bespoke token signed with Supabase's legacy JWT secret. The project is configured the current way, with Clerk registered as a **third-party auth provider** and the ordinary session token verified against Clerk's JWKS.

Against a project configured the new way, the old call does not degrade — it fails, because no such template exists. Every route would have 403'd with a perfectly valid session, and the symptom points squarely at authorisation rather than at a two-year-old API change. Now returns the plain session token.

### Three infrastructure defects, each invisible to the one before it

- **`npm run dev` exited seconds after printing `Ready`.** `turbo.json` had `"ui": "tui"`, which needs a raw-mode-capable stdin and quits when it cannot get one, reporting `Tasks: 0 successful`. It had also been swallowing all task output under a pipe, which is why the real error was never visible. Now `"stream"`. Also worth knowing: turbo.json accepts JSONC comments but **rejects unknown keys**, so the `"//key"` convention this repo uses in `package.json` is a parse error there.
- **The root `.env.local` was never being read.** Next loads env from its own project directory — `apps/web` — because that is Turborepo's cwd. A root file is simply invisible, and the symptom is "Supabase URL not set", which reads as a missing variable rather than a misplaced file. `next.config.mjs` now loads it explicitly. Deliberately *not* solved by copying the file: two copies of a credentials file drift, and the stale one is always the copy nobody is looking at.
- **`config.matcher` cannot be an imported identifier.** Next resolves it by static analysis at build time. `next dev` accepted the imported version happily; `next build` rejected it. The literal now lives in `apps/web/middleware.ts` with the reason written next to it.

### `0099` — duplicate overrides, and why `ON CONFLICT DO NOTHING` lied

Verification against seed data turned up two identical *active* override rows per school, created 90 seconds apart — the seed had been run twice.

`dev_seed.sql` ends that INSERT with `ON CONFLICT DO NOTHING`. **With no unique constraint to conflict with, the clause is unreachable** — it inserts the duplicate while reading like a guard. That is the trap: the code looks defensive and is inert.

The consequence lands on the screen built this session. `school_has_feature()` resolves with `EXISTS`, so duplicates resolve identically — but the dashboard lists overrides individually and revokes them **by id**. An operator revoking the visible grant would watch access persist, and would reasonably conclude the resolver was broken. Uniqueness is what keeps "revoked" and "no longer in force" the same statement.

`0099` deactivates the duplicates (keeping the earliest, never deleting — the table is the audit record of a support decision) and adds a **partial** unique index on `is_active`, so a grant → revoke → grant history stays legal. `COALESCE` on the nullable key columns, because `NULL != NULL` in an index would let two active NULL-valued rows straight through the guard being added.

### What was verified, and what was not

Real HTTP against the running server: every admin route answers `403` signed out — not a crash, and not an empty `200` that would read as "the platform has no schools". `/admin` redirects to `/sign-in`. Production build passes.

The data layer was verified under a genuine AfriTech-admin JWT through RLS: 6 schools, 6 health rows, 13 features, 35 matrix cells, 4 tiers. The resolver demonstrably disagrees with the tier matrix in exactly the two seeded cases — `ZM-LSK-9001` holds `loan_module` its tier excludes, `ZM-KIT-9001` lacks `per_absence_alerts` its tier includes — which is the whole justification for resolving per-school rather than rendering the tier row.

**Not verified: an authenticated browser session.** Signing in needs a browser, so the authenticated render is the user's gate review. The 403s prove the boundary; they do not prove the happy path.

### Clerk organisation settings — decisions to revisit before school onboarding

Set on the Clerk instance this session, recorded here because they are invisible in the repository and each one becomes load-bearing the moment a real school is provisioned.

1. **Default membership limit must not stay at 5.** A Zambian private school has far more than five staff needing accounts; the limit applies to *members*, so it caps teachers and administrators, not parents. Either unlimited, or set per school at creation.
2. **"Allow user-created organisations" should be OFF in production.** Only ZSMS provisions school organisations. Left on, anyone signing up can mint an organisation that satisfies no naming convention, has no `schools` row behind it, and holds a slug the reserved-slug check never sees.
3. **"New members can delete organisations" — disabled.** Correct, and worth keeping: deleting the Clerk org orphans every `school_id` reference in the database with no corresponding delete, which is not a recoverable state.

**How do school orgs get their member limits set during onboarding? Today: they do not, and there is nothing to derive one from.** Two gaps, one in code and one in the product:

- `CLERK.md`'s onboarding snippet calls `createOrganization({ name, slug, createdBy })` with **no `maxAllowedMemberships`**, so every school would silently inherit the instance default. (The `school-onboard` Edge Function it describes does not exist yet — `supabase/functions/` is empty — so this is a gap to close before it is written, not a bug to fix.)
- Deriving the limit from the tier is the obvious answer and **is not currently possible**: `afritech.subscription_tiers` has `student_limit` and `whatsapp_quota`, and no staff-seat column at all. Pricing has never distinguished pupils from staff accounts.

So this needs a product decision before code: either staff seats are unlimited on every tier and onboarding passes `maxAllowedMemberships: 0`, or seats become a priced dimension and the tier table gains a column. Tracked in `CLAUDE.md`.

---

## 2026-08-17 — Admin sub-phase: the feature tables that were never there

Branch `feature/phase-4-design-foundation`. **Migrations `0095`–`0098` applied. `afritech` went from one table to four. Dev seeded with 6 synthetic schools.** Backend for the admin dashboard; screens follow.

### CLAUDE.md described a schema that did not exist

Building the feature-flag screen meant reading `afritech.feature_flags`. It is not there. Nor is `tier_features`, nor `school_feature_overrides`. The schema held `subscription_tiers` and nothing else.

`CLAUDE.md` states this as one of the *two decisions that shape everything else*:

> Pricing and feature access are entirely database-driven. Four `afritech`-schema tables (`subscription_tiers`, `feature_flags`, `tier_features`, `school_feature_overrides`) drive everything.

Three of the four were fiction for the whole of Phases 0–3. What makes this worth more than a line in a changelog is that **the same file warns about exactly this failure** — it has a section headed *"A pattern worth knowing before you trust any doc"*, listing `class_enrolments`, the GLOSSARY fee statement, and the `payments` DDL. The warning was accurate and the file was still wrong two paragraphs earlier, because the architecture summary was written from the specification and never checked against the database.

I have corrected the claim rather than deleted it, and pointed the warning at itself. A doc that says "I was wrong here, in this specific way" is worth more than one quietly fixed.

`0095` builds the three tables to `PRICING.md`'s DDL **as written**, seed matrix included. Nothing invented — where I added anything (a CHECK that an add-on offered for sale has a price; a CHECK that a `grant_feature` row actually names a feature) it is called out in the migration.

**The resolution order is four steps, not five.** The published order is revoke → grant → tier override → *module subscription* → matrix, and no module-subscription table exists. Omitted and named in the function comment rather than approximated. Revoke wins outright, which is the safe direction: a revoke exists because someone decided a school must not have something, and a grant that silently overturns it is how a suspended school keeps the feature it was cut off from.

### The metrics functions are INVOKER, and I want the reasoning on record

The natural shape for an admin dashboard is a `SECURITY DEFINER` function that checks `is_afritech_admin()` and then reads everything. It works. It also creates a second copy of the authorisation rule, in application-adjacent code that no pgTAP suite covers — the same trade ADR-042 had to make for workers, and worth making only when there is no alternative.

Here there was one. Every table these read already carries an `afritech_admin_all_*` policy. Running as INVOKER means the aggregate is scoped by the policies the existing suites already assert: an admin gets the platform, a school owner calling the same function gets their own school, a parent gets nothing. `0096` fails the migration if either function is ever changed to definer, because the change would be invisible in review and silent in behaviour until someone read another school's finances.

The same reasoning drove `0097`: `afritech` stays off PostgREST, and the four relations the dashboard needs are surfaced as `security_invoker` views instead. `0098` added RLS to `subscription_tiers`, **which had none** — putting a public view over an unpoliced table would have made it world-readable, so the policy went in the same migration as the view rather than being left for later.

### Health scores that do not lie about what they measure

`SCHOOL_HEALTH_SCORES.md` specifies six inputs. Two need per-user login telemetry and mobile session data, neither of which this schema has.

The tempting implementation scores the missing inputs as zero. That produces a dashboard where every school looks like it is churning, and a customer-success report that says "call today" about all of them is a report nobody reads twice. Each dimension is rescaled over the inputs that exist instead, and `inputs_available` is returned as 4 of 6 so the screen can mark the score provisional rather than presenting a partial calculation as a complete one.

Deriving `active_teacher_rate` from whether a teacher has marked attendance was considered and rejected — it makes the operational score partly a function of itself.

### The fixture set had to contain failure

First seed had six healthy schools. Loading it proved nothing: a ranking that puts six identical schools in some order has not demonstrated it ranks. D is now billing for forty pupils and doing nothing with them, E is onboarded and never configured, F is suspended. The set spans **excellent 85 to critical 0**, and school A only reaches "excellent" because it has attendance, marks, linked guardians, *and* message traffic — which is the point.

An unbilled school scores 50 on finance rather than 0, deliberately. A school with no fee records is unconfigured, not failing, and a nightly report that calls every new customer critical is one the team learns to ignore.

### Three schema facts found by writing the seed

- **`staff_members` has no `role` column.** Roles are Clerk organisation memberships. Anything reasoning about staff roles from the database alone is reasoning about something that is not there.
- **`fee_structures` has no `due_date`** — it is a price list; the date lives on `fee_records`, which is what lets one structure be issued with different deadlines.
- **`payments.payment_method` has no `mobile_money`.** The CHECK admits cash, bank_deposit, cheque, online_gateway, loan_disbursement, reversal, waiver. Mobile money is the dominant payment rail in Zambia and currently has to be recorded as `online_gateway`, which loses the distinction on every receipt and every reconciliation. Flagged in `CLAUDE.md` rather than worked around — it needs a migration and a product decision, not a seed-file shrug.

### What is not done

No screens. No `.env`, so **nothing has been exercised end to end** — every route here is correct against the real schema and the generated types, and not one has answered an HTTP request. Same posture as the Phase 3 delivery caveat, and it should be read the same way.

---

## 2026-08-17 — Phase 4 sub-phase 1 revision: the aesthetic retune, and a worker that never ran

Branch `feature/phase-4-design-foundation`, continued. **Migration `0094` applied. Token tests 25/25; `school_branding_test.sql` now 38/38; contrast audit grew from 21 to 25 pairings per mode, all passing.** Still no portal screens.

### Navy became ink

The anchor moved from `#2B3A55` to `#1E2A3F`, and more importantly its *job* changed. It was being used as a solid header bar, which is the visual language of an older generation of admin software — a heavy chrome strip with white text on it. The same colour used as body text and headings on a light ground reads as considered rather than dated. The preview page's own header is now a white surface with navy ink and a hairline border, which is the clearest single demonstration of the difference.

The page ground moved to a soft lavender-grey (`#F1F3FA`) with white cards on top. That inversion — tinted page, white card — is most of what makes an interface feel airy. A white page with white cards has to draw every boundary with a line.

### The tinted page broke a pairing, and the audit found it the same minute

Step 600 is derived by darkening until it clears 4.5:1 **against white**. The moment the page stopped being white, `primary link on page` measured **4.15:1** — the derivation passing the test it was given while failing the one that matters.

Fixed by deriving the text steps against the page instead, which is the darker of the two light grounds and therefore the binding one. This is the second time in two sessions that the audit has caught something no amount of looking would have: the colour still looks blue, it is just 0.35 short.

That change had a consequence I nearly missed. `validateTheme()` and the `0092` CHECK constraints were *also* measuring against white, so a school palette could pass both and still be unreadable in place. `#6E7690` is the worked example — 4.51:1 on white, 4.07:1 on the page. **Migration `0094`** moves both thresholds onto the page ground, and `PAGE_GROUND` is now exported from the token package specifically so the SQL literal and the TS constant are traceable to each other. Both halves of that example are pinned in the pgTAP suite, because the gap between those two numbers *is* the reason the ground moved.

### Amber, again

The brief asked for saturated variants for "icons, dots, emphasis" alongside the pale tints. I wired `--zsms-<hue>-fill` to step 500 — the brand hex — and then measured it against the tint it would sit on. Blue 2.93, teal 2.79, **amber 1.80**. A status dot invisible on the chip it labels.

So `mark` is now a derived step of its own, guaranteed 3:1 against that hue's own `100` tint, sitting alongside 500 rather than replacing it. For hues that already pass it is indistinguishable; for amber it is visibly deeper, which is the honest consequence of amber being pale rather than a fault in the design. All six marks are audited rather than the two I sampled first.

A related trap avoided: the first `StatCard` draft put a white glyph on a filled square of the mark colour. That works in light mode and fails in dark, where marks are *lightened* rather than darkened — white on a light amber mark is about 2:1. The icon is now drawn directly in the mark colour, which is the pairing that is actually guaranteed.

### Dark mode, and why it is charcoal rather than black

Three things, each against a specific failure. The ground is `#14181F` rather than `#000000` because pure black causes halation — light letterforms smearing at their edges — which is the most common complaint from people who read dark themes all day and is not a WCAG failure at all. Cards sit *lighter* than the page at `#1A1F2A`, because shadows are invisible on a dark ground so lightness is the only depth cue left; cards darker than the page read as holes. And every accent step is desaturated ~18%, because a saturated hue on charcoal vibrates rather than glows.

Dark scales are now derived against the **card** rather than the page, since tinted chips live inside cards. Deriving against the darker page returns steps that pass there and fall a hair short where they are actually drawn.

### One CSS change that was not cosmetic

To show light and dark side by side on the preview page — the only way to tell whether they are one design or two — the dark block had to match nested elements, not just `:root`. It is now emitted as a bare `[data-theme="dark"]`, with a `[data-theme="light"]` block added so a light panel inside a dark page also resolves rather than silently inheriting dark.

This also closes a scope mismatch I had not noticed: Tailwind's `dark:` variant was configured as `[data-theme="dark"] &` and has always matched nested elements, while the variables were root-only. Same class of bug as the two mechanisms disagreeing about which mode is active, which is the thing the single-switch decision exists to prevent.

### The worker had never started, and `npm run dev` was the casualty

`@zsms/workers` crashed with `ERR_MODULE_NOT_FOUND: Cannot find module '…/src/db'`, taking the turbo dev set with it.

Nothing was missing. `db.ts` is there. The `dev` script used `node --experimental-strip-types`, which is an ESM loader and requires explicit `.ts` on every relative import — and this package writes `from './db'` throughout. **Exactly the same defect as the design-tokens test script yesterday**, from the same cause, which is worth naming: `--experimental-strip-types` looks like a drop-in TypeScript runner and is not one. Both now use `tsx`, which is already the root devDependency behind the e2e script.

Two changes so this cannot block UI work again. The worker script is named `dev:worker`, not `dev`, so `turbo dev` does not pick it up — a worker needs Redis and provider credentials a UI session has no reason to hold. And root `dev` is now `turbo dev --filter=@zsms/web`; `dev:all` keeps the old behaviour and `dev:workers` runs the worker deliberately.

I could not verify the worker *processes* anything — there is still no Redis locally, so it starts and idles. What is verified is that its module graph resolves, which is what was broken.

---

## 2026-08-16 — Phase 4 sub-phase 1: the design foundation

Branch `feature/phase-4-design-foundation`. **New package `@zsms/design-tokens` (24 tests). Migrations `0092` and `0093` applied. New `school_branding_test.sql` 36/36; suites now 261 assertions across six files.** No portal screens — this sub-phase deliberately stops at the foundation and a preview page.

### The brand palette does not pass WCAG AA, and that had to be settled first

Before designing anything I measured the six supplied brand colours against white. **Five of the six fail 4.5:1 for normal text.** Primary blue is 3.47:1. Amber is 1.95:1 — it fails even the 3:1 non-text threshold.

That is not a criticism of the palette; it is a brand palette, and brand palettes are chosen against paper and signage. But using those hexes directly as text colours would have failed accessibility on nearly every label in the product, and discarding them would have thrown away the brand.

The resolution is a **derived scale**: the brand hex is preserved *exactly* at step 500, where it is used as a fill (and clears the 3:1 non-text minimum), and step 600 is the same hue darkened in HSL until it clears 4.5:1 for text. A parent sees the school's actual green on a status bar; the label beside it is the same green, legibly darker. Nobody is told their colour is wrong.

Amber is the case that proved the rule rather than fitting it — no usable lightness of it carries white text — so `AMBER_REQUIRES_DARK_TEXT` is exported and warning fills take dark text.

### Dark mode is not an inverted light mode, and one switch is not two

Inverting the light theme puts step-600 text — picked *because* it is dark — onto a dark surface. `deriveDarkScale()` takes the light end of each hue for text instead, and the audit is re-run against the dark surface set rather than assumed to transfer.

Separately, a self-caught defect before it shipped: I had CSS variables flipping on `prefers-color-scheme` while Tailwind's `dark:` utilities flipped on a class. For any user on the "system" setting those two can disagree — variables dark, utilities light. **`data-theme` is now the single switch**, with a pre-paint script resolving "system" to an explicit value, and the media query kept only as a no-JS fallback scoped to `:not([data-theme])`.

### Three contrast failures found by arithmetic, not by looking

The token tests are accessibility assertions, so they fail rather than warn. Three did, and all three were real: a dark-mode header whose text measured **1.53:1** because `textOnFill` had been conflated with text on the anchor; dark-mode subtle text at 3.04:1; and — the one that mattered most — a **focus ring at 2.82:1 in dark mode for a custom school colour**, which is invisible to exactly the users who depend on it. Fixed with a mode-aware `focusRing` token and a regression test. None of these would have been caught by eye, and the school-colour one would not have been caught at all without testing a *non-default* theme.

### The guardrail is a constraint, not a validator

The brief asked that a school not be able to choose an unreadable palette. `validateTheme()` does that at the API boundary and produces the message a school reads. But an admin tool, a support script, or a bulk import would never pass through it.

So `0092` implements the WCAG luminance formula **a second time, in SQL**, as CHECK constraints on `public.school_branding`. That is genuine duplication and I want it on the record as a cost accepted rather than overlooked: a guardrail present in one of two writers is one that will eventually be walked past. The two implementations are pinned to each other by assertions on fixed ratios (`11.4185`, `3.4742`) — and that pinning immediately earned itself, because my hand-computed expectation of `3.22` in the first draft was simply wrong arithmetic, and the migration refused to apply until it matched what both implementations actually produce.

**It refuses rather than warns.** A warning gets dismissed by whoever is setting the school up the night before launch; the cost lands on parents who never chose the colour.

A subtlety worth recording: the format constraints are **not** redundant with the contrast constraints. A CHECK evaluating to NULL *passes*, and `wcag_contrast_ratio()` returns NULL for a malformed colour — without the `~ '^#[0-9A-Fa-f]{6}$'` checks, `'#GGGGGG'` would be stored happily.

### The login screen has no session, so it cannot use RLS

A parent login page must be the school's before anyone signs in. `current_school_uuid()` is NULL there. The easy answer — an `anon` SELECT policy on `school_branding` — hands any caller the whole branding table.

`school_branding_by_slug()` is the narrow version: one school, by the slug already in the URL, returning exactly five keys. The key count is **pinned by a test**, so that adding a column to `schools` cannot silently widen an unauthenticated surface.

The slug is `lower(schools.school_id)` — the value Clerk already uses as the organisation slug. It is sequential and therefore enumerable, and I chose to accept that rather than invent a second public identifier: what a walk of the sequence yields is a school's name, two colours, and a logo. Public signage, no personal data, and terminated schools return nothing.

### The theme had to reach the PDFs, and receipts took a different road

Report cards and statements read `worker_school_branding()`, so `0092` extended it. Receipts do not — `worker_payment_context()` assembles the entire receipt from a payment id in one call, and its embedded `school` object predates `school_branding`. Left alone, a maroon school would have sent maroon report cards and ZSMS-blue receipts, and the receipt is the document a parent keeps and questions. `0093` fixes that; every join stays anchored to the payment's own `school_id`.

In `packages/documents` the brand colour is applied to the school name and the header rule **and nowhere else**. Body text and money stay ink: a themed amount column would trade legibility for brand on the page a parent reads to check what they paid. The 4.5:1 anchor constraint means paper — which is white — is covered by the same guarantee as the screen.

### Two smaller things found on the way

**`npm test` had never run this package.** The `test` script used `node --experimental-strip-types`, which requires explicit `.ts` extensions on relative imports; the 23 passes I recorded came from `npx tsx`, which does not. Switched to `tsx`. 24 tests now pass under `npm test` at the root, which is the command anyone else would run.

**`check-test-plans.mjs` did not know `is_empty`.** Its own comment warned that the assertion list has to be extended or counts drift low — and the first suite to use `is_empty` undercounted by one. Added, longer names first.

### What this sub-phase deliberately did not do

No portal screens. No logo upload flow — `school_branding` stores URLs and nothing yet mints them, so branding is set by direct write until the school settings screen exists. **Email templates still use fixed ZSMS colours**: the colours are available to the notification layer, but the HTML templates have not been changed, and I would rather record that than imply the propagation is complete.

---

## 2026-08-15 — Phase 3 completion: worker boundary, crons, routes, AI capture design

Branch `feature/phase-3-completion`, cut first. **Migrations `0090` and `0091` applied. New `worker_boundary_test.sql` 26/26; suites now 225 assertions across five files.** Phase 3 closes the three things the previous entry listed as unfinished.

### The prohibition, amended rather than reinterpreted

The previous session stopped at prohibition 1 — *"the service role key is never used outside an Edge Function"* — and refused to decide alone. Decision taken: **amend it.** The rule's intent is keeping the key out of client-reachable code, and a Railway worker is no more client-reachable than an Edge Function. CONVENTIONS.md now reads "outside a **trusted server-side context** — an Edge Function, or a Railway background worker," and **ADR-042** records the reasoning with four conditions a worker must satisfy.

The amendment costs something, and it is worth naming: **the worker's connection bypasses every RLS policy the other four suites verify.** So the tenant boundary had to be rebuilt somewhere else rather than merely surrendered.

`0090` is that somewhere. Seven `SECURITY DEFINER` functions, each anchoring its joins to one school internally, granted to `service_role` and revoked from everyone else.

### The banner said one thing and the code did another

I wrote a warning banner into `db.ts` — *"do not add a direct table query"* — and a journal line claiming the worker never issues one. Then I grepped `apps/workers` for `.from(` before committing, and found **three**: an UPDATE of `message_log` by id, and two reads of `schools`.

None was exploitable. Every id came from a `worker_*` call earlier in the same chain, so no attacker-controlled value ever reached them. But the `message_log` UPDATE is **an unanchored write on a connection with no policies**, which is the exact statement ADR-042 exists to make unavailable. It survived because I wrote the read surface first and the writes felt like plumbing.

The tempting fix was to soften the claim — "no direct queries except `schools` by primary key." I took the other one. `0091` adds `worker_update_dispatch()` and `worker_school_branding()` and removes all three, so the rule stays absolute: **`.from(` anywhere in `apps/workers` is a defect**, greppable, with no exceptions for a reviewer to weigh. The qualified version would not have covered the write in any case, which is the argument against it.

`worker_update_dispatch()` sets the terminal timestamps from the status itself, so a worker cannot stamp `delivered_at` on a message the provider refused. It carries no status whitelist — `message_log` already has a CHECK with nine values, and my first draft of the whitelist had already omitted four of them. One list.

The design choice I am most confident in: **`worker_announcement_recipients()` takes no `school_id` argument.** Recipients derive from the announcement's own school. "Send school A's announcement to school B's parents" is not blocked by a check — it cannot be expressed.

### Testing the place where RLS was switched off

`worker_boundary_test.sql` (26 assertions) applies the same adversarial standard to the functions that `tenant_isolation_test.sql` applies to the policies, because the guarantee moved and a guarantee is only as good as its test.

The fixture is built to be hostile: **both schools have a student with the same name, in the same grade, with the same class id.** A join that loses its school anchor returns the wrong parent, and nothing in the data would reveal it. Asserted that `worker_payment_context()` returns school A's student and school A's guardian, and specifically **never the other school's phone number** — a receipt for one family's money reaching another family is the failure this exists to prevent.

Also asserted: an unknown payment id returns `NULL` rather than a shell object a handler would dispatch against; the reminder cooldown suppresses repeats; and **a school owner — the highest-privileged end-user role — calling `worker_payment_context()` is refused 42501 by the executor**, not merely absent from the grant catalogue.

**Bulk quota is all-or-nothing.** The existing suite drove the ceiling one message at a time; a 300-recipient fan-out asks for 300 units in one call. Verified that a bulk send exceeding the remaining allowance is refused **and consumes nothing** — a partial burn would bill a school for messages nobody received and leave the worker unable to tell which recipients were covered. The 80% warning fires on the crossing call and not again.

Cross-tenant message-history isolation needed nothing new: `communications_test.sql` Section C already asserts it from three directions — an owner against another school's log, a parent against another parent's messages, and a school B parent against school A entirely.

### A test suite that could not have passed

Setting the plan on the new file by hand, I miscounted, so I wrote a script to count instead. It flagged a **pre-existing** mismatch: `fees_attendance_results_test.sql` has 44 assertions under `plan(45)`, and has since it was committed. Under `pg_prove` that file **fails**.

I reported it as "45/45 passing" at the Phase 2 gate. That number came from running the suite through the Supabase MCP, which executes statements one at a time and never evaluates the plan — so the adapted run and the committed file were not the same thing, and the difference was invisible in exactly the direction that flatters the report. **Corrected: the Phase 2 suite is 44 assertions, all passing.**

A wrong plan is worse than no plan, because it is how a suite silently loses coverage: delete an assertion and the count meant to notice has to be edited by hand. `npm run db:test` now runs `scripts/check-test-plans.mjs` first, which fails if any `plan(N)` disagrees with the assertions in the file. It needs no database and no Docker, so it runs on this machine today and will run in CI when CI exists.

### Built out

Three cron handlers (fee reminders reading the derived arrears fields, scheduled-announcement claim via `FOR UPDATE SKIP LOCKED` so two runners cannot double-send, report-card batch), three API routes (`announcements`, `announcements/[id]/read`, `messages`), and `worker.ts` registering four workers. Receipts get their own worker at concurrency 10 with a 100/1000ms limiter: a parent waiting on confirmation of money they just handed over must not queue behind a 400-student report card run.

`message_log` is read-only over the API by design — the log is written only by the worker, through a function.

### Still not proven, and Phase 6 is when it will be

Stated plainly because the gate report could be read as claiming more than it does:

- **Live BullMQ→Redis transport is unverified.** No Redis on this machine. Handlers are invoked directly and `worker.ts` is a thin adapter over exactly that call — but "thin" remains an assertion until a job actually round-trips through Redis.
- **Real WhatsApp, email, and SMS delivery is unverified.** No Meta, Resend, or Twilio credentials; every channel runs through the mock provider. Correct for `zsms-dev`, whose fixtures carry real-shaped numbers that must never be dialled.

**The logic is proven; the delivery is not.** Both are Phase 6 items, verified when credentials and Redis exist. Nothing in Phases 4–5 should be built on the assumption that a message has ever left this machine.

### AI capture design enriched

`AI_CAPTURE.md` is now 383 lines — multi-image capture, camera and upload, HEIC/PDF/spreadsheet handling where Excel and CSV bypass vision entirely, pre-processing, confidence-highlighted verification UX, and offline capture that reserves credit at queue time. Design only, Phase 4/5. Confirmed against the applied schema: **no Phase 2 table changes**, because a partial save persists in capture staging and never as a partial write to a domain table.

---

## 2026-08-15 - Phase 3: background jobs and communications

Branch `feature/phase-3-jobs-communications`, cut before any work this time. **Migrations `0082`-`0089` applied. Communications suite 45/45, gate harness 28/28.**

### The same default-privilege bug, a third time - and finally fixed as a class

`0019` found `authenticated` holding DELETE on every Phase 1 table. `0076` found it holding UPDATE on `payments`. This phase found it holding **INSERT and UPDATE on `message_log` and `school_message_quotas`** - which would have allowed a fabricated delivery record (the artefact a school would use to claim a parent was warned) and a school resetting `messages_used` to zero to send without limit.

Three times I granted what a table needed and assumed that was the whole story. **`GRANT` is not a whitelist**: Supabase's defaults already give `authenticated` and `anon` `ALL` on anything new in `public`.

`0089` stops the class rather than the instance - `ALTER DEFAULT PRIVILEGES` so new objects arrive with nothing granted, plus an inline verification that fails at apply time. Asserted: **a table created after `0089` inherits no end-user privileges at all.**

**And its verification immediately caught something I did not know about.** The two arrears *views* carried INSERT and UPDATE. `fee_record_status` is a simple view over `fee_records`, which makes it **auto-updatable** - a write through the view reaches the table. `security_invoker` meant RLS still applied, so nothing was exploitable, but it was an entire write path nobody designed. My first sweep missed it because it joined `pg_tables`, which excludes views. A narrow query created the gap; a broad assertion caught it.

### The abstraction was only half-built

The queue abstraction covered *producing* jobs. BULLMQ.md's own worker example imports `bullmq` directly, so **consuming was never behind it** - switching providers would have been configuration for producers and a refactor for consumers.

`createWorker()` now lives in `@zsms/queue`, and `apps/workers` has no `bullmq` or `ioredis` dependency at all. The abstraction also states the asymmetry plainly rather than hiding it: BullMQ workers *pull*; QStash *pushes* over HTTP and has no worker process, so `createWorker()` throws under QStash with an explanation. That is the same trade ADR-035 already records, seen from the consuming side.

Verified by grep: no `bullmq`/`ioredis` import outside `packages/queue`, no provider SDK or endpoint outside `packages/notifications/src/providers`.

### What the gate actually proves - and what it does not

28/28 on the harness, running the **real** handler, the **real** pdf-lib renderer, and the **real** fallback chain across five scenarios: happy path, WhatsApp failure falling through to email, quota exhaustion, total delivery failure, and a student with no linked guardian.

**Not proven, and it matters:**
- **BullMQ-to-Redis transport.** No Redis on this machine. The handler is invoked directly; `worker.ts` is a thin adapter over exactly that call, but "thin" is an assertion until Redis exists.
- **Real provider delivery.** No Meta, Resend, or Twilio credentials, so channels run through the mock provider. This is also correct for `zsms-dev`, whose fixtures carry real-shaped phone numbers.
- **The handler's database adapter.** Deliberately unimplemented - see below.

### Open question I refused to answer alone

`CONVENTIONS.md` prohibition 1: *"the service role key is never used outside an Edge Function."* A worker is not an Edge Function, yet it must read a payment, its student, and the guardian - and holds no end-user JWT, because nobody has a session when a cron fires at 08:00.

`createWorkerDeps()` throws, with the three options written out (Edge Functions for all DB work / amend the prohibition to cover Railway workers / a dedicated Postgres role). The rule exists to keep the key out of client-reachable code, so amending it is probably the intent - but a documented prohibition should be amended deliberately, not reinterpreted by whoever happens to write the worker.

### Everything dynamic

Quota ceilings come from `afritech.subscription_tiers`, which required creating the first table in a schema that had been empty since `0002` - the pricing tables were specified in the void `0061`-`0065` block. Message wording lives in `notification_templates` with school override and platform fallback; 13 platform defaults seeded. No template string exists in application code, because a wording change is the most common request a school makes and it must not be a deployment.

### Not built

API routes for announcements and message history, the fee-reminder and scheduled-announcement cron handlers, and report-card bulk generation. The renderers exist for all three document types; what is missing is the routes and the cron wiring.

---

## 2026-08-15 — Pre-Phase-3 documentation reconciliation

Documentation only. No schema or code changes.

### CLAUDE.md brought current

It still opened *"Phase 0 scaffold complete. Phase 1 not started."* — four phases of work out of date, and it is the file every session reads first. Now states Phases 0–2 plus arrears, 12 API routes, 29 applied migrations, three pgTAP suites (155 assertions), 23 tables, 97 policies, and — importantly — **that there is no user interface at all**, which the old text left ambiguous.

Its *Known documentation inconsistencies* table was entirely stale: all five conflicts (session lengths, schema counts, QStash vs BullMQ, missing WAF, missing ADRs) had been resolved sessions ago. Replaced with the four items actually open, and with the pattern worth knowing: **repeatedly a document has described something the schema could not do**, and each case was found by implementing against the doc rather than reading it.

### Stale table references — larger than flagged

The readiness report listed four stale `class_enrolments` references. Fixing them surfaced **28 further `staff_assignments` references across 10 documents** — a table dropped in `0069`. `ASSIGNMENTS.md` is structurally built around it, and `POWERSYNC.md` carried three sync rules joining two tables that no longer exist; anyone implementing PowerSync from that document would have written SQL that cannot run.

Corrected in `POWERSYNC.md`, `ASSIGNMENTS.md`, `OFFLINE_SYNC.md`, `RESULTS.md`, `REPORT_CARDS.md`, `TIMETABLE.md`, `INVITATIONS.md`, `CONVENTIONS.md`, `DATABASE.md`, and `INDEXES.md`. The DDL blocks in `DATABASE.md` and `INDEXES.md` are retained under a **REMOVED** banner so older references resolve to an explanation instead of a dead end.

**The lesson: dropping a table is not one migration.** The schema change took one file; the documentation it invalidated took ten.

### Two gaps recorded as ADRs

- **ADR-040 — multi-country config hardening (deferred).** Catalogues the hardcoded CHECK constraints and the `reference_subjects_zm` naming. Deferred on purpose: designing a configuration vocabulary against one known market usually produces the wrong abstraction, and the `custom` escape hatch means a new market is degraded rather than blocked.
- **ADR-041 — grading-scale versioning (open data-integrity gap).** `exam_results` stores a grade letter without the scale that produced it. A mid-year revision makes every historical grade unexplainable, and **the column cannot be backfilled for rows already written** — which is the argument for fixing it before a school accumulates a year of results. `score_config` already solves exactly this for loan scoring.

Both are listed in `BUILD_SEQUENCE.md` under *Tracked pre-launch decisions*, with ADR-041 carrying a deadline of the Phase 6 pilot.

### Process note

The previous commit landed **directly on `integration`** rather than through a feature branch — the prior merge left me on that branch and I did not check before committing. Agreed with the user to leave it rather than rewrite a pushed shared branch. It is exactly what branch protection would catch, and cannot, on the free plan.

---

## 2026-08-15 — AI-assisted capture design; pre-Phase-3 readiness

Branch `feature/fee-arrears-model` (continued). **Design and documentation only — no capture code built.**

### AI-assisted capture recorded as a planned Phase 4/5 module

`18 AI Module/AI_CAPTURE.md` + **ADR-039**, registered in `BUILD_SEQUENCE.md`, `AI_OVERVIEW.md` (as System 5), and `DYNAMIC_CONFIG.md`.

The design point that matters most: **context-anchored matching is why this is feasible at all.** Handwriting against an open vocabulary is unreliable; handwriting against a known roster of ~30 names is a constrained match. Extraction always runs inside a class the teacher already occupies, matched only against that class's roster via `teacher_reaches_class()`. **The roster is never widened to the whole school to find a match** — that is exactly how a mark lands on a same-named child in another grade, and it is also a privacy control, since the roster leaves the system inside the prompt.

Everything else follows from assist-not-autopilot: no confidence threshold permits a direct write; unmatched names are surfaced, never guessed; the approving teacher is the author.

**Compatibility with the Phase 2 schema was assessed, not assumed.** No change is required now. The domain tables never receive drafts, and their existing unique keys already make repeated approval idempotent. Two changes land with the module: an added `sync_source` value, and an optional `source_capture_id` for provenance that cannot be backfilled.

Credit pricing is fully dynamic — trial allowance, per-capture rates by type, pack prices, individual-purchase toggle, and the match confidence floor. Balance derives from an append-only ledger rather than a mutable column, for the same reason as ADR-038's arrears.

### A test gap I had reported as covered

In the arrears gate report I listed *"`revise_fee_records()` refuses to drop below verified payments"* under what was implemented, in a way that implied test coverage. **It was implemented but untested** — only the missing-reason branch had an assertion. Tested now and passing, along with atomicity of the refusal and the transferred-student flag. Arrears suite is 38 assertions.

The lesson is narrow and worth keeping: a guard written in a migration and described in a report is not a guard that has been exercised.

### Config-driven audit findings (reported, not fixed)

Grading scales and class structures are genuinely config-driven — `school_grading_scales.grade_bands` is JSONB, `exam_results.grade_letter`/`grade_points` are free text and integer, class identifiers are free-form. But several **CHECK constraints encode Zambia/Cambridge assumptions in the schema**, which contradicts ADR-031's dynamic-config principle. Full list in the readiness report; the significant ones are `curriculum_type`, `grading_system`, and `examination_type`, all of which would need a migration to admit another country's system.

Separately: `exam_results` records `grade_letter` but **not which grading scale produced it**, so a scale revised mid-year makes historical grades unexplainable — the same versioning problem `score_config` already solves for loans.

---

## 2026-08-15 — Fee arrears model (pre-Phase 3)

Branch `feature/fee-arrears-model`. **Migrations `0077`–`0081` applied. Arrears suite 33/33.**

### What the investigation found

Asked whether unpaid balances carry forward, the honest answer from the schema was: **the rows persisted, but there was no arrears model.** Prior-term records were never deleted, so debt did not reset — but there was no linkage between terms, no cumulative balance, no overdue signal, and no endpoint answering *"what does this student owe?"*. Verified against the catalog: **0 balance views, 0 arrears columns, no `balance` column on `students`.**

Worse, three documents already promised what the schema could not produce — `GLOSSARY.md` and `PDF_GENERATION.md` describe a fee statement *"with a running balance"*, and `CHATBOT.md` has a `FEES — View outstanding balance` command. All three now reference the implementation.

A second gap surfaced in the same investigation: revising an **already-generated** term silently did nothing. `generate_fee_records()`'s `ON CONFLICT DO NOTHING` protects against double-billing, but it also blocked correcting a mis-keyed fee — returning `created: 0` with no error and no alternative path.

### The model (ADR-038)

**Derived, not materialised.** `fee_records` stays the single source of truth. Writing a *"Balance brought forward"* row into each new term reads like a bursar's ledger but double-counts while the original record exists. The brought-forward line is emitted by `fee_statement()` at render time instead — **one truth in the data, ledger-style on the page.**

**`security_invoker = true` is load-bearing.** A view runs with its *owner's* privileges by default, which would have bypassed RLS on `fee_records` and shown every parent every family's balance. The suite attacks that specific failure from parent, cross-family, and cross-tenant angles.

**Overdue is a separate axis from payment progress.** `status` means how much has been paid; `is_overdue` / `days_overdue` / `arrears_amount` derive from `due_date`. A record can be `partial` and overdue, or `partial` and not yet due — collapsing them into one enum would destroy that and break the balance trigger.

**Carry-forward spans years and survives status changes.** No year filter, and no filter on `students.status` — a graduated student owing 800 still shows it, because schools withhold certificates until cleared. Asserted directly.

**The model never gates.** Nothing refuses a result, certificate, or re-registration because a balance is outstanding. Arrears commonly *do* gate those things in Zambia, which is exactly why it must be a per-school setting, off by default, rather than schema behaviour — a school that does not withhold results must not inherit the behaviour of one that does. The suite asserts publishing succeeds while a student is in arrears, so a future gate cannot be added silently.

### Two real defects the suite caught

- **`allocate_payment()` was completely broken.** `RETURNS TABLE` columns become PL/pgSQL variables, and `amount` / `fee_record_id` collided with the internal temp table's columns — `42702 column reference "amount" is ambiguous` aborted every call. Fixed in `0080` by prefixing the OUT columns.
- **`fee_statement()` was non-deterministic.** Charges were dated by `created_at`, but generation writes a whole term in one statement, so every charge shared a timestamp and the running balance had no defined order. **The same statement closed at 1000 or 2200 depending on planner order.** A financial document that reads differently each time is not a financial document. Fixed in `0081`: charges date by `due_date`, and the window function and final `ORDER BY` use one complete key. The suite now runs the same call eight times and asserts a single distinct closing balance.

That second one also explains the windowed-statement failure — with charges dated at generation time, nothing fell before a five-day window, so no brought-forward line appeared even though a term due forty days earlier was plainly outstanding.

### Verified

Arrears suite 33/33 · Phase 2 suite 45/45 · Phase 1 suite 72/72 · `turbo type-check` 8/8 · types regenerated · fixtures cleaned up.

### Not built, deliberately

- **Arrears gating** — per-school, admin-configurable, off by default. Reads these columns when it lands.
- **Loan linkage** — `records_overdue`, `days_overdue`, `paid_at`, and `due_date` are the raw material `BEHAVIOUR_SCORE.md` would need. Not coupled, not precluded.
- **API routes for the balance/statement** — the views and functions exist and are RLS-safe; surfacing them is UI work.

---

## 2026-08-15 — Phase 2: fees, attendance, and results

Branch `feature/phase-2-fees-attendance-results`. **Migrations `0070`–`0076` applied to `zsms-dev`. Phase 2 suite passes 45/45; Phase 1 suite still 72/72.**

### The suite caught the same class of bug again

First run was **44/45**:

```
not ok 3 - authenticated holds no UPDATE on payments   (have 1, want 0)
```

Identical root cause to `0019`: **Supabase's default privileges grant `ALL` on a new `public` table to `authenticated`.** `0070` granted `SELECT, INSERT` and revoked `DELETE`/`TRUNCATE`, but adding a grant does not remove the `UPDATE` already held — and `0019`'s `ALTER DEFAULT PRIVILEGES` only covered `DELETE` and `TRUNCATE`.

`0070`'s own comment asserted *"no UPDATE privilege for end users at all."* **That was false when written.** `payments` has no UPDATE policy, so RLS filtered direct updates to zero rows for ordinary roles — but `afritech_admin_all_payments` is `FOR ALL`, which covers UPDATE. A super admin could have edited a payment in place, bypassing `verify_payment()` and its guard against re-verifying. Payments are supposed to be immutable with corrections as reversal rows; an in-place edit leaves no trace.

Fixed in `0076`, which verifies itself inline. **Twice now the same default-privilege mechanism has produced a hole, both times found by an assertion rather than by review.** The lesson is that `GRANT` is not a whitelist — the baseline is already permissive, so every new table needs an explicit revoke of what it must not expose.

### Fee lifecycle, proven end to end

Structure → generated records → parent submits → accountant verifies → balance moves. Twelve assertions walk it, and two carry the design:

- **A pending payment moves nothing.** `amount_paid` stays 0 and the record stays `unpaid` until verification. Without that assertion, "verification" would be decorative.
- **Verification is attributed.** A `CHECK` requires `verified_by` and `verified_at` together — *verified by nobody at no time* is not a valid state for a money record.

Three things are database functions rather than route code because they must be atomic: receipt numbering (locks the school row; two concurrent cashiers would otherwise compute the same number), balance derivation (a trigger over **verified** payments only, so it cannot drift), and verification itself.

`generate_fee_records()` is idempotent — asserted, because a second run silently doubling every balance is the worst plausible failure here.

### Teaching scope reaches attendance and marks

ADR-037 paid off exactly where intended. Attendance uses `teacher_reaches_class()`; marks use the narrower `teacher_teaches_subject()`, where a `scope='class'` teacher owns every subject in their class and a `scope='subject'` teacher only their own. The suite asserts a subject teacher cannot enter marks for **a different subject in a class they do reach** — the case a coarser model would have allowed.

**One deviation from `RLS.md`, deliberate.** It left the publication lock to the application layer. That would leave a published mark editable by any direct PostgREST call, so `results_published = FALSE` is in the UPDATE policy's `USING` clause. The suite asserts a teacher cannot edit after publication and cannot publish by flipping the flag on their own row.

### Numbering: the reserved block was unusable

`0022`–`0068` sort **below** the applied high-water mark (`0069`), and `supabase db push` skips anything older than the last applied without `--include-all`. A migration written as `0030` today would simply never run. Phase 2 therefore starts at `0070`, and `MIGRATIONS.md` now states the rule plainly: **numbers are assigned when a migration is written, never reserved in advance.**

### Document conflict resolved: `payments`

`SCHEMA.md` and the 2026-04-26 `CHANGELOG.md` entry specify `status`, `verified_by`, `verified_at`, `rejection_reason`, `proof_of_payment_url`, and `confirmation_checkbox_at` — the change that *"removed OTP for financial submissions, replaced with confirmation workflow"*. `DATABASE.md`'s DDL had none of them. Without those columns there is no verification step at all. SCHEMA.md governs; `DATABASE.md` corrected.

### API routes

`/api/fees/structures` · `/api/fees/records` (GET, POST=generate) · `/api/payments` (GET, POST=submit) · `/api/payments/[id]/verify` · `/api/attendance` · `/api/results` · `/api/results/publish`. Twelve routes total across Phases 1–2, all registering in the build.

Two rules held throughout: **the client never names its own status** — every submission lands `pending_verification`, and the field is absent from the schema — and **teaching-scope checks are not duplicated in route code**. The policy is the check; a second copy in TypeScript is a second thing to drift.

### Verified

Phase 2 suite 45/45 · Phase 1 suite 72/72 · `turbo type-check` 8/8 · `turbo build` clean · types regenerated · fixtures cleaned up.

---

## 2026-08-15 — Phase 1: core domain backend (schools, students, staff)

Branch `feature/phase-1-core-domain`, cut from `integration` at `8ffbddb`.

**Status: APPLIED to `zsms-dev` and verified. Isolation suite passes 72/72. Merged to `integration`.**

### The teaching-assignment model — ADR-037 (migrations `0020`, `0021`)

The `class_enrolments` gap was closed at its root rather than worked around. `class_subjects` records which subjects a class is taught; `teacher_assignments` records what a teacher teaches, discriminated by a `scope` field:

| scope | Shape | Models |
|---|---|---|
| `class` | `class_id` set, `subject_id` NULL | primary school, form teacher |
| `subject` | both set | secondary school subject teacher |

A teacher may hold any number of rows of either scope, including both. **Both scopes carry `class_id`** — that is the load-bearing detail, because it lets `teacher_reaches_class()` ignore `scope` entirely and therefore never branch on school type. The shape of a school is data, not a code path.

The scope/subject `CHECK` constraint is a security control, not tidiness: a `scope='subject'` row with a NULL `subject_id` would read to the predicate as reaching the *whole* class, silently widening that teacher.

Write access is owner and principal only. Teacher reach is derived from this table, so a teacher who could insert their own row could grant themselves any class's students — the suite asserts that directly.

`teacher_assigned_to_class()`, the `0016` interim helper, is **dropped** rather than left in place. Two predicates answering "which students may this teacher see" is exactly how the wrong one ends up in a future policy.

**`staff_assignments` dropped in `0069`** (2026-08-15), on explicit approval. Verified dead first: 0 rows, 0 inbound FKs, 0 functions, 0 views, no application references. The migration re-checks the row count at apply time and refuses if non-empty — "it was empty when I checked" is not "it is empty now" — and uses `RESTRICT`, not `CASCADE`, so a surviving dependency fails loudly instead of being silently removed too.

Removing it surfaced four **Phase 2** policies in `RLS.md` — two on `attendance_records`, two on `exam_results` — still resolving teachers through the dropped table. Repointed at `teacher_reaches_class()` and a newly specified `teacher_teaches_subject(class_id, subject_code)`, which lands with the exam-results migration. Left unfixed, those would have been written against a table that no longer exists.

**Twelve new assertions**, covering both scopes, the mixed case, the two constraint violations, self-assignment, and the one that matters: *a subject teacher cannot see students in a class they do not teach*. Suite is now 72, all passing.

### I collided with reserved migration numbers

`0019`, `0020`, and `0021` were **already claimed** by the plan — `create_fee_tables`, `create_fee_rls`, `create_message_quota_table`. I named files by looking at the highest number on disk instead of reading *Next Available Sequence Number*, which said `0066`.

Mine are applied, and an applied version cannot be renumbered — it is the identity `supabase db push` reconciles against. So the *planned* migrations moved instead: fees and message quota are now `0066`–`0068`, next available `0069`.

The document also carried **three conflicting "next available" pointers** (`0022`, `0056`, `0066`) in different sections. Reconciled, with the one near the top declared authoritative.

**Rule 3 exists for exactly this and I skipped it.** Most of the sequence is planned in the document long before it exists on disk, so the filesystem is never the source of truth for the next number.

### The isolation suite caught a real defect on its first run

This is the entry that matters. The first run was **53/55**, and the two failures were the same root cause:

```
not ok 3  - authenticated holds no DELETE privilege on students   (have 1, want 0)
not ok 27 - owner A cannot hard-delete even their OWN student     (caught: no exception)
```

**Supabase's default privileges grant `ALL` on every new `public` table to `authenticated`.** Migrations `0003`–`0018` revoked that for `anon` but only *added* `SELECT, INSERT, UPDATE` for `authenticated` — which does not remove the `DELETE` it already held.

No data was lost: `students` has no `DELETE` policy, so RLS filtered the delete to zero rows, and a later assertion confirmed the row survived. But the guarantee was resting on RLS alone, and that was thinner than it looked — **policies written `FOR ALL` cover DELETE too.** `afritech_admin_all_students`, `management_write_staff`, and `school_management_links` are all `FOR ALL`, so on those paths the privilege was live. An AfriTech super admin could have hard-deleted a student, which prohibition 8 says must be impossible for anyone.

Fixed by **migration `0019`**, which revokes `DELETE, TRUNCATE` from `authenticated` and `anon` across all fifteen tables, sets `ALTER DEFAULT PRIVILEGES` so future tables inherit the correction, and verifies itself inline — the migration raises at apply time if any grant survives. Four assertions were added to the suite (now **60**) covering the `FOR ALL` paths and the super admin specifically.

**The lesson is the one the brief was built around.** Every "can School A read its own data" test passed on the broken schema. Only the assertion that *actively attempted a forbidden delete* found it. Testing what users cannot do is what located a defect that review had not.

### Two further defects found while running

- **Data-modifying CTEs are illegal as function arguments.** The suite used `is((WITH x AS (UPDATE ...) SELECT count(*) FROM x), 0, ...)`, which PostgreSQL rejects with *WITH clause containing a data-modifying statement must be at the top level*. Replaced with a `SECURITY INVOKER` `rows_affected()` helper — invoker rights are essential, so the write executes as the role under test.
- **One assertion tested the wrong failure mode.** "Owner A cannot reassign their own student into School B" expected zero rows affected. It does not: `USING` passes because the row *is* visible to that caller, and `WITH CHECK` rejects the post-update row, raising `42501`. Changed to `throws_ok`.

### Applied state (verified by query, not assumed)

| Check | Result |
|---|---|
| `public` tables | 17 |
| Tables without RLS | **0** |
| Tables without `FORCE` | **0** |
| Policies | 64 |
| `DELETE`/`TRUNCATE` granted to end-user roles | **0** |
| Migrations applied | 21 (`0001`–`0021`) |
| Non-four-digit versions | **0** |
| Stale `teacher_assigned_to_class()` | **0** — dropped in `0021` |
| Leftover test fixtures | 0 (suite cleans up after itself) |
| pgTAP isolation suite | **72 / 72** |

`turbo type-check` 8/8 · `turbo build` clean · types regenerated from the live schema.

### On the CLI

The user reported login *and* link succeeded; the CLI reported neither. Both were half true: **login had succeeded** — the token lives in the Windows Credential Manager, not `~/.supabase/access-token`, which is why the file check said otherwise — but **link had not** (`"linked": false` from the API). Diagnosed with `supabase projects list`, which returned the project list *and* `linked: false` in one response. Worth remembering: on Windows, the absence of the token file proves nothing.

### Migrations 0002–0018

Schemas · schools · school config tables (`academic_config`, `grade_levels`, `subjects`, `grading_scales`, `reference_subjects_zm`, `onboarding_checklists`) · students · parents · `student_parent_links` · permission tables · staff tables · RLS for all of it.

Written contiguously rather than only the three tables named in the brief. Leaving `0005`–`0010` as gaps would have meant filling them later with versions that sort *before* the applied maximum, which `supabase db push` skips without `--include-all` — the exact hazard the versioning procedure written yesterday exists to prevent.

### Three specification defects found by implementing against the docs

| Defect | Resolution |
|---|---|
| **Migration order is impossible.** `MIGRATIONS.md` put the permission tables at `0017`, *after* the student RLS (`0014`) and staff RLS (`0016`) whose policies call `has_permission_grant()` — which reads `staff_permission_grants`. A policy evaluated before its table exists raises `relation does not exist`, so every `students` query would error rather than filter. | Permission tables → `0014`, staff tables → `0015`, student RLS → `0016`. Corrected order recorded in `MIGRATIONS.md`. |
| **Policy recursion.** `RLS.md` writes three policies as cross-table subqueries: `students` reads `student_parent_links`, whose policy reads `students`. Literally applied, PostgreSQL aborts with *infinite recursion detected in policy*. | Predicates unchanged, relocated into four `SECURITY DEFINER` lookups (`is_linked_parent_of`, `student_in_current_school`, `parent_has_student_in_current_school`, `teacher_assigned_to_class`) which do not re-trigger RLS on the inner table. |
| **`class_enrolments` did not exist.** `RLS.md` resolves a teacher's students through it. It has no DDL in `DATABASE.md`, no entry in `SCHEMA.md`'s 58-table inventory, and no migration — yet four documents reference it (`RLS.md`, `ASSIGNMENTS.md`, `POWERSYNC.md`, `OFFLINE_SYNC.md`). | `teacher_read_assigned_students` resolves through `students.class_id`, which *is* defined and `NOT NULL`. **RESOLVED** by ADR-037 — see the teaching-assignment section above. `class_subjects` and `teacher_assignments` replace it. |

### Two hardening choices beyond the spec

- **`FORCE ROW LEVEL SECURITY` on every table**, not just `ENABLE`. Without it the table owner bypasses every policy — and the isolation suite would then pass against a boundary that does not hold for the owning role.
- **RLS enabled at table-creation time, policies deferred.** `0014` and `0015` enable RLS immediately and add policies in `0017`/`0018`. A table with RLS on and no policies denies everything, so the gap fails closed. The alternative would leave `staff_permission_grants` — the table deciding who may exceed their role — readable by every authenticated user for the length of the gap.

### API routes

`/api/schools` (GET, PATCH) · `/api/students` (GET, POST) · `/api/students/[id]` (GET, PATCH, DELETE→soft) · `/api/staff` (GET, POST). Zod validation, documented `{ data, meta? }` / `{ error, code, details? }` envelopes.

Two decisions worth keeping:

- **`school_id` is always derived from the JWT, never read from a request body.** A client that can name its own tenant turns `WITH CHECK` into the only thing standing between it and another school's data.
- **Cross-tenant reads return `404`, not `403`.** A 403 confirms the record exists somewhere, which is itself a cross-tenant disclosure. RLS makes the row invisible rather than forbidden, and the routes preserve that.

The service role key appears nowhere: `createServiceClient()` deliberately does not exist, because a Next.js API route is not an Edge Function (prohibition 1).

### pgTAP isolation suite — 60 assertions

`supabase/tests/rls/tenant_isolation_test.sql`. Adversarial by construction: the majority of assertions have School A actively attempt to read, update, insert into, reassign, or delete School B's records and assert refusal. Covers owner, teacher, parent, student, super admin, and `anon`, in both directions between the two schools.

The subtle ones worth noting: reassigning one's *own* student into another school (the `USING` clause passes because the row is currently visible, so only `WITH CHECK` stops it); a `students:write` grant at School A not conferring write at School B; a teacher blocked from an unassigned class *within their own school*; and a cross-school aggregate returning only the caller's count. Section 6 asserts the AfriTech super admin *does* cross tenants — without it, a blanket-deny bug would make every other assertion pass for the wrong reason.

### Verified so far

`turbo type-check` 8/8 including the new routes. Nothing else can be verified until the migrations are applied.

### Known limitation

`nextStudentId()` computes the sequence as `count + 1`, so two concurrent enrolments at one school can collide. The `UNIQUE` constraint turns that into a 409 rather than a duplicate, so it is safe but not graceful. `STUDENT_ID.md` assigns generation to an Edge Function; moving it there with a per-school sequence removes the race.

---

## 2026-08-14 — Pre-Phase-1 cleanup: security bump, migration procedure, permission policy

Three cleanups before Phase 1, plus a persistent permission configuration.

### 1. Next.js security bump — done

`14.2.18` → **`14.2.35`**, the exact version the [2025-12-11 advisory](https://nextjs.org/blog/security-update-2025-12-11) names for the 14.x line. It carries the complete fix for **CVE-2025-67779** — the initial patch for CVE-2025-55184 (DoS) was incomplete — plus CVE-2025-55183 (Server Function source-code exposure). Both are App Router / RSC issues, so they apply directly to `apps/web`.

Verified after the bump: `turbo type-check` 8/8 pass, `turbo build` pass.

**The larger finding: Next.js 14 is effectively end-of-life for security.** `npm audit` still reports `next` as high severity after the bump, across ~21 further advisories whose fixed versions land in the **15.5.x** line — nothing is backported to 14.x. A sample of what remains unpatched on 14:

| Advisory | Fixed in |
|---|---|
| SSRF in rewrites via attacker-controlled destination hostname | 15.5.21 |
| SSRF in Server Actions on custom servers | 15.5.21 |
| Unauthenticated disclosure of internal Server Function endpoints | 15.5.21 |
| XSS in App Router apps using CSP nonces | 15.5.16 |
| Cache poisoning in RSC responses / middleware redirects | 15.5.16 |
| HTTP request smuggling in rewrites | 15.5.13 |

`npm audit` reports `fixAvailable: next@16.3.0 (isSemVerMajor)`.

**Raised as a decision rather than fixed silently — the user chose to upgrade.** `apps/web` now runs **Next.js 15.5.23** (ADR-036). `npm audit` confirms **`next` has zero advisories of its own**; it is now flagged only transitively through `postcss` and `sharp`.

#### The upgrade exposed a hoisting fault — worth reading before Phase 1

The build failed on `15.5.23` with `Cannot read properties of null (reading 'useContext')` while prerendering `/_error`. The require stack named the culprit:

```
node_modules/styled-jsx/dist/index/index.js        ← monorepo ROOT
  └─ next/dist/compiled/next-server/pages.runtime.prod.js
      └─ apps/web/.next/server/pages/_document.js
```

`styled-jsx` is a transitive dependency of `next`. npm hoists it to the **root**, while `next` stays nested in `apps/web`. It therefore resolves `react` against the **root** `node_modules` — which held `18.3.1`, hoisted there for React Native 0.76. Prerendering loaded a second React instance, and the two shared no dispatcher.

The repo genuinely needs two React majors (Next 15 App Router wants 19; RN 0.76 pins 18.3.1). They cannot be reconciled by picking one — what matters is **which version occupies the root slot**, because hoisted transitive dependencies resolve against it. Fixed by declaring `react`/`react-dom` at `19.2.8` in the root `package.json` purely to control hoisting, plus a scoped `overrides` pinning Clerk's `next` peer.

**Three hypotheses were tested and rejected first, each by experiment:**

| Hypothesis | How it was killed |
|---|---|
| React major mismatch in `apps/web` | Failed with React 18 *and* React 19 |
| `transpilePackages` pulling `auth-provider` in | Removing it changed nothing; `apps/web` imports only `@zsms/config` |
| Mismatched SWC binary | The `@next/swc` warning was a benign hoisting artifact, correct at `15.5.23` |

A pristine Next 15.5.23 + React 19.2.8 app built outside the monorepo compiled cleanly — that is what localised the fault to the dependency tree rather than the framework. **The lesson: I guessed twice before isolating, and both guesses cost a full reinstall cycle. The pristine-app comparison should have been the first move, not the fourth.**

Verified after the fix: `turbo type-check` 8/8, `turbo build` clean and stable across repeat runs.

**What remains after the upgrade**, none of it currently reachable, all of it needing a decision before it becomes reachable:

| Package | Issue | Reachable when | Fix |
|---|---|---|---|
| `sharp` `<0.35.0` | libvips CVEs | a user-uploaded image passes through `next/image` | sharp ≥ 0.35, or serve images straight from R2/Cloudflare and bypass the Next optimizer |
| `postcss` | sourceMappingURL path traversal, stringify XSS | only if we ever process untrusted CSS | build-time only; we author all CSS |
| `tar` **critical** | hardlink path traversal | build/install time under Expo 52 | needs Expo 57 (major) |

`sharp` is the one that matters: ZSMS will serve student photos and school logos. **Resolve it before any user-uploaded image is served through `next/image`.**

### 2. Branch protection — **DEFERRED, not skipped**

**Blocked by GitHub plan, not by configuration.** Rulesets and branch protection are not enforced on a **free private organisation repository**. The rules can be created, but GitHub does not apply them, so a direct push to `main` still succeeds. The user set protection on `main` manually; it will not take effect until the org moves to **GitHub Team**.

**Until then, ADR-011's workflow rests on PR discipline, not platform enforcement.** Treat `feature/* → integration → main` as a convention that nothing prevents you from violating. Do not assume a failed push means the rule worked.

Re-attempt when the org upgrades to Team. Two settings to get right at that point:

- **Required approvals: 0**, not 1, while there is a single maintainer — GitHub forbids approving your own PR, so 1 makes `main` unmergeable.
- **Leave "Do not allow bypassing" off** until the workflow is proven; with 0 reviewers it can lock the owner out of the default branch.

Required status checks were deliberately left unconfigured — there is no CI yet (the Layer 7 gap). They should be added the moment `CI_CD.md` lands. **That is what actually makes prohibition 4 — no table without an RLS policy — enforceable rather than aspirational.**

`gh` is also not installed on this machine (neither Windows PATH nor Git Bash) and no token is configured, so any future attempt needs `winget install GitHub.cli` and `gh auth login` first.

### 3. Migration versioning convention — established

Root cause of the `0001` desync: **the version string and the filename come from different places.** Supabase keys `supabase_migrations.schema_migrations` on a version string; the MCP's `apply_migration` writes a timestamp version regardless of what the file is called, and `supabase migration new` generates timestamp *filenames*. Either one breaks the `NNNN_` convention.

The ordering consequence is worse than the naming one: **versions sort as strings, so a timestamp version sorts after every four-digit version.** One stray timestamp silently reorders the entire sequence — and the sequence is load-bearing, since `0001`'s `has_permission_grant()` depends on tables created in `0003` and `0017`.

Resolution — the Supabase CLI is now the only supported path:

- CLI pinned as a root `devDependency` (**2.114.0**) so every developer and CI runner uses one version
- Added `db:push`, `db:list`, `db:diff` scripts alongside the existing `db:types` / `db:test`
- Full procedure documented in `MIGRATIONS.md` → *Migration Versioning and Application Procedure*, summarised in `CLAUDE.md`
- MCP `apply_migration` is now dev-exploration only, and requires the history-row correction in the same session
- Staging and production are release actions requiring explicit human approval, with a re-link-to-dev-immediately rule

**Latent bug found in passing:** `package.json` already had `db:types` and `db:test` calling a bare `supabase`, but the CLI was not installed anywhere — globally, locally, or as a dependency. Both scripts would have failed the first time anyone ran them. Fixed by the pin above. Also corrected placeholder project refs (`zsms-dev-ref`) and a generated-types path in `MIGRATIONS.md` that disagreed with `package.json`.

### 4. Permission configuration — persisted to the repo

Written to `.claude/settings.json` (tracked, team-shared) rather than `settings.local.json`, so it survives sessions and applies to everyone.

Routine and reversible work now runs unprompted: reads, edits, builds, type-checks, tests, local git, and `zsms-dev` queries and migrations. Irreversible or outward-facing work still prompts: pushes, branch deletion, `reset --hard`, file deletion, project re-linking, Edge Function deploys, and anything aimed at a non-dev project. Force-push and reading `.env` / key material are denied outright rather than merely gated.

**Two things this required beyond a plain allow-list:**

- **A `PreToolUse` hook** (`.claude/hooks/guard-supabase-sql.js`). Permission rules match on *tool name only*, so allowing `execute_sql` for routine dev queries would equally allow `DROP TABLE` — the split the user asked for is not expressible in rules alone. The hook inspects the SQL and escalates on `DROP`, `TRUNCATE`, `ALTER … DROP`, `DELETE`/`UPDATE` without `WHERE`, `DISABLE ROW LEVEL SECURITY`, and on any `project_id` that is not `zsms-dev`. It fails closed: an unparseable payload escalates rather than passes. Verified against eight payloads covering both directions.
- **Pruning `settings.local.json`.** It had accumulated ~70 one-off approvals from earlier sessions, including `git push origin main` and `git push -f origin integration`. Local settings **outrank** project settings, so those entries would have silently defeated the very rules being added. Reduced to four durable entries; backup kept in the session scratchpad.

**Known gap, deliberate:** MCP permission rules cannot match on arguments, so `apply_migration` cannot be allowed for dev while prompting for staging. The hook closes this by reading `project_id`, but the hook is the only thing enforcing it — if it is removed or errors non-fatally, the rule reverts to allow-all-projects. Revisit when `zsms-staging` is provisioned.

---

## 2026-08-13 — Phase 0 scaffold

**State at start:** documentation-only repo, 118 markdown files, empty `zsms-dev` schema.
**State at end:** Turborepo monorepo with all three provider abstractions stubbed, migration `0001` applied and verified, `main` and `integration` both on GitHub.

### Completed

**Monorepo** — `apps/web` (Next.js 14 App Router, `/api/health` returning component-level status per `AVAILABILITY.md`), `apps/mobile` (Expo 52 / RN 0.76), six workspace packages, `supabase/{migrations,functions,tests/rls,seed}` + `config.toml` exposing only `public`.

**Abstractions** — all three stubbed interface-complete with dynamic imports so the scaffold builds before dependencies land:

| Package | Default | Alternate | Swap point |
|---|---|---|---|
| `@zsms/queue` | BullMQ (ADR-035) | QStash fallback | `JOB_QUEUE_PROVIDER` |
| `@zsms/auth-provider` | Clerk | Keycloak (Tier 2, throws until built) | `AUTH_PROVIDER` |
| `@zsms/storage` | Cloudflare R2 | MinIO (Tier 2) | endpoint + credentials |

Boundary verified by grep: no `@clerk/*`, `bullmq`, `@upstash/qstash`, or `@aws-sdk/*` import exists outside its owning wrapper.

**Migration `0001`** — written, applied to `zsms-dev`, verified:
- `vector` + `pgtap` `WITH SCHEMA extensions`, never `public`
- Seven canonical RLS helpers from `RLS.md`, implemented verbatim
- `public`: **0 tables, 7 functions**; `extensions`: 1,252 functions
- `SET LOCAL check_function_bodies = off` — `has_permission_grant()` reads tables from `0003`/`0017` that do not exist yet
- History version corrected from the MCP timestamp `20260813143727` to `0001` so `supabase db push` reconciles against the `NNNN_` convention

**Helper reconciliation** — proposed `is_afritech_staff()` and `is_school_admin()` were **not** created. Competing near-synonyms in a security layer are how the wrong check lands in a policy. Mapped to `is_afritech_admin()` and `get_user_role() IN (...)` respectively; recorded in `MIGRATIONS.md`.

### Documentation bugs found while scaffolding

Writing the migration surfaced a cluster the earlier reconciliation pass missed — all in the same family (`ARCHITECTURE.md`/`AUTH.md` drifting from `RLS.md`):

| Bug | Fix |
|---|---|
| `get_school_id()` returned `uuid` from `user_metadata` in **two** docs | Corrected to `RLS.md`'s TEXT/`auth.jwt()` version |
| Example policy compared a UUID column to `get_school_id()` | Type error — corrected to resolve via `schools.clerk_org_id` |
| `ARCHITECTURE.md` listed 5 of 8 `org:*` roles | Added `org:admin`, `org:parent`, `org:student` |
| `RLS.md` role list omitted `org:staff` | Added |
| `AUTH.md` `ZsmsJwtClaims` used `org_id`/`org_role`/`metadata` | Corrected to compact `o`/`act` claims |
| Two alumni "indefinite session" references | Corrected to 30 days |

**Lesson:** the earlier text-level sweep caught string mismatches but not *semantic* drift between an authoritative doc and its illustrative copies. Implementing against a doc is what exposed it. Expect more of this at each phase boundary.

### Build verification

| Check | Result |
|---|---|
| `npm install` | 703 + 96 packages, exit 0 |
| `turbo type-check` | **8/8 workspaces pass** |
| `turbo build` | **pass** — `/` static, `/api/health` dynamic (ƒ), 87.1 kB shared JS |
| Abstraction boundaries | no `@clerk`, `bullmq`, `@upstash/qstash`, or `@aws-sdk` import outside its wrapper |

Two scaffold defects found and fixed during verification:
- **Implicit `@types/*` inclusion.** With hoisted workspaces, `tsc` pulled every `@types` package in the root and failed to resolve them. Fixed with `"types": []` in `tsconfig.base.json` plus explicit per-workspace declarations.
- **`.js` extensions in relative imports.** `tsc` under `moduleResolution: "Bundler"` accepted them; webpack could not resolve `./countries/zm.js` against `zm.ts`. Stripped from 11 source files. Worth remembering: type-check passing does not imply the bundler agrees.

### Open items carried forward

- `INDEXES.md` still needs the eight `afritech` index entries when `0065` is written
- Layer 1 (Frontend) and Layer 7 (CI-CD) remain **Thin** in `THIRTEEN_LAYER_COMPLIANCE.md`; CI must land before the first production migration
- `next@14.2.18` carries a published security advisory (npm deprecation warning points to the 2025-12-11 Next.js security update). Needs a patch bump within 14.x before any deployment — flagged, not applied, since it is a dependency-policy decision

---

## 2026-08-13 — Documentation reconciliation, architecture gap fill, repo initialisation

**State at start:** documentation-only repository, 108 markdown files, no git, no Supabase schema.
**State at end:** 118 markdown files, git initialised on `main` with remote configured, `zsms-dev` extensions enabled, all known documentation contradictions resolved.

### Completed

**Repository setup**
- `git init`, branch renamed `master` → `main` (ADR-011 workflow)
- Remote `origin` → `https://github.com/AfriTechSystems/zsms-monorepo.git`
- `.gitignore` — secrets, `.claude/settings.local.json`, `~$*.docx`, Node/Turborepo/Next/Expo/Supabase
- `.gitattributes` — `* text=auto eol=lf`, CRLF for Windows scripts, binary and generated-file handling
- `CLAUDE.md` authored — repo state, doc map, conventions, Supabase environments, known inconsistencies

**Supabase (`zsms-dev`, ref `tevblmcebsqqjgzjptgw`)**
- `vector` 0.8.2 and `pgtap` 1.3.3 enabled, relocated to the `extensions` schema
  (they initially landed in `public`, adding ~1,190 functions to the schema PostgREST exposes and `supabase gen types` introspects)
- Region confirmed as `eu-west-1` — a deliberate, documented exception; synthetic data only
- Schema remains empty; migrations are specified but not applied

**Documentation — 10 new documents**
- `THIRTEEN_LAYER_COMPLIANCE.md`, `DYNAMIC_CONFIG.md`, `BUILD_SEQUENCE.md`
- `COST_MANAGEMENT.md`, `CACHING_CDN.md`, `SCALING.md`, `AVAILABILITY.md`, `DEPLOYMENT_TOPOLOGY.md`, `HOSTING_STRATEGY.md`
- `LOAD_TESTING.md`

**Documentation — six new ADRs (030–035)**
13-layer compliance · dynamic-config-everything · three-tier deployment topology · k6 load testing · context-aware AI assistant with approval-gated writes · BullMQ as default job queue

**Contradictions resolved**
| Was | Now |
|---|---|
| QStash-first vs BullMQ-first | ADR-035 is sole source of truth; 0 unqualified references remain |
| `RAILWAY.md` "is a database only" | Standby **+** BullMQ workers; correlated-failure risk flagged |
| `DATABASE.md` / `SUPABASE.md` "two schemas" | Three schemas, counts corrected |
| 365-day sessions in 5 documents | 30 days, per the 2026-06-23 `SESSIONS.md` revision |
| Migration gap in `DYNAMIC_CONFIG.md` | Closed — migrations `0061`–`0065` |

**Migration gap closure**
`DYNAMIC_CONFIG.md` specified `afritech` tables with no migration. Recorded as five; cross-check found **eight** — `platform_settings`, `platform_products`, and `commission_rates` were also missing. All eight now defined in migrations `0061`–`0065` with full DDL, deny-by-default RLS, and indexes. **Documentation only — not applied to any database.**

### Incidents

- **UTF-8 corruption during bulk edit.** A PowerShell find/replace across 32 files read them as ANSI (PS 5.1 default), double-encoding every non-ASCII character and adding BOMs. Detected, reversed via CP1252 round-trip, BOMs stripped. Verified clean across all 118 files. **Lesson: use `[System.IO.File]::ReadAllBytes` with explicit UTF-8 decoding in PS 5.1, or use `sed`.**

### Verification at close

| Check | Result |
|---|---|
| QStash-as-default claims | 0 |
| Unqualified QStash references | 0 |
| Mojibake / BOM | 0 / 0 |
| "two PostgreSQL schemas" | 0 |
| Stale 365-day sessions | 0 |
| Stale migration range | 0 |
| ADRs | 35 |
| Markdown files | 118 |

### Open items

- `THIRTEEN_LAYER_COMPLIANCE.md` Layer 1 (Frontend) — **Thin**, needs `FRONTEND.md` before substantial UI work
- `THIRTEEN_LAYER_COMPLIANCE.md` Layer 7 (CI-CD) — **Thin**, needs `CI_CD.md` before the first production migration
- PowerSync has no documented self-hosted path — largest open risk in the Tier 2 deployment model
- `INDEXES.md` needs the eight `afritech` index entries when `0065` is written
- Clerk per-MAU billing vs permanent alumni accounts (ADR-015) — unmodelled cost growth

---

## Next step

**Phase 1** — per `01 Foundation Layer/BUILD_SEQUENCE.md`. The Phase 0 scaffold has landed; what remains of Phase 0's scope carries into Phase 1:

1. Migrations `0002`–`0065` written and applied to `zsms-dev` **via the CLI** (`MIGRATIONS.md` procedure)
2. RLS policy for every table, with pgTAP coverage — a table without a policy is a defect
3. Clerk wired through `packages/auth-provider`; signup → school created → Clerk org provisioned → authenticated dashboard
4. A job enqueued through the queue abstraction, processed by a BullMQ worker (ADR-035)
5. CI/CD — closes the Layer 7 gap; must precede the first production migration
6. Sentry and PostHog
7. `zsms-staging` provisioned in `af-south-1`

**Phase 0 exit gate:** signup → school created → Clerk org provisioned → authenticated dashboard; pgTAP isolation suite passes; a job enqueued through the abstraction is processed by a worker; CI blocks a merge adding a table without an RLS policy.

### Blocking before Phase 1

Nothing blocking. Both prior blockers are closed:

- **Next.js version decision** — resolved; upgraded to 15.5.23 per ADR-036, all 21 advisories cleared.
- **Branch protection** — **deferred, not skipped.** Not enforceable on a free private org repo; revisit at GitHub Team. Until then the ADR-011 workflow is convention only, with nothing preventing a direct push to `main`.

`integration` fast-forwarded to `main` at `8ffbddb`, so Phase 1 feature branches start from the security fix rather than from vulnerable Next 14.

### Open items carried forward

- `INDEXES.md` still needs the eight `afritech` index entries when `0065` is written
- Layer 1 (Frontend) and Layer 7 (CI-CD) remain **Thin** in `THIRTEEN_LAYER_COMPLIANCE.md`
- `sharp` `<0.35.0` — **must be resolved before user-uploaded images pass through `next/image`**
- `tar` critical advisory under `apps/mobile` — needs Expo 57 (major); build-time only
- The root `react`/`react-dom` pin and the Clerk `next` override exist only to control npm hoisting — remove both once React Native supports React 19
- PowerSync has no documented self-hosted path — largest open risk in the Tier 2 deployment model
- Clerk per-MAU billing vs permanent alumni accounts (ADR-015) — unmodelled cost growth
