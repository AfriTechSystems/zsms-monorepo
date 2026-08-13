# COMPLIANCE.md — Regulatory Compliance Framework

## Related Documents

- `docs/foundation/SECURITY_POLICIES.md` — technical security controls
- `docs/modules/auth/SESSIONS.md` — session management as compliance control
- `docs/RLS.md` — data isolation as compliance control
- `docs/countries/ZM.md` — Zambia-specific compliance requirements
- `docs/testing/SECURITY_AUDIT.md` — pre-launch compliance verification

---

## Purpose

This document defines ZSMS's complete compliance framework — the regulatory obligations AfriTech must meet, the current compliance posture, the SOC 2 roadmap, and the data flow documentation required for regulatory submissions. Every Claude Code session building any feature that touches personal data must understand the compliance context defined here.

---

## Regulatory Obligations

### Zambia Data Protection Act 2021 (ZDPA)

The ZDPA is the primary data protection legislation governing ZSMS operations in Zambia. AfriTech Systems Limited is a **data controller** under the ZDPA — it determines the purposes and means of processing personal data.

**Core obligations:**

| Obligation | Status | Implementation |
|---|---|---|
| Data Controller registration with ZICTA | Required before commercial launch | Julius to complete — January 2027 |
| Lawful basis for processing | Required | Consent (parents) + Legitimate interest (school operations) |
| Data subject rights (access, correction, deletion) | Required | Parent portal profile + support request process |
| Cross-border transfer adequacy | Required | Supabase af-south-1 (POPIA adequate) + Clerk DPA |
| Data breach notification (72 hours) | Required | Sentry alerts + incident response plan |
| Data minimisation | Required | Only collect data necessary for stated purpose |
| Privacy policy publication | Required before launch | zsms.co.zm/privacy |
| Terms of service publication | Required before launch | zsms.co.zm/terms |

**What the ZDPA does NOT require:**
- Data must be stored in Zambia (adequacy of protection is the standard, not territory)
- SMS OTP or specific authentication mechanisms
- Specific data retention periods (reasonable periods aligned with purpose)

---

### Bank of Zambia — MFI Licensing (Phase 3)

When ZSMS registers as a Microfinance Institution:

| Requirement | Timeline | Notes |
|---|---|---|
| MFI licence application | Phase 3 (2028+) | Julius leads with legal counsel |
| Minimum capital requirement | Phase 3 | Bank of Zambia will specify |
| Credit bureau reporting (ZCR) | Phase 3 | Report loan outcomes to Zambia Credit Reference Bureau |
| Consumer protection compliance | Phase 3 | Disclosure requirements for loan products |
| Anti-money laundering (AML) | Phase 3 | KYC requirements for borrowers |
| SOC 1 Type II | Phase 3 | Required when ZSMS holds and moves funds directly |

**Why Phase 3 only:** ZSMS does not hold funds in Phase 1 or 2. Loans are disbursed by partner MFIs directly to schools. AfriTech earns commission only. MFI licensing is only triggered when ZSMS itself lends directly.

---

### Multi-Country Expansion Compliance (Future)

For each new country, a compliance assessment is required before launch:

| Country | Data Protection Law | Adequacy Notes | Self-Hosted Required? |
|---|---|---|---|
| Zambia (ZM) | ZDPA 2021 | af-south-1 adequate | No |
| Botswana (BW) | Data Protection Act 2018 | Similar to ZDPA | No |
| Zimbabwe (ZW) | Cyber and Data Protection Act 2021 | Similar framework | TBD |
| Kenya (KE) | Data Protection Act 2019 | More mature — strict | Possibly |
| Nigeria (NG) | NDPR 2019 | Strict — data localisation risk | Likely |
| Rwanda (RW) | Law No. 058/2021 | Modern framework | TBD |

Countries flagged "Likely" for self-hosted require the Keycloak + Supabase self-hosted deployment path documented in ARCHITECTURE.md.

---

## Data Flow Documentation

Required for ZICTA registration and SOC 2 audit.

### Personal Data Inventory

