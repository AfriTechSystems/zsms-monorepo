/**
 * Notification dispatch — the only entry point.
 *
 * Spec: `Official Documentation/12 Communication System/WHATSAPP.md`
 *       `Official Documentation/12 Communication System/TEMPLATES.md`
 *
 * Nothing outside this package imports Meta, Resend, or Twilio. The provider
 * classes are constructed here and nowhere else.
 */

import type {
  Channel,
  FallbackOutcome,
  NotificationChannel,
  SendRequest,
  SendResult,
} from './types'
import { FALLBACK_CHAIN } from './types'
import { MetaWhatsAppChannel } from './providers/meta-whatsapp'
import { ResendEmailChannel } from './providers/resend-email'
import { TwilioSmsChannel } from './providers/twilio-sms'
import { MockChannel } from './providers/mock'

/**
 * Resolves a template and consumes quota. Supplied by the caller so this
 * package never opens a database connection of its own — the worker already
 * holds one, and a second would be a second thing to configure and leak.
 */
export interface DispatchContext {
  resolveTemplate(input: {
    schoolId: string | null
    templateKey: string
    channel: Channel
    languageCode: string
  }): Promise<{ subject?: string; body: string; metaTemplateName?: string; variableOrder: string[] } | null>

  consumeQuota(input: {
    schoolId: string
    channel: Channel
  }): Promise<{ allowed: boolean; reason: string }>

  recordDispatch(input: {
    schoolId: string | null
    channel: Channel
    templateKey: string
    recipientPhone?: string
    recipientEmail?: string
    recipientUserId?: string
    studentId?: string | null
    status: string
    variables: Record<string, string>
    isFallback: boolean
    fallbackOfId?: string
    consumedQuota: boolean
  }): Promise<string>

  updateDispatch(input: {
    messageLogId: string
    status: string
    providerMessageId?: string
    failureReason?: string
  }): Promise<void>
}

function useMock(): boolean {
  const configured = process.env['NOTIFICATION_PROVIDER']?.trim().toLowerCase()
  if (configured === 'mock') return true
  if (configured === 'live') return false
  // Default to mock unless explicitly set live. zsms-dev holds synthetic data,
  // and a fixture parent's phone number is still somebody's phone number.
  return process.env['NODE_ENV'] !== 'production'
}

export function getChannel(channel: Channel): NotificationChannel {
  if (useMock()) return new MockChannel(channel)

  switch (channel) {
    case 'whatsapp':
      return new MetaWhatsAppChannel()
    case 'email':
      return new ResendEmailChannel()
    case 'sms':
      return new TwilioSmsChannel()
    default:
      throw new Error(
        `Channel "${channel}" has no provider. Push and in-app are surfaces, not dispatch channels.`,
      )
  }
}

/** Substitutes {{placeholders}}. Unknown placeholders are left visible rather
 *  than silently blanked — a parent seeing "{{amount}}" is a bug report; a
 *  parent seeing "" is a mystery. */
export function renderTemplate(body: string, variables: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key]! : match,
  )
}

/**
 * Sends down the fallback chain until one channel succeeds.
 *
 * The chain advances ONLY on a confirmed failure. A timeout or a 5xx leaves the
 * attempt failed but does not advance — the queue retries the same channel
 * instead. Advancing on a transient error would send every parent a duplicate
 * over SMS during a Meta outage, at the school's expense.
 */
export async function sendWithFallback(
  request: SendRequest,
  ctx: DispatchContext,
  chain: readonly Channel[] = FALLBACK_CHAIN,
): Promise<FallbackOutcome> {
  const attempts: SendResult[] = []
  const messageLogIds: string[] = []
  let previousLogId: string | undefined

  for (const channel of chain) {
    const impl = getChannel(channel)

    if (!impl.canReach(request.recipient)) {
      attempts.push({
        channel,
        success: false,
        error: 'Recipient has no address for this channel',
        confirmedFailure: true,
      })
      continue
    }

    const template = await ctx.resolveTemplate({
      schoolId: request.schoolId,
      templateKey: request.templateKey,
      channel,
      languageCode: request.languageCode ?? 'en',
    })

    if (!template) {
      // No wording configured for this channel. Not a delivery failure — skip
      // to the next rather than sending an empty message.
      attempts.push({
        channel,
        success: false,
        error: `No template for ${request.templateKey} on ${channel}`,
        confirmedFailure: true,
      })
      continue
    }

    // Quota is checked per channel, and only WhatsApp is metered. Checking it
    // before the send — not after — is what makes the ceiling real.
    let consumedQuota = false
    if (request.schoolId) {
      const quota = await ctx.consumeQuota({ schoolId: request.schoolId, channel })
      if (!quota.allowed) {
        const logId = await ctx.recordDispatch({
          schoolId: request.schoolId,
          channel,
          templateKey: request.templateKey,
          recipientPhone: request.recipient.phoneE164,
          recipientEmail: request.recipient.email,
          recipientUserId: request.recipient.userId,
          studentId: request.studentId ?? null,
          status: 'quota_exceeded',
          variables: request.variables,
          isFallback: Boolean(previousLogId),
          fallbackOfId: previousLogId,
          consumedQuota: false,
        })
        messageLogIds.push(logId)
        attempts.push({
          channel,
          success: false,
          error: quota.reason,
          // A quota ceiling is a confirmed refusal for THIS channel, so the
          // chain moves on to email — which is the behaviour a school expects
          // when its WhatsApp allowance runs out mid-month.
          confirmedFailure: true,
        })
        previousLogId = logId
        continue
      }
      consumedQuota = quota.reason === 'ok' || quota.reason === 'unlimited'
    }

    const rendered = renderTemplate(template.body, request.variables)
    const subject = template.subject ? renderTemplate(template.subject, request.variables) : undefined

    const logId = await ctx.recordDispatch({
      schoolId: request.schoolId,
      channel,
      templateKey: request.templateKey,
      recipientPhone: request.recipient.phoneE164,
      recipientEmail: request.recipient.email,
      recipientUserId: request.recipient.userId,
      studentId: request.studentId ?? null,
      status: 'queued',
      variables: request.variables,
      isFallback: Boolean(previousLogId),
      fallbackOfId: previousLogId,
      consumedQuota,
    })
    messageLogIds.push(logId)

    const result = await impl.send(
      {
        ...request,
        variables: {
          ...request.variables,
          ...(template.metaTemplateName ? { __metaTemplateName: template.metaTemplateName } : {}),
          __variableOrder: template.variableOrder.join(','),
        },
      },
      rendered,
      subject,
    )
    attempts.push(result)

    await ctx.updateDispatch({
      messageLogId: logId,
      status: result.success ? 'sent' : 'failed',
      providerMessageId: result.providerMessageId,
      failureReason: result.error,
    })

    if (result.success) {
      return { deliveredVia: channel, attempts, messageLogIds }
    }

    previousLogId = logId

    if (!result.confirmedFailure) {
      // Transient. Stop here and let the queue retry this channel rather than
      // burning the chain on a blip.
      break
    }
  }

  return { deliveredVia: null, attempts, messageLogIds }
}

export { FALLBACK_CHAIN, CHANNELS } from './types'
export type {
  Channel,
  Recipient,
  SendRequest,
  SendResult,
  FallbackOutcome,
  NotificationChannel,
  ProviderName,
} from './types'
export { mockSentMessages, resetMockMessages } from './providers/mock'

export { renderBrandedEmail, type BrandedEmail, type EmailBranding } from './email-shell'
