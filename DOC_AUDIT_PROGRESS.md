# Documentation Audit — Progress Tracker

**What this is.** A walk through all 18 numbered folders of `Official Documentation/`, one
at a time, checking every claim each document makes against what is actually built —
database, API route, screen, and the link a user presses to reach it. Where something is
missing it gets built; where the document is wrong it gets corrected.

**Why it is tracked in a file.** The audit spans many sessions. Without a record, each one
re-derives which folders are done and what was deferred, and the deferrals quietly become
permanent.

**How to use it.** Read this before starting an audit pass. Update the row when a folder is
finished, and move anything deferred into *Carried forward* with a reason — a deferral with
no reason is how a gap disappears.

---

## Scoring

| Band | Meaning |
|---|---|
| **Excellent** (90–100%) | Built, reachable, matches the document, and verified by exercise |
| **Good** (70–89%) | Built and reachable; gaps are documented and deliberate |
| **Fair** (40–69%) | Substantially built, with real gaps or unreachable work |
| **Bad** (0–39%) | Mostly unbuilt, or the document describes something that does not exist |

A score measures **what is built against what the document promises**, not documentation
quality on its own.

---

## Progress

| # | Folder | Files | Status | Score | Finished |
|---|---|---:|---|---|---|
| 01 | Foundation Layer | 14 | **Done** | Good · 73% | 2026-10-06 |
| 02 | Authentication and Identity | 5 | **Done** | Good · 88% | 2026-10-11 |
| 03 | Infrastructure Services | 20 | **Done** | Good · 78% | 2026-10-11 |
| 04 | Country and Configuration | 2 | **Done** | Excellent · 90% | 2026-10-11 |
| 05 | Core Database and API Reference | 8 | **Done** | Good · 82% | 2026-10-11 |
| 06 | School and Tenant Management | 6 | **Done** | Good · 85% | 2026-10-11 |
| 07 | Student and Parent Modules | 5 | **Done** | Good · 88% | 2026-10-11 |
| 08 | Staff Management | 5 | **Done** | Good · 87% | 2026-10-11 |
| 09 | Fee and Financial Management | 6 | **Done** | Good · 85% | 2026-10-11 |
| 10 | Attendance | 4 | **Done** | Good · 80% | 2026-10-11 |
| 11 | Examinations and Results | 5 | **Done** | Good · 88% | 2026-10-11 |
| 12 | Communication System | 6 | **Done** | Fair · 65% | 2026-10-11 |
| 13 | Document and PDF System | 4 | **Done** | Good · 86% | 2026-10-11 |
| 14 | Loan and Finance Module | 7 | **Done** | Good · 82% | 2026-10-11 |
| 15 | Super Admin and Platform | 5 | **Done** | Good · 84% | 2026-10-11 |
| 16 | Testing and Launch | 6 | Not started | — | — |
| 17 | Integration and Pricing | 5 | Not started | — | — |
| 18 | AI Module | 5 | Not started | — | — |

---

## 01 — Foundation Layer (Good, 73%) · 2026-10-06

14 documents, not 13. Per-document scores are in the session record; the summary:

**Strong.** CONVENTIONS 95%, RLS 95% (214 policies, 0 tables without RLS, forced
everywhere), DYNAMIC_CONFIG 92%, DESIGN_SYSTEM 90%.

**Weak.** CHANGELOG 25% (stale since 2026-08-14 — now caught up), ENV 45%, DATABASE 55%
(documented 49 of 93 tables).

**Built in response:** PostHog with autocapture off, origin security headers, ADR-012
custom staff roles (`0228`), ADR-015 marketing consent and the alumni access proof
(`0229`), ADR-023 integrations (`0230`), ADR-044 settling Edge Functions.

**Corrected:** `DATABASE.md` had said *"If there is a conflict between this document and
the code, this document takes precedence and the code must be corrected"* — removed, since
the schema is the fact and a document is a claim about it. Added generated
`SCHEMA_INVENTORY.md` rather than hand-transcribing 52 tables that would drift within a
week.

---

## 02 — Authentication and Identity (Good, 88%) · 2026-10-11

Assessed at **Fair 55%**, then remediated in the same pass. Re-scored after.

| Document | Was | Now | What changed |
|---|---|---|---|
| PERMISSIONS.md | 55% | **95%** | The whole system was unreachable; `0236` made it usable |
| ROLES.md | 75% | **92%** | The six `afritech:*` roles were one boolean; `0237` separated them |
| IMPERSONATION.md | 40% | **85%** | `0238` mints real actor tokens, records sessions, shows a banner |
| AUTH.md | 65% | **85%** | Student and alumni portals built; entry-point table corrected to reality |
| SESSIONS.md | 40% | **80%** | ADR-045 settles the duration question honestly; anomaly detection still unbuilt |

### What was built

- **`0236` — permission grants.** The tables, the function and **15 live RLS policies**
  existed with no route, no screen and no rows, so the function always returned false.
  Writing now goes through `grant_staff_permission()` rather than the INSERT policy,
  because "you cannot grant what you do not hold" cannot live in a route a direct
  PostgREST call skips. Screen at `/school/[code]/settings/permissions`.
- **`0237` — AfriTech roles.** `afritech_role()`, `has_afritech_capability()` and
  `afritech.staff_scope_assignments`. `is_afritech_admin()` is unchanged because **91
  policies call it**. Matrix visible at `/admin/team`.
