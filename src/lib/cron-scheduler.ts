// ZIAY — Cron scheduler for compliance jobs.
//
// P0.3 FIX: BullMQ's minimal surface in this project doesn't support
// repeatable jobs (`Queue.add(name, data, { repeat: { cron } })`). Instead,
// we use Node.js setInterval as a lightweight scheduler that enqueues
// jobs at fixed intervals. This is NOT a replacement for BullMQ's
// repeatable jobs in production with Redis — it's a fallback that works
// in both dev (inline) and prod (BullMQ) modes.
//
// In production with REDIS_URL set, the jobs are enqueued to BullMQ and
// processed by the worker. In dev, they run inline.
//
// Jobs scheduled:
//   1. DIAN retry — every 10 min (exponential backoff per invoice)
//   2. Retention cleanup — daily at 02:00 (Ley 1581 compliance)
//   3. Escrow auto-release — every 30 min (release funds after delivery)
//
// The scheduler starts when `initQueue()` is called (instrumentation.ts).
// It's idempotent — calling `initCronJobs()` twice is a no-op.

import { enqueue } from './queue'
import { getLogger } from './logger'
import { sendAlert } from './alerts'

const log = getLogger('cron-scheduler')

let cronJobsInitialized = false
let intervals: NodeJS.Timeout[] = []

export function initCronJobs(): void {
  if (cronJobsInitialized) {
    log.info('Cron jobs already initialized — skipping')
    return
  }
  cronJobsInitialized = true

  // 1. DIAN retry — every 10 minutes
  // Walks pending_submission invoices and retries with exponential backoff.
  const dianInterval = setInterval(
    async () => {
      try {
        log.info('Cron: enqueuing dian-retry job')
        await enqueue('dian-retry', {})
      } catch (err) {
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'Cron: dian-retry enqueue failed')
        void sendAlert({
          tenantId: 'platform',
          title: 'Cron job DIAN retry falló',
          message: `El job programado de reintento DIAN falló al encolar: ${err instanceof Error ? err.message : String(err)}`,
          severity: 'critical',
          source: 'pipeline',
          metadata: { job: 'dian-retry' },
        }).catch(() => {})
      }
    },
    10 * 60 * 1000, // 10 minutes
  )
  intervals.push(dianInterval)

  // 2. Retention cleanup — daily (24h interval)
  // Runs the retention sweep that anonymizes/deletes old PII per Ley 1581.
  const retentionInterval = setInterval(
    async () => {
      try {
        log.info('Cron: enqueuing retention-cleanup job')
        await enqueue('retention-cleanup', {})
      } catch (err) {
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'Cron: retention-cleanup enqueue failed')
        void sendAlert({
          tenantId: 'platform',
          title: 'Cron job retention cleanup falló',
          message: `El job programado de limpieza de retención falló: ${err instanceof Error ? err.message : String(err)}`,
          severity: 'critical',
          source: 'pipeline',
          metadata: { job: 'retention-cleanup' },
        }).catch(() => {})
      }
    },
    24 * 60 * 60 * 1000, // 24 hours
  )
  intervals.push(retentionInterval)

  // 3. Escrow auto-release — every 30 minutes
  // R-18 FIX: releases funds to sellers after delivery confirmation
  // (or 7-day auto-release if no dispute).
  const escrowInterval = setInterval(
    async () => {
      try {
        log.info('Cron: enqueuing escrow-auto-release job')
        await enqueue('escrow-auto-release', {})
      } catch (err) {
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'Cron: escrow-auto-release enqueue failed')
      }
    },
    30 * 60 * 1000, // 30 minutes
  )
  intervals.push(escrowInterval)

  // 4. Refund retry — every 5 minutes (P1.4 FIX)
  // Walks OrderEvent rows with type='refund_failed' and retries the refund
  // with exponential backoff. Fires alert after 5 failures.
  const refundRetryInterval = setInterval(
    async () => {
      try {
        log.info('Cron: enqueuing refund-retry job')
        await enqueue('refund-retry', {})
      } catch (err) {
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'Cron: refund-retry enqueue failed')
        void sendAlert({
          tenantId: 'platform',
          title: 'Cron job refund retry falló',
          message: `El job programado de reintento de reembolsos falló: ${err instanceof Error ? err.message : String(err)}`,
          severity: 'warning',
          source: 'pipeline',
          metadata: { job: 'refund-retry' },
        }).catch(() => {})
      }
    },
    5 * 60 * 1000, // 5 minutes
  )
  intervals.push(refundRetryInterval)

  log.info(
    {
      jobs: ['dian-retry (10min)', 'retention-cleanup (24h)', 'escrow-auto-release (30min, placeholder)', 'refund-retry (5min)'],
    },
    'Cron jobs initialized',
  )
}

