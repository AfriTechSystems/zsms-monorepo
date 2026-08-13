# META_API.md — WhatsApp Meta Cloud API Integration

## Related Documents

- `docs/modules/communication/WHATSAPP.md` — WhatsApp messaging model
- `docs/modules/communication/TEMPLATES.md` — approved template registry
- `docs/modules/communication/MESSAGE_LOG.md` — delivery status updates
- `docs/DATABASE.md` — schools.whatsapp_owns_number and related fields
- `docs/infra/QSTASH.md` — async job dispatch for WhatsApp
- `docs/ENV.md` — Meta API environment variables

---

## Purpose

This document defines the Meta Cloud API integration — how ZSMS dispatches WhatsApp messages, how delivery status webhooks are processed, and critically how the Edge Function selects between the AfriTech shared number and a school's own number. Every Claude Code session building any WhatsApp dispatch feature must read this document.

---

## Two WhatsApp Delivery Modes

### Mode A — AfriTech Shared Number (Default)

`schools.whatsapp_owns_number = FALSE`

All messages dispatched using AfriTech's Meta Business Account credentials stored in environment variables. Messages appear from "ZSMS Zambia" or the AfriTech business display name. Quota is tracked per school from the shared account.

```typescript
// Environment variables used for Mode A
META_WHATSAPP_PHONE_NUMBER_ID=AfriTech_phone_number_id
META_WHATSAPP_ACCESS_TOKEN=AfriTech_access_token
META_WHATSAPP_BUSINESS_ACCOUNT_ID=AfriTech_waba_id
```

### Mode B — School-Specific Number

`schools.whatsapp_owns_number = TRUE`

Messages dispatched using the school's own Meta Business Account credentials stored encrypted in the database. Messages appear from the school's own WhatsApp number and display name. The school manages their own Meta quota independently.

```typescript
// Database fields used for Mode B (on public.schools)
schools.whatsapp_phone_number_id      // School's Meta phone number ID
schools.whatsapp_access_token_enc     // Encrypted with GATEWAY_ENCRYPTION_KEY
schools.whatsapp_business_acct_id     // School's WABA ID
```

---

## Per-School Number Selection in the Edge Function

The `send-whatsapp` Edge Function reads the school's configuration before every dispatch:

```typescript
// supabase/functions/send-whatsapp/index.ts

interface WhatsAppCredentials {
  phoneNumberId: string
  accessToken: string
}

async function getWhatsAppCredentials(schoolId: string): Promise<WhatsAppCredentials> {
  const { data: school } = await supabaseAdmin
    .from('schools')
    .select('whatsapp_owns_number, whatsapp_phone_number_id, whatsapp_access_token_enc')
    .eq('id', schoolId)
    .single()

  if (school.whatsapp_owns_number && school.whatsapp_phone_number_id) {
    // Mode B — use school's own credentials
    const accessToken = await decrypt(
      school.whatsapp_access_token_enc,
      Deno.env.get('GATEWAY_ENCRYPTION_KEY')!
    )
    return {
      phoneNumberId: school.whatsapp_phone_number_id,
      accessToken,
    }
  }

  // Mode A — use AfriTech shared credentials (default)
  return {
    phoneNumberId: Deno.env.get('META_WHATSAPP_PHONE_NUMBER_ID')!,
    accessToken: Deno.env.get('META_WHATSAPP_ACCESS_TOKEN')!,
  }
}
```

---

## Sending a Template Message

```typescript
async function sendWhatsAppTemplate(
  recipientPhone: string,
  templateName: string,
  variables: string[],
  credentials: WhatsAppCredentials
): Promise<string> {

  const response = await fetch(
    `https://graph.facebook.com/v19.0/${credentials.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipientPhone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: variables.length > 0 ? [{
            type: 'body',
            parameters: variables.map(v => ({ type: 'text', text: v })),
          }] : undefined,
        },
      }),
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`Meta API error: ${JSON.stringify(error)}`)
  }

  const result = await response.json()
  return result.messages[0].id  // The Meta WAMID — stored in message_log.provider_message_id
}
```

---

## Delivery Status Webhook

Meta POSTs delivery status updates to `POST /api/webhooks/whatsapp`. The `webhook-whatsapp` Edge Function processes these:

```typescript
// Delivery status values from Meta:
// sent → delivered → read → failed

