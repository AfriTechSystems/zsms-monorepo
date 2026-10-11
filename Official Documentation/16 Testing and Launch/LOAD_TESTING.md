# LOAD_TESTING.md — Load Testing Strategy

## Related Documents

- `16 Testing and Launch/TEST_STRATEGY.md` — Layer 6 of the testing strategy
- `03 Infrastructure Services/SCALING.md` — the scaling targets these tests verify
- `16 Testing and Launch/PERFORMANCE_CHECKLIST.md` — per-operation latency targets
- `16 Testing and Launch/TEST_DATA.md` — seed data required for realistic load
- `16 Testing and Launch/LAUNCH_CHECKLIST.md` — load test results are a go/no-go item
- `03 Infrastructure Services/COST_MANAGEMENT.md` — load tests generate real spend
- `01 Foundation Layer/DECISIONS.md` — ADR-033 records k6 as the primary tool

---

## Implementation Status (2026-10-11)

**Not executed. No harness exists**, and running load tests against `zsms-dev` would be
the wrong move — it is the only database in the project, and saturating it would stop
development rather than measure anything useful.

Scored as pending rather than failing.

**What is known without a load test**, and is worth recording because it is where the
first real limit will show:

- **`/api/admin/schools/[id]` issues one RPC per feature** — 13 PostgREST round-trips
  today, growing with the catalogue. Correct, but an N+1 over the network. It wants a
  single set-returning `school_feature_resolution(school_id)` when the page feels slow.
- **The rate limiter fails OPEN** by design, so a cache outage cannot take down a
  school's register. That is the right trade and it means a load test measuring the
  limiter must distinguish "limited" from "limiter unavailable".
- **Report card batches are per class and term**, so a whole-school run is one job to
  watch rather than several hundred to reconcile.

Needs `zsms-staging` first, for the same reason as UAT.

---

## Purpose

This document defines how ZSMS verifies that it meets the load targets in `SCALING.md`. It specifies k6 as the primary load testing tool, Artillery as the secondary, the scenarios that model real school traffic, the thresholds that constitute a pass, and the rules that prevent a load test from becoming a self-inflicted outage. Every launch gate that claims the system handles N schools must point at a passing run of these scenarios.

---

## Overview

ZSMS load testing exists to answer one question: **will the system survive the morning of the first day of term?**

That question is specific, and it drives the entire approach. Schools do not generate smooth traffic. Per `SCALING.md`, load arrives in correlated spikes — every school marking attendance between 07:00 and 08:00, every school publishing results in the same fortnight, every parent checking those results within hours of publication. A test that averages load across a day proves nothing about the only moments that matter.

Every scenario below therefore models a **real, named, correlated event** rather than abstract request volume.

### Tool selection

**k6 is the primary tool** (ADR-033). It is scripted in JavaScript, which matches the team's language; thresholds are declarative and make pass/fail unambiguous rather than a matter of reading graphs; it runs in CI without a control plane; and it handles the concurrency levels in the Milestone 3 targets on modest hardware.

**Artillery is the secondary tool**, used for two things k6 does less naturally: YAML-defined smoke tests that are quick to write and read, and WebSocket testing for Supabase Realtime subscriptions during bulk generation.

Neither replaces the other and neither is used where the other is clearly better suited.

---

## Rules of Engagement

These are absolute. A load test run against the wrong target is worse than no load test at all.

1. **Load tests run against staging only.** Never production. Never `zsms-dev`.
2. **Staging must be seeded** with data volume matching the target milestone before a run — an empty database gives meaninglessly good numbers.
3. **Announce runs.** They fire billing alerts (`COST_MANAGEMENT.md`) and monitoring alerts (`AVAILABILITY.md`), which must not be mistaken for incidents.
4. **All test data is fictional**, per `TEST_DATA.md` — never real school names, phone numbers, or financial amounts.
5. **Load tests generate real spend.** Include the cost in the monthly review.
6. **Never load test third-party endpoints.** Meta, Twilio, and payment gateways are mocked. Sending 10,000 test messages to Meta risks the WhatsApp number.
7. **Results are recorded**, with the git SHA under test, and compared against the previous run.

---

## Test Scenarios

Each scenario maps to a real event and to a milestone in `SCALING.md`.

