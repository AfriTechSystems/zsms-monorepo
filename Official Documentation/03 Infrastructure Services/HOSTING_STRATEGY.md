# HOSTING_STRATEGY.md — Hosting Decision Strategy

## Related Documents

- `03 Infrastructure Services/DEPLOYMENT_TOPOLOGY.md` — the three tiers this document selects between
- `01 Foundation Layer/COMPLIANCE.md` — per-country data protection assessment
- `04 Country and Configuration/ADDING_COUNTRY.md` — the launch playbook that follows this decision
- `01 Foundation Layer/DECISIONS.md` — ADR-022 (residency), ADR-032 (topology)
- `03 Infrastructure Services/COST_MANAGEMENT.md` — cost consequences of each tier
- `03 Infrastructure Services/AVAILABILITY.md` — availability consequences of each tier

---

## Purpose

This document defines how AfriTech decides where a country's ZSMS deployment is hosted. It sets the public-cloud-first default, defines what evidence is required before accepting a self-hosted deployment, gives practical guidance on selecting a local VPS provider and partner, and fixes the sequence in which approvals must be obtained. It is a decision process, not a technical specification — the technical detail lives in `DEPLOYMENT_TOPOLOGY.md`.

---

## Overview

The core position, stated plainly:

> **Public cloud is the default. Self-hosting is accepted only when a country's law leaves no compliant alternative — never because a customer prefers it, and never because it feels safer.**

The reasoning is that self-hosting trades a solved problem for an unsolved one. Managed infrastructure gives AfriTech automated backups, monitoring, patched dependencies, and one deployment path. Self-hosting replaces all of that with a country partner's operational maturity, which AfriTech cannot observe and cannot control. Every self-hosted deployment is a second product to support, running software AfriTech cannot see, backed up by someone AfriTech is not.

There is also a persistent misconception worth naming, because it comes up in nearly every enterprise conversation: **data sovereignty law is usually about adequate protection, not physical territory.** The ZDPA does not require Zambian data to sit in Zambia — `COMPLIANCE.md` states this explicitly. A prospective customer asserting "our data must stay in the country" is usually expressing a preference, occasionally repeating a misunderstanding, and only sometimes citing an actual legal requirement. The assessment below exists to tell these apart before AfriTech commits to a hosting model on the strength of a sales conversation.

---

## The Decision Flow

Run once per country, before any infrastructure is provisioned.

```
STEP 1 — What does the law actually say?
  Obtain the country's data protection statute and any
  sector guidance for education or financial services.
  Legal counsel reads the text. Not a summary, not a
  vendor's claim, not a customer's assertion.
        │
        ▼
STEP 2 — Is cross-border transfer permitted at all?
  ├─ YES, to adequate jurisdictions → STEP 3
  ├─ YES, with a mechanism (DPA, SCCs, consent) → STEP 3
  └─ NO, localisation mandated → STEP 5
        │
        ▼
STEP 3 — Does a compliant region exist on our providers?
  Supabase regions vs the adequacy list.
  ├─ YES → TIER 1. Document the basis. Done.
  └─ NO  → STEP 4
        │
        ▼
STEP 4 — Is there an acceptable alternative mechanism?
  Approved DPA, binding corporate rules, explicit consent
  where lawful for this data category.
  ├─ YES → TIER 1 with documented mechanism
  └─ NO  → STEP 5
        │
        ▼
STEP 5 — Self-hosted viability assessment
  Is there a credible local partner?
  Is there a suitable VPS provider?
  Does projected revenue justify the operational burden?
  ├─ ALL YES → TIER 2, subject to the approval sequence below
  └─ ANY NO  → DO NOT LAUNCH IN THIS COUNTRY YET
```

**Step 5's failure branch is a real outcome, not a formality.** A country that mandates localisation but has no credible partner and no suitable hosting is a country AfriTech should not enter. Launching anyway produces a deployment nobody can support and a compliance position nobody can defend.

---

## Evidence Required Before Accepting Tier 2

A self-hosted deployment proceeds only when all of the following exist as documents, not intentions:

| Evidence | Owner | Purpose |
|---|---|---|
| Written legal opinion citing the specific localisation provision | External counsel | Confirms the requirement is real |
| Confirmation that no adequacy mechanism applies | External counsel | Confirms Tier 1 is genuinely unavailable |
| Named local partner with signed responsibility split | Julius | Establishes who operates what |
| VPS provider assessment against the criteria below | Mwando | Confirms the infrastructure is adequate |
| Key custody and escrow agreement | Julius | Prevents data loss on partner exit |
| Revenue projection covering operational overhead | Julius | Confirms the deployment is economically sensible |
| Local data protection registration plan | Country partner | Confirms local compliance obligations are owned |