async function handleStatusUpdate(entry: MetaWebhookEntry): Promise<void> {
  const statuses = entry.changes[0]?.value?.statuses ?? []

  for (const status of statuses) {
    // Find the message_log row by Meta WAMID
    const { data: logEntry } = await supabaseAdmin
      .from('message_log')
      .select('id, school_id')
      .eq('provider_message_id', status.id)
      .single()

    if (!logEntry) continue

    const updates: Record<string, unknown> = {}

    switch (status.status) {
      case 'sent':
        updates.status = 'sent'
        updates.sent_at = new Date(Number(status.timestamp) * 1000).toISOString()
        break
      case 'delivered':
        updates.status = 'delivered'
        updates.delivered_at = new Date(Number(status.timestamp) * 1000).toISOString()
        break
      case 'read':
        updates.status = 'read'
        updates.read_at = new Date(Number(status.timestamp) * 1000).toISOString()
        break
      case 'failed':
        updates.status = 'failed'
        updates.failed_at = new Date().toISOString()
        updates.failure_reason = status.errors?.[0]?.message ?? 'Unknown error'
        // Trigger SMS fallback for critical messages
        await triggerSmsFallbackIfCritical(logEntry.id)
        break
    }

    await supabaseAdmin
      .from('message_log')
      .update(updates)
      .eq('id', logEntry.id)
  }
}
```

---

## Webhook Verification (GET Request from Meta)

Meta sends a GET request to verify the webhook endpoint before delivery starts:

```typescript
// GET /api/webhooks/whatsapp
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === Deno.env.get('META_WEBHOOK_VERIFY_TOKEN')) {
    return new Response(challenge, { status: 200 })
  }

  return new Response('Forbidden', { status: 403 })
}
```

---

## Template Management for Schools Using Own Number

Schools using Mode B (own WhatsApp number) must register the same templates under their own Meta account. AfriTech provides the template specifications. The school submits them to Meta under their WABA and waits for approval (typically 24-72 hours).

Required templates for a school using their own number:
```
fee_payment_confirmed    ← Required
fee_overdue_reminder     ← Required
fee_overdue_final        ← Required
monthly_attendance_summary ← Required
results_published        ← Required
absence_alert            ← Optional (only if per-absence alerts enabled)
school_announcement      ← Optional (only if important announcements enabled)
loan_status_update       ← Optional (only if loan module enabled)
```

AfriTech provides the exact template body and variable structure for each template. The school's template name must match the `template_id` used in the codebase exactly (case-sensitive, underscores).

---

## Inbound Message Processing (Chatbot)

When a parent sends a message to the ZSMS WhatsApp number, Meta delivers it to the same webhook endpoint:

```typescript
async function handleInboundMessage(entry: MetaWebhookEntry): Promise<void> {
  const message = entry.changes[0]?.value?.messages?.[0]
  if (!message) return

  const fromPhone = message.from      // Parent's phone number
  const messageText = message.text?.body?.trim().toUpperCase() ?? ''

  // Look up parent by phone
  const parent = await findParentByPhone(fromPhone)
  if (!parent) {
    await sendTextReply(fromPhone, 'Your number is not registered with any ZSMS school.', credentials)
    return
  }

  // Process chatbot command
  await processChatbotCommand(parent, messageText, fromPhone, credentials)
}
```

Inbound message routing uses the same Mode A / Mode B credential selection — but since AfriTech manages the shared number webhook, Mode A inbound messages all arrive at the same endpoint. Mode B schools receive inbound messages on their own number's webhook, which must be separately configured in their Meta account to point to the same ZSMS endpoint.

---

## HMAC Webhook Signature Verification

Every incoming webhook POST from Meta must be verified before processing:

```typescript
async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string
): Promise<boolean> {
  const appSecret = Deno.env.get('META_APP_SECRET')!
  const expected = 'sha256=' + await hmacSha256Hex(appSecret, rawBody)
  return expected === signatureHeader
}
```

Return 401 if signature verification fails. Never process unverified webhooks.

---

## Business Rules

1. Mode A or Mode B is determined per school on every dispatch call — never cached at the Edge Function level.
2. School WhatsApp access tokens are decrypted in the Edge Function only — never stored in plaintext, never logged.
3. Mode B templates must be registered under the school's own WABA. ZSMS cannot submit templates on behalf of schools.
4. Webhook HMAC verification must pass before any webhook payload is processed. 401 is returned for failed verification.
5. Meta message IDs (WAMIDs) are stored in `message_log.provider_message_id` immediately after dispatch to enable delivery status matching.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-04-26 | Initial complete draft | Infrastructure reference |
| 2026-04-26 | Added per-school number selection logic | School-specific WhatsApp numbers confirmed |
| 2026-04-26 | Added Mode B template management requirements | Schools using own number need their own approved templates |
| 2026-04-26 | Added Mode B inbound message routing | Chatbot must work for both shared and school-specific numbers |
