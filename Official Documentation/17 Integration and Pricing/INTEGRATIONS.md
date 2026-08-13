# INTEGRATIONS.md — Integrations Framework Overview

## Related Documents

- `docs/modules/integrations/ACCOUNTING_CONNECTORS.md` — Sage, QuickBooks, Xero, Google Sheets
- `docs/modules/integrations/CRM_CONNECTORS.md` — HubSpot and custom CRM
- `docs/modules/integrations/CUSTOM_WEBHOOK.md` — custom outbound webhook configuration
- `docs/api/API_INTEGRATION.md` — inbound API access for external systems
- `docs/modules/admin/PRICING.md` — integrations as a feature flag
- `docs/DATABASE.md` — school_integrations, integration_log tables
- `docs/infra/QSTASH.md` — integration event dispatch queue

---

## Purpose

This document defines the ZSMS integrations framework — the three-tier architecture, what connects to what, how integrations are configured, and how events flow from ZSMS to connected systems. Every Claude Code session building any integration connector must read this document before starting.

---

## Overview

Schools do not exist in isolation. Most private schools that reach Professional or Enterprise tier already use other software — accounting systems like Sage or QuickBooks, productivity tools like Google Workspace, and sometimes CRM tools for enrollment management. ZSMS integrations allow these tools to stay in sync with ZSMS automatically, eliminating the double-entry that accountants and administrators currently perform manually.

Integrations are a Phase 2 feature — the architecture is built now, connectors are implemented in Phase 2, and a Zapier app is planned for Phase 3.

---

## Three-Tier Architecture

### Tier 1 — Native Webhooks (Already Built — Phase 1)

Any system that can receive HTTP webhooks connects immediately using the existing `school_webhooks` table. The school configures a webhook URL and selects which ZSMS events to forward. ZSMS signs every webhook with HMAC-SHA256 using the school's registered secret. No additional integration infrastructure needed — this is the `API_INTEGRATION.md` Tier 1 system surfaced in a user-friendly UI.

**Works for:** Any developer-savvy school or school with IT staff. Connects to any webhook-capable system.

**Setup time:** 5-10 minutes (register URL, select events, copy secret to target system).

### Tier 2 — Pre-Built Connectors (Phase 2)

ZSMS builds and maintains connectors for the most common tools used by Zambian private schools. Each connector is a thin adapter that translates ZSMS webhook events into the target system's native API format and handles OAuth authentication with that system.

**Available connectors:**
- Sage 50 (CSV export — desktop accounting)
- Sage Business Cloud (API — cloud accounting)
- QuickBooks Online (API — cloud accounting)
- Xero (API — cloud accounting)
- Google Sheets (API — universal data destination)
- HubSpot (API — enrollment CRM)

**Setup time:** 5-15 minutes (OAuth flow + field mapping configuration).

### Tier 3 — Zapier/Make Integration (Phase 3)

A published ZSMS Zapier app and Make module allows schools to connect ZSMS to any of 5,000+ apps on those platforms — project management tools, messaging platforms, custom databases, or any other tool the school uses. AfriTech publishes and maintains the Zapier/Make integration; the school configures their own Zaps without AfriTech involvement.

---

## Database Schema

### `public.school_integrations`

One row per connected integration per school. Stores credentials, configuration, and sync state.

```sql
CREATE TABLE public.school_integrations (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID NOT NULL REFERENCES public.schools(id),
  integration_type  TEXT NOT NULL
                    CHECK (integration_type IN (
                      'sage_50_export',      -- CSV export (no OAuth)
                      'sage_business_cloud', -- OAuth API
                      'quickbooks',          -- OAuth API
                      'xero',                -- OAuth API
                      'google_sheets',       -- OAuth API
                      'hubspot',             -- OAuth API
                      'custom_webhook'       -- Any webhook-capable system
                    )),
  display_name      TEXT NOT NULL,
  -- E.g. "Our Sage Accounting", "Enrollment HubSpot"

  is_active         BOOLEAN DEFAULT TRUE,
  is_paused         BOOLEAN DEFAULT FALSE,
  -- Paused: integration exists but events are not being dispatched

  config            JSONB NOT NULL DEFAULT '{}',
  -- Integration-specific configuration (see each connector doc for structure)

  credentials_enc   TEXT,
  -- Encrypted OAuth access token, refresh token, API keys
  -- NULL for sage_50_export (no auth needed) and custom_webhook (secret handled separately)

  events_subscribed TEXT[] NOT NULL DEFAULT '{}',
  -- ZSMS events this integration forwards:
  -- 'payment.verified', 'payment.rejected', 'student.created',
  -- 'student.updated', 'fee_record.generated', 'results.published',
  -- 'attendance.marked', 'loan.disbursed'

  last_sync_at      TIMESTAMPTZ,
  last_sync_status  TEXT CHECK (last_sync_status IN ('success', 'failed', 'partial')),
  last_error        TEXT,
  sync_count        INT DEFAULT 0,
  error_count       INT DEFAULT 0,

  created_by        TEXT NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_integrations_school ON public.school_integrations(school_id, is_active)
  WHERE is_active = TRUE;
CREATE INDEX idx_integrations_type ON public.school_integrations(integration_type, is_active)
  WHERE is_active = TRUE;
```

