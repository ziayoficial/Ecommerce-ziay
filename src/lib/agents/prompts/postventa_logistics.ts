// ────────────────────────────────────────────────────────────────────
// 7 — Agente de post-venta logística (postventa_logistics)
// Consolidación IA-3: merge de guide_tracking (§7.1) + guide_alert (§7.5)
// + logistics_notifier (§7.7) en un único agente con 3 modos.
// ────────────────────────────────────────────────────────────────────
// El contexto `ctx.mode` discrimina entre las 3 responsabilidades que
// antes tenían 3 agentes distintos:
//   - 'tracking'      → consulta el estado de una guía y responde al cliente
//                        (reemplaza guide_tracking, §7.1).
//   - 'alert'         → detecta guías con problemas (stuck, devuelta,
//                        extraviada) y produce alertas operativas para el
//                        equipo del tenant (reemplaza guide_alert, §7.5).
//   - 'notification'  → genera el mensaje proactivo al cliente en cada
//                        hito del envío (reemplaza logistics_notifier, §7.7).
// Si `ctx.mode` no viene, se infiere: si hay `shipmentId` o `guia` → tracking;
// si hay `novedadTipo` → notification; en caso contrario → alert.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildPostventaLogisticsPrompt(
  ctx: AgentContext,
): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')

  // ── Resolver el modo ─────────────────────────────────────────────────
  type Mode = 'tracking' | 'alert' | 'notification'
  const mode: Mode =
    (ctx.mode as Mode | undefined) ??
    (ctx.shipmentId || ctx.guia
      ? 'tracking'
      : ctx.novedadTipo
        ? 'notification'
        : 'alert')

  // ── Resolver la shipment si aplica ───────────────────────────────────
  // tracking + notification operan sobre una guía específica; alert opera
  // sobre lotes (stuck > 48h, devueltas, con novedad). La búsqueda es la
  // misma de guide_tracking.ts original.
  type ShipmentWithOrder = NonNullable<
    Awaited<
      ReturnType<
        typeof db.shipment.findFirst<{
          include: {
            order: {
              select: { number: true; customer: { select: { name: true; city: true } } }
            }
          }
        }>
      >
    >
  >
  let shipment: ShipmentWithOrder | null = null
  if (ctx.shipmentId) {
    shipment = await db.shipment.findUnique({
      where: { id: ctx.shipmentId },
      include: {
        order: {
          select: { number: true, customer: { select: { name: true, city: true } } },
        },
      },
    }) as ShipmentWithOrder | null
  } else if (ctx.guia) {
    // No unique constraint on [tenantId, numeroGuia] → use findFirst.
    shipment = await db.shipment.findFirst({
      where: { tenantId: ctx.tenantId, numeroGuia: ctx.guia },
      include: {
        order: {
          select: { number: true, customer: { select: { name: true, city: true } } },
        },
      },
    })
  } else if (ctx.orderId) {
    shipment = await db.shipment.findFirst({
      where: { tenantId: ctx.tenantId, orderId: ctx.orderId },
      include: {
        order: {
          select: { number: true, customer: { select: { name: true, city: true } } },
        },
      },
    })
  }

  // ── Branch por modo ──────────────────────────────────────────────────
  if (mode === 'tracking') {
    return buildTrackingBranch(tenant, ctx, shipment)
  }
  if (mode === 'notification') {
    return buildNotificationBranch(tenant, ctx, shipment)
  }
  return buildAlertBranch(tenant, ctx)
}

