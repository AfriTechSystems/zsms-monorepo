# SESSIONS.md — Session Management

## Related Documents

- `docs/modules/auth/AUTH.md` — login flows that create sessions
- `docs/modules/auth/ROLES.md` — roles with different session durations
- `docs/infra/CLERK.md` — Clerk session configuration
- `docs/foundation/SECURITY_POLICIES.md` — session management as a security control
- `docs/foundation/COMPLIANCE.md` — SOC 2 session requirements

---

## Purpose

This document defines session durations for every user type, the security rationale behind each duration, and how sessions are managed and revoked. Every Claude Code session building authentication or session-related features must read this document.

---

## Session Duration Policy

All end-user sessions are capped at **30 days maximum**. This is a deliberate security decision aligned with SOC 2 Type II Logical Access requirements and the ZDPA's mandate for appropriate technical measures to protect personal data.

| Role | Session Duration | Re-auth Method | Rationale |
|---|---|---|---|
| `afritech:super_admin` | 8 hours | Email OTP | Highest privilege — mandatory daily re-auth |
| `afritech:regional_manager` | 12 hours | Email OTP | Standard working day + buffer |
| `afritech:support_agent` | 12 hours | Email OTP | Standard working day |
| `afritech:loan_officer` | 12 hours | Email OTP | Accesses financial PII |
| `afritech:finance_officer` | 12 hours | Email OTP | Accesses revenue data |
| `afritech:developer` | 4 hours max | Email OTP | Production grants expire in 4 hours |
| `org:owner` | 7 days | Email OTP | Operational — logs in multiple times per week |
| `org:principal` | 7 days | Email OTP | Daily school operations |
| `org:accountant` | 7 days | Email OTP | Daily fee processing |
| `org:admin` | 7 days | Email OTP | Regular operational access |
| `org:teacher` | 30 days | Email OTP | Mobile app — regular but not daily re-auth friction |
| `org:parent` | **30 days** | Email OTP | Security-appropriate — re-auth monthly |
| `org:student` | **30 days** | Email OTP | Security-appropriate — re-auth monthly |
| `platform:teacher` | 30 days | Email OTP | Regular tool usage |
| `platform:alumni` | **30 days** | Email OTP | Historical document access — secure re-auth |

---

## Why 30 Days for Parents, Students, and Alumni

### The Security Rationale

Previous session durations of 365 days (parents/students) and indefinite (alumni) were revised to 30 days for the following reasons:

**1. Device loss and theft risk.**
A parent or student who loses their phone has up to 365 days of potential exposure on a 365-day session. At 30 days, the maximum exposure window for a stolen device is 30 days. Given ZSMS handles student academic records, fee payment history, and loan application data, this is a meaningful security improvement.

**2. SOC 2 Type II compliance.**
SOC 2 Logical Access controls (CC6.1) require that session management controls are appropriate for the sensitivity of the data accessed. Indefinite sessions on applications handling financial and academic records of minors will be flagged as a control deficiency by any SOC 2 auditor. 30 days is defensible; 365 days is not.

**3. ZDPA "appropriate technical measures" standard.**
The ZDPA 2021 requires data controllers to implement appropriate technical measures. Session management is explicitly cited in ZDPA guidance as a technical control. 30-day sessions satisfy this requirement.

**4. Practical re-authentication burden is minimal.**
Parents receive fee reminders, attendance summaries, and results notifications monthly. They naturally access the portal at least once per month — re-authentication via email OTP adds approximately 30 seconds to one session per month. This is not a meaningful UX burden.

**5. Alumni historical access.**
Alumni need to access historical records occasionally — for university applications, scholarship submissions, or dispute resolution. Email OTP re-authentication in 30 seconds is acceptable for infrequent but important access. Indefinite sessions on historical data create unnecessary long-term risk.

---

## Session Revocation

Sessions are revoked immediately in these scenarios:

| Scenario | Who Revokes | Method |
|---|---|---|
| Teacher leaves school | School admin removes staff | Clerk org membership removal → all sessions invalidated |
| Parent requests removal | School admin | Clerk org membership removal |
| Account security concern | AfriTech super admin | Clerk: revoke all active sessions for user |
| Student graduates | Graduation flow | School org session revoked, platform:alumni session issued |
| Student transfers | Transfer flow | School org session revoked after grace period |
| Developer grant expires | Automatic (queue cron) | Grant deactivated → production access removed |
| Suspicious activity detected | AfriTech super admin | Immediate Clerk session revocation + notification to user |

---

## Suspicious Activity Detection

ZSMS monitors for session anomalies and triggers alerts for:

```typescript
// Flagged patterns (logged in audit_logs, alert sent to AfriTech super admin)
const SUSPICIOUS_PATTERNS = [
  'login_from_new_country',              // Different country from registration
  'multiple_concurrent_sessions',        // > 3 active sessions simultaneously
  'rapid_data_access',                   // > 100 records accessed in 60 seconds
  'payment_submission_multiple_accounts',// Same IP submitting from multiple parent accounts
  'loan_application_multiple_submissions',// > 2 applications within 24 hours
]
```

---

## Dual-Context Session (Linked Teacher)

A linked teacher (standalone + school) has one Clerk session with two navigation contexts. Session duration is 30 days for both contexts. The session contains:
- `platform:teacher` metadata (always present)
- `org_id` and `org_role` for the active school context

Switching between Teacher Hub and school dashboard is a context change within the same session — not a new authentication.

---

## Session Token Storage

Session tokens are stored by Clerk in secure HTTP-only cookies (web) and secure device storage (mobile via Expo SecureStore). Tokens are:
- Never stored in localStorage or sessionStorage
- Never logged in application logs
- Never included in API request/response payloads
- Rotated automatically by Clerk on each session refresh

---

## Business Rules

1. All end-user sessions (parent, student, teacher, alumni) are capped at 30 days. This is not configurable at the school level.
2. AfriTech staff sessions are shorter (8-12 hours) than end-user sessions. Higher privilege requires more frequent re-authentication.
3. The platform:alumni 30-day session replaces the previous indefinite session policy. Alumni re-authenticate via email OTP — the same flow as all other users.
4. Payment submission security does not rely solely on session freshness. The `confirmation_checkbox_at` timestamp must be within 10 minutes of submission regardless of session age.
5. Session revocation for security incidents is immediate — Clerk invalidates all active tokens for the user within seconds.
6. AfriTech developer production access is always time-limited regardless of their base session. The production grant (max 4 hours) is the binding constraint.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial draft | Pre-development session reference |
| 2026-04-26 | Added alumni indefinite sessions | Graduated account model |
| 2026-06-23 | **REVISED: parent and student 365-day → 30 days** | SOC 2 compliance, ZDPA technical measures, device theft risk |
| 2026-06-23 | **REVISED: alumni indefinite → 30 days** | SOC 2 Logical Access control requirement |
| 2026-06-23 | Added suspicious activity detection | Security monitoring requirement |
| 2026-06-23 | Added session token storage requirements | SOC 2 control CC6.1 |
