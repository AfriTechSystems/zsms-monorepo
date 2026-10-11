# LAUNCH_CHECKLIST.md — Pre-Launch Go/No-Go Checklist

## Related Documents

- `docs/testing/UAT_CHECKLIST.md` — UAT must be complete before this checklist
- `docs/testing/SECURITY_AUDIT.md` — security checks referenced here
- `docs/testing/PERFORMANCE_CHECKLIST.md` — performance checks referenced here
- `docs/infra/VERCEL.md` — production deployment
- `docs/infra/SUPABASE.md` — production database verification
- `docs/countries/ZM.md` — Zambia compliance requirements
- `docs/modules/admin/ONBOARDING.md` — pilot school readiness

---

## Implementation Status (2026-10-11)

**The engineering half is largely done; the purchases and environments are not.**

Done and verified: R2 live (`r2:smoke`, 14 checks), PostHog live (`posthog:smoke`),
Upstash and the queue transport proven (`queue:smoke`), 38 pgTAP suites green in CI,
migrations applying cleanly to an empty database on every push, and the security audit
executable and clean (`security:audit` — 15 pass, 0 fail).

**Blocking, and none of it is code:**

| Blocker | Why it blocks launch |
|---|---|
| **Paid Clerk plan** | The free tier caps an organisation at **five members**. A school with six staff cannot be fully onboarded |
| **Meta / Twilio / Resend** | No message has ever left this machine. Every channel runs through the mock provider |
| **`zsms-staging` and `zsms-zm` in `af-south-1`** | `COMPLIANCE.md` requires substantive personal data to stay in `af-south-1`. Only `eu-west-1` dev exists |
| **Terms of Service and Privacy Policy** | Registration records consent and `0150` timestamps it; the pages state plainly that final text is unpublished. Needs a lawyer, not a developer |
| **`FIELD_ENCRYPTION_KEY`** | Until set, no per-school integration credential can be stored at all |

**SMS deserves separate mention.** In Zambia it is the channel that reaches a parent with
no smartphone and no data. Today that parent is reached by nothing — the in-app badge needs
the portal and the portal needs a smartphone. Twilio is a launch prerequisite rather than
an enhancement.

---

## Purpose

This document is the go/no-go checklist for two launch milestones: the September 2026 pilot launch (10 pilot schools) and the January 2027 commercial launch (open self-registration). Every item must be checked by the responsible person before any school goes live on production.

---

## September 2026 Pilot Launch Checklist

Target date: **1 September 2026**

---

### Section A — Infrastructure Readiness

| # | Check | Responsible | Status |
|---|---|---|---|
| A1 | Supabase `zsms-zm` project on Pro plan (not Free tier) | Mwando | ☐ |
| A2 | All migrations applied to `zsms-zm` — `supabase migration list` shows all applied | Mwando | ☐ |
| A3 | `supabase db diff` returns no differences (schema matches migrations) | Mwando | ☐ |
| A4 | Railway standby replication active — lag under 5 seconds | Mwando | ☐ |
| A5 | Cloudflare R2 buckets `zsms-public-zm` and `zsms-private-zm` created | Mwando | ☐ |
| A6 | R2 lifecycle policy configured (Infrequent Access after 3 years) | Mwando | ☐ |
| A7 | Vercel `zsms-zm` project connected to `main` branch | Mwando | ☐ |
| A8 | Custom domain `zsms.co.zm` pointing to Vercel — SSL active | Mwando | ☐ |
| A9 | Staging domain `staging.zsms.co.zm` active and pointing to `integration` branch | Mwando | ☐ |
| A10 | Queue provider production plan active — Railway workers + Redis sized (or QStash paid tier if fallback) | Mwando | ☐ |
| A11 | Upstash Redis production instance active for rate limiting | Mwando | ☐ |
| A12 | All Vercel environment variables set for production — confirmed via test page load | Mwando | ☐ |
| A13 | All Supabase Edge Function secrets set — `supabase secrets list` verified | Mwando | ☐ |

