// ─────────────────────────────────────────────────────────────────────────────
// CAPI auto-fire on order paid.
//
// Study §14.4: "closing the attribution loop with CAPI is the highest-impact
// improvement reported in 2026" for WhatsApp attribution.
//
// When a payment webhook transitions an Order's `paymentStatus` to `paid`,
// the `applyPaymentUpdate` helper (see `payment-webhook-utils.ts`) calls
// this module to enqueue a `Purchase` ConversionEvent per active PixelConfig
// of the tenant. The existing `capi-fire` BullMQ worker (see `queue.ts`)
// then POSTs to Meta / GA4 / TikTok.
//
// Closed-loop attribution is achieved by passing the order's `clickId`
// (CTWA click_id captured by the WA webhook) in the event payload — Meta
// uses it to tie the conversion back to the originating ad.
//
// SPRINT-WHATSAPP-FUNCTIONAL-001
// ─────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'
import { enqueue } from '@/lib/queue'

const log = getLogger('capi-auto-fire')

/**
 * SHA-256 hash of a PII value (lowercased + trimmed) for deduplication +
 * privacy-safe forwarding to ad platforms. Matches Meta's CAPI PII hashing
 * spec: hex-encoded lowercase SHA-256.
 */
export function hashPii(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value.toLowerCase().trim())
    .digest('hex')
}

/**
 * Enqueue a `Purchase` ConversionEvent for every active PixelConfig of the
 * tenant. The actual platform POST (Meta / GA4 / TikTok) is performed by
 * the `capi-fire` worker — this function only persists the rows + enqueues
 * the job. Best-effort: failures are logged but never propagated to the
 * caller (the payment webhook must still ACK 200 to stop gateway retries).
 *
 * Idempotency: callers guard with `wasAlreadyPaid` so this only fires on
 * the webhook that actually transitions the order to `paid`. Even if a
 * duplicate fire happens, Meta dedupes on `event_id` (we use
 * `order-<id>-<platform>`) — the CAPI payload includes it as the JSON
 * metadata stored in `ConversionEvent.response`. The worker currently
 * does not forward `event_id` to Meta (TODO) but the dedup key is
 * persisted for future use.
 */
export async function fireCapiPurchaseEvent(
  orderId: string,
  tenantId: string,
): Promise<void> {
  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        customer: true,
      },
    })
    if (!order) {
      log.warn({ orderId, tenantId }, 'CAPI auto-fire: order not found')
      return
    }

    // Only fire for actual monetary orders (> 0). Free / $0 orders are
    // typically test data — firing CAPI for them pollutes ad platform
    // reporting.
    if (!order.total || order.total <= 0) {
      log.info({ orderId, total: order.total }, 'CAPI auto-fire: skipping $0 order')
      return
    }

    const pixels = await db.pixelConfig.findMany({
      where: { tenantId, active: true },
    })

    if (pixels.length === 0) {
      log.info({ orderId, tenantId }, 'CAPI auto-fire: no active pixels — skipping')
      return
    }

    // Privacy-safe PII hashing for deduplication. The Meta CAPI spec wants
    // these as SHA-256 hashes; we store them in the `response` JSON column
    // of ConversionEvent so the worker can forward them when the payload
    // supports it (TODO: extend `fireMeta` to include `user_data`).
    const customerEmailHash = order.customer?.email
      ? hashPii(order.customer.email)
      : null
    const customerPhoneHash = order.customer?.phone
      ? hashPii(order.customer.phone)
      : null

    // Pre-create one ConversionEvent row per pixel in 'pending' state.
    // The queue worker updates each row with the platform's response.
    // The `response` field stores attribution metadata as JSON — this
    // keeps the schema stable (no new columns needed) while still
    // persisting click_id + hashed PII for downstream dedup.
    const created = await Promise.all(
      pixels.map((pixel) =>
        db.conversionEvent.create({
          data: {
            tenantId,
            pixelConfigId: pixel.id,
            eventType: 'Purchase',
            value: order.total,
            currency: order.currency || 'COP',
            status: 'pending',
            response: JSON.stringify({
              orderId: order.id,
              orderNumber: order.number,
              eventId: `order-${order.id}-${pixel.platform}`,
              clickId: order.clickId ?? null,
              sourceAdId: order.sourceAdId ?? null,
              sourceCampaign: order.sourceCampaign ?? null,
              sourcePlatform: order.sourcePlatform ?? null,
              customerEmailHash,
              customerPhoneHash,
              itemCount: order.items.length,
              origin: 'payment-webhook-auto-fire',
            }),
          },
        }),
      ),
    )

    // Enqueue the actual firing. In dev (no REDIS_URL) the job runs inline
    // and the rows are updated by the time `enqueue` returns. In prod
    // (BullMQ), the rows stay 'pending' until the worker picks them up.
    await enqueue('capi-fire', {
      tenantId,
      eventType: 'Purchase',
      value: order.total,
      currency: order.currency || 'COP',
      pixels: pixels.map((p) => ({
        id: p.id,
        platform: p.platform,
        pixelId: p.pixelId,
        apiToken: p.apiToken,
        testMode: p.testMode,
      })),
      eventIds: created.map((e) => e.id),
    })

    log.info(
      {
        orderId: order.id,
        orderNumber: order.number,
        tenantId,
        pixelCount: pixels.length,
        clickId: order.clickId ?? null,
        total: order.total,
        currency: order.currency,
      },
      'CAPI Purchase event enqueued (auto-fire on paid)',
    )
  } catch (err) {
    // Best-effort — capture + log but never propagate. The payment webhook
    // must still ACK 200 to stop gateway retries. A failed CAPI fire is
    // visible in the ConversionEvent table (rows stay 'pending' or never
    // get created) and can be replayed from the orders view.
    captureError(err as Error, {
      action: 'capi-auto-fire',
      orderId,
      tenantId,
    })
    log.error(
      { orderId, tenantId, err: err instanceof Error ? err.message : String(err) },
      'CAPI auto-fire failed (non-blocking)',
    )
  }
}