- **`0238` — impersonation.** Actor tokens minted through `auth-provider` (ADR-032
  intact), sessions recorded separately from `audit_logs`, banner in the root layout, and
  a school owner can read sessions against their own school.
- **`0239` — pupils and alumni.** Policies keyed on `students.clerk_user_id` and never on
  the org claim, which is what lets a graduated pupil keep reading their history after
  their membership is revoked. One portal for both (ADR-046).

### Decisions recorded

- **ADR-045** — one Clerk session lifetime (7 days), not fifteen. SESSIONS.md's table is
  not expressible as Clerk configuration, and a parallel session store would sign people
  out mid-payment when two clocks disagreed.
- **ADR-046** — pupils and alumni share one portal. `alumni_profiles` is not built and
  should not be.

### Still open

- Suspicious activity detection: none of the five patterns, and no alerting path.
- 32 of 34 `admin_*` functions still use the plain `is_afritech_admin()` check.
- The two-day grant expiry notification needs a notification channel.
- Phone-based login is blocked on SMS OTP, which was disabled on cost grounds.

## 03 — Infrastructure Services (Good, 78%) · 2026-10-11

Assessed at **Fair 52%**, then remediated. The pattern was sharp and worth remembering:
**where ZSMS writes code it was done; where ZSMS needs an account it was not.**

### Built this pass

- **HTTP rate limiting** (`lib/rate-limit.ts`). There was none. `ai_assistant_quota()`
  and `consume_message_quota()` are real but are BILLING limits — neither notices ten
  thousand requests a minute. Middleware, ahead of authentication, failing open.
- **API integration, Tier 2 end to end** (`0241`). `school_api_keys` was specified and
  absent. Keys hashed and shown once, owner-only, `/api/v1/` read endpoints, usage log
  including refusals, management screen. Tenant isolation tested, not reasoned about.
- **Unit economics** (`0240`, `/admin/costs`). Consumption per school, no invented money.
- **Cache convention** — the doc changed to match the code, per the decision that
  `zsms:` namespacing is worth keeping in a shared Redis.

### Scores after

| Band | Documents |
|---|---|
| Excellent | R2 95, BULLMQ 90, SUPABASE 90 |
| Good | CLERK 85, POSTHOG 85, API_INTEGRATION 80, CACHING_CDN 80, SENTRY 70, HOSTING_STRATEGY 70, COST_MANAGEMENT 70 |
| Fair | META_API 55, TWILIO 55, QSTASH 55, VERCEL 50, CLOUDFLARE_WAF 50, RAILWAY 45, DEPLOYMENT_TOPOLOGY 40, SCALING 40, AVAILABILITY 35 |
| Deferred | POWERSYNC — paid service, online-first by decision |

Every one of the twenty now carries an **Implementation Status** block saying what is
built, what is credential-blocked, and what is deferred — so the next reader does not
have to re-derive which is which.

### Still open

- **AVAILABILITY is the weakest.** `/api/health` reports component status and **nothing
  polls it.** No alerting, no PITR verification, no standby. Recovery objectives are
  targets with nothing measuring them — worth knowing before quoting them to a customer.
- API write endpoints (Tier 1/3): a write with no user behind it needs idempotency on a
  caller-supplied key, or a retry double-records a payment.
- Outbound webhook registration (`webhooks:receive` scope exists, no endpoint).
- Billing alerts, which want real spend data first.

## 04 — Country and Configuration (Excellent, 90%) · 2026-10-11

Two documents, and the smallest folder so far — but it held one real product gap.

**`reference_subjects_zm` held 16 of the 62 subjects ZM.md lists, and none at A-level.**
That table is what a school picks from during onboarding, so a secondary school found
about a quarter of its curriculum and typed the rest by hand — at exactly the moment it
is deciding whether ZSMS knows anything about Zambian schooling. A sixth form found
nothing. `0242` seeds all 62, extracted from ZM.md's own tables by script rather than
transcribed, because a mistyped code does not fail — it quietly never appears.

**`npm run country:check`** is new: it prints every place in the live schema that assumes
Zambia. `ADDING_COUNTRY.md` is an eight-step runbook that would have failed *gradually* —
the first school in a new country refused by one CHECK, then another, each looking like a
bug. ADR-040 rightly defers widening them; what was missing was that the list existed
nowhere, so the runbook promised a path nobody had walked.

The script found **ten** places where ADR-040 listed five, and corrected it twice:

- **`term_number` is not coupled.** Every CHECK admits 1–4, so a four-term country
  already works. One fewer thing to do.
- **`school_subjects.curriculum_type` was missed**, and it is on a table schools write to
  — so it would have been met sooner and read as a stranger bug.

Also added `appName` and `whatsAppSenderId`, which ZM.md specified and the type omitted.

**Already country-neutral, and worth not re-solving:** `packages/config` has the country
index Step 2 describes — keyed by code, selected by `NEXT_PUBLIC_COUNTRY_CODE`, with an
error naming the runbook. Step 2 is satisfied.

## 05 — Core Database and API Reference (Good, 82%) · 2026-10-11

### Built