| # | Scenario | Models | Verifies |
|---|---|---|---|
| 1 | Morning attendance surge | 07:00–08:00, all schools | Peak concurrent write load |
| 2 | Results publication day | Principal publishes, parents check | Read spike after a write burst |
| 3 | Bulk report card generation | Term end, multiple schools | Queue throughput, PDF pipeline |
| 4 | Parent portal steady load | Normal school-hours browsing | Sustained baseline |
| 5 | Fee payment burst | Fee deadline day | Payment path under concurrency |
| 6 | Mixed realistic day | All of the above, weighted | Whole-system interaction |
| 7 | Soak test | 4 hours at 60% peak | Memory leaks, connection leaks |
| 8 | Spike test | 0 → peak in 30 seconds | Cold-start and autoscale behaviour |

---

### Scenario 1 — Morning attendance surge

The single most important scenario. Every teacher across every school marks attendance within the same half hour.

```javascript
// tests/load/k6/attendance-surge.js
import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'

const errorRate = new Rate('errors')

export const options = {
  scenarios: {
    attendance_surge: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5m',  target: 200 },   // 07:00 — early teachers
        { duration: '15m', target: 1000 },  // 07:15 — peak
        { duration: '10m', target: 1000 },  // sustained
        { duration: '5m',  target: 100 },   // 07:50 — tail
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    errors: ['rate<0.005'],           // < 0.5% per SCALING.md
    http_req_failed: ['rate<0.01'],
  },
}

export default function () {
  const token = __ENV.TEST_JWT_POOL.split(',')[__VU % 50]
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  // Teacher opens their class register
  const roster = http.get(`${__ENV.BASE_URL}/api/attendance/class/${classId()}`, { headers })
  check(roster, { 'roster loaded': (r) => r.status === 200 })
  errorRate.add(roster.status !== 200)

  sleep(Math.random() * 30 + 10)   // teacher actually marks the register

  // Submit the full class in one request — never per student
  const submit = http.post(
    `${__ENV.BASE_URL}/api/attendance/bulk`,
    JSON.stringify({ class_id: classId(), date: today(), records: buildRecords(40) }),
    { headers },
  )
  check(submit, { 'attendance saved': (r) => r.status === 201 })
  errorRate.add(submit.status !== 201)

  sleep(1)
}
```

**Note on realism.** The `sleep` between loading the register and submitting it is not padding — it models a teacher actually taking half a minute to mark forty students. Removing it produces a test that hammers the API in a pattern no human generates, and which will fail for reasons that never occur in production.

**Offline caveat.** Most real attendance arrives through PowerSync sync rather than this API path. This scenario deliberately tests the worst case where every teacher is online and submitting directly. PowerSync sync load is tested separately in Scenario 6.

---

### Scenario 2 — Results publication day

A write burst (principal publishes) immediately followed by a read spike (parents check).

```javascript
// tests/load/k6/results-publication.js
export const options = {
  scenarios: {
    principals_publishing: {
      executor: 'shared-iterations',
      vus: 10, iterations: 10, maxDuration: '10m',
    },
    parents_checking: {
      executor: 'ramping-vus',
      startTime: '2m',                       // parents arrive after publication
      startVUs: 0,
      stages: [
        { duration: '10m', target: 2000 },   // notification-driven spike
        { duration: '20m', target: 800 },
        { duration: '10m', target: 100 },
      ],
    },
  },
  thresholds: {
    'http_req_duration{scenario:parents_checking}': ['p(95)<2000'],
    'http_req_duration{scenario:principals_publishing}': ['p(95)<5000'],
    http_req_failed: ['rate<0.01'],
  },
}
```

The asymmetric thresholds are deliberate. A principal publishing results is doing a heavy, deliberate, once-a-term operation and will tolerate five seconds. A parent tapping a notification will not tolerate more than two.

---

### Scenario 3 — Bulk report card generation

Tests the queue and PDF pipeline against the target from `ARCHITECTURE.md`: 400 students in under 90 seconds.

```javascript
// tests/load/k6/bulk-generation.js
export const options = {
  scenarios: {
    bulk_generation: {
      executor: 'per-vu-iterations',
      vus: 10,              // 10 schools simultaneously
      iterations: 1,        // one 400-student run each
      maxDuration: '15m',
    },
  },
  thresholds: {
    'generation_duration': ['p(95)<90000'],   // 90s per ARCHITECTURE.md
    'batch_failures': ['count<5'],
  },
}
```

The test polls `report_generation_jobs` for completion and records wall-clock duration per school. It verifies queue throughput, batch isolation (one failed batch must not fail the run), and that fonts and logos load once per batch rather than per student — the expensive pattern called out in `COST_MANAGEMENT.md`.

---

### Scenario 4 — Parent portal steady load

Sustained baseline browsing: dashboard, fee history, attendance, results, receipt downloads. Constant-arrival-rate executor, 30 minutes, `p(95) < 2000ms`. Establishes the baseline that the spike scenarios are measured against.

---

### Scenario 5 — Fee payment burst

