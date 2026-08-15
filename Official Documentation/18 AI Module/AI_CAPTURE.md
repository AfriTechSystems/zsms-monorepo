# AI_CAPTURE.md — AI-Assisted Capture (Planned, Phase 4/5)

> **STATUS: DESIGN ONLY. NOT BUILT.** No table, function, route, or job described here exists. This document records the intended design so that Phases 2–3 do not foreclose it, and so the decision is settled before implementation begins. See ADR-039.

## Related Documents

- `18 AI Module/AI_OVERVIEW.md` — the four AI systems and how this becomes the fifth
- `18 AI Module/AI_ASSISTANT.md` — the approval-gated write principle this inherits
- `01 Foundation Layer/DECISIONS.md` — ADR-034 (approval-gated AI writes), ADR-037 (teaching scope), ADR-039 (this module)
- `01 Foundation Layer/DYNAMIC_CONFIG.md` — where every credit price and trial limit lives
- `01 Foundation Layer/RLS.md` — the policies approved data is written through
- `03 Infrastructure Services/BULLMQ.md` — the queue that runs extraction
- `03 Infrastructure Services/R2.md` — image storage
- `17 Integration and Pricing/PRICING.md` — subscription tiers this sits alongside

---

## Purpose

Teachers in Zambian schools mark on paper. Registers, mark sheets, and enrolment lists are filled in by hand long before anyone opens a laptop, and the transcription into ZSMS is the slowest, most error-prone part of the day. AI-assisted capture removes the typing, not the teacher: a photograph of the paper produces a **pre-filled verification screen**, and the teacher confirms or corrects it before anything is written.

This document defines how that works, why it can be accurate enough to be useful, how it is charged for, and — most importantly — the boundaries it must never cross.

---

## Overview

```
Teacher (already inside a specific class context)
  │
  ├─ photographs a paper mark sheet / register / enrolment list
  │
  ▼
Image → Cloudflare R2 (private bucket)
  │
  ▼
BullMQ job: vision extraction (Claude vision, Anthropic API)
  │   • extracts rows and values
  │   • matches handwritten names against THIS CLASS'S roster
  │   • attaches a confidence score to every cell
  ▼
Draft held in a capture staging table — NOT in exam_results/attendance_records
  │
  ▼
Teacher opens the VERIFICATION SCREEN
  │   • every value editable
  │   • low-confidence cells visually flagged
  │   • unmatched names surfaced for manual assignment
  ▼
Teacher approves
  │
  ▼
Approved data submitted through the EXISTING RLS-gated APIs
  (POST /api/results, POST /api/attendance, the import endpoint)
```

**The AI never writes to a domain table.** It produces a draft; a human approves; the approved data travels the same authenticated, RLS-checked path as data typed by hand. This is the identical principle to `AI_ASSISTANT.md` — the assistant may compose a write, but a person confirms it.

---

## Principle 1 — Assist, never autopilot

Every extracted value is a **draft**, without exception. There is no confidence level at which extraction writes directly, and no "trusted teacher" setting that skips verification. A capture with a hundred perfectly extracted marks still requires an approval action.

Three consequences follow, and all three are requirements rather than preferences:

- **Every cell is editable** on the verification screen. A teacher must never be forced to accept a value they can see is wrong.
- **Low-confidence cells are flagged**, not hidden or silently defaulted. The verifier's attention is the scarce resource; the interface spends it where the model is least sure.
- **Unmatched names are surfaced, never guessed.** If a handwritten name cannot be matched to the roster above the confidence floor, it is presented for manual assignment. It is not attached to the nearest candidate.

The reason is not caution for its own sake. A mark written to the wrong student is discovered weeks later by a parent, and by then the report card has been issued. The cost of a wrong write is far higher than the cost of a second look.

---

## Principle 2 — Context-anchored matching is why this works

**This is the core accuracy mechanism, and the reason the feature is viable at all.**

Handwriting recognition against an open vocabulary is unreliable. Handwriting recognition against **a known list of about thirty names** is a different problem — and a much easier one.

