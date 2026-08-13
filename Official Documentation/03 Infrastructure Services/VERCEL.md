# VERCEL.md — Hosting and Deployment

## Related Documents

- `docs/ARCHITECTURE.md` — environment structure and deployment pipeline
- `docs/CONVENTIONS.md` — branch naming that drives deployments
- `docs/ENV.md` — all environment variables set in Vercel
- `docs/infra/SUPABASE.md` — database connected to each Vercel deployment
- `docs/infra/CLERK.md` — Clerk instance per environment
- `docs/countries/ZM.md` — Zambia-specific deployment configuration

---

## Purpose

This document covers the complete Vercel deployment configuration for ZSMS — how branches map to environments, how environment variables are managed per deployment, how the multi-country architecture is deployed, and how domain configuration works. Every Claude Code session that touches deployment configuration must reference this document.

---

## Overview

Vercel hosts the ZSMS Next.js web application. It provides automatic deployments on Git push, edge caching, and serverless function execution for Next.js API routes. One Vercel project exists per country domain — each project points at the same GitHub repository but uses different environment variables to connect to the correct Supabase project, Clerk instance, and country configuration.

---

## Branch to Environment Mapping

```
feature/* branches → Preview deployments (automatic, temporary URLs)
integration branch → Staging: staging.zsms.co.zm
main branch        → Production: zsms.co.zm (Zambia)
```

| Branch | Environment | URL | Supabase Project | Clerk Instance |
|---|---|---|---|---|
| `feature/*` | Preview | `zsms-pr-123.vercel.app` | `zsms-dev` | `zsms-development` |
| `integration` | Staging | `staging.zsms.co.zm` | `zsms-staging` | `zsms-staging` |
| `main` | Production (ZM) | `zsms.co.zm` | `zsms-zm` | `zsms-production` |
| `main` | Production (BW, future) | `bsms.co.bw` | `zsms-bw` | `zsms-production-bw` |

Preview deployments are created automatically for every pull request. They use the development Supabase project and development Clerk instance. They are useful for reviewing UI changes before merging to integration.

---

## Vercel Project Structure

One Vercel project per country. For Zambia:

- **Project name:** `zsms-zm`
- **Repository:** `AfriTechSystems/zsms-monorepo`
- **Root directory:** `apps/web`
- **Framework preset:** Next.js
- **Build command:** `cd ../.. && npx turbo build --filter=web`
- **Output directory:** `.next`

When adding Botswana:
- **Project name:** `zsms-bw`
- Same repository, same root directory, different environment variables

---

## Environment Variable Configuration

Environment variables are set in Vercel Dashboard → Project → Settings → Environment Variables. Each variable can be scoped to Production, Preview, or Development environments within the project.

### Production Environment Variables (zsms-zm project)

```bash
# Supabase — Production Zambia project
NEXT_PUBLIC_SUPABASE_URL=https://zsms-zm-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...production-anon-key...
SUPABASE_SERVICE_ROLE_KEY=eyJ...production-service-role-key...

# Clerk — Production instance
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
CLERK_WEBHOOK_SIGNING_SECRET=whsec_...

# Country configuration
NEXT_PUBLIC_COUNTRY_CODE=ZM
NEXT_PUBLIC_APP_URL=https://zsms.co.zm

# All other service keys (Meta, queue provider, R2, etc.)
# Set as Production-scoped variables
```

### Staging Environment Variables (integration branch)