Missing any one of these means the country waits.

---

## Choosing a VPS Provider

Where Tier 2 is unavoidable, provider selection determines whether the deployment is merely harder to run or genuinely fragile.

**Prefer a managed VPS from an established local or regional provider over self-managed bare metal.** The goal is to recover as much managed-service benefit as the jurisdiction permits — someone else patching the hypervisor, monitoring the hardware, and taking the 2 a.m. call.

### Minimum criteria

| Criterion | Requirement | Why |
|---|---|---|
| Legal presence in-country | Registered entity, local jurisdiction | Often what the localisation law actually requires |
| Data centre location | Physically in-country | The point of Tier 2 |
| Managed service level | OS patching, hardware monitoring, backup | Reduces partner operational burden |
| Uptime SLA | ≥ 99.5% with credits | Must not undercut ZSMS's own target |
| Redundant power and connectivity | N+1 power, multiple upstreams | Single-homed data centres fail predictably |
| Backup infrastructure | Independent from the primary host | A backup on the same host is not a backup |
| Support responsiveness | 24/7 for critical, < 1 hour | School hours are non-negotiable |
| Security posture | ISO 27001 or a credible equivalent | Partner due diligence evidence |
| Provisioning capacity | Second VPS for standby replication | Required for `AVAILABILITY.md` targets |

### Disqualifying signals

- No published SLA, or an SLA with no remedies
- Backups stored on the same physical host
- No out-of-band or console access for recovery
- Reseller of a foreign cloud with no local data centre — this defeats the entire purpose and is common
- No documented incident history or status page
- Unwilling to sign a data processing agreement

### Minimum specification

Sized for a country at roughly 50 schools, scaling per `SCALING.md`:

| Role | Specification |
|---|---|
| Application server | 4 vCPU, 8 GB RAM, 100 GB SSD |
| Database primary | 4 vCPU, 16 GB RAM, 500 GB SSD, provisioned IOPS |
| Database standby | Matching primary, separate physical host |
| Object storage (MinIO) | 500 GB expandable |
| Redis / queue worker | 2 vCPU, 4 GB RAM |

---

## Choosing a Country Partner

The partner matters more than the hardware. Hardware failure is recoverable; a partner who does not apply security patches for six months is not.

**Required capabilities:** demonstrated Linux and PostgreSQL operations experience; capacity to respond within school hours; willingness to accept documented responsibilities in writing; and local standing sufficient to hold data protection registration.

**Warning signs:** a partner who is primarily a reseller with no operations team; one who intends to subcontract operations to an unnamed third party; one unwilling to commit to patch timelines; or one who sees hosting as a revenue line rather than an obligation.

**The responsibility split from `DEPLOYMENT_TOPOLOGY.md` is signed before launch, not after.** The most expensive ambiguity in a self-hosted deployment is who restores the database at 03:00.

---

## Approval Sequence

The order is fixed. Each step gates the next, and reordering them is how a deployment ends up legally unsupportable after the infrastructure is already running.

```
1. LEGAL ASSESSMENT
   External counsel confirms the requirement and the mechanism.
   No infrastructure discussion until this is written down.
        ↓
2. DPA APPROVAL
   Data processing agreements signed with every sub-processor
   in the chain — VPS provider, country partner, and any
   remaining AfriTech-operated service.
   ── NOTHING IS PROVISIONED BEFORE THIS STEP COMPLETES ──
        ↓
3. PARTNER AND PROVIDER SELECTION
   Assessed against the criteria above. Responsibility split
   and key custody agreements signed.
        ↓
4. LOCAL REGISTRATION
   Country partner completes data protection authority
   registration where required.
        ↓
5. INFRASTRUCTURE PROVISIONING
   VPS, database, storage, queue. Tier 3 vault export configured
   at provisioning, not afterwards.
        ↓
6. DEPLOYMENT AND VERIFICATION
   Migrations applied. RLS tests pass. Backup restore verified.
   Vault export verified end to end.
        ↓
7. PILOT THEN LAUNCH
   Per ADDING_COUNTRY.md.
```

**Step 2 is the hard gate.** Provisioning infrastructure before DPAs are signed means personal data may flow through an entity with no lawful basis to process it. The remedy at that point is deleting the deployment and starting again.

---

## Reassessment

Hosting decisions are not permanent. Each country's assessment is reviewed:

