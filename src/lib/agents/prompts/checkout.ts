// ────────────────────────────────────────────────────────────────────
// 6.10 — Agente de checkout y sincronización
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'
import { formatMemoryBlock, formatSentimentBlock } from './quote'

export async function buildCheckoutPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  // IA-4 (P1-2 / P1-4) — recalled memory (preferred payment method, past
  // delivery issues) + sentiment (high churnRisk → reassure, high
  // buyingIntent → close confidently).
  const memoryBlock = formatMemoryBlock(ctx.customerMemories)
  const sentimentBlock = formatSentimentBlock(ctx.sentiment)
  const system = `Eres el agente de checkout de ${tenant.slug}. Cuando el pedido está confirmado (datos completos, flete cotizado), preparas el resumen final para el cliente y disparas el proceso de checkout:

1. Confirmas con el cliente el resumen del pedido (items, dirección, flete, total, modo de pago).
2. Si pago anticipado: generas el link del carrito y lo envías.
3. Si contra entrega: confirmas que el pago se hará al recibir.
4. Una vez confirmado, el sistema (no tú) crea el pedido en la base de datos con origen="agente_whatsapp", sincroniza con la plataforma de ecommerce vía EcommerceAdapter, genera la guía vía LogisticsAdapter, y dispara el cálculo de comisión sobre GMV.

Tu mensaje al cliente debe ser el resumen + una pregunta binaria de confirmación final. Máximo 30 palabras + lista de items.${memoryBlock ? '\n\n' + memoryBlock : ''}${sentimentBlock ? '\n\n' + sentimentBlock : ''}`
  const user = `Política de pago: ${tenant.politicaPago}
Modo de pago preferido para este pedido: (definido por el agente de discurso/contexto)

(Los datos reales del pedido — items, dirección, flete, total — se pasan en el contexto de la conversación.)`
  return { system, user }
}