- **Per-key rate limiting.** `rate_limit_rpm` was stored by `0241`, shown on the
  management screen, and consulted by nothing — my own gap from the previous pass. A
  limit a school can see and set, and that does not apply, is a promise rather than a
  limit.
- **Middleware policies aligned with RATE_LIMITS.md's seven categories** rather than the
  three broad bands shipped the day before. Its distinctions are the useful ones: a
  broadcast and a dashboard read are not the same risk.
- **Webhooks, the first one ever.** `0243` builds idempotency keyed on the provider's own
  event id — delivery is at-least-once, so without it a retried gateway callback credits
  a fee twice. `lib/webhook-verify.ts` handles both signature styles in the document,
  constant-time, Edge-compatible, with ten smoke checks including forgery, replay and
  future-dating. `POST /api/webhooks/clerk` is live and needs only the signing secret.
- **Three error codes added to the envelope** — `RATE_LIMITED`, `INSUFFICIENT_SCOPE`,
  `API_KEY_INVALID` — because code here already returned them and a type that does not
  admit what it sends disagrees with reality.
- **`ENDPOINT_INVENTORY.md` generated.** `ENDPOINTS.md` catalogues 74 routes of 124.

### What `npm run gaps` caught

Two pieces of **my own** unreachable work from earlier passes —
`admin_integration_health()` and `admin_marketing_consent_summary()`, both built with no
route and no screen. Now called by `/api/admin/overview`. Three more are called from SQL
rather than source and are ACCEPTED with reasons.

An exception nearly went in wrong: `ACCEPTED_ROUTES` is keyed relative to the api
directory, and a full path matches nothing silently — the entry would have looked
recorded while the warning stayed.

### Still open

- **Nine of ten webhooks**, every one blocked on an account that does not exist —
  seven gateways, Meta, a lending partner. The foundation is built, so each is a handler
  rather than a project.
- **Outgoing webhooks** (ZSMS → school systems). The `webhooks:receive` scope exists in
  `0241`; registration and delivery do not.
- Three pre-existing orphaned functions: `admin_publish_prompt_template`,
  `ai_credit_topup`, `revise_grading_scale`.
- Clerk-side OTP rate limits, which are instance settings rather than ZSMS code.

## 06 — School and Tenant Management (Good, 85%) · 2026-10-11

Six documents. Two commercial holes, both found by reading what the documents promise
and asking whether anything enforced it.

### Trials never expired

`schools.status` admitted `trial_expired` since `0003`; `register_school()` set
`trial_ends_at` since `0150`; **no code made the transition.** One school on `zsms-dev`
was past its date with full access. `0244` fixes it, deleting nothing — TRIAL.md promises
twice that data survives.

### Which exposed something larger: no recurring job was scheduled at all

`scheduleRecurring()` existed in `packages/queue` on both queue backends with a matching
type entry, and **nothing had ever called it.** So `check-scheduled-announcements` had a
worker, a handler, and a comment reading "cron every 15 minutes" — and no cron. An
announcement a school scheduled for Monday would have sat in the table forever.
`apps/workers/src/schedule.ts` registers both on startup.

### The API was a paid add-on and was free

SUBSCRIPTION.md prices API Read at K138 and API Write at K275. The flags existed; `0241`
checked neither, so any school could use the API for nothing. `0245` gates it at issue
AND at verify — the second is the one that matters, because without re-resolving each
call a cancelled add-on leaves the key working forever.

No key was revoked. A school already wired in is a commercial conversation, and
`/admin/costs` now lists the mismatches so it starts from a list.

### Deliberately not built

**Per-school WhatsApp configuration.** `SCHOOL_CONFIG.md` describes a shared-number
default and a bring-your-own-number path. Neither column exists, and `ARCHITECTURE.md`
referred to both as though they did — a false claim now corrected. Not built because
**neither option can send**: no Meta account, and `FIELD_ENCRYPTION_KEY` unset so a
school's token could not be kept safely. A settings screen where both choices are inert
is a screen that lies.

**The trial notification schedule** — all ten touchpoints, blocked on email. The worker
logs each expired school by name so somebody can telephone.

## 07 — Student and Parent Modules (Good, 88%) · 2026-10-11

Five documents. Most of this folder was already built — the finding was one artefact
nobody could produce, and one format nobody checked.

### The transfer letter was never produced

`transfer_letter` had been an allowed `doc_type` since `0087`, a type in
`packages/documents`, and listed in `/api/documents`. **Nothing rendered one.** A school
transferring a pupil had no letter for the family — the one physical artefact a transfer
produces, and what the receiving school asks for.

Now built end to end: `renderTransferLetter()`, `0246`'s context and reference functions,
a queued worker that stores to R2 at the path TRANSFER.md specifies, and the checkbox
ticked by default as recommended.

Queued rather than rendered inline so a transfer still completes when R2 is briefly
unavailable — the pupil's status must not fail; the letter is retryable.

### The pupil identifier format was unenforced

`students.student_id` was NOT NULL and UNIQUE, and the format `STU-ZM-LSK-0001-00042` —
specified in two documents — was enforced nowhere. `STU-ZM-LSK-1-42` would have stored
cleanly and then failed every lookup built on the documented shape. A pupil who exists
and cannot be found is worse than a refused insert at the moment of the typo. `0247`
adds the CHECK; all 254 existing pupils already matched.

### Already built, and better than first appearance