### `public.integration_log`

Append-only log of every integration event dispatch attempt.

```sql
CREATE TABLE public.integration_log (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id         UUID NOT NULL REFERENCES public.schools(id),
  integration_id    UUID NOT NULL REFERENCES public.school_integrations(id),
  event_type        TEXT NOT NULL,
  zsms_record_id    TEXT,
  -- The ID of the ZSMS record that triggered this event

  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'success', 'failed', 'retrying', 'skipped')),

  request_payload   JSONB,
  -- What was sent — sanitised (no PII, no financial amounts — just IDs and metadata)

  response_code     INT,
  response_summary  TEXT,
  -- First 500 chars of response body for debugging
  error_message     TEXT,
  retry_count       INT DEFAULT 0,
  next_retry_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);

CREATE INDEX idx_integration_log_integration ON public.integration_log(integration_id, created_at DESC);
CREATE INDEX idx_integration_log_status ON public.integration_log(integration_id, status)
  WHERE status IN ('failed', 'retrying');
CREATE INDEX idx_integration_log_school ON public.integration_log(school_id, created_at DESC);
```

---

## Event Flow

When a ZSMS event fires (e.g. payment.verified), the event flow is:

```
1. ZSMS internal event fires
   (webhook-payment Edge Function verifies and processes payment)

2. Edge Function checks school_integrations for active integrations
   subscribed to 'payment.verified' at this school

3. For each matching integration:
   a. Create integration_log row (status: 'pending')
   b. Enqueue queued job: 'dispatch-integration-event'
   c. Job payload: { integration_id, event_type, zsms_record_id }
      (no PII or financial data in the queue — only IDs)

4. 'dispatch-integration-event' Edge Function runs:
   a. Fetch full integration config and credentials (decrypt)
   b. Fetch the ZSMS record by zsms_record_id
   c. Transform data to target system format
   d. Call target system API
   e. Update integration_log: status → 'success' or 'failed'
   f. Update school_integrations: last_sync_at, last_sync_status

5. On failure: the queue retries with exponential backoff
   Retry 1: 30 seconds
   Retry 2: 5 minutes
   Retry 3: 30 minutes
   After 3 failures: status = 'failed', appears in integration health dashboard
```

---

## Subscription Access

Integrations require the `integrations` feature flag. Access via:

| Access Path | Monthly Cost |
|---|---|
| Professional tier (included) | No additional cost |
| Enterprise tier (included) | No additional cost |
| Growth tier add-on | K200/month |
| Starter tier add-on | K200/month |

Checked via `schoolHasFeature(schoolId, 'integrations')` before showing the integrations UI or dispatching any integration events.

---

## Integrations Settings Panel

**Location:** Settings → Integrations

```
Connected Integrations

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Sage Business Cloud               Last sync: 2 hours ago
   Events: payment.verified, student.created
   [Configure]  [View Log]  [Pause]  [Disconnect]

✅ Google Sheets — Fee Tracker       Last sync: 5 minutes ago
   Events: payment.verified, fee_record.generated
   [Configure]  [View Log]  [Pause]  [Disconnect]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[+ Connect an integration]

Available integrations:
[Sage 50 Export]  [QuickBooks]  [Xero]  [HubSpot]  [Custom Webhook]
```

---

## Integration Health Monitoring

The Integration Log view (Settings → Integrations → [Integration] → View Log) shows:

```
Sage Business Cloud — Event Log

Filter: [All ▼]  [Date range]

Date          Event              Record        Status     Actions
────────────────────────────────────────────────────────────────────
15 Sep 11:45  payment.verified   REC-0042      ✅ Success
15 Sep 10:23  student.created    STU-00047     ✅ Success
14 Sep 17:00  payment.verified   REC-0041      ❌ Failed   [Retry]
   └── Error: Sage API rate limit exceeded (429)
   └── Retried 3 times — manual retry required
14 Sep 09:30  payment.verified   REC-0040      ✅ Success

Failed events can be retried individually or in bulk.
[Retry all failed]
```

---

## Business Rules

1. Integration dispatch is always asynchronous — ZSMS never waits for a third-party system to respond before completing its own operation. A slow Sage API never delays payment verification.
2. Integration failures do not block ZSMS operations. If QuickBooks is down, ZSMS continues functioning normally — events are queued and retried when QuickBooks recovers.
3. PII is never included in queue job payloads — only ZSMS record IDs. The dispatch Edge Function fetches the full data at dispatch time.
4. Integration credentials are encrypted using `GATEWAY_ENCRYPTION_KEY` — the same key used for payment gateway credentials.
5. Pausing an integration preserves the configuration and credentials but stops dispatching events. Events that fire while paused are not retroactively sent when the integration is resumed.
6. Disconnecting an integration deletes the credentials and configuration. Integration logs are retained for 90 days for the school's reference.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | CRM and accounting integration confirmed |
| 2026-04-26 | Phase 2 classification | Integration connectors are post-pilot features |
| 2026-04-26 | Added three-tier architecture | Balances immediate value (webhooks) with long-term capability |
