/**
 * Notification channel abstraction — type contract.
 *
 * Spec: `Official Documentation/12 Communication System/WHATSAPP.md`
 *       `Official Documentation/12 Communication System/SMS.md`
 *       `Official Documentation/03 Infrastructure Services/META_API.md`
 *       `Official Documentation/03 Infrastructure Services/TWILIO.md`
 *
 * Application code never imports `@meta`, `resend`, or `twilio` directly. The
 * only supported entry points are `getChannel()` and `sendWithFallback()` from
 * this package — the same rule that keeps Clerk behind `auth-provider` and
 * BullMQ behind `queue`.
 *
 * The reason is not tidiness. `DEPLOYMENT_TOPOLOGY.md` Tier 2 puts a
 * self-hosted deployment behind a different SMS gateway and possibly a
 * different email relay; a direct provider import anywhere else turns that from
 * a configuration change into a refactor.
 */

import type { EmailBranding } from './email-shell'

/** Delivery channels, in fallback order for critical messages. */
export const CHANNELS = ['whatsapp', 'email', 'sms', 'push', 'in_app'] as const
export type Channel = (typeof CHANNELS)[number]

/**
 * The fallback chain for a critical notification.
 *
 * WhatsApp → email → SMS, per `TWILIO.md` and `SMS.md`: SMS is the last resort
 * and fires only after both earlier channels have *confirmed* failure. Push and
 * in-app are not in the chain — they are additive surfaces, not substitutes for
 * reaching a parent who is not holding the app.
 */
export const FALLBACK_CHAIN: readonly Channel[] = ['whatsapp', 'email', 'sms'] as const

export type ProviderName = 'meta' | 'resend' | 'twilio' | 'mock'

export interface Recipient {
  /** E.164. Required for whatsapp and sms. */
  phoneE164?: string
  /** Required for email. */
  email?: string
  /** Clerk user ID, recorded on the message log. */
  userId?: string
}

/**
 * What a caller asks to send.
 *
 * NOTE THE ABSENCE OF A MESSAGE BODY. A caller names a template key and
 * supplies variables; the body is resolved from `notification_templates` at
 * send time. Passing rendered text here would let a caller bypass the
 * admin-controlled wording, which is the thing the template table exists to
 * guarantee.
 */
export interface SendRequest {
  schoolId: string | null
  templateKey: string
  recipient: Recipient
  /** Values for the template's {{placeholders}}. */
  variables: Record<string, string>
  /** Attachment paths in R2. Email only; ignored by other channels. */
  attachmentPaths?: string[]
  studentId?: string | null
  languageCode?: string
  /**
   * The school's colours and logo, for channels that can render them.
   *
   * Email only in practice — WhatsApp and SMS have no presentation layer to
   * brand. Resolved by the worker from `worker_school_branding()` once per
   * school and passed down, so a provider never queries anything and stays
   * testable without a database.
   *
   * Absent means the ZSMS default, which is also what a school that has set no
   * branding gets. **Carries no PII**: a name, two hex colours, and a logo URL,
   * consistent with the rule that job payloads carry IDs rather than personal
   * data.
   */
  branding?: EmailBranding | null
}

export interface SendResult {
  channel: Channel
  success: boolean
  /** Meta wamid, Twilio SID, Resend message ID. */
  providerMessageId?: string
  /** Present when success is false. */
  error?: string
  /**
   * True when the provider reported a definite, non-retryable failure — an
   * invalid number, a hard bounce, an opt-out.
   *
   * This distinction drives the chain: a *confirmed* failure moves to the next
   * channel, a transient one (timeout, 5xx, rate limit) is retried on the same
   * channel by the queue. Treating a timeout as confirmed failure would send
   * every parent a duplicate over SMS during a Meta outage.
   */
  confirmedFailure?: boolean
}

/**
 * One delivery channel. Implementations live in this package and nowhere else.
 */
export interface NotificationChannel {
  readonly channel: Channel
  readonly provider: ProviderName
  /** Whether this channel can reach the recipient at all. */
  canReach(recipient: Recipient): boolean
  send(request: SendRequest, renderedBody: string, subject?: string): Promise<SendResult>
}

export interface FallbackOutcome {
  /** The channel that actually delivered, or null if every channel failed. */
  deliveredVia: Channel | null
  attempts: SendResult[]
  /** message_log row IDs created, in attempt order. */
  messageLogIds: string[]
}