The external transfer UI **is** on the pupil's page, where TRANSFER.md says. My first
pass called it missing because I searched for a filename rather than checking the page.

The 30-day unlink grace period **is** honoured — `is_linked_parent_of()` admits an
inactive link whose `grace_period_ends_at` is still in the future. That is the kind of
detail most likely to have been skipped, and it was not.

### Still open

- The marketing opt-in prompt at transfer: the column exists and defaults FALSE; the
  screen does not.
- `packages/validators` does not exist. The one regex lives beside the data instead,
  because a package for a single expression is two places for it to drift.

## 08 — Staff Management (Good, 87%) · 2026-10-11

Five documents. Two real gaps, and one of them had live bad data.

### Staff could not edit their own profile

`staff_read_own_record` let them READ since `0014`; there was no UPDATE path, so a
teacher whose phone number changed had to ask the office. `0249` adds it — on `/account`
rather than in a school's settings, because a phone number belongs to a person and
STAFF.md's multi-school case is real.

**The first draft opened an escalation and its own assertion caught it.** `authenticated`
already holds a table-level UPDATE on `staff_members`, and a column grant unions with a
table grant rather than narrowing it — so a self-scoped policy would have let any member
of staff write `school_id`, `is_active` or `staff_number` on their own row. It goes
through a SECURITY DEFINER function instead, which cannot reach what it does not name.

### Two teachers could be class teacher of one class

ASSIGNMENTS.md says one. The unique index covered
`(school_id, teacher_user_id, class_id, academic_year)`, which stops the same teacher
twice and permits two different ones — and **three classes on `zsms-dev` had exactly
that**. Since a `scope = 'class'` row is what RLS reads to decide who may mark a
register, that is two people holding a responsibility the school believes one holds.

Resolved the way the document's own replace flow does: stand the older down, keep the
newest, delete nothing. The new index is partial on `is_active` so a handover still works.

### Not built, with reasons

- **Bulk invitation.** Clerk's free plan caps an organisation at five members, so a CSV
  of 20–30 teachers would invite five and fail the rest — worse than not offering it.
  Worth building immediately after a paid plan.
- **"Subject must exist" / "class must exist" validation.** `class_id` is TEXT with no
  foreign key, which is how grade structures stay school-configurable while Zambia runs
  two systems at once. The validation belongs in the route and is a real gap there.

### Folder 07's open item closed in the same pass

The departure marketing prompt (`0248`) — asked once when a child leaves, never
pre-ticked, and clicking Continue without ticking counts as an answer rather than a
deferral.

## 09 — Fee and Financial Management (Good, 85%) · 2026-10-11

Six documents. The fee path turned out to be almost entirely configuration-driven already
— no hardcoded prices, no hardcoded tiers, receipt numbers matching the documented format
exactly. One exception, and it was a consequential one.

### The reminder schedule was two constants in a TypeScript file

`?? 3` and `?? 7` in the fee-reminder handler decided when **every school in Zambia**
chased a parent for money, and they did not match REMINDERS.md's 7/14/30. Nothing passed
those options, so the defaults were the behaviour.

`0251` makes it per-school: the rungs, the three channels separately (WhatsApp costs quota,
the others do not), a cooldown, and an off switch that keeps the schedule. `0252` makes the
worker read it. Screen at Settings → Fee reminders.

**`0252` deviates from the documented rule deliberately.** Exact day matching, which the
document specifies, means a missed cron run on day 7 sends **no** 7-day reminder ever. The
duplicate it guards against is already handled by the cooldown. So it counts rungs passed
against reminders received — same cadence, late instead of never, and arithmetically
incapable of over-sending.

### The final-notice template was named but never seeded

Only `fee_reminder` existed, so a family thirty days in arrears got the same gentle nudge
as one seven days in, three times. `fee_reminder` also had no in-app row, though a school
can choose in-app as its only channel — which would have sent nothing, silently. `0253`
seeds both and asserts every choosable channel has a template on both rungs.

### I opened a tenant hole and closed it in the same session

`0251` granted `school_reminder_settings(UUID)` — SECURITY DEFINER, no tenant clause — to
`authenticated`, so any signed-in user could read any school's chasing schedule by changing
a UUID. Caught while wiring the route, fixed in `0254` with a no-argument
`my_reminder_settings()`. Commercially sensitive rather than catastrophic, and exactly the
pattern the migration skill names first: never trust an id passed as an argument.

### Deferred, with reasons

- **GATEWAY.md** is outside the current product model, not behind it. Parents pay their
  school by whatever rail the school uses and upload proof; nothing in that path needs a
  gateway. When built it automates the recording step, and it is blocked on both credentials
  and one of the nine unbuilt webhook routes.
- **`payments.payment_method` has no `mobile_money`** — the dominant Zambian rail is
  recorded as `online_gateway`, losing the distinction on every receipt. Needs a migration
  and a product decision.
- **Delivery remains unproven.** The schedule is correct; no Meta/Twilio/Resend credentials
  exist, so no reminder has left this machine.

## 10 — Attendance (Good, 80%) · 2026-10-11

Four documents, one of which (`OFFLINE_SYNC.md`) is deferred by a commercial decision
rather than scored as a failure.

### Marking a child absent had never told their parent anything