- **Annually**, as part of the compliance review cycle in `COMPLIANCE.md`
- **On any change** to the country's data protection law
- **When a provider adds a compliant region** — a Tier 2 country may become eligible for Tier 1, which is always an improvement worth taking
- **On partner change or termination**

A Tier 2 country that becomes Tier 1 eligible should migrate. The operational burden of self-hosting is a permanent cost with no offsetting benefit once the legal requirement lifts.

---

## Business Rules

1. Public cloud (Tier 1) is the default. Self-hosting is accepted only on a written legal opinion citing a specific localisation provision.
2. Customer preference is never sufficient grounds for self-hosting. Only law is.
3. No infrastructure is provisioned before all applicable DPAs are signed.
4. Tier 2 requires all seven evidence items. Missing any one delays the launch.
5. VPS providers that are resellers of foreign cloud with no local data centre are disqualified — they satisfy the letter of a localisation requirement while defeating its purpose.
6. The responsibility split and key custody agreement are signed before provisioning.
7. Hosting assessments are reviewed annually and on any relevant legal or provider change.
8. A Tier 2 country that becomes Tier 1 eligible migrates at the next practical opportunity.
9. A country failing the Step 5 viability assessment is not launched.

---

## Edge Cases and Error Handling

**A large customer demands self-hosting.** Common with government and international school groups. The answer is the assessment: if the law permits Tier 1, ZSMS is offered on Tier 1, and the compliance basis is explained in writing. `COMPLIANCE.md` and `THIRTEEN_LAYER_COMPLIANCE.md` are usually more persuasive than a hosting concession. Walking away from a deal is preferable to operating a deployment nobody can support.

**Law is ambiguous.** Where counsel cannot give a clear opinion, default to the more conservative reading — but note that "conservative" is not automatically "self-hosted". An unnecessary Tier 2 deployment carries its own compliance risk, because a poorly operated local deployment is less secure than a well-operated foreign one.

**Partner fails during assessment.** Do not proceed with a weak partner because a customer is waiting. A failed self-hosted deployment damages the product's reputation across the whole region.

**Provider changes ownership or moves data centres.** Triggers immediate reassessment. A provider acquired by a foreign entity may no longer satisfy the localisation requirement that justified Tier 2 in the first place.

**Sub-processor added after launch.** Any new service touching personal data requires a DPA before it is enabled, in every tier. This applies to AfriTech-operated services equally.

---

## Integration Points

- `DEPLOYMENT_TOPOLOGY.md` — the technical specification of the selected tier
- `COMPLIANCE.md` — per-country assessments and the sub-processor DPA inventory
- `ADDING_COUNTRY.md` — the launch playbook executed after this decision
- `COST_MANAGEMENT.md` — Tier 2 shifts infrastructure cost to the partner but adds AfriTech support cost
- `AVAILABILITY.md` — Tier 2 availability depends on partner capability
- `SECURITY_POLICIES.md` — vendor management and partner due diligence

---

## Security Considerations

**Self-hosting is not automatically more secure, and is frequently less so.** A managed Supabase project receives security patches automatically, is monitored continuously, and is operated by a team whose full-time job it is. A local VPS operated by a partner with other priorities may run unpatched for months. When a customer equates local hosting with security, that assumption should be examined rather than accommodated.

Partner due diligence is a security control. The partner will hold plaintext personal data for an entire country, and AfriTech's technical controls end at the software boundary.

The approval sequence is itself a security control. Provisioning before DPAs are signed creates an unlawful processing situation that cannot be remediated after the fact.

---

## Known Limitations and Future Work

- No Tier 2 deployment has been executed. This process is untested against reality and will need revision after the first one.
- No standing legal counsel relationship for African data protection law. Each assessment currently requires sourcing counsel, which is slow and inconsistent.
- No template partner agreement, responsibility split, or key custody instrument. Each would be drafted from scratch today.
- VPS criteria are drawn from general infrastructure practice, not from evaluating actual providers in target markets. Real evaluation may reveal that few providers in some countries meet them.
- No cost model for Tier 2. Support burden, release overhead, and incident cost are acknowledged but unquantified.
- Reassessment is calendar-driven with no monitoring of legal change. A country that amends its law between reviews would not be noticed promptly.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-13 | Initial complete draft | Hosting decision process formalised alongside ADR-032 |
| 2026-08-13 | Public-cloud-first default stated explicitly | Self-hosting requests are usually preference, not legal requirement |
| 2026-08-13 | DPA-approval-before-provisioning gate fixed in the sequence | Provisioning first creates unlawful processing with no remedy |
| 2026-08-13 | VPS and partner selection criteria defined | Foreign-cloud resellers satisfy the letter of localisation while defeating its purpose |