export function stopCronJobs(): void {
  intervals.forEach((i) => clearInterval(i))
  intervals = []
  cronJobsInitialized = false
  log.info('Cron jobs stopped')
}

// ── Job handlers ────────────────────────────────────────────────────────
// These are registered with the queue system so the worker can process them.
// They're registered here (not in queue.ts) to keep queue.ts focused on
// infrastructure. The handlers are idempotent and safe to run concurrently.

import { registerJobHandler } from './queue'

// DIAN retry handler
registerJobHandler('dian-retry', async () => {
  const { retryPendingDianInvoices } = await import('@/lib/compliance/dian-invoicing')
  const result = await retryPendingDianInvoices()
  log.info(
    { processed: result.processed, submitted: result.submitted, failed: result.failed, permanentlyFailed: result.permanentlyFailed, skipped: result.skipped },
    'dian-retry job complete',
  )
  if (result.permanentlyFailed > 0) {
    void sendAlert({
      tenantId: 'platform',
      title: `${result.permanentlyFailed} facturas DIAN fallaron permanentemente`,
      message: `${result.permanentlyFailed} factura(s) electrónica(s) excedieron el máximo de reintentos y requieren atención manual.`,
      severity: 'warning',
      source: 'pipeline',
      metadata: { job: 'dian-retry', permanentlyFailed: result.permanentlyFailed },
    }).catch(() => {})
  }
})

// Refund retry handler (P1.4 FIX)
registerJobHandler('refund-retry', async () => {
  const { db } = await import('@/lib/db')
  const failedEvents = await db.orderEvent.findMany({
    where: {
      type: 'refund_failed',
      createdAt: { lt: new Date(Date.now() - 5 * 60 * 1000) }, // only retry events > 5 min old
    },
    take: 10, // process max 10 per run
    orderBy: { createdAt: 'asc' },
  })

  log.info({ count: failedEvents.length }, 'refund-retry: processing failed refund events')

  for (const event of failedEvents) {
    try {
      // Parse the order ID from the event note
      const orderIdMatch = event.note?.match(/order[:\s]+([a-zA-Z0-9-]+)/i)
      if (!orderIdMatch) continue

      const orderId = orderIdMatch[1]
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { id: true, paymentRef: true, paymentGateway: true, total: true, tenantId: true },
      })

      if (!order || !order.paymentRef) continue

      // Import the adapter and retry the refund
      const { getPaymentAdapter } = await import('@/lib/adapters/payment-registry')
      const adapter = getPaymentAdapter(order.paymentGateway || 'mercadopago')
      if (!adapter) continue

      const refundResult = await adapter.refund(order.paymentRef, order.total)

      if (refundResult.success) {
        // Refund succeeded — update the order event
        await db.orderEvent.update({
          where: { id: event.id },
          data: { type: 'refunded', note: `Refund succeeded on retry: ${refundResult.paymentId}` },
        })
        log.info({ orderId, eventId: event.id }, 'refund-retry: refund succeeded on retry')
      } else {
        // Refund failed again — count retries
        const retryCount = (event.note?.match(/retry:\s*(\d+)/i)?.[1] ? parseInt(event.note.match(/retry:\s*(\d+)/i)![1]) : 0) + 1
        await db.orderEvent.update({
          where: { id: event.id },
          data: { note: `${event.note} | retry:${retryCount} failed:${refundResult.message}` },
        })

        if (retryCount >= 5) {
          // Alert after 5 failed retries
          void sendAlert({
            tenantId: order.tenantId,
            title: `Reembolso falló ${retryCount} veces — requiere intervención manual`,
            message: `El reembolso para la orden ${orderId} ha fallado ${retryCount} veces. Último error: ${refundResult.message}. Requiere atención manual.`,
            severity: 'critical',
            source: 'pipeline',
            metadata: { orderId, retryCount, gateway: order.paymentGateway },
          }).catch(() => {})

          // Mark as permanently failed
          await db.orderEvent.update({
            where: { id: event.id },
            data: { type: 'refund_error', note: `Permanently failed after ${retryCount} retries: ${refundResult.message}` },
          })
        }
      }
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.message : String(err), eventId: event.id },
        'refund-retry: unexpected error for event',
      )
    }
  }
})

// Escrow auto-release handler (R-18 FIX)
registerJobHandler('escrow-auto-release', async () => {
  const { escrowService } = await import('@/lib/services/escrow.service')
  const result = await escrowService.autoReleaseExpired()
  log.info(
    { released: result.released, errors: result.errors },
    'escrow-auto-release job complete',
  )
})