`attendance_records.parent_notified` and `.notification_sent_at` have existed since
`0074`. **Nothing had ever read or written either one.** The `absence_alert` template
existed. The quota meter existed. Only the decision to send was missing — the exact
"backend built, no chain" shape `npm run gaps` exists to catch, except that here the
missing link was in the middle rather than at the end.

Built in `0255`: a per-school toggle (default OFF), `worker_due_absence_alerts()`, the
worker handler, an hourly weekday schedule, the route and the screen.

### I did not build the trigger the document specifies, and wrote ADR-047 to say why

TRIGGERS.md's Trigger 1 is a row trigger calling `net.http_post()` to an Edge Function
with a service-role key read from database configuration. Three independent problems:

1. **An HTTP call inside the register's transaction.** Forty pupils, eight absences,
   eight sequential round-trips before the INSERT commits. On failure there are only two
   outcomes and both are wrong: roll back the teacher's attendance, or silently drop the
   alert. Attendance is the record of record; a notification is a convenience.
2. **It needs an Edge Function, and ADR-044 superseded those.**
3. **A service-role key in database configuration**, readable by every DEFINER function,
   to save a lookup.

Polling also buys retry, which a trigger structurally cannot: with a trigger the moment
of the INSERT is the only chance to send.

### The quota number is the feature, not the switch

NOTIFICATIONS.md does the arithmetic — 400 pupils at 5% absence is ~400 messages a month,
about 80% of the Starter tier's entire quota. The screen computes that from the school's
**actual roll** and shows it before the toggle, because a school that enables this blind
discovers it when the quota runs dry mid-term and a fee reminder cannot go out.

### Not built, with reasons

- **The mobile app, which ATTENDANCE.md calls the *primary* interface.** `apps/mobile`
  type-checks and has no screens. Largest single gap in the tree.
- **Offline capture** — PowerSync unlicensed; the schema is already shaped for it
  (`sync_source`, `local_created_at`), so it needs no migration against live data.
- **NOTIFICATIONS.md Channels 2, 4 and 5** — push needs the mobile app; the monthly
  summary and the `ATTENDANCE` chatbot command need a live Meta account.
- **Delivery, for all of it.** No provider credentials; nothing has left this machine.

## 11 — Examinations and Results (Good, 88%) · 2026-10-11

Five documents, the most complete module in the tree after fees. Two gaps, both the
"finished but unreachable" shape, and one stale claim corrected in `CLAUDE.md` itself.

### Grade override was specified and did not exist

GRADING.md names `exam_results.grade_override` and `.grade_override_reason` and describes
the whole flow. **Neither column had ever existed** and nothing in `apps/` mentioned
either name. So a coursework subject whose grade is not a percentage had no correct
recording: leave the computed grade wrong, or fake a mark to produce the right letter —
which also corrupts the class average and position.

`0256` keeps the computed grade **beside** the override rather than replacing it.
Overwriting would leave `grading_scale_version_id` pointing at a grade the scale never
produced, make the asterisk GRADING.md asks for impossible to justify, and leave nothing
to restore when an override is removed.

**My first draft of the validation refused the result's own computed grade** — I assumed
the band key was `grade`; it is `letter`. Found by running it, then checked with
`jsonb_object_keys` rather than guessed a second time.

### Revising a grading scale had no caller

`revise_grading_scale()` has existed since `0141` with the versions table,
`current_grading_scale_version()`, `reject_used_grading_scale_version_change()` and a
20-assertion pgTAP suite behind it. **No school could change its own grade boundaries
through any surface.** Screen now at Settings → Grading scales.

### The mobile app was not missing — `CLAUDE.md` was wrong

Asked to build mobile attendance screens, I went to build them and found **27 screens
already there**, including the register marking screen, with a parent tab group and a
teacher tab group. A teacher can mark a register on a phone end to end today.

It is online only and the screens say so: `lib/api.ts` returns an `OFFLINE` code and the
register answers it with "nothing was saved, your marks are still here" rather than
implying they were stored. `lib/features.ts` separates "coming soon" from "needs your
school", because a teacher can act on the second. `gaps:mobile` confirms all 22 endpoints
the phone calls resolve.

`CLAUDE.md` had said "no mobile screens exist" through several passes, and my own folder
10 note repeated it without looking. Both corrected, with a note recording that it
happened — the same failure that file warns about in its own text.

### Remaining

Offline capture, deferred on the PowerSync licence. Everything else in this folder is
built and reachable.

## 12 — Communication System (Fair, 65%) · 2026-10-11

Six documents, and the lowest score so far — not because the code is poor but because
**four of the six cannot be exercised at all.** No Meta, Twilio or Resend credentials
exist, so every channel runs through the mock provider and **no message has ever left
this machine.**

That is the honest ceiling for this folder. Announcements score near full marks; WhatsApp,
SMS and the chatbot cannot be verified by anybody, and a passing score for unexecuted code
would be the same mistake as reporting CI green from a doc line.

### Built this pass

**The message log had a table, a writer and no reader.** Full lifecycle, failure reasons,
retry counts, fallback chain, quota consumption — all recorded since `0075`, visible
nowhere. Screen now at Communication → Message log.

**The banner on it is the point.** Rows say "sent"; nothing was sent. A log that implied
delivery would be the most misleading thing this product could show a school chasing an
unpaid fee, so the route reports `providerIsMock` from the environment and the screen says
so plainly — and stops saying it the moment credentials exist, with no deployment.