---

### Section B — Application Readiness

| # | Check | Responsible | Status |
|---|---|---|---|
| B1 | All Edge Functions deployed — `supabase functions list` shows all active | Mwando | ☐ |
| B2 | TypeScript types up to date — `supabase gen types typescript` run after last migration | Mwando | ☐ |
| B3 | Unit tests pass — `turbo test --filter=utils` exits 0 | Mwando | ☐ |
| B4 | RLS tests pass — `supabase test db` exits 0 | Mwando | ☐ |
| B5 | E2E tests pass against staging — `playwright test` exits 0 | Mwando | ☐ |
| B6 | Supabase Realtime enabled for `report_generation_jobs` and `payments` tables | Mwando | ☐ |
| B7 | PowerSync production project configured and sync rules deployed | Mwando | ☐ |
| B8 | Mobile app (teacher + parent) submitted to App Store / Play Store and approved | Mwando | ☐ |
| B9 | PDF generation tested on production — report card preview generates correctly | Mwando | ☐ |

---

### Section C — Payment Gateway Readiness

| # | Check | Responsible | Status |
|---|---|---|---|
| C1 | PawaPay production credentials set in Edge Function secrets | Mwando | ☐ |
| C2 | PawaPay webhook URL `zsms.co.zm/api/webhooks/payment/pawapay` registered in PawaPay dashboard | Mwando | ☐ |
| C3 | PawaPay end-to-end test: sandbox payment → ZSMS webhook received → fee record updated | Mwando | ☐ |
| C4 | Flutterwave credentials set (if any pilot school requests it) | Mwando | ☐ |

---

### Section D — WhatsApp Readiness

| # | Check | Responsible | Status |
|---|---|---|---|
| D1 | AfriTech WhatsApp Business number registered and verified with Meta | Mwando | ☐ |
| D2 | All required message templates approved by Meta (check `docs/communication/TEMPLATES.md` for full list) | Mwando | ☐ |
| D3 | Meta webhook `zsms.co.zm/api/webhooks/whatsapp` configured and verified | Mwando | ☐ |
| D4 | WhatsApp test message sent and delivered successfully | Mwando | ☐ |
| D5 | WhatsApp chatbot tested — FEES, RESULTS, ATTENDANCE, HELP commands return correct responses | Mwando | ☐ |
| D6 | Monthly quota tracking verified — quota deducted correctly after test message | Mwando | ☐ |

---

### Section E — Operational Readiness

| # | Check | Responsible | Status |
|---|---|---|---|
| E1 | ZICTA Data Controller registration application submitted | Julius | ☐ |
| E2 | Privacy Policy published at `zsms.co.zm/privacy` | Julius | ☐ |
| E3 | Terms of Service published at `zsms.co.zm/terms` | Julius | ☐ |
| E4 | Data Processing Agreement signed with Clerk | Julius | ☐ |
| E5 | Data Processing Agreement signed with Supabase (Supabase DPA available in dashboard) | Julius | ☐ |
| E6 | Support email `support@afritechsystems.com` configured and monitored | Julius | ☐ |
| E7 | AfriTech team Clerk accounts created with correct roles | Mwando | ☐ |
| E8 | AfriTech scope assignments created in `afritech.staff_scope_assignments` | Mwando | ☐ |

---

### Section F — Monitoring Readiness

| # | Check | Responsible | Status |
|---|---|---|---|
| F1 | Sentry production project active — errors routing to Mwando's email | Mwando | ☐ |
| F2 | Sentry payment error alert configured — immediate email on any payment Edge Function error | Mwando | ☐ |
| F3 | PostHog production project active — `school_trial_started` event firing on test registration | Mwando | ☐ |
| F4 | Railway replication lag monitored — alert if lag > 30 seconds | Mwando | ☐ |
| F5 | Supabase Pro plan usage alerts configured (database size, API calls) | Mwando | ☐ |

---

### Section G — Pilot School Readiness

