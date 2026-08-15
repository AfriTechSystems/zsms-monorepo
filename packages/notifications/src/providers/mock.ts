/**
 * Mock channel — records dispatch instead of sending.
 *
 * Selected by `NOTIFICATION_PROVIDER=mock`, and the default in development.
 *
 * WHY THIS EXISTS
 * ---------------
 * `zsms-dev` must never send a real message. The dev database holds synthetic
 * data (CLAUDE.md), and a WhatsApp template rendered against a fixture parent
 * would still reach whatever phone number the fixture happens to contain.
 *
 * It is also what makes the fallback chain testable: a mock configured to fail
 * on WhatsApp proves the chain reaches email without an outage at Meta.
 */

import type { Channel, NotificationChannel, Recipient, SendRequest, SendResult } from '../types'

export interface MockRecord {
  channel: Channel
  to: string
  body: string
  subject?: string
  templateKey: string
  at: Date
}

/** In-memory record of everything "sent". Test-visible; never used in production. */
const sent: MockRecord[] = []

export function mockSentMessages(): readonly MockRecord[] {
  return sent
}

export function resetMockMessages(): void {
  sent.length = 0
}

/**
 * Channels listed here fail on purpose, so a test can drive the chain.
 * e.g. NOTIFICATION_MOCK_FAIL=whatsapp,email → only SMS succeeds.
 */
function forcedFailures(): Set<string> {
  return new Set(
    (process.env['NOTIFICATION_MOCK_FAIL'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
}

export class MockChannel implements NotificationChannel {
  readonly provider = 'mock' as const

  constructor(readonly channel: Channel) {}

  canReach(recipient: Recipient): boolean {
    if (this.channel === 'email') return Boolean(recipient.email)
    return Boolean(recipient.phoneE164)
  }

  async send(request: SendRequest, renderedBody: string, subject?: string): Promise<SendResult> {
    if (forcedFailures().has(this.channel)) {
      return {
        channel: this.channel,
        success: false,
        error: `Mock forced failure on ${this.channel}`,
        // Confirmed, so the chain advances rather than retrying forever.
        confirmedFailure: true,
      }
    }

    sent.push({
      channel: this.channel,
      to: request.recipient.email ?? request.recipient.phoneE164 ?? 'unknown',
      body: renderedBody,
      subject,
      templateKey: request.templateKey,
      at: new Date(),
    })

    return {
      channel: this.channel,
      success: true,
      providerMessageId: `mock_${this.channel}_${sent.length}`,
    }
  }
}