Extraction never runs unanchored. A teacher initiating a capture is already inside a specific context: they are in Grade 6A, entering Term 2 mathematics marks. That context is known to the system before the image is uploaded, so extraction is told:

> These handwritten rows correspond to students in **this class roster**. Here are the thirty-one enrolled names.

The matching problem collapses from *"what name is this?"* to *"which of these thirty-one names is this most likely to be?"* — a constrained fuzzy match where a smudged `Chanda M.` resolves confidently against a roster containing exactly one Chanda, and ambiguously against one containing three.

**Known-roster-first is the primary reason accuracy is achievable.** Every design decision below follows from protecting it:

- The roster is drawn from the class the teacher currently holds, resolved through `teacher_reaches_class()` (ADR-037). A teacher can only capture into a class they actually teach.
- Matching is scored per name, and the score becomes the cell's confidence. A single strong candidate is high confidence; two close candidates is low, and is flagged.
- **The roster is never widened to the whole school.** If a name does not match within the class, it is reported unmatched. Searching the full student body to "find" a match is precisely how a mark lands on a same-named child in another grade.
- A student on the paper but not in the roster (a late enrolment, a visitor) is surfaced as an exception for the teacher to resolve — not silently created.

The same anchoring applies to every capture type: attendance is anchored to a class and a date, enrolment import to a grade and intake, payment proof to a specific fee record.

---

## Principle 3 — Applies to four capture types

| Capture type | Anchored to | Draft target | Approved write path |
|---|---|---|---|
| **Marks entry** | class + academic year + term + subject | staging | `POST /api/results` |
| **Attendance** | class + date + term | staging | `POST /api/attendance` |
| **Bulk student import** | school + grade + intake | staging | the import endpoint (Phase 3+) |
| **Fee-payment proof** | a specific `fee_record` | staging | `POST /api/payments` → `verify_payment()` |

Fee-payment proof is the closest fit to what already exists: `payments.proof_of_payment_url` and `status = 'pending_verification'` were built for exactly this shape. Extraction pre-fills amount, date, and reference from a deposit slip or mobile-money confirmation; the payment still lands as pending, and `verify_payment()` remains the only path to `verified`. **The AI shortens the typing, not the approval.**

---

## Compatibility with the Phase 2 schema

**Assessed against the applied schema. No change is required now.** Findings:

| Aspect | State | Verdict |
|---|---|---|
| Draft storage | Drafts live in a capture staging table, never in `exam_results` / `attendance_records` | ✅ No change — domain tables only ever receive approved data |
| Repeat approval | `exam_results` is `UNIQUE (school, student, year, term, subject)`; `attendance_records` is `UNIQUE (school, student, date)` | ✅ **Already idempotent.** Re-approving a re-photographed sheet upserts rather than duplicating |
| Authorship | `entered_by_user_id` / `recorded_by_user_id` are `NOT NULL` | ✅ Correct as-is — the **approving teacher** is the author, not the model |
| Write authorisation | `teacher_teaches_subject()` / `teacher_reaches_class()` gate the write | ✅ Capture inherits teaching scope for free |
| Payment proof | `proof_of_payment_url`, `pending_verification`, no UPDATE privilege | ✅ Strong fit; the verification workflow already exists |
| Publication lock | `results_published = FALSE` required to write marks | ✅ Correct — capture cannot reopen published results |

**Two changes that will be needed when the module is built, neither blocking now:**

1. **`sync_source` needs an additional value.** Both `exam_results` and `attendance_records` constrain it to `('web','mobile_online','mobile_offline')`. Capture-sourced rows want `'ai_capture'`. Extending a `CHECK` is a one-line migration with no data change, so it belongs with the module rather than now.
2. **Provenance is optional but easier to add early.** If it must be possible to ask *"which capture produced this mark?"*, a nullable `source_capture_id` on `exam_results` and `attendance_records` answers it. It cannot be backfilled for rows written before it exists — so if provenance matters for audit or for measuring extraction quality against corrections, add the column with the module and accept that pre-module rows have none.

**Nothing about the current schema precludes the flow.** The one property that would have been fatal — domain tables accepting unverified writes — is already prevented by RLS.

---

## Pricing — credit-based, because each capture has a real cost