**The accountant could not read it** (`0257`), though MESSAGE_LOG.md always said they
could, and every fee reminder in the log is theirs to answer for.

### Two mistakes worth recording, both caught by the gate

- **`settings:read` does not exist** in the permission matrix. `can()` returns false for
  an unknown key, so the nav row would have silently vanished for everybody. Replaced with
  `fees:read`, whose holders are exactly the four roles the policy admits after `0257`.
  This is the failure `zsms-feature` names explicitly, and I made it anyway.
- **A concatenated PostgREST `select` string** killed row inference and produced eleven
  type errors. Also a named rule in the same skill.

### Not built, with reasons

- **The inbound WhatsApp webhook**, which blocks `delivered_at` and `read_at` from ever
  being populated — they come from receipts with nowhere to arrive. ADR-044 settles that
  it is a Next.js route; `webhook_events` (`0243`) already holds the idempotency table.
- **The chatbot**, two blockers deep: it needs the webhook, which needs the Meta account.
- **A screen for a school to write its own template text.** The override mechanism exists
  and is SQL-only. Low priority while delivery is mocked — a school cannot tune wording
  nobody receives.
- **SMS has never run**, and this is the one that should worry us: in Zambia it is the
  channel that reaches a parent with no smartphone and no data. Today that parent is
  reached by nothing at all.

## 13 — Document and PDF System (Good, 86%) · 2026-10-11

Four documents. The generation and storage halves were already proven; the
**customisation** half was almost entirely unreachable.

### Two colour columns with contrast guarantees and no way in

`school_branding.anchor_color` and `.primary_color` have existed since `0092`, each
carrying a `wcag_contrast_ratio()` CHECK — a school *physically cannot* set a brand
colour too pale to read on a report card a parent has to hold. Excellent constraint, over
a year old, and **nothing could set either column.** The settings screen edits the logo
URL and stops.

`0259` adds the setter and deliberately does **not** restate the threshold: two copies of
"is this readable" is two answers, and the copy in a function drifts from the one the
database enforces.

### CUSTOMISATION steps 3–6 had no table at all

`document_templates` is specified in TEMPLATE_SYSTEM.md and had never been created, so the
layout variant, the content switches, the principal's comment and the acknowledgement slip
were unrepresentable. Built in `0258`, with the tier gate on layout variants resolving on
**read** as well as write — a school that downgrades falls back to the standard layout
rather than losing report cards, which would turn a billing change into an outage.

### And then the renderer had to actually read it

Configuration nothing reads is the failure this audit keeps finding, so the chain is
closed in the same pass: the worker resolves the template once per batch (not once per
pupil), picks out the comment for the term being rendered, and the renderer honours
position, average, attendance, comments and the slip.

**Every switch defaults to shown when absent**, because absent means "this school has
never opened that screen" — which is every school until it does. Defaulting to hidden
would have silently stripped information from every report card in the system on deploy.

### A bug caught by a migration's own assertion

`set_principal_comment()` first merged with
`jsonb_set(config, ARRAY['principal_comments', key], ..., TRUE)`. `create_missing` creates
only the **last** path element, so while `principal_comments` did not exist the call
returned the target unchanged and **every comment write silently did nothing.** A head
would have typed a paragraph, seen no error, and found the cards blank. Now `||` at each
level.

Three other introspection misses in one statement — `feature_name` for `display_name`, a
missing NOT NULL `updated_by`, and the category `documents` where the CHECK admits
`document`. All three were guesses where `db:cols` would have answered.

### Remaining

- **Template preview.** A school sees its changes on the next card it generates. Needs a
  sample-data path rather than a real pupil.
- **R2 lifecycle policy.** Nothing is ever expired, which is the safe direction.
  `COMPLIANCE.md` makes a departed pupil's documents a ZDPA retention question rather than
  a storage-cost one, so it wants a deliberate answer, not a bucket rule.
- **Visual regression testing.** Needs a rendered-image baseline harness.

## 14 — Loan and Finance Module (Good, 82%) · 2026-10-11

Seven documents, 2,345 lines — the largest folder in the set, and much better built than
its size suggested. The application, consent, behaviour score, lender registry and
commission halves are all complete and reachable, correctly in the `private` schema per
ADR-018, and properly gated: `loan_module` is enforced in **both** the SQL function and
the route, so a Starter school never sees it.

### Phase 1 repayment was the one thing missing, and it mattered

`REPAYMENT.md` defines Phase 1 as entirely *"surfacing the lender's collection details
prominently, showing the repayment schedule clearly"* — ZSMS moves no money.

The route had been returning `collectionAccount` and `repaymentSchedule` all along and
**the screen rendered neither.** It showed `collection_instructions` and stopped. With the
one seeded lender, whose instructions are the literal string "Airtel Money", a parent saw:

> How to repay: Airtel Money

A debt, a channel name, and no way to pay it. That is worse than an empty screen because
it reads as an answer.

Now rendered: the mobile number or bank account, the branch, the parent's own reference,
and the instalment table — plus an explicit "ask your lender" state when a lender has
given ZSMS nothing, because when it is about money, "this should be unreachable" is
exactly the condition worth saying out loud.