// ────────────────────────────────────────────────────────────────────
// Modo TRACKING (reemplaza guide_tracking §7.1)
// ────────────────────────────────────────────────────────────────────
function buildTrackingBranch(
  tenant: { slug: string; proveedorLogistico: string; nombreAsesora: string | null },
  ctx: AgentContext,
  shipment: { numeroGuia: string | null; transportadoraCanonica: string | null; transportadora: string | null; proveedor: string | null; estado: string; novedad: string | null; tiempoEstimadoDias: number | null; order: { number: string; customer: { name: string; city: string | null } } } | null,
): { system: string; user: string } {
  const system = `Eres el agente de seguimiento de guías de ${tenant.slug}. Recibes una guía o número de
pedido, consultas el estado real vía LogisticsAdapter (no inventas estados) y devuelves un mensaje
cercano al cliente (tuteando, tono_marca del tenant) con: transportadora, estado actual, última
novedad si la hay, y ubicación aproximada o ETA. Si la guía no existe para este tenant, dilo. Si
ya fue entregada, felicita y pide feedback en una pregunta binaria. Máximo 25 palabras + el dato
de la guía.`
  const shipmentInfo = shipment
    ? `Guía ${shipment.numeroGuia || '(sin número)'} | transportadora: ${shipment.transportadoraCanonica || shipment.transportadora || shipment.proveedor} | estado: ${shipment.estado} | novedad: ${shipment.novedad || 'ninguna'} | ETA: ${shipment.tiempoEstimadoDias ?? '?'} días | pedido: ${shipment.order.number} | cliente: ${shipment.order.customer.name} (${shipment.order.customer.city || '?'})`
    : ''
  const user = `Proveedor logístico del tenant: ${tenant.proveedorLogistico}
Nombre asesora: ${tenant.nombreAsesora || 'Asesora'}

Estado real de la guía (vía DB — el LogisticsAdapter refrescará antes de responder):
${shipmentInfo || 'No se encontró guía con los datos proporcionados — pide al cliente el número de pedido o guía.'}

Consulta del cliente: "${ctx.message || '¿Dónde está mi pedido?'}"`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// Modo ALERT (reemplaza guide_alert §7.5)
// ────────────────────────────────────────────────────────────────────
async function buildAlertBranch(
  tenant: { slug: string },
  ctx: AgentContext,
): Promise<{ system: string; user: string }> {
  const system = `Eres el agente de alertas operativas de ${tenant.slug}. Monitoreas las guías de este
tenant y produces alertas accionables cuando detectas: guías sin movimiento > 48h, guías
devueltas, guías con novedad crítica (robo/extravío), guías con más de 2 intentos fallidos.
Formato de salida (JSON):
{"severidad": "critica|alta|media", "tipo": "stuck|devuelta|extraviada|reintentos_excedidos",
"guia": "...", "pedido": "...", "cliente": "...", "accion_recomendada": "...", "deadline": "YYYY-MM-DD"}.
NO contactas al cliente — tu salida es para el equipo operativo del tenant.`
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000)
  const stuck = await db.shipment.findMany({
    where: { tenantId: ctx.tenantId, estado: { in: ['generada', 'en_transito'] }, updatedAt: { lt: cutoff } },
    take: 20,
    include: { order: { select: { number: true, customer: { select: { name: true } } } } },
  })
  const returned = await db.shipment.findMany({
    where: { tenantId: ctx.tenantId, estado: { in: ['devuelta', 'novedad'] } },
    take: 20,
    include: { order: { select: { number: true, customer: { select: { name: true } } } } },
  })
  const stuckShipments = `Guías estancadas (>48h sin update): ${stuck.length}
${stuck.map(s => `- ${s.numeroGuia} | ${s.estado} | última actualización ${s.updatedAt.toISOString().slice(0, 10)} | pedido ${s.order.number} | cliente ${s.order.customer.name}`).join('\n')}

Guías con novedad o devueltas: ${returned.length}
${returned.map(s => `- ${s.numeroGuia} | ${s.estado} | novedad: ${s.novedad || 'N/A'} | pedido ${s.order.number} | cliente ${s.order.customer.name}`).join('\n')}`
  const user = `Resumen operativo para ${tenant.slug}:
${stuckShipments}

Foco solicitado: ${ctx.shipmentId ? `guía específica ${ctx.shipmentId}` : 'todas las guías del tenant'}`
  return { system, user }
}

// ────────────────────────────────────────────────────────────────────
// Modo NOTIFICATION (reemplaza logistics_notifier §7.7)
// ────────────────────────────────────────────────────────────────────
function buildNotificationBranch(
  tenant: { slug: string; tonoMarca: string | null; nombreAsesora: string | null },
  ctx: AgentContext,
  shipment: { numeroGuia: string | null; transportadoraCanonica: string | null; transportadora: string | null; estado: string; novedad: string | null; tiempoEstimadoDias: number | null; order: { number: string; customer: { name: string } } } | null,
): { system: string; user: string } {
  const system = `Eres el notificador proactivo de logística de ${tenant.slug}. Cuando un envío cambia de
estado, generas el mensaje al cliente en tono_marca. Hitos estándar:
1) "guía_generada": confirma envío + número de guía + transportadora + ETA.
2) "en_transito": aviso breve de que salió.
3) "en_reparto": aviso de que hoy llega, pide confirmar horario/dirección en pregunta binaria.
4) "entregada": felicita + pide feedback en pregunta binaria.
5) "novedad": explica + da siguiente paso (re-agenda, retiro en oficina, etc.).
Máximo 25 palabras por mensaje + dato de la guía. Nunca revelas información interna del proveedor.`
  const shipmentInfo = shipment
    ? `Guía ${shipment.numeroGuia} | transportadora: ${shipment.transportadoraCanonica || shipment.transportadora} | estado: ${shipment.estado} | novedad: ${shipment.novedad || 'ninguna'} | ETA: ${shipment.tiempoEstimadoDias ?? '?'} días | pedido ${shipment.order.number} | cliente ${shipment.order.customer.name}`
    : ''
  const user = `Tono marca: ${tenant.tonoMarca || 'Cercano, profesional'}
Nombre asesora: ${tenant.nombreAsesora || 'Asesora'}

Hito a notificar: ${ctx.novedadTipo || 'cambio de estado general'}

Envío:
${shipmentInfo || 'Sin envío localizado — no generes notificación falsa.'}

Mensaje actual del cliente (si responde algo): "${ctx.message || '(primer mensaje proactivo)'}"`
  return { system, user }
}
