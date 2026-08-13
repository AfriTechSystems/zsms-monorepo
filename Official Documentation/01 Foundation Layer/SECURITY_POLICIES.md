# SECURITY_POLICIES.md — Information Security Policies

## Related Documents

- `docs/foundation/COMPLIANCE.md` — regulatory context for these policies
- `docs/modules/auth/SESSIONS.md` — session management controls
- `docs/RLS.md` — data isolation controls
- `docs/testing/SECURITY_AUDIT.md` — security verification checklist

---

## Purpose

This document is AfriTech Systems Limited's formal Information Security Policy framework. It defines the security controls that govern how ZSMS is built, operated, and maintained. This document is required for SOC 2 Type I audit and ZDPA Data Controller registration. It is reviewed annually and updated when significant architectural changes occur.

**Policy owner:** Mwando Hamwenda, CTO
**Approved by:** Board of Directors, AfriTech Systems Limited
**Next review date:** January 2028

---

## 1. Information Security Policy

### 1.1 Purpose and Scope

AfriTech Systems Limited ("AfriTech") is committed to protecting the confidentiality, integrity, and availability of all personal data processed through the ZSMS platform. This policy applies to:
- All AfriTech staff members and contractors
- All systems, services, and infrastructure used to deliver ZSMS
- All personal data processed on behalf of schools, parents, students, and teachers

### 1.2 Security Principles

1. **Least privilege:** Every user, service, and system has the minimum access required to perform its function. No more.
2. **Defence in depth:** Security controls are layered. Failure of one control does not compromise the system.
3. **Security by design:** Security is built into features from the start — not added after.
4. **Transparency:** Security incidents affecting personal data are disclosed to affected parties promptly.
5. **Continuous improvement:** Security controls are reviewed and improved regularly.

---

## 2. Access Control Policy

### 2.1 User Access Management

**Provisioning:**
- All ZSMS user accounts are created through Clerk with verified email addresses
- School staff accounts are provisioned by school owners only — not self-provisioned
- AfriTech staff accounts are created by the super admin only
- Standalone teacher accounts are self-provisioned but scoped to Teacher Hub tools only

**Authentication:**
- Email OTP is the sole authentication method — no passwords, no SMS OTP
- Multi-device sessions are limited to 3 concurrent active sessions per user
- Suspicious concurrent sessions trigger an alert and optional forced revocation

**Session Management:**
- All end-user sessions: 30-day maximum duration
- AfriTech staff sessions: 8-12 hours depending on role
- Session tokens stored in HTTP-only cookies (web) and Expo SecureStore (mobile)
- Sessions revoked immediately on role change, account deactivation, or security incident

**Access Review:**
- School owners review staff access quarterly (prompted by ZSMS in January, April, July, October)
- AfriTech super admin reviews AfriTech staff access bi-annually

### 2.2 Privileged Access Management

- AfriTech super admin role is held by maximum 2 people at any time
- Production database access requires a time-limited grant (max 4 hours) with documented reason
- All production access is logged in the immutable audit_logs table
- School data is never accessed without a documented support reason

### 2.3 Role-Based Access Control

- All roles follow least-privilege principles as defined in ROLES.md
- Custom school roles cannot exceed the permissions of the granting admin
- Role changes take effect immediately via Clerk session invalidation
- All permission grants are time-limited and logged

---

## 3. Data Protection Policy

### 3.1 Data Classification

| Class | Examples | Controls Required |
|---|---|---|
| **Restricted** | Loan PII (NRC, income), payslips | Encryption at rest + in transit, private schema, access logging, 15-min URL expiry |
| **Confidential** | Student records, financial records | Encryption in transit, RLS enforcement, school-scoped access |
| **Internal** | Platform metrics, AfriTech analytics | AfriTech role access only |
| **Public** | School directory listings | No restrictions |

### 3.2 Encryption Standards

**At rest:**
- Supabase: AES-256 encryption for all data at rest (managed by Supabase)
- Cloudflare R2: AES-256 for all stored objects
- Sensitive fields (NRC, income, gateway credentials, WhatsApp tokens): additional AES-256 application-layer encryption using GATEWAY_ENCRYPTION_KEY and FIELD_ENCRYPTION_KEY

