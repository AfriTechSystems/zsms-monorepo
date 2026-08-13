# CLOUDFLARE_WAF.md — Cloudflare WAF and Security Layer

## Related Documents

- `docs/ARCHITECTURE.md` — WAF position in the stack
- `docs/foundation/SECURITY_POLICIES.md` — security controls this implements
- `docs/api/RATE_LIMITS.md` — rate limiting enforced at WAF and Edge Middleware
- `docs/ENV.md` — Cloudflare environment variables
- `docs/infra/VERCEL.md` — Vercel sits behind the WAF

---

## Purpose

This document defines the Cloudflare WAF (Web Application Firewall) configuration for ZSMS — why it exists, what it protects against, how it is configured, and how it integrates with the rest of the infrastructure. Every Claude Code session touching network or security configuration must read this document.

---

## Overview

Cloudflare WAF sits between the internet and Vercel, acting as the first line of defence for all ZSMS traffic. Since ZSMS already uses Cloudflare for R2 storage, adding WAF protection costs very little in operational overhead and significantly raises the security baseline — critical for an application handling student financial records, loan PII, and academic data of minors.

```
Internet (requests from schools, parents, teachers)
              ↓
    Cloudflare WAF + CDN
    (DDoS protection, WAF rules, rate limiting, bot management, TLS termination)
              ↓
    Vercel Edge Network
    (Next.js middleware, JWT verification, API routes)
              ↓
    Supabase / Edge Functions / Queue workers
    (Application logic and data)
```

---

## What the WAF Protects Against

### Layer 3/4 — Network Layer

**DDoS Protection (included free):**
Cloudflare's network absorbs volumetric DDoS attacks (up to multiple Tbps) before they reach Vercel. A school competitor or bad actor cannot take ZSMS offline with a traffic flood. This is especially important for an African SaaS where the application cannot afford downtime during school fee collection periods or exam results release days.

### Layer 7 — Application Layer

**OWASP Top 10 Protection:**

| Attack | WAF Rule | ZSMS Risk |
|---|---|---|
| SQL Injection | Auto-blocked by Cloudflare Managed Rules | High — loan PII, financial records |
| Cross-Site Scripting (XSS) | Auto-blocked | Medium — announcement content |
| Authentication abuse | Rate limiting + bot challenge | High — credential stuffing on login |
| Sensitive data exposure | TLS enforcement, header rules | High — student records |
| Security misconfiguration | Header security rules | Medium |
| API abuse | Rate limiting per endpoint | High — WhatsApp quota exhaustion attacks |

---

## Configuration

### Zone Setup

```
1. In Cloudflare dashboard: Add zsms.co.zm as a zone
2. Update DNS: Point zsms.co.zm nameservers to Cloudflare
3. Add DNS record: CNAME zsms.co.zm → cname.vercel-dns.com (Proxied — orange cloud ON)
4. SSL/TLS mode: Full (Strict) — end-to-end TLS
5. Always use HTTPS: ON
6. Minimum TLS version: TLS 1.2 (TLS 1.3 preferred)
7. Opportunistic Encryption: ON
8. HSTS: Enabled, max-age 31536000, includeSubDomains
```

### WAF Rulesets

**Cloudflare Managed Ruleset (enable all):**
```
Security Level: High
Challenge Passage: 30 minutes
Browser Integrity Check: ON
Hotlink Protection: ON (prevents direct linking to R2 PDFs)
```

**Custom WAF Rules (create these):**

Rule 1 — Block countries with no ZSMS presence (optional — review quarterly):
```
(ip.geoip.country ne "ZM" and
 ip.geoip.country ne "BW" and
 ip.geoip.country ne "ZW" and
 ip.geoip.country ne "KE" and
 ip.geoip.country ne "NG" and
 ip.geoip.country ne "ZA" and
 ip.geoip.country ne "GB" and
 ip.geoip.country ne "US")
Action: Challenge (not Block — AfriTech team may travel)
```

Rule 2 — Protect admin panel:
```
(http.request.uri.path contains "/admin" and
 not ip.src in {AfriTech_office_IP AfriTech_team_IPs})
Action: Challenge
```

Rule 3 — Block sensitive endpoint scraping:
```
(http.request.uri.path contains "/api/students" and
 not cf.client.bot and
 http.request.method eq "GET" and
 rate(http.request.uri.path, 60) > 100)
Action: Block
```

Rule 4 — Protect loan application endpoints:
```
(http.request.uri.path contains "/api/loans" and
 rate(http.request.uri, 60) > 20)
Action: Block
Note: Loan applications should never be submitted rapidly — 20/min is already generous
```

Rule 5 — Block known bad bots:
```
(cf.client.bot and
 not cf.verified_bot_category in {"Search Engine Crawlers" "Monitoring & Analytics"})
Action: Block
```

### Rate Limiting Rules (Cloudflare Level)

These are network-level rate limits — they fire before requests reach Vercel:

```
Rule: Login endpoint protection
  Path: /api/auth/* or /sign-in
  Rate: 10 requests per minute per IP
  Action: Challenge (CAPTCHA)
  Duration: 10 minutes

Rule: API endpoint protection
  Path: /api/*
  Rate: 300 requests per minute per IP
  Action: Block
  Duration: 1 minute

Rule: Webhook endpoint protection (high volume legitimate traffic)
  Path: /api/webhooks/*
  Rate: 1000 requests per minute per IP
  Action: Block (Meta and PawaPay can generate high volumes)
  Duration: 1 minute

Rule: Payment submission protection
  Path: /api/fees/payments
  Rate: 5 requests per minute per IP
  Action: Block
  Duration: 10 minutes
  Note: A parent should never submit more than 5 payments per minute
```

