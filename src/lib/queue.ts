// ZIAY — Job Queue
//
// SPRINT6-SCALE-001
//
// Uses BullMQ if REDIS_URL is set, otherwise runs inline (dev mode).
// In production, workers process jobs asynchronously (CAPI, sync, seed,
// notifications) so the request thread returns immediately and the work
// happens out-of-band.
//
// In dev (no REDIS_URL) `enqueue()` runs the registered handler synchronously
// inside the same `await`. This means:
//   - Callers see the final side-effects (DB rows updated, audit log written)
//     by the time `enqueue()` returns — so response shapes don't break.
//   - There's no extra infrastructure to set up for local development.
//
// The dynamic `import('bullmq')` uses a NON-literal module specifier so `tsc`
// does NOT try to resolve its type declarations. That means `bullmq` (and
// `@socket.io/redis-adapter`) can be installed only in production — the type
// check still passes with them absent in dev. The same trick is used in
// `src/lib/redis.ts` for `ioredis`.

import { getLogger } from './logger'
import { db } from './db'
import { captureError } from './capture-error'
import { getEcommerceAdapter } from './adapters/registry'

const log = getLogger('queue')

interface JobData {
  type: string
  payload: Record<string, unknown>
}

type JobHandler = (data: JobData['payload']) => Promise<void>

// Minimal structural types for BullMQ — the package is an optional prod-only
// dep (see header comment), so we type only the surface area we use. Same
// pattern as `RedisLike` in `src/lib/redis.ts`.
interface BullMQJob {
  id?: string
  data: JobData
}

interface BullMQQueue {
  add(name: string, data: JobData): Promise<unknown>
  close(): Promise<unknown>
}

interface BullMQWorker {
  on(event: 'completed', listener: (job: BullMQJob) => void): this
  on(event: 'failed', listener: (job: BullMQJob | undefined, err: Error) => void): this
  on(event: string, listener: (...args: unknown[]) => void): this
  close(): Promise<unknown>
}

interface BullMQModule {
  Queue: new (name: string, opts: { connection: { url: string } }) => BullMQQueue
  Worker: new (
    name: string,
    processor: (job: BullMQJob) => Promise<void>,
    opts: { connection: { url: string }; concurrency: number },
  ) => BullMQWorker
}

const handlers = new Map<string, JobHandler>()
// `null` while BullMQ is not yet initialised or unavailable in this env.
let bullmqQueue: BullMQQueue | null = null
let bullmqWorker: BullMQWorker | null = null
let inlineMode = true // flips to false only when BullMQ successfully starts

// Promise singleton — `enqueue()` calls `initQueue()` on its first invocation
// so the queue wires itself up without requiring changes to `instrumentation.ts`.
// Concurrent `enqueue()` calls share the same init promise so BullMQ is only
// constructed once. After the promise resolves, `enqueue()` skips the await
// entirely (resolved promise → microtask hop is negligible).
let initPromise: Promise<void> | null = null

/**
 * Returns `true` when the queue is running in inline (synchronous) mode.
 * Routes can use this to decide whether to read back the result of a job
 * immediately (inline) or return a "queued" ack (BullMQ).
 */
export function isInlineMode(): boolean {
  return inlineMode
}

/**
 * Initialise the queue. Safe to call multiple times — only the first call
 * actually does work; subsequent calls return the same promise. In dev (no
 * REDIS_URL) this is essentially a no-op and the queue stays in inline mode.
 *
 * `enqueue()` calls this lazily on first invocation, so wiring it into
 * `instrumentation.ts` is OPTIONAL — but doing so moves the BullMQ connect
 * cost out of the first request and into boot.
 */
export function initQueue(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = doInitQueue().catch((err) => {
    // If init throws, clear the singleton so the next call can retry.
    initPromise = null
    throw err
  })
  return initPromise
}

