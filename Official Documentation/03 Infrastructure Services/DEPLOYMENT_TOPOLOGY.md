# DEPLOYMENT_TOPOLOGY.md — Three-Tier Deployment Topology

## Related Documents

- `03 Infrastructure Services/HOSTING_STRATEGY.md` — the decision process for selecting a tier
- `01 Foundation Layer/ARCHITECTURE.md` — system architecture and the abstraction layers
- `01 Foundation Layer/DECISIONS.md` — ADR-032 records this topology; ADR-022 the residency strategy
- `04 Country and Configuration/ADDING_COUNTRY.md` — the country launch playbook
- `01 Foundation Layer/COMPLIANCE.md` — per-country data protection assessment
- `03 Infrastructure Services/AVAILABILITY.md` — the backup vault's recovery role
- `03 Infrastructure Services/BULLMQ.md`, `CLERK.md`, `R2.md`, `SUPABASE.md` — the abstracted services

---

## Purpose

This document defines the three deployment tiers ZSMS supports — central public cloud, per-country self-hosted, and the central encrypted backup vault — and explains how the auth, queue, and storage abstractions reduce each country's hosting model to a configuration decision rather than a fork of the codebase. Every Claude Code session writing code that touches authentication, background jobs, or file storage must understand why direct provider calls are prohibited.

---

## Overview

ZSMS sells into markets whose data protection regimes range from permissive to strictly localising. Nigeria may require data to remain in Nigeria. Zambia requires adequate protection, not territory. Botswana sits somewhere between. A product that can only deploy one way can only sell into one kind of market.

The response is three deployment tiers sharing **one codebase, one schema, and one release**. A country is assigned to a tier during its compliance assessment, and that assignment changes configuration and infrastructure — never application logic.

```
┌──────────────────────────────────────────────────────────────┐
│  TIER 1 — CENTRAL PUBLIC CLOUD          (default)            │
│                                                              │
│  Vercel · Supabase · Clerk · Upstash · Cloudflare R2         │
│  AfriTech operates everything. One Supabase project and       │
│  one Vercel deployment per country.                          │
│  Countries: ZM (af-south-1), BW and ZW planned                │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│  TIER 2 — PER-COUNTRY SELF-HOSTED       (when forced)        │
│                                                              │
│  Supabase self-hosted · Keycloak · BullMQ/Redis · MinIO      │
│  Country partner operates the infrastructure on local VPS.    │
│  AfriTech ships software, updates, and support.              │
│  Countries: none yet — for localisation-mandating markets     │
└──────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│  TIER 3 — CENTRAL ENCRYPTED BACKUP VAULT   (always on)       │
│                                                              │
│  Encrypted daily exports from every Tier 1 and Tier 2         │
│  deployment. AfriTech holds ciphertext only.                  │
│  Purpose: disaster recovery of last resort                    │
└──────────────────────────────────────────────────────────────┘
```

Tier 3 is not an alternative to Tiers 1 and 2 — it operates alongside both.

---

## Tier 1 — Central Public Cloud

The default and strongly preferred tier. Used wherever the country's data protection law permits cross-border transfer to an adequate jurisdiction.

| Layer | Service | Notes |
|---|---|---|
| Frontend / API | Vercel | One project per country (`zsms-zm`, `zsms-bw`) |
| Database | Supabase | One project per country (ADR-009) |
| Auth | Clerk | Shared instance, organisation-scoped per school |
| Queue | BullMQ workers on Railway | Default per ADR-035; QStash is the fallback |
| Cache | Upstash Redis | Per country |
| Storage | Cloudflare R2 | Two buckets per country (`zsms-public-zm`, `zsms-private-zm`) |
| CDN / WAF | Cloudflare | Shared zone, per-country hostnames |
| Monitoring | Sentry, PostHog | Shared, tagged by country |

**AfriTech operates everything.** Full control over deployment, monitoring, backup, and incident response. Fastest to launch — `ADDING_COUNTRY.md` describes this path end to end.

**Data residency.** Each country's Supabase project sits in the region its compliance assessment specifies. Zambia uses `af-south-1` on the POPIA adequacy basis (ADR-022). The `zsms-dev` project is an explicit exception at `eu-west-1`, permitted because it holds synthetic data only — see `COMPLIANCE.md`.

---

## Tier 2 — Per-Country Self-Hosted

Used only where a country's law mandates local storage of personal data and no adequacy route exists. Each substitution replaces a managed service with a self-hostable equivalent behind the same interface.

| Tier 1 service | Tier 2 substitute | Interface that makes it swappable |
|---|---|---|
| Clerk | Keycloak | `packages/auth-provider` |
| Supabase (managed) | Supabase self-hosted | Same PostgreSQL, same RLS, same migrations |
| BullMQ on Railway Redis | BullMQ on local Redis | **Not a substitution** — same implementation, different connection string |
| Cloudflare R2 | MinIO | S3-compatible storage interface |
| Upstash Redis | Local Redis | Same client interface |
| Vercel | Node.js on local VPS | Next.js standalone build |
| Railway standby | Second local VPS with streaming replication | Same PostgreSQL replication |