### Security Headers (Cloudflare Transform Rules)

Add these response headers for all ZSMS responses:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: default-src 'self'; 
  script-src 'self' 'unsafe-inline' https://cdn.clerk.io;
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https://*.r2.cloudflarestorage.com;
  connect-src 'self' https://*.supabase.co https://clerk.zsms.co.zm;
  frame-ancestors 'none'
```

---

## Cloudflare Workers for Edge Rate Limiting

Beyond the WAF rules, a Cloudflare Worker provides application-aware rate limiting before requests reach Vercel:

```typescript
// cloudflare-worker/rate-limit.ts
// Deployed to workers.zsms.co.zm — runs before Vercel

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const clientIP = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    const path = url.pathname

    // Per-endpoint rate limits using Cloudflare KV
    const limits: Record<string, { requests: number; windowSeconds: number }> = {
      '/api/loans/apply': { requests: 3, windowSeconds: 3600 },       // 3 per hour
      '/api/fees/payments': { requests: 10, windowSeconds: 300 },     // 10 per 5 minutes
      '/api/ai/assistant': { requests: 20, windowSeconds: 60 },       // 20 per minute
      '/api/ai/lesson-plans': { requests: 10, windowSeconds: 60 },    // 10 per minute
      '/api/students/bulk-import': { requests: 2, windowSeconds: 3600 }, // 2 per hour
    }

    const limit = Object.entries(limits).find(([p]) => path.startsWith(p))
    if (limit) {
      const [endpoint, { requests, windowSeconds }] = limit
      const key = `rate:${clientIP}:${endpoint}`
      const current = parseInt(await env.RATE_LIMIT_KV.get(key) ?? '0')

      if (current >= requests) {
        return new Response(JSON.stringify({
          error: 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED',
          retry_after: windowSeconds,
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': windowSeconds.toString(),
          }
        })
      }

      await env.RATE_LIMIT_KV.put(key, (current + 1).toString(), {
        expirationTtl: windowSeconds,
      })
    }

    return fetch(request)
  }
}
```

---

## Monitoring and Alerting

**Cloudflare Analytics (built-in):**
- Requests by country, path, status code
- WAF rule trigger frequency
- Rate limit trigger events
- DDoS attack timeline

**Custom alerts to configure:**

```
Alert 1: WAF triggers spike
  Condition: > 1,000 WAF rule triggers in 5 minutes
  Action: Email to mwando@afritechsystems.com + Julius

Alert 2: DDoS detected
  Condition: Cloudflare DDoS mode auto-activated
  Action: Immediate phone notification

Alert 3: Admin panel access from new IP
  Condition: Request to /admin from IP not in allowlist
  Action: Email notification + log to audit_logs

Alert 4: Unusual country access
  Condition: > 100 requests from a new country in 10 minutes
  Action: Email notification (may be legitimate — verify before blocking)
```

---

## Vercel + Cloudflare Configuration

**Critical:** Vercel must be configured to only accept requests from Cloudflare IP ranges. Without this, an attacker could bypass the WAF by hitting Vercel's IP directly.

```
In Vercel Dashboard → Settings → Trusted Proxies:
Add Cloudflare IP ranges: https://www.cloudflare.com/ips-v4

In Next.js middleware — verify CF-Ray header:
if (!request.headers.get('CF-Ray') && process.env.NODE_ENV === 'production') {
  // Request bypassed Cloudflare — block it
  return new Response('Forbidden', { status: 403 })
}
```

---

## SOC 2 Evidence

The Cloudflare WAF configuration provides evidence for these SOC 2 controls:

| SOC 2 Control | Evidence Provided |
|---|---|
| CC6.6 — Encryption in transit | TLS 1.3 enforced by Cloudflare |
| CC6.8 — Malicious software prevention | WAF rules blocking injection attacks |
| CC7.1 — Security monitoring | WAF analytics and alerts |
| CC7.2 — Threat detection | DDoS protection and rate limiting |
| A1.1 — Availability | DDoS protection prevents availability loss |

---

## Business Rules

1. The Cloudflare WAF proxy must always be enabled (orange cloud ON) for zsms.co.zm. Disabling it bypasses all WAF protections and exposes Vercel's origin IP.
2. WAF rules are reviewed quarterly — new attack patterns require new rules.
3. Cloudflare WAF logs are retained for 30 days by Cloudflare. For SOC 2 evidence, export monthly summaries to a retained log store.
4. The admin panel (`/admin`) challenge rule must always be active. It is never disabled even for debugging.
5. TLS 1.0 and 1.1 are permanently disabled. Any integration that requires them is rejected.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-06-23 | Initial complete draft | Architecture improvement — WAF added to stack |
| 2026-06-23 | Cloudflare Worker rate limiting | Edge-level rate limiting before Vercel |
| 2026-06-23 | Security headers via Transform Rules | SOC 2 CC6.8 and OWASP header requirements |
| 2026-06-23 | Vercel IP restriction to Cloudflare only | Prevent WAF bypass via direct Vercel IP access |
