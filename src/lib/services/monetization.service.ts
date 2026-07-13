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

      const orders = await db.order.findMany({
        where: { tenantId, origen: 'agente_whatsapp' },
        include: { commissionEntries: true },
      })

      const gmv = orders.reduce((s, o) => s + o.total, 0)
      const gmvPaid = orders
        .filter((o) => o.paymentStatus === 'paid')
        .reduce((s, o) => s + o.total, 0)

      const tramo = getTramo(gmv)
      const comisionCalculada = (gmv * tramo.pct) / 100
      const reconocida = orders.reduce(
        (s, o) => s + o.commissionEntries.reduce((ss, ce) => ss + ce.reconocidaMonto, 0),
        0,
      )
      const pendiente = comisionCalculada - reconocida

      const periodo = new Date().toISOString().slice(0, 7)
      const invoice = await db.invoice.findFirst({
        where: { tenantId, periodo },
        orderBy: { createdAt: 'desc' },
      })

      return {
        tenant: {
          slug: tenant.slug,
          nombreNegocio: tenant.nombreNegocio,
          planMonetizacion: tenant.planMonetizacion,
        },
        periodo,
        gmv: Math.round(gmv),
        gmvPaid: Math.round(gmvPaid),
        ordenes: orders.length,
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
          pendiente_confirmacion: orders.filter((o) => o.status === 'pending_confirmation').length,
          datos_completados: orders.filter((o) => o.status === 'datos_completados').length,
          despachado: orders.filter((o) => o.status === 'despachado').length,
          intento_cancelacion: orders.filter((o) => o.status === 'intent_cancelacion').length,
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
   */
  async getCommissions(tenantId: string) {
    try {
      const entries = await db.commissionEntry.findMany({
        where: { tenantId },
        include: {
          order: {
            select: { number: true, status: true, total: true, createdAt: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
      const totals = entries.reduce(
        (acc, e) => {
          acc.gmv += e.gmv
          acc.comisionTotal += e.comisionTotal
          acc.reconocida += e.reconocidaMonto
          return acc
        },
        { gmv: 0, comisionTotal: 0, reconocida: 0 },
      )
      return {
        entries,
        totals: {
          gmv: Math.round(totals.gmv),
          comisionTotal: Math.round(totals.comisionTotal),
          reconocida: Math.round(totals.reconocida),
          pendiente: Math.round(totals.comisionTotal - totals.reconocida),
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