**The schema, RLS policies, and migrations are identical.** This is the property that makes Tier 2 viable at all: `0001`–`0065` apply unchanged, because Supabase self-hosted is PostgreSQL with the same extensions. A self-hosted deployment is not a variant of ZSMS — it is ZSMS with different infrastructure underneath.

**Responsibility split.** This must be explicit in the country partner agreement, not discovered during an incident:

| Responsibility | Owner |
|---|---|
| Application code, schema, migrations, updates | AfriTech |
| Security patches to ZSMS software | AfriTech |
| VPS provisioning, OS patching, network security | Country partner |
| Database backup and verified restore | Country partner |
| Uptime monitoring and incident response | Country partner |
| Local data protection registration | Country partner |
| Encrypted export to the Tier 3 vault | Country partner (AfriTech provides tooling) |

**Known costs of Tier 2.** Slower releases, no AfriTech visibility into production incidents, partner-dependent availability, and no PowerSync managed service — self-hosted PowerSync or a degraded sync path is required. These are real and are why `HOSTING_STRATEGY.md` treats Tier 2 as a last resort rather than a menu option.

---

## Tier 3 — Central Encrypted Backup Vault

Every deployment, regardless of tier, exports an encrypted daily backup to a central AfriTech-controlled vault.

| Property | Detail |
|---|---|
| Contents | Full database export plus private-bucket object manifest |
| Encryption | AES-256, encrypted **before** leaving the source deployment |
| Key custody | Per-country key; AfriTech holds ciphertext, never plaintext |
| Frequency | Daily |
| Retention | 90 days rolling |
| Purpose | Disaster recovery of last resort only |

**The key custody model is what makes this compliant.** AfriTech holds encrypted blobs it cannot read without the country's key. For a Tier 2 country whose law mandates local storage, an encrypted export the operator cannot decrypt is generally a backup arrangement rather than a cross-border transfer of personal data — but this must be confirmed in each country's compliance assessment and written into the partner agreement, never assumed.

**When the vault is used.** Only for total loss of a deployment — the Runbook 6 scenario in `AVAILABILITY.md`. It is not used for routine restores, which use the deployment's own PITR or local backups. Recovery from the vault requires the country's key holder to participate, which is a deliberate friction, not an oversight.

**Verification.** Vault restores are tested quarterly per `AVAILABILITY.md`. An encrypted backup that has never been decrypted and restored is not a backup.

---

## The Abstractions That Make This Work

Three interfaces carry the entire multi-tier model. Each exists specifically so that tier selection is configuration rather than code.

### `packages/auth-provider` — authentication

The most important abstraction in the codebase. Clerk is the current implementation; Keycloak is the self-hosted one. **No package other than `auth-provider` imports Clerk directly** — this is stated in `ARCHITECTURE.md` and enforced as a review rule. A single direct Clerk import anywhere else silently converts the Keycloak swap from a configuration change into a refactor.

### Queue abstraction — background jobs

Per `BULLMQ.md` and ADR-035, application code enqueues through the abstraction and never calls BullMQ or QStash directly. **Tier 1 and Tier 2 both run BullMQ** — only the Redis connection string differs — so the queue is one of the few layers with no behavioural divergence between tiers at all. QStash remains available as a fallback in either tier.

### Storage interface — files

R2 and MinIO are both S3-compatible, so the storage client is configured by endpoint and credentials rather than branched on. Bucket names and folder conventions in `STORAGE.md` are identical across tiers.

**The general rule:** if application code can tell which tier it is running in, an abstraction has leaked. The only legitimate tier awareness is in configuration and deployment scripts.

---

## Tier Selection

Tier assignment happens once per country, during the compliance assessment in `HOSTING_STRATEGY.md`, before any infrastructure is provisioned.

```
Country compliance assessment (COMPLIANCE.md)
        │
        ├─ Cross-border transfer permitted to an adequate jurisdiction?
        │     YES → TIER 1 (default)
        │     NO  → continue
        │
        ├─ Adequacy achievable via DPA or approved mechanism?
        │     YES → TIER 1 with documented mechanism
        │     NO  → continue
        │
        └─ Local storage mandated → TIER 2
                 └─ Requires: local partner, VPS provider,
                    signed responsibility split, key custody agreement

All tiers → TIER 3 vault enabled at provisioning
```

Current assignments, per the compliance table in `COMPLIANCE.md`:

| Country | Tier | Basis |
|---|---|---|
| Zambia (ZM) | 1 | `af-south-1`, POPIA adequate under ZDPA |
| Botswana (BW) | 1 (planned) | Data Protection Act 2018, similar framework |
| Zimbabwe (ZW) | 1 (planned, TBD) | Assessment pending |
| Kenya (KE) | 1 or 2 (TBD) | More mature regime — assessment required |
| Nigeria (NG) | 2 (likely) | NDPR localisation risk |
| Rwanda (RW) | TBD | Assessment required |