| Data Category | Examples | Storage Location | Legal Basis | Retention |
|---|---|---|---|---|
| Student identity | Name, DOB, student ID | Supabase af-south-1 | Contract (school) | Duration of enrollment + 7 years |
| Student academic records | Marks, results, attendance | Supabase af-south-1 | Contract (school) | Indefinite (alumni access) |
| Parent contact details | Name, phone, email | Supabase af-south-1 + Clerk (US, DPA) | Contract (school) | Duration + 7 years |
| Financial records | Fee amounts, payment history | Supabase af-south-1 | Contract (school) | 7 years (Zambian financial regulations) |
| Loan application PII | Income, NRC, payslips | Supabase af-south-1 (private schema, encrypted) | Consent (explicit) | 7 years |
| Staff records | Name, email, role | Supabase af-south-1 + Clerk (US, DPA) | Contract (school) | Duration of employment + 3 years |
| Authentication credentials | Email, phone, session tokens | Clerk (US, DPA covered) | Contract | Duration of account |
| Documents (PDFs) | Report cards, receipts, certificates | Cloudflare R2 | Contract | Indefinite (alumni access) |
| Analytics events | Anonymised usage patterns | PostHog (EU servers) | Legitimate interest | 2 years |

### Data Flow Diagram

```
Parents/Students/Teachers
          |
          | HTTPS (TLS 1.3)
          ↓
Cloudflare WAF + CDN (DDoS protection, WAF rules)
          |
          ↓
Vercel Edge Network (JWT verification, rate limiting)
          |
          ↓
Next.js Application (Vercel — US/Global)
          |
    ┌─────┴─────┐
    ↓           ↓
Clerk (US)    Supabase (af-south-1, South Africa)
Auth only     All personal data, RLS enforced
    |           |
    |           ├── Cloudflare R2 (Documents, global CDN)
    |           ├── PowerSync (Mobile offline sync)
    |           └── Railway (Standby replica, same data)
    |
    └── DPA in place (GDPR-equivalent terms)

Background Processing:
Application → Queue abstraction → BullMQ workers on Railway (default, ADR-035)
                                → QStash (US) only if the fallback is active
Note: job payloads carry record IDs only — no personal data in the queue,
      under either implementation

WhatsApp:
Supabase → Meta Cloud API (US) → Parent's device
Note: Message content is school notifications, not stored by Meta beyond delivery
```

The diagram above describes **production**. Non-production environments are covered separately below.

---

## Environment Data Residency

The `af-south-1` adequacy argument applies to environments that hold real personal data. It is not a blanket requirement across every ZSMS environment — it is a requirement that follows the data.

| Environment | Supabase Project | Region | Data Held | Adequacy Basis Required |
|---|---|---|---|---|
| Development | `zsms-dev` | `eu-west-1` (Ireland) | Synthetic and seed data only | No — no personal data processed |
| Staging | `zsms-staging` | `af-south-1` (South Africa) | Synthetic and seed data; UAT may involve real pilot data | Yes |
| Production | `zsms-zm` | `af-south-1` (South Africa) | All real school, student, parent, and financial data | Yes — POPIA adequacy under ZDPA |

### Development environment exception (`zsms-dev`, `eu-west-1`)

The development Supabase project is hosted in `eu-west-1` (Ireland), not `af-south-1`. This is a **deliberate, documented exception**, not a configuration error.

**Why the exception is compliant:** The ZDPA's cross-border transfer provisions govern the transfer of *personal data*. `zsms-dev` holds only synthetic and seed data generated per `docs/testing/TEST_DATA.md` — fictional school names, fictional students, fictional phone numbers, and fictional financial amounts. No data subject exists, so no personal data is transferred, and no adequacy basis is engaged. The POPIA-adequacy argument that justifies `af-south-1` for production simply has no subject matter to apply to here.

**The binding constraint:** No real school data may ever be placed in `zsms-dev` — not production dumps, not anonymised extracts of real records, not pilot school data, not screenshots of real parent contact details loaded as fixtures. If real data is ever needed for debugging, it is reproduced as synthetic data matching the shape of the problem, or the investigation happens in `zsms-staging`.