async function doInitQueue(): Promise<void> {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    log.info('Queue: no REDIS_URL — running inline mode (dev)')
    return
  }

  try {
    // Non-literal specifier → tsc does NOT resolve types for bullmq.
    const moduleName = 'bullmq' as string
    const { Queue, Worker } = (await import(moduleName)) as BullMQModule
    const connection = { url: redisUrl }

    bullmqQueue = new Queue('ziay-jobs', { connection })

    bullmqWorker = new Worker(
      'ziay-jobs',
      async (job: BullMQJob) => {
        const handler = handlers.get(job.data.type)
        if (handler) {
          log.info({ jobType: job.data.type, jobId: job.id }, 'Processing job')
          await handler(job.data.payload)
        } else {
          log.warn({ jobType: job.data.type, jobId: job.id }, 'No handler registered for job type')
        }
      },
      { connection, concurrency: 3 },
    )

    bullmqWorker.on('completed', (job: BullMQJob) => {
      log.info({ jobId: job.id, jobType: job.data.type }, 'Job completed')
    })
    bullmqWorker.on('failed', (job: BullMQJob | undefined, err: Error) => {
      log.error({ jobId: job?.id, jobType: job?.data?.type, err: err.message }, 'Job failed')
    })

    inlineMode = false
    log.info('Queue: BullMQ initialized with Redis — async mode')
  } catch (err) {
    log.warn(
      { err: (err as Error).message },
      'Queue: BullMQ not available — falling back to inline mode',
    )
    // Stay in inline mode — `bullmqQueue` stays null, `enqueue()` runs handlers directly.
  }
}

/**
 * Register a handler for a job type. The handler runs in the worker process
 * (BullMQ mode) or inline (dev mode). Re-registering the same type replaces
 * the previous handler.
 */
export function registerJobHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler)
  log.info({ jobType: type }, 'Job handler registered')
}

/**
 * Enqueue a job. In BullMQ mode the job is added to the Redis-backed queue
 * and processed asynchronously by a worker. In inline mode the registered
 * handler is awaited directly inside this call.
 *
 * Returns when:
 *   - BullMQ mode: the job has been added to the queue (NOT when it finishes)
 *   - Inline mode: the handler has finished (success or failure)
 */
export async function enqueue(
  type: string,
  payload: JobData['payload'] = {},
): Promise<void> {
  // Lazy init on first enqueue — picks up BullMQ automatically when
  // REDIS_URL is set, without requiring `initQueue()` to be wired into
  // instrumentation.ts. After the first call this is a resolved-promise
  // await (essentially free).
  await initQueue()

  if (bullmqQueue) {
    await bullmqQueue.add(type, { type, payload })
    log.info({ jobType: type }, 'Job enqueued to BullMQ')
    return
  }
  // Inline mode — run immediately so callers see the side-effects.
  const handler = handlers.get(type)
  if (!handler) {
    log.warn({ jobType: type }, 'Inline enqueue — no handler registered')
    return
  }
  try {
    await handler(payload)
  } catch (err) {
    // Capture but do NOT re-throw — a job failure must not crash the request
    // that enqueued it. Mirrors BullMQ's "failed" event behaviour.
    log.error({ jobType: type, err: (err as Error).message }, 'Inline job failed')
    captureError(err, { action: 'queue:inline', jobType: type })
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Default job handlers
//
// These are registered at module load so any process that imports the queue
// (API routes, the worker entrypoint, instrumentation) gets them for free.
//
// Add new job types by calling `registerJobHandler('your-type', fn)` from
// wherever makes sense (the function is idempotent).
// ───────────────────────────────────────────────────────────────────────────

// ── capi-fire ──────────────────────────────────────────────────────────────
// Fires a conversion event to each active PixelConfig of a tenant. The route
// handler pre-creates one `ConversionEvent` row per pixel in 'pending' state
// and passes the IDs in — this handler just updates each row with the
// platform's response. Decoupling like this means the route can return
// immediately in BullMQ mode and the firing happens out-of-band.
registerJobHandler('capi-fire', async (payload) => {
  const { tenantId, eventType, value, currency, pixels, eventIds } = (payload || {}) as {
    tenantId: string
    eventType: string
    value: number | null
    currency: string
    pixels: CapiPixel[]
    eventIds: string[]
  }

  if (!pixels || !eventIds || pixels.length !== eventIds.length) {
    log.error(
      { tenantId, eventType, pixelsLen: pixels?.length, eventIdsLen: eventIds?.length },
      'capi-fire: malformed payload — skipping',
    )
    return
  }

  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i]
    const eventId = eventIds[i]

    // SPRINT-BACKEND-FINAL-001 — fetch the ConversionEvent row to extract
    // the deduplication `event_id` stored in its `response` JSON (set by
    // `fireCapiPurchaseEvent` as `order-<id>-<platform>`). Forwarding
    // `event_id` to Meta lets the platform dedupe CAPI events against
    // pixel-fired (browser) events that share the same id — closing the
    // attribution loop without double-counting. Best-effort: if the row
    // can't be loaded (already deleted, JSON malformed, …) we still fire
    // without an event_id — Meta will dedupe on (event_name, event_time,
    // user_data) hash instead, slightly less reliable but non-blocking.
    let dedupEventId: string | undefined
    let existingMeta: Record<string, unknown> = {}
    try {
      const row = await db.conversionEvent.findUnique({
        where: { id: eventId },
        select: { response: true },
      })
      if (row?.response) {
        try {
          const parsed = JSON.parse(row.response)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            existingMeta = parsed as Record<string, unknown>
            const maybeEventId = existingMeta.eventId
            if (typeof maybeEventId === 'string' && maybeEventId.length > 0) {
              dedupEventId = maybeEventId
            }
          }
        } catch {
          // malformed JSON in `response` — fall back to no event_id.
        }
      }
    } catch (loadErr) {
      captureError(loadErr, {
        action: 'capi-fire:load-event',
        eventId,
        pixelConfigId: pixel.id,
      })
    }

    const result = await fireCapiPlatform(pixel, {
      eventType,
      value,
      currency,
      eventId: dedupEventId,
    })
    try {
      // SPRINT-BACKEND-FINAL-001 — preserve the original metadata
      // (orderId, eventId, clickId, hashed PII, …) by merging the
      // platform response into the existing JSON rather than
      // overwriting it. That way a replay (re-enqueued capi-fire job)
      // can still extract the dedup event_id + the attribution context.
      const mergedResponse = JSON.stringify({
        ...existingMeta,
        platformStatus: result.status,
        platformResponse: result.response,
      })
      await db.conversionEvent.update({
        where: { id: eventId },
        data: { status: result.status, response: mergedResponse },
      })
    } catch (err) {
      captureError(err, {
        action: 'capi-fire:persist',
        eventId,
        pixelConfigId: pixel.id,
      })
    }
    if (result.status === 'sent') {
      log.info(
        { tenantId, platform: pixel.platform, pixelConfigId: pixel.id, eventType, dedupEventId: dedupEventId ?? null },
        'platform fire success',
      )
    } else {
      log.warn(
        {
          tenantId,
          platform: pixel.platform,
          pixelConfigId: pixel.id,
          eventType,
          response: result.response,
        },
        'platform fire failed',
      )
    }
  }
})

