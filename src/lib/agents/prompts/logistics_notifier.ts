// ────────────────────────────────────────────────────────────────────
// 7.7 — Agente notificador logístico (logistics_notifier)
// Envía notificaciones proactivas al cliente en los hitos clave del envío
// (guía generada, en transito, en reparto, entregada, novedad).
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildLogisticsNotifierPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el notificador proactivo de logística de ${tenant.slug}. Cuando un envío cambia de
estado, generas el mensaje al cliente en tono_marca. Hitos estándar:
1) "guía_generada": confirma envío + número de guía + transportadora + ETA.
2) "en_transito": aviso breve de que salió.
3) "en_reparto": aviso de que hoy llega, pide confirmar horario/dirección en pregunta binaria.
4) "entregada": felicita + pide feedback en pregunta binaria.
5) "novedad": explica + da siguiente paso (re-agenda, retiro en oficina, etc.).
Máximo 25 palabras por mensaje + dato de la guía. Nunca revelas información interna del proveedor.`
  let shipmentInfo = ''
  if (ctx.shipmentId) {
    const shipment = await db.shipment.findUnique({ where: { id: ctx.shipmentId }, include: { order: { select: { number: true, customer: { select: { name: true } } } } } })
    if (shipment) {
      shipmentInfo = `Guía ${shipment.numeroGuia} | transportadora: ${shipment.transportadoraCanonica || shipment.transportadora} | estado: ${shipment.estado} | novedad: ${shipment.novedad || 'ninguna'} | ETA: ${shipment.tiempoEstimadoDias ?? '?'} días | pedido ${shipment.order.number} | cliente ${shipment.order.customer.name}`
    }
  }
  const user = `Tono marca: ${tenant.tonoMarca || 'Cercano, profesional'}
Nombre asesora: ${tenant.nombreAsesora || 'Asesora'}

Hito a notificar: ${ctx.novedadTipo || 'cambio de estado general'}

Envío:
${shipmentInfo || 'Sin envío localizado — no generes notificación falsa.'}

Mensaje actual del cliente (si responde algo): "${ctx.message || '(primer mensaje proactivo)'}"`
  return { system, user }
}
