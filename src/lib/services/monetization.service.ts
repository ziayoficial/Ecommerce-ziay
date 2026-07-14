// ZIAY — Monetization service layer.
//
// Wraps the GMV / commission / invoice pipeline (Saramantha §17).
// Tramos (commission tiers) are encoded as constants so the service
// is the single source of truth for the percentages.
//
// SPRINT6-ARCH-001 — service layer.

import { db } from '@/lib/db'
import { getLogger } from '@/lib/logger'
import { captureError } from '@/lib/capture-error'

const log = getLogger('service:monetization')

/**
 * Commission tramo (Saramantha §17.3):
 *   GMV < 10M   → 4.5%
 *   GMV < 40M   → 3.0%
 *   GMV  40M+   → 1.75%
 *
 * Returns { label, pct } so callers can persist both for auditability.
 */
export function getTramo(gmv: number): { label: string; pct: number } {
  if (gmv < 10_000_000) return { label: '0-10M', pct: 4.5 }
  if (gmv < 40_000_000) return { label: '10-40M', pct: 3.0 }
  return { label: '40M+', pct: 1.75 }
}

export const monetizationService = {
  /**
   * GMV summary for a tenant: total + paid GMV, commission recognized,
   * pending, current tramo + invoice for the current period.
   *
   * Used by `/api/monetization/gmv`.
   */
  async getGMV(tenantId: string) {
    try {
      const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
      if (!tenant) return null

      const periodo = new Date().toISOString().slice(0, 7)
      const orderWhere = { tenantId, origen: 'agente_whatsapp' as const }

      // AUDIT-GAP-4-DB N+1 #4/#5: previously loaded ALL tenant orders into memory
      // and JS-reduced on `o.total` + `commissionEntries[].reconocidaMonto`.
      // Push all sums/counts/groupBy to the DB — 4 parallel aggregate queries + 1 invoice lookup.
      const [gmvAgg, gmvPaidAgg, reconocidaAgg, statusGroups, invoice] = await Promise.all([
        // gmv = sum(o.total) over all agente_whatsapp orders
        db.order.aggregate({
          where: orderWhere,
          _sum: { total: true },
          _count: true,
        }),
        // gmvPaid = sum(o.total) where paymentStatus='paid'
        db.order.aggregate({
          where: { ...orderWhere, paymentStatus: 'paid' },
          _sum: { total: true },
        }),
        // reconocida = sum(commissionEntry.reconocidaMonto) for entries on
        // agente_whatsapp orders (relation filter preserves the original scope).
        db.commissionEntry.aggregate({
          where: { tenantId, order: { origen: 'agente_whatsapp' } },
          _sum: { reconocidaMonto: true },
        }),
        // embudo counts by status (single groupBy replaces 4 array.filter().length)
        db.order.groupBy({
          by: ['status'],
          where: orderWhere,
          _count: { _all: true },
        }),
        db.invoice.findFirst({
          where: { tenantId, periodo },
          orderBy: { createdAt: 'desc' },
        }),
      ])

      const gmv = gmvAgg._sum.total ?? 0
      const ordenes = gmvAgg._count
      const gmvPaid = gmvPaidAgg._sum.total ?? 0
      const reconocida = reconocidaAgg._sum.reconocidaMonto ?? 0

      const tramo = getTramo(gmv)
      const comisionCalculada = (gmv * tramo.pct) / 100
      const pendiente = comisionCalculada - reconocida

      const countByStatus = (status: string) =>
        statusGroups.find((g) => g.status === status)?._count._all ?? 0

      return {
        tenant: {
          slug: tenant.slug,
          nombreNegocio: tenant.nombreNegocio,
          planMonetizacion: tenant.planMonetizacion,
        },
        periodo,
        gmv: Math.round(gmv),
        gmvPaid: Math.round(gmvPaid),
        ordenes,
        tramo: tramo.label,
        comisionPct: tramo.pct,
        comisionCalculada: Math.round(comisionCalculada),
        comisionReconocida: Math.round(reconocida),
        comisionPendiente: Math.round(pendiente),
        feeBaseMensual: tenant.feeBaseMensual,
        totalEstimado: Math.round(tenant.feeBaseMensual + comisionCalculada),
        invoice: invoice
          ? {
              id: invoice.id,
              estado: invoice.estado,
              total: invoice.total,
              emitidaAt: invoice.emitidaAt,
            }
          : null,
        embudo: {
          pendiente_confirmacion: countByStatus('pending_confirmation'),
          datos_completados: countByStatus('datos_completados'),
          despachado: countByStatus('despachado'),
          // Note: status value is 'intent_cancelacion' (no "o"); object key keeps
          // the original 'intento_cancelacion' name for API-shape compatibility.
          intento_cancelacion: countByStatus('intent_cancelacion'),
        },
      }
    } catch (err) {
      captureError(err as Error, { service: 'monetization', method: 'getGMV', tenantId })
      throw new Error('Failed to fetch GMV')
    }
  },

  /**
   * List commission entries for a tenant + totals (gmv, comision, reconocida).
   * Used by `/api/monetization/commission`.
   *
   * FIX-PERFORMANCE-001 — previously did a single `take: 100` findMany +
   * JS reduce, which silently truncated `totals.gmv`/`comisionTotal`/
   * `reconocida` to the latest 100 entries when a tenant had more.
   * Now we run the bounded list (recent 50 for the table) in parallel
   * with an `aggregate` so totals cover ALL rows for the tenant.
   */
  async getCommissions(tenantId: string) {
    try {
      const [entries, sumAgg] = await Promise.all([
        db.commissionEntry.findMany({
          where: { tenantId },
          include: {
            order: {
              select: { number: true, status: true, total: true, createdAt: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        db.commissionEntry.aggregate({
          where: { tenantId },
          _sum: { gmv: true, comisionTotal: true, reconocidaMonto: true },
        }),
      ])

      const gmv = sumAgg._sum.gmv ?? 0
      const comisionTotal = sumAgg._sum.comisionTotal ?? 0
      const reconocida = sumAgg._sum.reconocidaMonto ?? 0

      return {
        entries,
        totals: {
          gmv: Math.round(gmv),
          comisionTotal: Math.round(comisionTotal),
          reconocida: Math.round(reconocida),
          pendiente: Math.round(comisionTotal - reconocida),
        },
      }
    } catch (err) {
      captureError(err as Error, { service: 'monetization', method: 'getCommissions', tenantId })
      throw new Error('Failed to fetch commissions')
    }
  },

  /**
   * Generate (or update) the monthly Invoice for a tenant + period.
   * Workflow:
   *   1. Sum GMV from non-cancelled orders in the period
   *   2. Determine commission tramo
   *   3. Upsert Invoice
   *   4. Write AuditLog
   *
   * Used by `/api/monetization/generate-invoice`.
   */
  async generateInvoice(tenantId: string, periodo?: string) {
    try {
      const now = new Date()
      const period =
        periodo || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

      const [year, month] = period.split('-').map(Number)
      const startOfMonth = new Date(year, month - 1, 1)
      const endOfMonth = new Date(year, month, 0, 23, 59, 59)

      const orders = await db.order.findMany({
        where: { tenantId, createdAt: { gte: startOfMonth, lte: endOfMonth } },
        select: { total: true, status: true },
      })

      const validOrders = orders.filter(
        (o) => o.status !== 'cancelled' && o.status !== 'intent_cancelacion',
      )
      const gmv = validOrders.reduce((sum, o) => sum + o.total, 0)

      const tramo = getTramo(gmv)
      const comisionTotal = Math.round((gmv * tramo.pct) / 100)
      const feeBase = 0
      const total = feeBase + comisionTotal

      const existing = await db.invoice.findFirst({ where: { tenantId, periodo: period } })
      const invoice = existing
        ? await db.invoice.update({
            where: { id: existing.id },
            data: {
              gmvTotal: gmv,
              feeBase,
              comisionTotal,
              tramoAplicado: tramo.label,
              total,
            },
          })
        : await db.invoice.create({
            data: {
              tenantId,
              periodo: period,
              gmvTotal: gmv,
              feeBase,
              comisionTotal,
              tramoAplicado: tramo.label,
              total,
              estado: 'borrador',
            },
          })

      try {
        await db.auditLog.create({
          data: {
            action: 'invoice_generated',
            entity: 'invoice',
            entityId: invoice.id,
            meta: JSON.stringify({
              tenantId,
              periodo: period,
              gmv,
              tramo: tramo.label,
              comisionPct: tramo.pct,
              comisionTotal,
              orderCount: validOrders.length,
            }),
          },
        })
      } catch (auditErr) {
        // Non-fatal — capture but don't surface to caller.
        captureError(auditErr as Error, {
          service: 'monetization',
          method: 'generateInvoice:audit',
          tenantId,
        })
      }

      log.info(
        { tenantId, periodo: period, invoiceId: invoice.id, gmv, tramo: tramo.label },
        'Invoice generated',
      )
      return {
        invoice,
        details: {
          periodo: period,
          orderCount: validOrders.length,
          gmv,
          tramo: tramo.label,
          comisionPct: tramo.pct,
          comisionTotal,
          total,
        },
      }
    } catch (err) {
      captureError(err as Error, { service: 'monetization', method: 'generateInvoice', tenantId })
      throw new Error('Failed to generate invoice')
    }
  },
}

export type MonetizationService = typeof monetizationService