**In transit:**
- TLS 1.3 minimum for all connections — TLS 1.0 and 1.1 disabled
- Enforced by Cloudflare WAF before requests reach Vercel
- Supabase connections encrypted with TLS
- Internal service-to-service communication over HTTPS only

**Key management:**
- Encryption keys stored as Vercel and Supabase Edge Function secrets — never in code
- Keys rotated every 6 months minimum
- Key rotation procedure documented in the runbook (internal document)

### 3.3 Data Retention and Disposal

| Data Category | Retention Period | Disposal Method |
|---|---|---|
| Student academic records | Indefinite (alumni access) | Anonymised on school account termination after 30-day export window |
| Financial records | 7 years | Anonymised after 7 years |
| Loan application PII | 7 years | Permanent deletion after 7 years |
| Payment proofs | 7 years | Permanent R2 deletion after 7 years |
| Audit logs | Indefinite | Never deleted |
| Session logs | 90 days | Automatic deletion |
| Analytics events | 2 years | Automatic PostHog deletion |

---

## 4. Incident Response Policy

### 4.1 Incident Classification

| Severity | Definition | Response Time | Examples |
|---|---|---|---|
| P1 — Critical | Data breach, system unavailable | 1 hour | Unauthorised data access, database breach, complete outage |
| P2 — High | Significant degradation, potential breach | 4 hours | Payment processing failure, auth service down, suspected breach |
| P3 — Medium | Partial degradation, non-critical failure | 24 hours | WhatsApp delivery failures, PDF generation errors |
| P4 — Low | Minor issue, no data or availability impact | 72 hours | UI bugs, minor performance issues |

### 4.2 Breach Notification Procedure

Under ZDPA, a personal data breach must be reported to ZICTA within **72 hours** of discovery.

**Breach response steps:**

```
1. DETECTION (Hour 0)
   → Sentry alert / user report / monitoring alert
   → Mwando notified immediately (PagerDuty/phone)

2. ASSESSMENT (Hours 0-2)
   → Determine: Is personal data affected? How many data subjects?
   → Determine: Is the breach ongoing or contained?
   → P1 classification if personal data confirmed affected

3. CONTAINMENT (Hours 1-4)
   → Revoke compromised credentials/sessions immediately
   → Block malicious IPs at Cloudflare WAF
   → Take affected system offline if necessary

4. ZICTA NOTIFICATION (Hours 0-72)
   → If personal data of >100 data subjects affected: notify ZICTA
   → Notification includes: nature of breach, data affected, measures taken

5. AFFECTED PARTY NOTIFICATION (Hours 24-72 after ZICTA)
   → Notify affected schools and individuals
   → Provide clear description and recommended actions

6. POST-INCIDENT REVIEW (Within 7 days)
   → Root cause analysis
   → Control improvements
   → Update this document if policies were insufficient
```

**Emergency contacts:**
- CTO (Mwando): primary technical responder
- CFO (Julius): business and regulatory communications
- Legal counsel: ZICTA notification, if required
- Supabase support: for database-layer incidents

### 4.3 Penetration Testing

- Annual independent penetration test by a qualified third-party security firm
- Scope: ZSMS web application, API endpoints, mobile application, authentication flows
- Critical and high severity findings remediated within 30 days
- Medium severity findings remediated within 90 days
- Penetration test reports retained for SOC 2 evidence

---

## 5. Change Management Policy

### 5.1 Development Controls

- All code changes go through feature → integration → main branch workflow
- No direct commits to the main (production) branch
- Integration branch deployed to staging and tested before merging to main
- All Pull Requests reviewed by at least one other developer when team size permits; solo developer documents change rationale in PR description

### 5.2 Database Migration Controls

- All schema changes applied via numbered migration files (0001_*.sql)
- Migrations tested on zsms-dev before applying to zsms-staging
- Migrations tested on zsms-staging before applying to zsms-zm (production)
- Destructive migrations (DROP TABLE, DROP COLUMN) require super admin review and a data backup verification