**Future revisit:** If `af-south-1` becomes available on AfriTech's Supabase plan, the dev project may be recreated in that region so all environments match. This is a consistency preference, not a compliance obligation, and is explicitly **not required**.

**Note for ZICTA registration and SOC 2 evidence:** When documenting the asset inventory and data flows, list `zsms-dev` as a non-production system processing no personal data. It is in scope for the asset inventory (it is a system AfriTech operates) but out of scope for cross-border transfer analysis.

---

## SOC 2 Compliance Roadmap

### What SOC 2 Is

SOC 2 (Service Organization Control 2) is an independent audit framework that certifies a SaaS company's security, availability, and privacy controls. It is the standard enterprise customers and financial regulators require before trusting a SaaS with sensitive data.

**Why ZSMS needs SOC 2:**
- Bank of Zambia MFI licensing will require evidence of security controls
- Enterprise school groups and international schools require it before signing contracts
- ZDPA "appropriate technical measures" is best evidenced by SOC 2 attestation
- Lender onboarding due diligence can be satisfied with SOC 2 instead of lengthy security questionnaires

**SOC 2 vs SOC 1:**
- SOC 1: Financial reporting controls — needed only when ZSMS holds and moves funds (Phase 3 MFI)
- SOC 2: Data security and privacy controls — needed now for the SaaS product

### Trust Services Criteria for ZSMS

ZSMS pursues SOC 2 across three criteria:

| Criterion | Priority | Rationale |
|---|---|---|
| Security (CC) | Mandatory | Access control, encryption, monitoring — already mostly implemented |
| Availability (A) | Include | Schools depend on ZSMS during school hours — uptime is contractual |
| Confidentiality (C) | Include | Student records, financial data, loan PII require confidentiality controls |

Privacy (P) is deferred to SOC 2 renewal — it requires a mature privacy programme and is rarely audited in the first SOC 2 engagement.

### Current Controls vs SOC 2 Requirements

**Already implemented (evidence available at audit):**

| SOC 2 Control | ZSMS Implementation | Evidence |
|---|---|---|
| CC6.1 Logical access | Clerk RBAC, RLS, custom roles | Clerk config, RLS policies |
| CC6.2 New user access | Staff invitation flow, school org creation | Audit logs |
| CC6.3 Access removal | Staff removal revokes Clerk membership | Audit logs |
| CC6.6 Encryption in transit | TLS 1.3 enforced by Vercel/Cloudflare | TLS configuration |
| CC6.7 Encryption at rest | Supabase + R2 AES-256, field encryption | Database config |
| CC7.1 Monitoring | Sentry error tracking, PostHog, Railway alerts | Alert configs |
| CC7.2 Anomaly detection | Suspicious activity detection in sessions | Audit logs |
| CC8.1 Change management | Git branch protection, staging environment | GitHub settings |
| A1.1 Availability commitments | Supabase Pro SLA, Railway standby | SLA agreements |
| A1.2 Capacity planning | Supabase usage monitoring | PostHog + Sentry |

**Gaps to close before SOC 2 Type I audit:**

| Gap | Required Action | Owner | Timeline |
|---|---|---|---|
| Written Information Security Policy | Author SECURITY_POLICIES.md, get board sign-off | Mwando | Jan 2027 |
| Access Control Policy | Formal document with review process | Mwando | Jan 2027 |
| Incident Response Plan | Documented procedure with contact list | Both | Jan 2027 |
| Vendor Management Policy | DPA inventory, annual review process | Julius | Feb 2027 |
| Business Continuity Plan | Recovery procedures, RTO/RPO targets | Mwando | Feb 2027 |
| Annual penetration test | Engage independent security firm | Both | Mar 2027 |
| Background checks for staff | Formal process for production data access | Julius | Ongoing |
| Security awareness training | Annual training with attendance log | Both | Ongoing |
| Formal risk assessment | Annual documented risk assessment | Both | Mar 2027 |
| Asset inventory | Inventory of all systems handling personal data | Mwando | Jan 2027 |

### SOC 2 Timeline