### `0260` makes the bad state impossible

An **active** lender must now carry a `collection_account` with at least one route for
money — mobile number, paybill or account number. A bank *name* alone is refused, because
a row that looks populated is the one nobody checks.

**The seeded lender was deactivated rather than given invented details.** Lupiya is a real
company; writing a plausible Airtel number into their row would put fabricated payment
details in front of a parent about to send money, which is the most harmful thing a seed
could do anywhere in this product. The dev consequence — `lenders_for_application()`
returns nothing — is the correct state: there is no lender ZSMS can honestly offer yet.

### Four introspection misses in one probe

`max_loan_amount`, then `interest_rate_display`, then two more NOT NULL columns, then a
conditional CHECK requiring `intake_email` when `integration_type = 'email'`. Each was one
failed push. `npm run db:cols -- lenders` answered all of it in a single call, which is
what the migration skill says to do first and what I did third.

### Not built, with reasons

- **The inbound lender webhook.** It writes `lender_reference`, `disbursed_at`, and the
  schedule's `status` and `paid_at`, so until it exists a disbursement and every repayment
  are recorded by hand. Blocked on a lender agreement rather than engineering — there is
  no endpoint to verify signatures against and no secret to verify with.
- **Phase 2 and 3 repayment.** Phase 2 needs a payment gateway the platform has in no
  form; `loan_repayment_log` belongs there.
- **Submission has never been exercised** — it dispatches through the same notification
  path as everything else, and there are no provider credentials.
- **`api_key_encrypted` / `webhook_secret` cannot be populated**: `FIELD_ENCRYPTION_KEY`
  is unset, and storing a lender's API key in plaintext to make a demo work is the kind of
  shortcut that survives into production.

## 15 — Super Admin and Platform (Good, 84%) · 2026-10-11

Five documents. Onboarding, health scores and impersonation are all genuinely complete.
The gap was in the document this folder is largest for.

### PLATFORM_METRICS.md is mostly about business metrics, and none were computed

`platform_metrics()` returns schools, pupils, staff and fees collected. **Not one of MRR,
ARR, revenue by tier, trial conversion or loan commission revenue existed anywhere** —
though every input did, in `afritech.subscription_tiers`, `schools.subscription_tier` and
`afritech.loan_commissions`.

`0261` computes them, rendered at the top of `/admin`, above the operational figures:
on AfriTech's own dashboard "is the business working" outranks "how many pupils are
enrolled".

Three decisions worth keeping:

- **MRR comes from live subscription state, not invoices.** An invoice is what *was*
  billed; recurring revenue is what *will* be. A school that joined yesterday has no
  invoice and is unambiguously MRR; one that churned last week still has last month's.
- **NRR is reported unavailable rather than computed.** It needs twelve months of history
  and launch is January 2027, so any figure would come from an empty window and render as
  0% or 100% — both of which read as facts. The dashboard says why.
- **Trial conversion is NULL, not 0, when no trial has finished.** "None ended" and "none
  converted" are different facts; 0% states the second. The card shows an em dash.

Both functions check `billing:read` (`0237`) rather than "is AfriTech", so a support
agent's overview omits revenue instead of failing.

### `CLAUDE.md` was wrong again — second time this session

Its API route list carried `admin/impersonate` *(501 — needs Clerk actor tokens)*. There
is **no 501 in that route.** It mints a real Clerk actor token through `@clerk/backend`,
records the session, and revokes the token if the database refuses — mint first, record
second, undo on refusal, so a trail can never claim a session that did not happen.

After the "no mobile screens" correction in folder 11, that is two stale claims in one
session. A note is now beside the route list saying so.

### What is already good and should not be touched

- **`school_health_scores()` records its own deviations in comments**: two of three
  operational sub-scores are measurable so they rescale from 80 to 100, and a school with
  no fee records scores 50 rather than 0 — unbilled is unconfigured, not failing. It also
  returns `inputs_available` / `inputs_total`, which is the honest shape for a composite
  built on partial data.
- **`afritech_role()` resolves a missing claim to `developer`**, the least privileged role.
  A missing claim is a configuration fault, and the safe reading of one is "can see,
  cannot act".
- **`is_afritech_admin()` was deliberately not rewritten** by `0237` — 91 policies call
  it, so differentiation sits above it rather than re-scoping 91 policies at once.

### Remaining

- **32 of 34 `admin_*` functions still use the broad `is_afritech_admin()`** rather than a
  capability. The two that do not are `0261`'s revenue functions.
- **Clerk's five-member organisation cap** blocks onboarding a school with six staff. A
  paid plan is a launch prerequisite.

## Carried forward

Open items from finished folders. Each carries why it is still open.

| From | Item | Why still open |
|---|---|---|
| 01 | Inbound webhooks (4) | ADR-044 settles that they are Next.js routes. Blocked on Meta, gateway and Clerk webhook credentials. |
| 01 | `zsms-staging` / `zsms-zm` | Compliance requires `af-south-1` before real school data. Needs an account action. |
| 01 | Field encryption keys | `FIELD_ENCRYPTION_KEY`, `GATEWAY_ENCRYPTION_KEY` unset; `0230`'s CHECK refuses plaintext credentials until they exist. |

