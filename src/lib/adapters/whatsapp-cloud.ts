// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Cloud API adapter — message sending.
//
// Study §13.1: Cloud API (not BSP) for message delivery. Sends text /
// template / image / interactive / location messages via Meta Graph API
// `POST /{phoneNumberId}/messages`. Inbound messages arrive via the
// `/api/webhooks/whatsapp` route and are parsed by `whatsapp-parser.ts`.
//
// SPRINT-WHATSAPP-FUNCTIONAL-001
// ─────────────────────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'

const WA_API_BASE =
  process.env.WHATSAPP_CLOUD_API_BASE ?? 'https://graph.facebook.com/v18.0'

/** Timeout for the outbound HTTP call to Meta. 10s matches the catalog adapter. */
const HTTP_TIMEOUT_MS = 10_000

export interface WhatsAppText {
  body: string
  /** Show URL preview in WhatsApp chat. Defaults to false. */
  preview_url?: boolean
}

export interface WhatsAppTemplate {
  name: string
  language: { code: string }
  components?: unknown[]
}

export interface WhatsAppImage {
  /** Media ID (uploaded previously to Meta). Mutually exclusive with `link`. */
  id?: string
  /** Public HTTPS URL Meta will fetch. Mutually exclusive with `id`. */
  link?: string
  caption?: string
}

export interface WhatsAppInteractive {
  type: 'button' | 'list'
  body: { text: string }
  /** Meta's `action` object — buttons / list sections. Opaque here. */
  action: unknown
}

export interface WhatsAppLocation {
  longitude: number
  latitude: number
  name?: string
  address?: string
}

export interface WhatsAppMessage {
  /** E.164 format without `+`: `'573001112233'`. */
  to: string
  type: 'text' | 'template' | 'image' | 'interactive' | 'location'
  text?: WhatsAppText
  template?: WhatsAppTemplate
  image?: WhatsAppImage
  interactive?: WhatsAppInteractive
  location?: WhatsAppLocation
}

export interface WhatsAppSendResult {
  /** Meta message ID (e.g. `wamid.HBgL...==`). Empty when Meta did not echo one. */
  messageId: string
  /** Always `'sent'` on 2xx — Meta does not give us delivery status synchronously. */
  status: string
}

/**
 * Thin Cloud API client. One instance per Channel — credentials are loaded
 * from the `Channel` record by the `getWhatsAppAdapter` factory below.
 *
 * Errors are thrown on non-2xx responses; callers (typically the
 * conversation service) wrap them in try/catch and surface a Spanish
 * error message to the user.
 */
export class WhatsAppCloudAdapter {
  private readonly phoneNumberId: string
  private readonly accessToken: string

  constructor(phoneNumberId: string, accessToken: string) {
    this.phoneNumberId = phoneNumberId
    this.accessToken = accessToken
  }

  /**
   * Send a message via `POST /{phoneNumberId}/messages`.
   *
   * Throws on:
   *   - Missing credentials (caller should check `isConfigured()` first)
   *   - Non-2xx response (with the raw Meta error body for diagnostics)
   *   - Network timeout (10s `AbortSignal.timeout`)
   */
  async sendMessage(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    if (!this.accessToken || !this.phoneNumberId) {
      throw new Error(
        'WhatsApp Cloud API no configurado: falta phoneNumberId o accessToken',
      )
    }

    const url = `${WA_API_BASE}/${this.phoneNumberId}/messages`
    // Meta requires `messaging_product: 'whatsapp'` on every send. The
    // `recipient_type: 'individual'` is the default but we set it
    // explicitly so the payload is self-documenting.
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: message.to,
      type: message.type,
      text: message.text,
      template: message.template,
      image: message.image,
      interactive: message.interactive,
      location: message.location,
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      logger.error(
        { status: res.status, errText: errText.slice(0, 500), to: message.to, type: message.type },
        'WhatsApp Cloud API send failed',
      )
      throw new Error(`WhatsApp API error ${res.status}: ${errText.slice(0, 300)}`)
    }

    const data = await res.json().catch(() => ({}))
    return {
      messageId: data?.messages?.[0]?.id || '',
      status: 'sent',
    }
  }

  /** Convenience wrapper for the common case — plain text outbound. */
  async sendText(to: string, text: string): Promise<WhatsAppSendResult> {
    return this.sendMessage({ to, type: 'text', text: { body: text } })
  }

  /**
   * Mark an inbound message as read. Best-effort — Meta does not surface a
   * synchronous delivery receipt for this call and failures here should
   * never block the main webhook flow. Callers should `catch` and swallow.
   *
   * Per Meta docs the body shape is:
   *   { messaging_product: 'whatsapp', status: 'read', message_id: '<id>' }
   */
  async markMessageRead(messageId: string): Promise<void> {
    if (!this.accessToken || !this.phoneNumberId || !messageId) return
    const url = `${WA_API_BASE}/${this.phoneNumberId}/messages`
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      })
    } catch (err) {
      logger.warn(
        { messageId, err: err instanceof Error ? err.message : String(err) },
        'WhatsApp markMessageRead failed (non-blocking)',
      )
    }
  }

  /** True when both phoneNumberId and accessToken are present. */
  isConfigured(): boolean {
    return !!(this.phoneNumberId && this.accessToken)
  }
}

/**
 * Factory: load Cloud API credentials from the tenant's active WhatsApp
 * `Channel` record. Returns `null` when the tenant has no configured
 * WhatsApp channel — callers should fall back to a stub / log-only path
 * in that case (e.g. demo tenants).
 *
 * The `db` import is lazy so this module can be imported from edge /
 * client bundles without dragging Prisma in.
 */
export async function getWhatsAppAdapter(
  tenantId: string,
): Promise<WhatsAppCloudAdapter | null> {
  const { db } = await import('@/lib/db')
  const channel = await db.channel.findFirst({
    where: { tenantId, type: 'whatsapp', active: true },
  })
  if (!channel?.phoneNumberId || !channel?.whatsappToken) return null
  return new WhatsAppCloudAdapter(channel.phoneNumberId, channel.whatsappToken)
}

/**
 * Reverse lookup: find the tenant's WhatsApp channel by the
 * `phone_number_id` Meta echoes in inbound webhook payloads
 * (`entry[].changes[].value.metadata.phone_number_id`). Used by the
 * webhook route to resolve which tenant owns an inbound message.
 *
 * Returns the channel row (with `tenantId`) or `null` when no channel
 * matches — callers should fall back to the env-var phoneNumberId or
 * 4xx the webhook.
 */
export async function findWhatsAppChannelByPhoneNumberId(
  phoneNumberId: string,
): Promise<{ id: string; tenantId: string } | null> {
  if (!phoneNumberId) return null
  const { db } = await import('@/lib/db')
  const channel = await db.channel.findFirst({
    where: { type: 'whatsapp', active: true, phoneNumberId },
    select: { id: true, tenantId: true },
  })
  return channel ?? null
}