```
January 2027 — Commercial Launch
  ↓ Implement written policies

March 2027 — SOC 2 Readiness
  ↓ Engage Vanta or Drata (compliance automation — ~$12,000/year)
  ↓ Vanta maps existing controls automatically
  ↓ Identifies remaining gaps with remediation guidance

April 2027 — Penetration Test
  ↓ Independent security firm tests ZSMS
  ↓ Remediate any critical/high findings

June 2027 — SOC 2 Type I Audit
  ↓ Point-in-time assessment of control design
  ↓ Expected cost: $15,000–25,000 USD
  ↓ Report issued: "Controls are suitably designed"

June 2027 → June 2028 — Controls Operating Period
  ↓ Evidence collected continuously by Vanta

June 2028 — SOC 2 Type II Audit
  ↓ Operational effectiveness over 12 months assessed
  ↓ Expected cost: $30,000–50,000 USD
  ↓ Report issued: "Controls operated effectively"
  ↓ This report satisfies enterprise customers and Bank of Zambia
```

### Compliance Automation Tool Recommendation

**Vanta** (vanta.com) is the recommended SOC 2 automation tool for ZSMS at this stage:
- Integrates with GitHub, Vercel, Supabase, Clerk, AWS/Cloudflare
- Automatically collects evidence from existing systems
- Assigns remediation tasks with guidance
- Manages vendor DPA tracking
- Cost: approximately $12,000–15,000/year
- Justification: Replaces weeks of manual evidence collection per audit cycle

Alternative: **Drata** — similar capability, slightly higher cost, stronger enterprise focus.

---

## Data Subject Rights Procedures

Under the ZDPA, data subjects (parents, students, staff) have rights that AfriTech must honour:

| Right | Procedure | Response Time |
|---|---|---|
| Access | Parent requests data export via support@afritechsystems.com | 30 days |
| Correction | Update via parent portal profile or support request | 7 days |
| Deletion | Anonymisation of personal fields (records retained for legal purposes) | 30 days |
| Portability | CSV export of own data via parent portal | 14 days |
| Objection | Opt-out via portal settings (whatsapp_opted_in, marketing_opt_in) | Immediate |

**Deletion note:** Complete deletion of payment records is not possible — Zambian financial regulations require 7-year retention. Deletion requests result in anonymisation (name replaced with "DATA SUBJECT DELETED", phone with "DELETED") while retaining the financial record structure.

---

## Business Rules

1. AfriTech must register as a ZICTA Data Controller before the January 2027 commercial launch. Julius owns this action.
2. All new features that collect personal data must be assessed against the data inventory before implementation.
3. Data Processing Agreements (DPAs) must be signed with all sub-processors before they handle personal data. Current DPAs required: Clerk, Supabase, Cloudflare, Meta, Resend, Twilio.
4. SOC 2 readiness is a product requirement — not a nice-to-have. It is on the path to MFI licensing and enterprise contracts.
5. Session durations are set at 30 days maximum for all end-user roles as a SOC 2 Logical Access control.
6. Real school data — including production dumps, anonymised extracts, and pilot school records — must never be loaded into the `zsms-dev` project. The EU region exception for dev depends entirely on that project holding synthetic data only. Debugging that requires realistic data uses synthetic reproductions or `zsms-staging`.
7. Staging (`zsms-staging`) and production (`zsms-zm`) must be provisioned in `af-south-1`. The documented POPIA adequacy basis applies to those environments and is a launch blocker for production.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-06-23 | Initial complete draft | Compliance framework for enterprise SaaS |
| 2026-06-23 | SOC 2 roadmap included | Required for MFI licensing and enterprise contracts |
| 2026-06-23 | Data flow diagram documented | Required for ZICTA registration |
| 2026-06-23 | Data subject rights procedures | ZDPA 2021 requirement |
| 2026-08-13 | Added Environment Data Residency section | `zsms-dev` provisioned in `eu-west-1`; documenting the synthetic-data-only basis for the exception |
| 2026-08-13 | Added business rules 6 and 7 | Bind the dev exception to a no-real-data constraint; fix staging/production to `af-south-1` |