---

## Business Rules

1. Tier 1 is the default. Tier 2 is used only where local storage is legally mandated and no adequacy route exists, as determined by a documented compliance assessment.
2. Tier assignment is decided before infrastructure is provisioned, never retrofitted.
3. Every deployment in every tier exports to the Tier 3 vault. There is no opt-out.
4. Vault exports are encrypted before leaving the source deployment. AfriTech never holds plaintext personal data from a Tier 2 country.
5. No package other than `packages/auth-provider` may import Clerk. No application code may call QStash or BullMQ directly. No application code may branch on deployment tier.
6. Schema, RLS policies, and migrations are identical across all tiers. A tier-specific migration is prohibited.
7. Tier 2 responsibility splits are signed before launch. Ambiguity about who restores a database is resolved in the contract, not during an outage.
8. Vault restore capability is verified quarterly per `AVAILABILITY.md`.

---

## Edge Cases and Error Handling

**A country changes its law after launch.** A Tier 1 country that introduces localisation requirements must migrate to Tier 2. This is a full data migration with downtime and requires a new local partner — realistically a multi-month project. It is the strongest argument for assessing regulatory trajectory, not only current law, during the initial assessment.

**Country partner ends the relationship.** The partner controls the infrastructure and the encryption key. The agreement must specify key escrow and data handover on termination, or schools in that country lose their data. This is a contract problem that no amount of architecture solves.

**Tier 2 deployment falls behind on releases.** A partner who does not apply updates runs old ZSMS, potentially with known security issues. The agreement must specify a maximum lag for security patches, and AfriTech needs a way to verify the deployed version.

**Vault export fails silently.** A country whose exports have been failing has no disaster recovery. Export success is monitored centrally and alerts after two consecutive failures — this is one of the few things AfriTech can monitor in a Tier 2 deployment without visibility into its internals.

**Key lost by a Tier 2 partner.** The vault becomes unrecoverable ciphertext. Key custody arrangements must include escrow with an agreed third party.

---

## Integration Points

- `HOSTING_STRATEGY.md` — the decision process feeding tier selection
- `ADDING_COUNTRY.md` — the Tier 1 launch playbook
- `COMPLIANCE.md` — per-country assessments determining tier
- `AVAILABILITY.md` — vault use in Runbook 6, verification schedule
- `BULLMQ.md` — the queue abstraction enabling the Tier 2 swap
- `CLERK.md` — Clerk configuration behind `auth-provider`
- `ARCHITECTURE.md` — the abstraction boundaries this topology depends on

---

## Security Considerations

**Tier 2 expands the trust boundary to include the country partner.** They hold plaintext personal data for their country and control its security. AfriTech's technical controls — RLS, encryption, audit logging — ship with the software and continue to apply, but perimeter security, OS patching, and physical access are the partner's. Partner due diligence is a security control, not a commercial formality.

**The vault is the highest-value target in the entire system.** It aggregates every country's data in one place. Encryption before egress, per-country keys, and AfriTech never holding plaintext are what keep a vault compromise from being a total compromise. Any proposal to decrypt centrally "for convenience" defeats the entire model.

**Restores create temporary plaintext copies.** Per `AVAILABILITY.md`, restore targets must be access-restricted, in a compliant region, and destroyed after verification.

**Version skew across Tier 2 deployments** means a security patch is not fully deployed when AfriTech ships it. Patch propagation must be tracked, not assumed.

---

## Known Limitations and Future Work

- No Tier 2 deployment exists yet. The substitutions are specified and individually plausible, but the full stack has never been assembled and run. The first Tier 2 launch should be treated as a project with real unknowns, not a configuration exercise.
- PowerSync has no documented self-hosted path in Tier 2. Offline mobile sync — a core requirement — may be degraded or require a different mechanism entirely. This is the largest open risk in the Tier 2 model.
- Vault export tooling is specified but not built.
- No automated version-compliance check for Tier 2 deployments.
- Key escrow arrangements are described but no legal mechanism is drafted.
- Tier 3 retention is 90 days; the 7-year financial retention obligation in `COMPLIANCE.md` is satisfied by the live deployment, not the vault. A total loss older than 90 days is unrecoverable.
- The daily vault export gives a region-loss RPO of up to 24 hours, well outside the 5-minute RPO that applies to other failure modes.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-08-13 | Initial complete draft | Three-tier deployment topology formalised in ADR-032 |
| 2026-08-13 | Tier 2 responsibility split documented | Ambiguity about who restores a database must be resolved contractually |
| 2026-08-13 | Tier 3 encrypted vault with per-country key custody defined | Central backup must not become a cross-border transfer |
| 2026-08-13 | Flagged PowerSync self-hosting as the largest open Tier 2 risk | Offline sync is a core requirement with no documented self-hosted path |
