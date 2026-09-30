/**
 * Expo push notifications — the free channel that makes per-absence alerts viable.
 *
 * Spec: `Official Documentation/10 Attendance/NOTIFICATIONS.md` → *Channel 2 — Push Notifications*
 *
 * ## Why push is not in the fallback chain, and why that is not a demotion
 *
 * `FALLBACK_CHAIN` is WhatsApp → email → SMS. Push is deliberately outside it, because a push
 * notification cannot substitute for reaching a parent: it arrives only if they installed the app and
 * left notifications on, and a silent failure is indistinguishable from a parent who did not look.
 *
 * What it substitutes for is **cost**. `NOTIFICATIONS.md` is explicit that ZSMS is portal-first and
 * does not send a WhatsApp message per absence, because every one consumes the school's quota. Push
 * is free, so it is the channel that lets a parent hear about today's absence today. Sent alongside
 * the chain rather than inside it.
 *
 * ## No SDK
 *
 * One `fetch` to `exp.host`, the same choice `packages/ai` made: the request is a JSON array and the
 * response is a JSON array, and `expo-server-sdk` brings a dependency tree to a Railway worker in
 * exchange for chunking we can write in four lines.
 *
 * ## The receipt half is the part that matters over time
 *
 * Expo answers with a *ticket* per message, which means "accepted", not "delivered". A device whose
 * app has been uninstalled returns `DeviceNotRegistered`, and continuing to send to it forever makes
 * every delivery statistic meaningless. `retiredTokens` on the result is what the worker feeds to
 * `worker_retire_push_token()` so the table converges on reality without anybody auditing it.
 */

import type { Channel, NotificationChannel, ProviderName, Recipient, SendRequest, SendResult } from '../types'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

/** Expo's documented cap per request. Batched rather than chunked by guesswork. */
const MAX_PER_REQUEST = 100

interface ExpoTicket {
  status: 'ok' | 'error'
  id?: string
  message?: string
  details?: { error?: string }
}

export interface PushOutcome extends SendResult {
  /**
   * Tokens Expo rejected as no longer belonging to an installed app. The caller retires these; this
   * module does not touch the database, for the same reason no other provider here does.
   */
  retiredTokens: string[]
}

export class ExpoPushChannel implements NotificationChannel {
  readonly channel: Channel = 'push'
  readonly provider: ProviderName = 'expo'

  /**
   * Reachable only if we hold at least one device token.
   *
   * Note this is the one channel where "can reach" is genuinely unknowable in advance: a token proves
   * the app was installed once, not that it still is, and not that notifications are permitted. The
   * honest reading of `true` here is "worth attempting", which is why push never satisfies the
   * fallback chain.
   */
  canReach(recipient: Recipient): boolean {
    return (recipient.pushTokens?.length ?? 0) > 0
  }

  async send(request: SendRequest, renderedBody: string, subject?: string): Promise<PushOutcome> {
    const tokens = request.recipient.pushTokens ?? []
    if (tokens.length === 0) {
      return {
        channel: 'push',
        success: false,
        error: 'No registered device.',
        // Confirmed: no retry will find a token that is not there.
        confirmedFailure: true,
        retiredTokens: [],
      }
    }

    const messages = tokens.map((to) => ({
      to,
      // The school's name, per NOTIFICATIONS.md's example — a parent with children at two schools
      // needs to know which one is telling them something before they open anything.
      title: subject ?? 'ZSMS',
      body: renderedBody,
      sound: 'default' as const,
      /**
       * Where tapping the notification lands, and IDs only.
       *
       * Consistent with the rule that a job payload carries identifiers rather than personal data:
       * a notification payload is stored by the operating system and visible on a lock screen, so
       * the body is the message and the data is navigation.
       */
      data: {
        templateKey: request.templateKey,
        schoolId: request.schoolId,
        studentId: request.studentId ?? null,
      },
    }))

    const retiredTokens: string[] = []
    const ticketIds: string[] = []
    let anyAccepted = false
    let lastError: string | undefined

    for (let i = 0; i < messages.length; i += MAX_PER_REQUEST) {
      const batch = messages.slice(i, i + MAX_PER_REQUEST)

      try {
        const response = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            // Expo compresses responses aggressively; asking for identity keeps the parse simple in
            // a Node worker that has no reason to gzip-decode by hand.
            'Accept-Encoding': 'identity',
          },
          body: JSON.stringify(batch),
        })

        if (!response.ok) {
          lastError = `Expo returned ${response.status}`
          // A 5xx or a rate limit is transient — NOT a confirmed failure, so the queue retries this
          // batch rather than the chain moving on.
          continue
        }

        const payload = (await response.json()) as { data?: ExpoTicket[] }
        const tickets = payload.data ?? []

        tickets.forEach((ticket, index) => {
          const token = batch[index]?.to
          if (ticket.status === 'ok') {
            anyAccepted = true
            if (ticket.id) ticketIds.push(ticket.id)
            return
          }

          lastError = ticket.message ?? ticket.details?.error ?? 'Expo rejected the message'

          /**
           * The one error worth acting on immediately. Everything else — a malformed payload, a rate
           * limit — is ours to fix or to retry; `DeviceNotRegistered` means the app is gone from that
           * handset and no amount of retrying brings it back.
           */
          if (ticket.details?.error === 'DeviceNotRegistered' && token) {
            retiredTokens.push(token)
          }
        })
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error)
      }
    }

    return {
      channel: 'push',
      success: anyAccepted,
      providerMessageId: ticketIds[0],
      error: anyAccepted ? undefined : lastError,
      /**
       * Confirmed only when every token was rejected as unregistered. A network error or a 503 is
       * transient, and marking it confirmed would have the queue give up on a parent because Expo
       * had a bad minute.
       */
      confirmedFailure: !anyAccepted && retiredTokens.length === tokens.length,
      retiredTokens,
    }
  }
}