| 02 | 32 of 34 `admin_*` functions still ungated | `0237` built the matrix; only the two guarding personal data are gated so far. Worth narrowing per release, not in one unverifiable sweep. |
| 02 | Suspicious activity detection | None of SESSIONS.md's five patterns, and no alerting path. `audit_logs` could detect two retrospectively. |


| 06 | Per-school WhatsApp configuration | Blocked twice over: no Meta account, and no encryption key for the token. |
| 06 | Trial notification schedule | Ten touchpoints, all blocked on a delivery channel. |
| 15 | NRR needs 12 months of history | Reported unavailable rather than computed from an empty window. Revisit after January 2028. |
| 14 | Inbound lender webhook | Writes disbursement and repayment status. Blocked on a lender agreement, not engineering. |
| 14 | No offerable lender on dev | The seeded lender was deactivated for having no collection details. Populate from a real agreement; never invent payment details. |
| 13 | R2 lifecycle / retention | Nothing is ever expired. Needs a ZDPA decision about a departed pupil's documents, not a bucket rule. |
| 13 | Template preview | A school sees changes on the next card generated. Needs a sample-data path. |
| 12 | SMS has never run | The channel that reaches a parent with no smartphone. Needs Twilio; a launch prerequisite rather than an enhancement. |
| 12 | School-authored template text | The override mechanism is SQL-only; no screen. Low priority while delivery is mocked. |
| 10 | Mobile OFFLINE capture | The 27 screens exist and mark a register online; ADR-004's offline-first waits on a PowerSync licence. Schema already shaped for it. |
| 10 | NOTIFICATIONS.md Channels 2, 4, 5 | Push needs the mobile app; monthly summary and the chatbot command need a live Meta account. |
| 09 | `payments.payment_method` has no `mobile_money` | The dominant Zambian rail is recorded as `online_gateway`. Needs a migration and a product decision. |
| 09 | Reminder DELIVERY is unproven | Schedule correct; no Meta/Twilio/Resend credentials, so nothing has left this machine. |
| 08 | Bulk staff invitation | Blocked on a paid Clerk plan — the free tier caps an organisation at five members. |
| 08 | Assignment subject/class validation | `class_id` is intentionally not a foreign key; the check belongs in the route. |
| 05 | Nine of ten inbound webhooks | Foundation built (`0243`); each is blocked on a gateway, Meta or lender account. |
| 05 | Outgoing webhooks to school systems | Scope exists, registration and delivery do not. |
| 04 | Multi-country constraint widening | ADR-040 defers it until a second country is real. `npm run country:check` keeps the inventory honest in the meantime. |
| 03 | Uptime monitoring and alerting | `/api/health` exists and nothing polls it. Needs an external monitor, not code. |
| 03 | API write endpoints (Tier 1/3) | Needs idempotency on a caller-supplied key, or a retried request double-records a payment. |
| 03 | PITR and the Railway standby | Paid plans. `zsms-dev` is free and synthetic, so there is nothing yet to verify against. |
| 02 | Phone-based login | Blocked on SMS OTP, disabled on cost grounds in Zambia. Parents match on verified email instead. |

---

## Method

1. Read every document in the folder in full.
2. Check each concrete claim against the live schema (`npm run db:cols`, `pg_policies`,
   `pg_proc`) and the tree — never against another document.
3. Follow the chain for each feature: **docs → schema → function → route → screen → a link
   somebody can press.** A missing last link is the most common and most expensive gap.
4. Build what is missing; correct what the document gets wrong; raise an ADR when a
   decision is implied rather than recorded.
5. Score, update this file, and report in plain language before moving on.

**When a document and the schema disagree, the schema is the fact.** Documents here have
repeatedly described things the database could not do.

---

## Change Log

| Date | Change |
|---|---|
| 2026-10-06 | Folder 01 audited and remediated |
| 2026-10-10 | Tracker created; folder 02 assessed |
| 2026-10-11 | Folder 02 remediated and re-scored 55% -> 88% |
| 2026-10-11 | Folder 03 assessed and remediated, 52% -> 78% |
| 2026-10-11 | Folder 04 assessed and remediated, 90% |
| 2026-10-11 | Folder 05 assessed and remediated, 82% |
| 2026-10-11 | Folder 06 assessed and remediated, 85% |
| 2026-10-11 | Folder 07 assessed and remediated, 88% |
| 2026-10-11 | Folder 08 assessed and remediated, 87%; folder 07's open item closed |
| 2026-10-11 | Folder 09 assessed and remediated, 85%; the reminder schedule is now per-school configuration |
| 2026-10-11 | Folder 10 assessed and remediated, 80%; absence alerts built as a worker, ADR-047 |
| 2026-10-11 | Folder 11 assessed and remediated, 88%; grade override built, grading revision reachable, CLAUDE.md's "no mobile screens" claim corrected |
| 2026-10-11 | Folder 12 assessed, 65%; message log built, accountant access fixed. Four of six docs unverifiable without provider credentials |
| 2026-10-11 | Folder 13 assessed and remediated, 86%; document customisation built end to end and wired into the renderer |
| 2026-10-11 | Folder 14 assessed and remediated, 82%; Phase 1 repayment display built, unrepayable lenders now refused |
| 2026-10-11 | Folder 15 assessed and remediated, 84%; MRR/ARR/tier revenue built, CLAUDE.md's impersonation "501" claim corrected |