Every capture is a vision-API call against the Anthropic API, so the cost is per use, not per seat. Charging for it inside a flat subscription tier would mean either subsidising heavy users or capping the feature so tightly it is not worth having.

**The model is credits.** All four elements below are configuration, never code:

**(a) Free trial, capped.** Every school and every individual can try capture without buying anything, up to a configured number of captures. The purpose is evaluation — a teacher must be able to photograph one real mark sheet and see the result before anyone pays.

**(b) School-level purchase.** A school buys credits for its staff, either for all capture types or for selected ones. This is the expected path: the school holds the budget.

**(c) Individual purchase.** A teacher or admin may buy their own credits. This matters in two situations the school-level model does not serve: a teacher at a school that has not bought capture but who wants it for their own classes, and a standalone Teacher Hub user with no school affiliation at all.

**(d) Credits deduct per capture**, at a configured rate that may differ per capture type — a dense mark sheet costs more to process than a one-line payment slip.

**Every value is dynamic configuration.** Trial limits, credit pack prices, per-capture costs, and per-type multipliers all live in the `afritech` configuration tables and are editable by a super admin without a deployment. Hardcoding any of them would violate ADR-031, and would make a pricing correction a release.

### Credit ledger — shape only, DO NOT BUILD

Sketched so Phase 2's schema does not preclude it. **No migration should implement this until the module is scheduled.**

```sql
-- WHO holds credits. Exactly one of school_id / owner_user_id is set:
-- school-purchased (b) or individually purchased (c).
public.capture_credit_accounts (
  id                UUID PK,
  school_id         UUID NULL REFERENCES public.schools(id),
  owner_user_id     TEXT NULL,              -- Clerk user ID, for individual accounts
  is_trial          BOOLEAN,                -- the capped free allowance (a)
  created_at, updated_at
  -- CHECK: (school_id IS NULL) <> (owner_user_id IS NULL)
)

-- WHAT happened. Append-only. Never updated, never deleted.
public.capture_credit_ledger (
  id                UUID PK,
  account_id        UUID REFERENCES capture_credit_accounts(id),
  delta             INT,                    -- negative = consumption, positive = top-up
  reason            TEXT,                   -- 'capture' | 'topup' | 'trial_grant' | 'refund'
  capture_job_id    UUID NULL,              -- what consumed it
  created_at
)

-- WHAT was captured.
public.capture_jobs (
  id                UUID PK,
  school_id         UUID,
  requested_by      TEXT,                   -- Clerk user ID
  capture_type      TEXT,                   -- marks | attendance | import | payment_proof
  context           JSONB,                  -- class_id, term, subject_code, fee_record_id …
  image_url         TEXT,                   -- R2 private bucket
  status            TEXT,                   -- queued | extracting | awaiting_review | approved | discarded | failed
  credits_charged   INT,
  extraction        JSONB,                  -- rows, values, per-cell confidence, roster matches
  reviewed_by       TEXT NULL,
  reviewed_at       TIMESTAMPTZ NULL,
  created_at, updated_at
)
```

**Balance is derived from the ledger, not stored as a mutable column** — the same reasoning as ADR-038's derived arrears. A cached balance must be kept in step with every consumption, top-up, and refund, and the first bug makes someone's credits wrong in a way nobody can reconstruct. If read performance ever demands it, add a materialised cache with the ledger still authoritative.

**Charging happens on successful extraction, not on upload.** A failed extraction, an unreadable photograph, or a job that errors must not consume a credit — a teacher who photographs a page in bad light and gets nothing back has not received the service.

### Revenue-tier implication

This introduces **usage-based revenue alongside the existing subscription tiers**, which are currently the only revenue line. Three consequences for `PRICING.md` and the `afritech` configuration tables:

- Capture is an **add-on**, not a tier feature. It should appear in `afritech.feature_flags` with credit pricing rather than being bundled into a tier, because bundling a metered cost into a flat price transfers all volume risk to AfriTech.
- **Margin is per capture and must be monitored.** The credit price has to exceed the vision-API cost at the observed image sizes with enough headroom to survive a provider price change. `COST_MANAGEMENT.md` should track cost-per-capture as a first-class metric once the module is live.
- **Individual purchase opens a B2C revenue path** that does not depend on a school buying anything — the same audience as the standalone Teacher Hub, and worth considering together.

