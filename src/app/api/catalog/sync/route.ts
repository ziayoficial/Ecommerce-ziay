// ZIAY — API /api/catalog/sync
// Saramantha §8.2–§8.5, §9.2–§9.5 — sincronización del catálogo del tenant.
//
// POST body: { tenantId }
// Resuelve el `EcommerceAdapter` del tenant, llama a `buscarProductos('')`
// para obtener todos, y upserta los resultados en la tabla `Product` con
// `fuenteSincronizacion` matching el adapter. Devuelve el conteo de productos
// sincronizados.
//
// La lógica de sincronización ahora vive en `src/lib/queue.ts` (handler
// `catalog-sync`) para que pueda ejecutarse fuera del request thread en
// producción (BullMQ + Redis). En dev (sin REDIS_URL) el handler corre
// inline — el response incluye el conteo final. En prod, el response es
// un ack `{ ok, queued: true }` y el resultado real aterriza en el
// audit log cuando el worker lo procese.
//
// Esta ruta es idempotente: ejecutarla múltiples veces produce el mismo estado
// final en la tabla `Product` (upsert por [tenantId, sku]).

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { enqueue, isInlineMode } from '@/lib/queue'

export async function POST(req: NextRequest) {
  const { error } = await requireAuth()
  if (error) return error
  try {
    const body = await req.json()
    const { tenantId } = body as { tenantId?: string }

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }

    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { plataformaCatalogo: true, slug: true, nombreNegocio: true },
    })
    if (!tenant) {
      return NextResponse.json({ error: `Tenant not found: ${tenantId}` }, { status: 404 })
    }

    // Enqueue the actual sync. In inline mode (no REDIS_URL) this runs
    // synchronously: by the time `enqueue` returns, the products are
    // upserted and the audit log row is committed. In BullMQ mode the job
    // lands on Redis and runs later in the worker process.
    await enqueue('catalog-sync', { tenantId })

    if (!isInlineMode()) {
      // BullMQ mode — the worker hasn't run yet, so there's no fresh audit
      // log entry to read back. Return a queued ack.
      return NextResponse.json({
        ok: true,
        queued: true,
        tenantId,
        tenantSlug: tenant.slug,
        plataforma: tenant.plataformaCatalogo,
        message: 'Catalog sync queued — results will land in the audit log',
      })
    }

    // Inline mode — the sync already ran. Read back the latest `catalog_sync`
    // audit log entry to surface the synced count + fuente in the response
    // (keeps the existing response shape backward-compatible).
    const audit = await db.auditLog.findFirst({
      where: { tenantId, action: 'catalog_sync' },
      orderBy: { createdAt: 'desc' },
    })

    let synced = 0
    let fuente = 'whatsapp_catalog'
    if (audit?.meta) {
      try {
        const meta = JSON.parse(audit.meta) as {
          plataforma?: string
          fuente?: string
          synced?: number
        }
        synced = typeof meta.synced === 'number' ? meta.synced : 0
        fuente = meta.fuente || fuente
      } catch {
        // malformed meta — fall back to defaults
      }
    }

    return NextResponse.json({
      ok: true,
      queued: false,
      tenantId,
      tenantSlug: tenant.slug,
      plataforma: tenant.plataformaCatalogo,
      fuenteSincronizacion: fuente,
      synced,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