// ── catalog-sync ───────────────────────────────────────────────────────────
// Pulls every product from the tenant's ecommerce adapter and upserts it into
// the `Product` table. Atomic: every upsert + the audit-log entry happen in a
// single $transaction. The audit log row's `meta` field stores the result
// (`{ plataforma, fuente, synced }`) — the route reads it back to build the
// HTTP response in inline mode.
registerJobHandler('catalog-sync', async (payload) => {
  const { tenantId } = (payload || {}) as { tenantId: string }
  if (!tenantId) {
    log.error('catalog-sync: tenantId missing — skipping')
    return
  }

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { plataformaCatalogo: true, slug: true, nombreNegocio: true },
  })
  if (!tenant) {
    log.error({ tenantId }, 'catalog-sync: tenant not found — skipping')
    return
  }

  const adapter = await getEcommerceAdapter(tenantId)
  const productos = await adapter.buscarProductos('')

  const fuenteMap: Record<string, string> = {
    whatsapp_catalog: 'whatsapp_catalog',
    woocommerce: 'woocommerce',
    shopify: 'shopify',
    catalogo_propio_cliente: 'supabase_cliente',
    catalogo_nuestro: 'supabase_nuestro',
  }
  const fuente = fuenteMap[tenant.plataformaCatalogo] ?? 'whatsapp_catalog'

  await db.$transaction(async (tx) => {
    let syncedCount = 0
    for (const p of productos) {
      await tx.product.upsert({
        where: { tenantId_sku: { tenantId, sku: p.sku } },
        create: {
          tenantId,
          sku: p.sku,
          name: p.name,
          price: p.precio,
          imageUrl: p.imagen_url || null,
          stock: p.stock,
          diseno: p.diseno ?? null,
          categoria: p.categoria ?? null,
          fuenteSincronizacion: fuente,
        },
        update: {
          name: p.name,
          price: p.precio,
          imageUrl: p.imagen_url || null,
          stock: p.stock,
          diseno: p.diseno ?? null,
          categoria: p.categoria ?? null,
          fuenteSincronizacion: fuente,
        },
      })
      syncedCount++
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        action: 'catalog_sync',
        entity: 'product',
        metadata: JSON.stringify({
          plataforma: tenant.plataformaCatalogo,
          fuente,
          synced: syncedCount,
        }),
      },
    })
  })

  log.info({ tenantId, fuente, count: productos.length }, 'catalog-sync complete')
})