---

## Business Rules

1. Extraction output is always a draft. There is no confidence threshold, setting, or role that permits a direct write.
2. Extraction runs only within a known context, and matches only against that context's roster.
3. The roster is never widened beyond the anchored context to find a match.
4. A name that does not match above the confidence floor is reported unmatched, never assigned to the closest candidate.
5. A student on the paper but absent from the roster is an exception for the teacher to resolve; capture never creates a student record.
6. Approved data is written through the existing RLS-gated APIs, under the approving user's own credentials and teaching scope.
7. The approving user is recorded as the author of the data.
8. Credits are consumed on successful extraction only.
9. Every price, limit, and rate is dynamic configuration.
10. A teacher may capture only into classes they reach under ADR-037.

---

## Edge Cases and Error Handling

| Case | Handling |
|---|---|
| Photograph unreadable / extraction fails | Job fails, **no credit charged**, teacher told why and invited to retake |
| Two roster names match equally well | Both surfaced, cell flagged, teacher chooses. Never auto-resolved |
| Name on paper not in roster | Surfaced as an exception. No student created, no nearest-match assignment |
| Roster changes between capture and approval | Re-match on approval; any newly unmatched row is re-flagged rather than written |
| Same sheet photographed twice | Approval upserts on the existing unique keys — no duplicate rows |
| Marks already published for that term | Write refused by the existing policy. Capture cannot reopen published results |
| Credit balance insufficient | Capture refused **before** the API call, with the shortfall stated |
| Teacher loses the class between capture and approval | Approval fails the teaching-scope check, as a manual entry would |

---

## Integration Points

- **R2** — images to the private bucket, never public. A photographed mark sheet carries children's names and marks.
- **BullMQ** — extraction is queued, not synchronous; a teacher does not wait on a vision call.
- **Anthropic API** — the same integration the AI assistant uses.
- **`teacher_reaches_class()` / `teacher_teaches_subject()`** — capture inherits ADR-037 scope with no new authorisation model.
- **`afritech` configuration tables** — all pricing and limits.
- **Existing APIs** — `POST /api/results`, `POST /api/attendance`, the import endpoint, `POST /api/payments`.

---

## Security Considerations

- **The AI holds no privileges.** Extraction runs in a job with no user session; it cannot read or write domain tables. Everything reaching a domain table travels under the approving user's JWT.
- **Images are personal data.** Mark sheets and registers name children. Private bucket, RLS-equivalent access control on the capture job, and retention governed by `COMPLIANCE.md` — a photograph should not outlive its usefulness.
- **The roster sent for matching is a disclosure.** It leaves the system as part of the prompt, so it must be minimal: the names needed to match, from the anchored class only. This is a second, independent reason never to widen the roster.
- **Confidence is not authorisation.** A high-confidence extraction is still a draft. No code path may treat a score as a substitute for approval.
- **Credit exhaustion must fail closed** — refuse the capture rather than perform it unbilled.

---

## Known Limitations and Future Work

- Accuracy on poor handwriting, faded photocopies, and non-standard sheet layouts is unknown until measured against real Zambian mark sheets. **A pilot with genuine paper is required before pricing is fixed**, because the credit price depends on retry rate.
- The confidence floor for auto-matching is a tuning parameter with no defensible default yet. It should start conservative — more flagged cells, fewer wrong matches.
- Multi-page mark sheets are out of scope for the first version.
- Extraction quality should be measured by comparing approved output against extraction output; that requires the optional `source_capture_id` provenance link.
- No offline capture. A teacher without connectivity photographs now and uploads later; PowerSync is not involved.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-15 | Initial design. Not built | Recorded before Phase 3 so the Phase 2 schema does not foreclose it (ADR-039) |
| 2026-08-15 | Confirmed Phase 2 marks/attendance schema is compatible; two non-blocking changes noted | Draft-then-verify needs no domain-table change; `sync_source` and optional provenance land with the module |
