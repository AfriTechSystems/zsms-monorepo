/**
 * Transactional email via Resend.
 *
 * THE ONLY FILE PERMITTED TO CALL RESEND.
 *
 * NOTE: ZSMS has no dedicated Resend document. Resend is named as the email
 * provider in `ARCHITECTURE.md`, `ENV.md`, `SECURITY_POLICIES.md`, and
 * `COMPLIANCE.md`, and the fallback chain is specified in `TWILIO.md`,
 * `SMS.md`, and `AVAILABILITY.md` — but there is no `RESEND.md` equivalent to
 * `META_API.md` or `TWILIO.md`. Behaviour here follows the chain those
 * documents describe; a dedicated doc should be written when email gains
 * anything beyond plain transactional send.
 */

import { renderBrandedEmail } from '../email-shell'
import type { NotificationChannel, Recipient, SendRequest, SendResult } from '../types'

export class ResendEmailChannel implements NotificationChannel {
  readonly channel = 'email' as const
  readonly provider = 'resend' as const

  canReach(recipient: Recipient): boolean {
    return Boolean(recipient.email)
  }

  async send(request: SendRequest, renderedBody: string, subject?: string): Promise<SendResult> {
    // Branding rides on the request. The worker resolves it once per school from
    // `worker_school_branding()` rather than this provider querying anything —
    // a provider that reaches for the database is a provider that cannot be
    // tested without one.
    const branded = renderBrandedEmail(renderedBody, request.branding ?? null)
    const apiKey = process.env['RESEND_API_KEY']
    const from = process.env['RESEND_FROM_ADDRESS']

    if (!apiKey || !from) {
      return {
        channel: 'email',
        success: false,
        error: 'RESEND_API_KEY or RESEND_FROM_ADDRESS is not set',
        confirmedFailure: false,
      }
    }

    if (!request.recipient.email) {
      return { channel: 'email', success: false, error: 'No email address', confirmedFailure: true }
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [request.recipient.email],
          subject: subject ?? 'Message from your school',
          // Multipart. The HTML carries the school's mark and colours; the text
          // part is what a feature phone, a screen reader in plain-text mode, and
          // every spam filter actually reads. Sending only one of the two is a
          // deliverability cost as well as an accessibility one.
          html: branded.html,
          text: branded.text,
          // Attachments are passed as R2 paths by the caller and resolved by
          // the worker before this point; a signed URL is never embedded here,
          // because an email is forwardable and a signed URL is a bearer token.
        }),
      })

      const payload = (await response.json()) as { id?: string; message?: string }

      if (!response.ok) {
        const permanent = response.status >= 400 && response.status < 500 && response.status !== 429
        return {
          channel: 'email',
          success: false,
          error: payload.message ?? `Resend returned ${response.status}`,
          confirmedFailure: permanent,
        }
      }

      return { channel: 'email', success: true, providerMessageId: payload.id }
    } catch (err) {
      return {
        channel: 'email',
        success: false,
        error: err instanceof Error ? err.message : 'Network error',
        confirmedFailure: false,
      }
    }
  }
}