// ── remarketing-send ───────────────────────────────────────────────────────
// Stub — placeholder so the route layer can enqueue remarketing sends now and
// the actual sending logic lands in a later sprint without touching the route.
registerJobHandler('remarketing-send', async (payload) => {
  const p = (payload || {}) as { tenantId?: string; campaignId?: string }
  log.info({ tenantId: p.tenantId, campaignId: p.campaignId }, 'Remarketing send job processed')
})

// ── seed-data ──────────────────────────────────────────────────────────────
// Stub — placeholder for the seed-data job. Useful for warming up a tenant
// with demo orders / conversations in non-prod environments.
registerJobHandler('seed-data', async (payload) => {
  const p = (payload || {}) as { tenantId?: string }
  log.info({ tenantId: p.tenantId }, 'Seed data job processed')
})

// ── retention-cleanup ──────────────────────────────────────────────────────
// SPRINT-ADOPT-ERRORHANDLER-001 — Ley 1581 Art 11 retention policy sweep.
// Registered as a queue handler so ops can trigger a manual sweep via
// `enqueue('retention-cleanup', {})` (e.g. from a script or admin shell).
//
// Daily scheduling: the BullMQ surface in this file is intentionally
// minimal — `Queue.add(name, data)` doesn't accept `{ repeat: { cron } }`
// options, so we can't register a recurring BullMQ job here. Instead, the
// daily 02:00 sweep is triggered by an external cron calling the HTTP
// endpoint at `/api/compliance/retention/cron` (see that route for the
// auth + idempotency contract). This handler is the execution seam the
// endpoint invokes indirectly via `runRetentionCleanup()`.
//
// Idempotent: `runRetentionCleanup` only touches rows strictly older than
// the retention cutoff — re-running on the same day is a no-op.
registerJobHandler('retention-cleanup', async () => {
  const { runRetentionCleanup } = await import('@/lib/compliance/retention')
  const result = await runRetentionCleanup()
  log.info(
    {
      customersAnonymized: result.customersAnonymized,
      conversationsDeleted: result.conversationsDeleted,
      messagesDeleted: result.messagesDeleted,
      auditLogsArchived: result.auditLogsArchived,
      consentRecordsDeleted: result.consentRecordsDeleted,
      decisionLogsDeleted: result.decisionLogsDeleted,
      durationMs: result.durationMs,
    },
    'retention-cleanup job complete',
  )
})

// Re-exported so callers can `import { RETENTION_QUEUE_NAME } from '@/lib/queue'`
// without hard-coding the string. Matches the convention used by other
// queue consumers (capi-fire, catalog-sync, etc. — those don't export a
// constant today, but adding one for retention makes future cron-scheduler
// wiring a one-line change).
export const RETENTION_QUEUE_NAME = 'retention-cleanup'

// ───────────────────────────────────────────────────────────────────────────
// CAPI firing helpers
//
// Moved here from `src/app/api/conversions/route.ts` so the queue worker can
// run them asynchronously in production. The route file now just enqueues
// the job and reads back the resulting `ConversionEvent` rows.
//
// Each platform has its own payload format and auth header. Any failure is
// captured per-platform so a single bad pixel doesn't poison the rest.
// ───────────────────────────────────────────────────────────────────────────

interface CapiPixel {
  id: string
  platform: string
  pixelId: string
  apiToken: string
  testMode: boolean
}

interface CapiEvent {
  eventType: string
  value: number | null
  currency: string
  /**
   * SPRINT-BACKEND-FINAL-001 — deduplication `event_id` forwarded to the
   * platform (Meta / Google / TikTok). Lets the platform dedupe CAPI
   * events against pixel-fired (browser) events that share the same id.
   * Undefined when the ConversionEvent row's `response` JSON didn't
   * carry an `eventId` (legacy row or JSON malformed).
   */
  eventId?: string
}

async function fireCapiPlatform(
  pixel: CapiPixel,
  event: CapiEvent,
): Promise<{ status: 'sent' | 'failed'; response: string }> {
  try {
    if (pixel.platform === 'meta') return await fireMeta(pixel, event)
    if (pixel.platform === 'google') return await fireGoogle(pixel, event)
    if (pixel.platform === 'tiktok') return await fireTikTok(pixel, event)
    return { status: 'failed', response: `Unknown platform: ${pixel.platform}` }
  } catch (e) {
    captureError(e, {
      action: 'capi-fire:platform',
      platform: pixel.platform,
      pixelConfigId: pixel.id,
    })
    return { status: 'failed', response: (e as Error).message }
  }
}