### 5.3 Secret and Credential Rotation

| Credential | Rotation Frequency | Owner |
|---|---|---|
| GATEWAY_ENCRYPTION_KEY | Every 6 months | Mwando |
| FIELD_ENCRYPTION_KEY | Every 6 months | Mwando |
| Payment gateway API keys | Every 6 months | Mwando |
| AfriTech WhatsApp access token | Every 60 days (Meta policy) | Mwando |
| Webhook verification secrets | Annually | Mwando |
| Supabase service role key | Annually or on staff departure | Mwando |

---

## 6. Vendor Management Policy

### 6.1 Sub-Processor Inventory

All vendors that process personal data on behalf of AfriTech:

| Vendor | Data Processed | DPA Status | Annual Review |
|---|---|---|---|
| Supabase | All personal data | DPA in Supabase dashboard | January annually |
| Clerk | Auth credentials (email, phone) | DPA available, must be signed | January annually |
| Cloudflare | Document files, WAF logs | DPA available | January annually |
| Meta (WhatsApp) | Message delivery | Meta DPA via Business Agreement | January annually |
| Vercel | Application logs, request metadata | DPA available | January annually |
| Upstash (Redis; QStash when fallback active) | Cache, rate limit counters, job payloads (IDs only, no PII) | DPA available | January annually |
| Railway (standby DB, BullMQ workers, Redis) | Replicated personal data; job payloads (IDs only) | DPA required | January annually |
| Railway | Database replica | DPA available | January annually |
| Resend | Email addresses for OTP + notifications | DPA available | January annually |
| PostHog | Anonymised usage analytics | GDPR compliant, EU servers | January annually |
| Sentry | Error logs (PII-masked) | DPA available | January annually |
| Twilio | Phone numbers (SMS fallback only) | DPA available | January annually |

### 6.2 Vendor Assessment Criteria

Before adding any new vendor that will process personal data:
1. Review the vendor's security posture (SOC 2 report, ISO 27001, or equivalent)
2. Confirm a Data Processing Agreement is available
3. Confirm the vendor's data region (prefer af-south-1 or EU over US for substantive data)
4. Add to the sub-processor inventory above
5. Update the Privacy Policy to list the new sub-processor

---

## 7. Business Continuity Policy

### 7.1 Recovery Objectives

| Component | RTO (Recovery Time Objective) | RPO (Recovery Point Objective) |
|---|---|---|
| ZSMS web application | 30 minutes | N/A (stateless — Vercel auto-recovers) |
| Supabase primary database | 4 hours | 1 hour (Railway replication lag target) |
| WhatsApp messaging | 2 hours (fallback to email) | N/A (messages not replayed) |
| PDF generation | 4 hours | N/A (re-generate on recovery) |

### 7.2 Backup Verification

- Railway standby replication lag monitored — alert if lag > 30 seconds
- Monthly: verify Railway standby can serve read queries
- Quarterly: perform a full restore test from Railway standby to a test instance
- All restore tests documented and retained for SOC 2 evidence

---

## 8. Physical and Environmental Security

ZSMS is a cloud-native application with no on-premises infrastructure. Physical security is delegated to:
- Supabase (AWS data centres — ISO 27001 certified, SOC 2 compliant)
- Cloudflare (global network — SOC 2 Type II certified)
- Vercel (AWS/Google Cloud — SOC 2 compliant)
- Railway (AWS — SOC 2 compliant)

AfriTech team members work remotely. Each team member is responsible for:
- Full-disk encryption on work computers
- Locking screens when unattended
- Using a VPN when on public networks for production system access
- Not storing ZSMS production credentials on personal devices

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-06-23 | Initial complete draft | SOC 2 Type I readiness requirement |
| 2026-06-23 | Session policy set to 30-day maximum | SOC 2 Logical Access control CC6.1 |
| 2026-06-23 | Breach notification procedure (72-hour ZDPA requirement) | ZDPA 2021 compliance |
| 2026-06-23 | Sub-processor inventory completed | ZDPA Data Controller requirement |
