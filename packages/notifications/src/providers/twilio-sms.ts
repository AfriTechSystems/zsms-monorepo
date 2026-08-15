/**
 * SMS via Twilio — the last resort in the fallback chain.
 *
 * THE ONLY FILE PERMITTED TO CALL TWILIO.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/TWILIO.md`
 *       `Official Documentation/12 Communication System/SMS.md`
 *
 * SMS fires only after WhatsApp AND email have *confirmed* failure, and only
 * for critical messages. It costs real money per segment and, unlike the other
 * two channels, the school pays whether or not anyone reads it.
 */

import type { NotificationChannel, Recipient, SendRequest, SendResult } from '../types'

export class TwilioSmsChannel implements NotificationChannel {
  readonly channel = 'sms' as const
  readonly provider = 'twilio' as const

  canReach(recipient: Recipient): boolean {
    return Boolean(recipient.phoneE164)
  }

  async send(request: SendRequest, renderedBody: string): Promise<SendResult> {
    const sid = process.env['TWILIO_ACCOUNT_SID']
    const token = process.env['TWILIO_AUTH_TOKEN']
    const from = process.env['TWILIO_FROM_NUMBER']

    if (!sid || !token || !from) {
      return {
        channel: 'sms',
        success: false,
        error: 'Twilio credentials are not set',
        confirmedFailure: false,
      }
    }

    if (!request.recipient.phoneE164) {
      return { channel: 'sms', success: false, error: 'No phone number', confirmedFailure: true }
    }

    const form = new URLSearchParams({
      To: request.recipient.phoneE164,
      From: from,
      Body: renderedBody,
    })

    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
        },
      )

      const payload = (await response.json()) as { sid?: string; message?: string }

      if (!response.ok) {
        const permanent = response.status >= 400 && response.status < 500 && response.status !== 429
        return {
          channel: 'sms',
          success: false,
          error: payload.message ?? `Twilio returned ${response.status}`,
          confirmedFailure: permanent,
        }
      }

      return { channel: 'sms', success: true, providerMessageId: payload.sid }
    } catch (err) {
      return {
        channel: 'sms',
        success: false,
        error: err instanceof Error ? err.message : 'Network error',
        confirmedFailure: false,
      }
    }
  }
}