Same Vercel project, but variables scoped to Preview/Development override production values:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://zsms-staging-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...staging-anon-key...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_APP_URL=https://staging.zsms.co.zm
```

---

## Multi-Country Deployment

Adding a new country (Botswana example):

1. Create a new Vercel project `zsms-bw`
2. Connect to same GitHub repository `AfriTechSystems/zsms-monorepo`
3. Set country-specific environment variables:
   ```bash
   NEXT_PUBLIC_COUNTRY_CODE=BW
   NEXT_PUBLIC_APP_URL=https://bsms.co.bw
   NEXT_PUBLIC_SUPABASE_URL=https://zsms-bw-ref.supabase.co
   # ... all other BW-specific variables
   ```
4. Configure custom domain `bsms.co.bw` in Vercel DNS settings
5. Push to `main` branch — Vercel automatically builds and deploys both `zsms-zm` and `zsms-bw` projects

**Zero code changes required.** The same codebase reads `NEXT_PUBLIC_COUNTRY_CODE` at build time and runtime to select the correct country configuration from `packages/config/countries/`.

---

## Domain Configuration

### Zambia Domain (`zsms.co.zm`)

1. Register domain with a registrar that supports `.co.zm` domains
2. Add domain in Vercel Dashboard → `zsms-zm` project → Settings → Domains
3. Update DNS records at registrar to point to Vercel:
   ```
   A record: @ → 76.76.21.21
   CNAME: www → cname.vercel-dns.com
   ```
4. Vercel automatically provisions SSL certificate (Let's Encrypt)

### Staging Subdomain (`staging.zsms.co.zm`)

1. Add `staging.zsms.co.zm` as a custom domain on the `zsms-zm` Vercel project
2. Assign it to the `integration` branch in Vercel branch settings
3. Add DNS record:
   ```
   CNAME: staging → cname.vercel-dns.com
   ```

---

## Edge Caching Configuration

Vercel caches static assets and server-rendered pages at the edge. ZSMS-specific caching rules are set in `apps/web/next.config.js`:

```javascript
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        // Public school directory — cache for 5 minutes at edge
        source: '/schools',
        headers: [{ key: 'Cache-Control', value: 's-maxage=300, stale-while-revalidate=60' }],
      },
      {
        // All dashboard routes — no caching (user-specific data)
        source: '/(dashboard)/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
      {
        // API routes — no caching
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]
  },
}
```

The public school search page benefits from edge caching — the list of schools does not change frequently. Dashboard and API routes are never cached.

---

## Deployment Process

### Normal Feature Deployment

```
1. Developer works on feature/* branch (local development)
2. Opens pull request → Vercel creates preview deployment automatically
3. Review preview deployment URL for visual/functional check
4. Merge PR to integration branch
5. Vercel auto-deploys to staging.zsms.co.zm
6. UAT testing on staging
7. Merge integration to main
8. Vercel auto-deploys to zsms.co.zm (production)
```

### Rollback Process

If a production deployment introduces a bug:

```
1. Vercel Dashboard → zsms-zm project → Deployments
2. Find the last known good deployment
3. Click "..." → Promote to Production
4. Previous deployment is immediately live again
5. Investigate and fix the issue on a new feature branch
```

Rollback takes under 60 seconds. No code changes required — Vercel redeploys the previous build artifact.

---

## Monorepo Build Configuration

Turborepo manages the monorepo build. Vercel's Turborepo integration caches build outputs — if `packages/types` has not changed, its build is skipped. This keeps deployment times fast even as the codebase grows.

```json
// turbo.json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**"]
    },
    "lint": {
      "outputs": []
    },
    "type-check": {
      "outputs": []
    }
  }
}
```

**Build time targets:**
- Full build (no cache): under 3 minutes
- Incremental build (with Turborepo cache): under 60 seconds

---

## Business Rules

1. Production deployments happen only by merging `integration` to `main`. Direct pushes to `main` are not permitted (enforced via GitHub branch protection).
2. Every production deployment must have a corresponding staging validation — the integration branch must be tested on staging before merging to main.
3. Environment variables containing secrets are never committed to the repository. They exist only in Vercel dashboard settings and local `.env.local` files.
4. Feature branch preview deployments always use development-tier services (zsms-dev Supabase, development Clerk instance).
5. Adding a new country requires a new Vercel project — not a new branch or a new environment variable set on the existing project.

---

## Known Limitations and Future Work

- Vercel's free tier has a limit of 100 deployments per day. At the current solo developer pace this is never reached. As the team grows and PR volume increases, upgrade to Vercel Pro.
- Next.js API routes on Vercel have a default timeout of 10 seconds. Edge Functions in Supabase have a 50-second limit. Heavy operations go through Supabase Edge Functions and the job queue, not Next.js API routes — this is the correct architecture.
- The Vercel deployment pipeline does not currently run automated tests before deploying. Adding a GitHub Actions step to run `turbo lint type-check` before merging to integration is planned for Phase 3.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Stage 3 infrastructure documentation |