async function fireMeta(
  pixel: { pixelId: string; apiToken: string; testMode: boolean },
  event: CapiEvent,
): Promise<{ status: 'sent' | 'failed'; response: string }> {
  // FIX-PEND-DB-QUEUES-001 — base URL env-overridable for proxy/sandbox.
  // Default matches the in-code version (v19.0) so existing behavior is
  // preserved when FB_PIXEL_API_BASE is unset.
  const fbBaseUrl =
    process.env.FB_PIXEL_API_BASE ?? 'https://graph.facebook.com/v19.0'
  const url = `${fbBaseUrl}/${pixel.pixelId}/events?access_token=${pixel.apiToken}`
  const payload = {
    data: [
      {
        event_name: event.eventType,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'system',
        // SPRINT-BACKEND-FINAL-001 — forward the dedup `event_id` so Meta
        // can match this CAPI event against the browser pixel event with
        // the same id (set by capi-auto-fire as `order-<id>-meta`).
        // Omitted when undefined so the payload stays clean for legacy
        // events without a stored eventId.
        ...(event.eventId ? { event_id: event.eventId } : {}),
        value: event.value ?? 0,
        currency: event.currency,
        test_event_code: pixel.testMode ? 'TEST12345' : undefined,
      },
    ],
  }
  if (pixel.testMode) {
    return { status: 'sent', response: 'Meta CAPI test mode (no network call)' }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) return { status: 'failed', response: `Meta ${res.status}: ${text}` }
  return { status: 'sent', response: `Meta ${res.status}: ${text.slice(0, 200)}` }
}

async function fireGoogle(
  pixel: { pixelId: string; apiToken: string; testMode: boolean },
  event: CapiEvent,
): Promise<{ status: 'sent' | 'failed'; response: string }> {
  // FIX-PEND-DB-QUEUES-001 — base URL env-overridable for proxy/sandbox.
  const ga4BaseUrl =
    process.env.GA4_MP_API_BASE ?? 'https://www.google-analytics.com'
  const url = `${ga4BaseUrl}/mp/collect?measurement_id=${pixel.pixelId}&api_secret=${pixel.apiToken}`
  const payload = {
    client_id: 'ziay_os',
    events: [
      {
        name: event.eventType.toLowerCase(),
        params: {
          value: event.value ?? 0,
          currency: event.currency,
          // SPRINT-BACKEND-FINAL-001 — GA4 dedup: `event_id` in params
          // lets the platform dedupe against gtag-fired events with the
          // same id. Omitted when undefined.
          ...(event.eventId ? { event_id: event.eventId } : {}),
        },
      },
    ],
  }
  if (pixel.testMode) {
    return { status: 'sent', response: 'Google MP test mode (no network call)' }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) return { status: 'failed', response: `Google ${res.status}: ${text || 'no body'}` }
  return { status: 'sent', response: `Google ${res.status}: ok` }
}

async function fireTikTok(
  pixel: { pixelId: string; apiToken: string; testMode: boolean },
  event: CapiEvent,
): Promise<{ status: 'sent' | 'failed'; response: string }> {
  // FIX-PEND-DB-QUEUES-001 — base URL env-overridable for proxy/sandbox.
  const tiktokBaseUrl =
    process.env.TIKTOK_EVENTS_API_BASE ?? 'https://business-api.tiktok.com'
  const url = `${tiktokBaseUrl}/open_api/v1.3/event/track/`
  const payload = {
    pixel_code: pixel.pixelId,
    event: event.eventType,
    event_time: Math.floor(Date.now() / 1000),
    // SPRINT-BACKEND-FINAL-001 — TikTok dedup: `event_id` at the top
    // level lets the platform dedupe against pixel-fired events with
    // the same id. Omitted when undefined.
    ...(event.eventId ? { event_id: event.eventId } : {}),
    value: event.value ?? 0,
    currency: event.currency,
    test_event_code: pixel.testMode ? 'TEST12345' : undefined,
  }
  if (pixel.testMode) {
    return { status: 'sent', response: 'TikTok Events API test mode (no network call)' }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Access-Token': pixel.apiToken },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) return { status: 'failed', response: `TikTok ${res.status}: ${text}` }
  return { status: 'sent', response: `TikTok ${res.status}: ${text.slice(0, 200)}` }
}
