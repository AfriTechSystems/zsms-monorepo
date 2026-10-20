# VERCEL.md — Hosting and Deployment

## Related Documents

- `docs/ARCHITECTURE.md` — environment structure and deployment pipeline
- `docs/CONVENTIONS.md` — branch naming that drives deployments
- `docs/ENV.md` — all environment variables set in Vercel
- `docs/infra/SUPABASE.md` — database connected to each Vercel deployment
- `docs/infra/CLERK.md` — Clerk instance per environment
- `docs/countries/ZM.md` — Zambia-specific deployment configuration

---

## Implementation Status (2026-10-20)

**No Vercel project exists yet.** The application *builds* — `npx turbo build
--filter=@zsms/web` succeeds and CI runs it on every push — but as of this date it has
never been deployed anywhere, and `next dev` on a developer's laptop is still the only
way to reach it. `zsms-staging` and `zsms-zm` do not exist as Vercel projects any more
than they do as Supabase projects.

*(This block read "the application builds and deploys" until 2026-10-20. It built; it had
never deployed. Update this paragraph the day a project is actually created rather than
the day one is planned.)*

*Deploying the dev instance on the free tier* below is the procedure for changing that.

There is no `vercel.json` — configuration is dashboard-side. The one thing that IS in the
repository is the security headers in `next.config.mjs`, which belong there rather than in
platform configuration precisely so they survive a platform change.

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
- **Build command:** `cd ../.. && npx turbo build --filter=@zsms/web`
- **Output directory:** `.next`

> **The filter must be the full package name.** This read `--filter=web` until
> 2026-10-20. `apps/web/package.json` declares `"name": "@zsms/web"`, and turbo
> matches package names, not directory basenames — so `--filter=web` resolves to
> **zero tasks**, exits 0, and builds nothing. On Vercel that is the worst shape a
> mistake can take: the deployment is marked successful, and the site 404s because
> `.next` was never produced. Verified with
> `npx turbo build --filter=web --dry-run=json`, which returns an empty task list.

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

## Deploying the Dev Instance on the Free Tier

Added 2026-10-20. Until this date the application had **never been hosted anywhere** —
`next dev` on one laptop was the only way to reach it, and the mobile app could only be
used by a phone on the same Wi-Fi with Metro running. This section is the free-tier path
that ends both constraints. It is for the **development** instance against `zsms-dev`,
and it is explicitly not a staging or production procedure: those are gated by
prohibition 10 and by `af-south-1`.

### What is already hosted, and what is not

Worth stating plainly, because it is the reason this is a short procedure rather than a
migration. Of the services ZSMS depends on, **five already run off-machine**: Supabase,
Clerk, Cloudflare R2, Upstash Redis and PostHog. Only two things were ever local — the
Next.js app and the Metro bundler. Deploying the first makes the second optional.

The Railway workers stay local by decision. Railway has no free tier, and nothing else
hosts a long-running worker for free on terms worth the setup. Jobs enqueue to Upstash
and wait; running `npm run dev:workers` drains them. So receipts and report cards are
**delayed rather than lost**, which is an acceptable property for a dev instance and an
unacceptable one for a school.

### Project settings

| Setting | Value |
|---|---|
| Repository | `AfriTechSystems/zsms-monorepo` |
| Root directory | `apps/web` |
| Framework preset | Next.js |
| Build command | `cd ../.. && npx turbo build --filter=@zsms/web` |
| Output directory | `.next` |
| Production branch | `main` |

The build command is the one thing here that fails silently if it is wrong — see the note
under *Vercel Project Structure*.

### Environment variables

The seven in `env.local.template` are the minimum for the app to run:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
CLERK_SECRET_KEY
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
AUTH_PROVIDER
NEXT_PUBLIC_COUNTRY_CODE
AI_GENERATOR
```

Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as well. Rate limiting is not
load-bearing for correctness — every call site guards with `?.trim()` and the limiter
fails open by design — but a public URL with no limiter is an invitation, and the
credentials already exist.

**Keep the Clerk development instance.** Its keys work from any origin, and the `role`
and `email` session claims this repository depends on are already configured on it. A
Clerk *production* instance means new keys, re-creating all seven `org:*` roles and
re-creating every organisation; it is real work and it buys nothing until a real school
exists.

### Making the APK real

This is the smaller half, because `.github/workflows/android-build.yml` already reads the
value — the gap was only ever that the variable was unset.

```bash
gh variable set EXPO_PUBLIC_API_URL --body "https://<project>.vercel.app"
```

`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is already a repository **secret** and needs nothing.
Then run the workflow with `universal` + `standalone`. The result talks to Vercel over
HTTPS and needs no Metro, no `npm run dev`, and no shared network — it can be handed to
somebody in another town.

It is signed with the **debug key**: installable for testing, not publishable to the Play
Store, which needs a real keystore and a decision about who holds it.

### What the free tier actually costs

Four constraints, none of them technical surprises if they are read first:

1. **Vercel Hobby prohibits commercial use.** It is free while nobody is paying for ZSMS.
   The day a school is invoiced, this needs Pro. That is a licence term, not a
   rate limit, and it will not announce itself.
2. **A free Supabase project pauses after roughly a week of inactivity.** The hosted app
   goes dark until someone opens the dashboard. For an instance that exists to be
   demonstrated occasionally, that is the sharpest edge here.
3. **A free deployment is still a public URL.** `/design` already refuses production to
   anyone who is not a signed-in AfriTech admin, and answers `404` rather than `403` so
   the route's existence is not itself disclosed. Any page added later is public by
   default; that is each page's own job, because middleware establishes identity and
   never authorises.
4. **No custom domain is free any more.** `*.vercel.app` is the free option.
   `zsms.co.zm` goes through a ZICTA-accredited registrar and is worth doing nearer to
   selling, not now.

### The constraint that is not negotiable

This deployment points at `zsms-dev`, which is in `eu-west-1`. That region is a
**documented exception that holds only because the data is synthetic** — see
`COMPLIANCE.md` → Environment Data Residency. Putting the app behind a public URL does
not change the exception; it widens who can reach it.

So the existing prohibition applies with more force, not less: **no production dumps, no
anonymised extracts, no pilot records.** The first real pupil in this database is a ZDPA
problem, and a hosted URL makes it one that is harder to notice. A real school waits for
`zsms-staging` in `af-south-1`.

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
| 2026-10-20 | Corrected the build command to `--filter=@zsms/web` | `--filter=web` matched no package, so the build produced nothing and Vercel reported success while the site 404'd |
| 2026-10-20 | Added *Deploying the dev instance on the free tier* | The app had never been hosted anywhere; a free Vercel deployment is what makes a standalone APK and remote testing possible |
