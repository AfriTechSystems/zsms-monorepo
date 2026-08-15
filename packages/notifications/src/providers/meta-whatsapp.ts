/**
 * WhatsApp via the Meta Cloud API.
 *
 * THE ONLY FILE PERMITTED TO CALL THE META GRAPH API.
 *
 * Spec: `Official Documentation/03 Infrastructure Services/META_API.md`
 *       `Official Documentation/12 Communication System/WHATSAPP.md`
 */

import type { NotificationChannel, Recipient, SendRequest, SendResult } from '../types'

const GRAPH_VERSION = 'v21.0'

/**
 * Meta rejects a message template that was not pre-approved in its console, so
 * the body we hold in `notification_templates` is for preview and audit; the
 * wire format names the approved template and supplies positional parameters.
 */
export class MetaWhatsAppChannel implements NotificationChannel {
  readonly channel = 'whatsapp' as const
  readonly provider = 'meta' as const

  canReach(recipient: Recipient): boolean {
    return Boolean(recipient.phoneE164)
  }

  async send(request: SendRequest, renderedBody: string): Promise<SendResult> {
    const phoneNumberId = process.env['META_PHONE_NUMBER_ID']
    const token = process.env['META_ACCESS_TOKEN']

    if (!phoneNumberId || !token) {
      return {
        channel: 'whatsapp',
        success: false,
        error: 'META_PHONE_NUMBER_ID or META_ACCESS_TOKEN is not set',
        // Missing configuration is not a delivery failure — falling through to
        // SMS because someone forgot an env var would spend money hiding a
        // deployment mistake.
        confirmedFailure: false,
      }
    }

    if (!request.recipient.phoneE164) {
      return { channel: 'whatsapp', success: false, error: 'No phone number', confirmedFailure: true }
    }

    const metaTemplate = request.variables['__metaTemplateName']
    const body = metaTemplate
      ? {
          messaging_product: 'whatsapp',
          to: request.recipient.phoneE164,
          type: 'template',
          template: {
            name: metaTemplate,
            language: { code: request.languageCode ?? 'en' },
            components: [
              {
                type: 'body',
                parameters: orderedParameters(request.variables).map((v) => ({
                  type: 'text',
                  text: v,
                })),
              },
            ],
          },
        }
      : {
          // Free-form text is only valid inside the 24-hour customer service
          // window. Outside it Meta rejects the send, which is a confirmed
          // failure and correctly moves the chain on to email.
          messaging_product: 'whatsapp',
          to: request.recipient.phoneE164,
          type: 'text',
          text: { body: renderedBody },
        }

    try {
      const response = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      )

      const payload = (await response.json()) as {
        messages?: Array<{ id: string }>
        error?: { message: string; code: number }
      }

      if (!response.ok) {
        // 4xx is the recipient or the message being wrong and will not improve
        // on retry; 5xx and 429 are Meta having a bad moment.
        const permanent = response.status >= 400 && response.status < 500 && response.status !== 429
        return {
          channel: 'whatsapp',
          success: false,
          error: payload.error?.message ?? `Meta returned ${response.status}`,
          confirmedFailure: permanent,
        }
      }

      return {
        channel: 'whatsapp',
        success: true,
        providerMessageId: payload.messages?.[0]?.id,
      }
    } catch (err) {
      return {
        channel: 'whatsapp',
        success: false,
        error: err instanceof Error ? err.message : 'Network error',
        confirmedFailure: false,
      }
    }
  }
}

/**
 * Meta template parameters are POSITIONAL, not named. The order therefore has
 * to match the approved template exactly, so it is taken from the template's
 * declared `variables` array rather than from object key order — which is
 * insertion-dependent and would silently swap a parent's name for an amount.
 */
function orderedParameters(variables: Record<string, string>): string[] {
  const order = variables['__variableOrder']
  if (!order) return []
  return order
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
    .map((k) => variables[k] ?? '')
}