Concurrent payment submissions on a fee deadline day. Verifies receipt number sequencing under concurrency (the atomic per-school sequence in `CONVENTIONS.md`), duplicate detection, and R2 proof-of-payment uploads.

**Critical assertion:** no duplicate receipt numbers across the entire run. A duplicate receipt number under concurrency is a correctness bug that only load testing will surface, and it has direct financial consequences.

---

### Scenario 6 — Mixed realistic day

Weighted composition of all traffic types running simultaneously, including PowerSync sync load. This is the scenario that catches interaction effects — a bulk generation run starving payment confirmations, or attendance sync exhausting the connection pool while parents browse.

```javascript
export const options = {
  scenarios: {
    attendance:  { executor: 'constant-vus', vus: 300, duration: '30m' },
    portal:      { executor: 'constant-vus', vus: 500, duration: '30m' },
    payments:    { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1m',
                   duration: '30m', preAllocatedVUs: 50 },
    bulk_jobs:   { executor: 'per-vu-iterations', vus: 3, iterations: 1, startTime: '10m' },
    sync:        { executor: 'constant-vus', vus: 200, duration: '30m' },
  },
  thresholds: {
    'http_req_duration{scenario:payments}': ['p(95)<1000'],   // must not be starved
    'http_req_duration{scenario:portal}':   ['p(95)<2000'],
    http_req_failed: ['rate<0.005'],
  },
}
```

The payment threshold under mixed load is the important one. It verifies the job priority separation specified in `SCALING.md` — bulk work must not starve user-facing work.

---

### Scenario 7 — Soak test

Four hours at 60% of peak. Not looking for latency but for drift: memory growth, connection pool exhaustion, leaked Realtime subscriptions, Redis key growth without expiry, and worker degradation over time. Pass criterion is **flat** resource curves, not merely acceptable ones.

---

### Scenario 8 — Spike test

Zero to peak in thirty seconds, hold five minutes, drop to zero. Models a notification blast — every parent receiving a results-published message at once. Verifies serverless cold-start behaviour and that rate limiting sheds load gracefully rather than the database falling over.

---

## Artillery Scenarios

Artillery covers two gaps.

**Quick smoke tests** — YAML-defined, fast to write, run on every staging deploy:

```yaml
# tests/load/artillery/smoke.yml
config:
  target: "https://staging.zsms.co.zm"
  phases:
    - duration: 60
      arrivalRate: 5
      name: "Smoke"
  ensure:
    p95: 2000
    maxErrorRate: 1
scenarios:
  - name: "Public pages"
    flow:
      - get: { url: "/" }
      - get: { url: "/pricing" }
      - get: { url: "/schools" }
  - name: "Health"
    flow:
      - get:
          url: "/api/health"
          expect:
            - statusCode: 200
            - contentType: json
```

**Realtime WebSocket testing** — Artillery's WebSocket engine tests concurrent Supabase Realtime subscriptions during bulk generation, verifying the connection ceiling and that subscriptions tear down correctly on completion (the leak risk noted in `SCALING.md`).

---

## Milestone Test Matrix

Each milestone from `SCALING.md` has a required scenario set. **A milestone is not certified until every required scenario passes.**

| Scenario | Pilot (10 schools) | Launch (50 schools) | Scale (200 schools) |
|---|---|---|---|
| 1 — Attendance surge | 200 VU | 1,000 VU | 4,000 VU |
| 2 — Results publication | 400 VU | 2,000 VU | 8,000 VU |
| 3 — Bulk generation | 2 schools | 10 schools | 40 schools |
| 4 — Portal steady | 100 VU | 500 VU | 2,000 VU |
| 5 — Payment burst | 50 VU | 250 VU | 1,000 VU |
| 6 — Mixed day | Required | Required | Required |
| 7 — Soak (4h) | Optional | Required | Required |
| 8 — Spike | Optional | Required | Required |

---

## Running Load Tests

```bash
# Seed staging to the target milestone first
npm run seed:staging -- --profile=launch    # pilot | launch | scale

# Single scenario
k6 run \
  -e BASE_URL=https://staging.zsms.co.zm \
  -e TEST_JWT_POOL="$(cat .test-tokens)" \
  tests/load/k6/attendance-surge.js

# Full milestone suite with JSON output
npm run loadtest -- --milestone=launch --out=results/launch-$(date +%F).json

# Artillery smoke (also runs on every staging deploy)
artillery run tests/load/artillery/smoke.yml
```

Load tests do **not** run on every pull request — they are too slow and too expensive. They run before each launch gate, after any change to a hot path or the queue architecture, and on a monthly schedule against staging once the pilot is live.