| # | Check | Responsible | Status |
|---|---|---|---|
| G1 | All 10 pilot school accounts created in production | Mwando | ☐ |
| G2 | All 10 pilot school owners have accepted their Clerk invitations | Mwando | ☐ |
| G3 | All 10 pilot schools have completed UAT (all 10 scenarios passed) | Both | ☐ |
| G4 | All 10 pilot school contacts saved in AfriTech CRM | Julius | ☐ |
| G5 | Onboarding call scheduled with each pilot school for launch week | Julius | ☐ |
| G6 | Pilot pricing agreed and configured for each school | Julius | ☐ |

---

### Pilot Launch Go/No-Go Decision

**All of Sections A, B, D, E, F, G must be complete.**
Section C (payment gateways) must have at least PawaPay verified.

```
Section A — Infrastructure:    PASS / FAIL  (items failed: ___)
Section B — Application:       PASS / FAIL  (items failed: ___)
Section C — Payment Gateways:  PASS / FAIL  (items failed: ___)
Section D — WhatsApp:          PASS / FAIL  (items failed: ___)
Section E — Operational:       PASS / FAIL  (items failed: ___)
Section F — Monitoring:        PASS / FAIL  (items failed: ___)
Section G — Pilot Schools:     PASS / FAIL  (items failed: ___)

DECISION: GO / NO-GO

Signed: Mwando Hamwenda (CTO) _______________  Date: ___________
Signed: Julius Masiwa (CFO)  _______________  Date: ___________
```

---

## January 2027 Commercial Launch Additions

Additional checks required before opening self-registration to the public:

| # | Check | Responsible | Status |
|---|---|---|---|
| J1 | Self-registration page live at `zsms.co.zm/register` | Mwando | ☐ |
| J2 | Trial activation flow tested end-to-end (register → trial → onboarding email) | Mwando | ☐ |
| J3 | 24-hour outreach queued job tested — escalation fires if no contact recorded | Mwando | ☐ |
| J4 | AfriTech onboarding task queue built and tested in admin panel | Mwando | ☐ |
| J5 | Subscription billing via Flutterwave tested (trial → paid conversion flow) | Mwando | ☐ |
| J6 | ZICTA Data Controller registration confirmed (number received) | Julius | ☐ |
| J7 | Public school directory live and searchable at `zsms.co.zm/schools` | Mwando | ☐ |
| J8 | Marketing site live at `zsms.co.zm` with pricing page | Julius | ☐ |
| J9 | AfriTech regional manager hired and trained (Zambia) | Julius | ☐ |
| J10 | Platform metrics dashboard operational in admin panel | Mwando | ☐ |
| J11 | Pilot school case studies prepared (2 minimum) for marketing | Julius | ☐ |
| J12 | All pilot schools converted from pilot pricing to standard subscription | Julius | ☐ |

---

## Rollback Plan

If a critical issue is discovered after launch:

**Immediate (within 1 hour):**
1. Mwando takes down the production site via Vercel dashboard (maintenance mode)
2. Post status update on `status.zsms.co.zm` (if configured — to be built)
3. Notify all pilot school owners via WhatsApp: "ZSMS is temporarily unavailable for maintenance. We'll update you shortly."

**Within 4 hours:**
1. Diagnose issue using Sentry error logs
2. If fixable: deploy hotfix to staging → test → deploy to production
3. If not fixable: roll back to previous Vercel deployment (30-second rollback)
4. Restore database from Railway standby if data corruption occurred

**Communication:**
- Pilot school owners: WhatsApp message from AfriTech shared number
- AfriTech team: Internal WhatsApp group
- Status updates every 30 minutes until resolved

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 16 testing and launch documentation |
| 2026-04-26 | Added WhatsApp school-specific number checks | School-specific WhatsApp confirmed |
| 2026-04-26 | Separated pilot and commercial launch checklists | Two distinct launch milestones |
| 2026-04-26 | Added rollback plan | Critical for pilot — must have recovery plan |