---

## Interpreting Results

**A pass is every threshold green.** k6 thresholds are declarative precisely so that "did it pass?" is not a judgement call.

When a scenario fails, work the diagnosis in the order given by `SCALING.md` — verify caching, then check for a missing index, then look at queue depth — before considering infrastructure changes. Most load test failures are a single missing index or an uncached hot path, and reaching for a bigger instance first hides the real defect.

Record every run: git SHA, milestone profile, date, threshold results, and the resource curves. Regression against the previous run matters more than the absolute number.

---

## Business Rules

1. Load tests run against staging only. Running one against production is prohibited.
2. Staging is seeded to the target milestone's data volume before any run.
3. Every milestone in `SCALING.md` must pass its required scenario set before the corresponding launch gate.
4. Third-party services are mocked. Meta, Twilio, and payment gateways are never load tested.
5. All load test data is fictional per `TEST_DATA.md`.
6. Runs are announced in advance so monitoring and billing alerts are not mistaken for incidents.
7. Results are recorded with the git SHA under test and compared against the previous run.
8. A failing threshold blocks the launch gate. It is not waived without an ADR recording the accepted risk.

---

## Edge Cases and Error Handling

**Staging is smaller than production.** Staging typically runs a smaller Supabase tier, so results are conservative rather than optimistic. Note the tier difference on every recorded run — a pass on smaller hardware is meaningful, but the margin is not transferable.

**Test tokens expiring mid-run.** Sessions are 30 days (`SESSIONS.md`), so this is unlikely, but a long soak test should refresh its token pool rather than degrade into an authentication-error test.

**Rate limiting triggering during the test.** Expected and correct — rate limits are part of the system under test. Scenarios stay within per-user limits so that limiting does not mask genuine capacity problems, except in Scenario 8 where load shedding is explicitly what is being verified.

**Load test data polluting staging.** Fictional data accumulates across runs and distorts subsequent results. Staging is reset to the seed profile before each milestone suite.

**Cost alert firing mid-run.** Expected. This is why runs are announced. A cost alert during an unannounced load test is indistinguishable from a real cost incident.

**A scenario passing for the wrong reason.** A test that passes because it never actually loaded the system — wrong endpoint, failed auth returning fast 401s, empty database — is worse than a failing test. Always verify request counts and status code distribution, not just the threshold summary.

---

## Integration Points

- `SCALING.md` — the source of every target verified here
- `PERFORMANCE_CHECKLIST.md` — per-operation targets that scenarios assert against
- `TEST_STRATEGY.md` — this is Layer 6 of the testing strategy
- `TEST_DATA.md` — seed profiles for each milestone
- `LAUNCH_CHECKLIST.md` — load test results are a go/no-go item
- `COST_MANAGEMENT.md` — runs generate real spend
- `AVAILABILITY.md` — runs trigger monitoring alerts

---

## Security Considerations

**Load testing production is a denial of service against real schools.** It is prohibited without exception, and staging URLs are the default in every script so an accidental production run requires an explicit override.

Test JWTs are real credentials for real staging accounts. They live in the CI secret store, never in the repository, and are rotated after each milestone suite. Test accounts are clearly named as such and hold no elevated permission beyond their role.

Load tests exercise rate limiting under adversarial-looking load. The results are useful security evidence: if legitimate peak traffic trips the limits, the limits are too tight, and if a load test can exhaust a shared resource, so can an attacker.

---

## Known Limitations and Future Work

- No load testing infrastructure exists yet. Scenarios are specified, not implemented.
- PowerSync sync load is approximated by HTTP requests in Scenario 6. Real sync behaviour with hundreds of concurrent devices is unmodelled and is a known blind spot flagged in `SCALING.md`.
- Mobile app load is not tested end to end — Detox does not scale to load testing volumes.
- No geographic distribution. Tests run from one location; real Zambian traffic arrives over higher-latency, lower-reliability mobile networks.
- Milestone targets are projections until pilot data exists. Re-derive them from real pilot traffic before the January 2027 launch.
- Third-party mocking means gateway latency and Meta throttling are invisible in results, though both are real production constraints.
- No automated regression detection between runs. Comparison is manual today.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-13 | Initial complete draft | Load testing had no owning document; targets in SCALING.md were unverified |
| 2026-08-13 | k6 adopted as primary, Artillery as secondary | ADR-033 — declarative thresholds and CI compatibility |
| 2026-08-13 | Eight scenarios defined against real school events | Correlated spikes, not average load, are what break this system |
| 2026-08-13 | Milestone test matrix tied to SCALING.md targets | A milestone is not certified until its scenario set passes |
