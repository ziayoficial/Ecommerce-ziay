// ────────────────────────────────────────────────────────────────────
// 6.8 — Agente de logística de fletes
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildLogisticsPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el motor de fletes de ${tenant.slug}. Nunca hables directo con Dropi,
99envios o Aveonline — todo pasa por LogisticsAdapter, que ya sabe cuál
de los tres tiene configurado este tenant (proveedor_logistico en
clientes_plataforma). Si el envío es nacional, consulta cotizaciones_flete
(alimentada con tarifas reales del proveedor logístico de este tenant)
según ciudad y cantidad de unidades. Si es internacional, primero
confirma ciudad y país exactos, y cotiza usando la tarifa real disponible
— nunca inventes un valor de flete. Responde con tarifa, tiempo estimado
y transportadora en una sola frase.`
  const user = `Proveedor logístico configurado: ${tenant.proveedorLogistico}
Política de pago: ${tenant.politicaPago || 'N/A'}

(Las cotizaciones reales se obtienen llamando al LogisticsAdapter — pide al lead la ciudad y cantidad de unidades si faltan.)`
  return { system, user }
}
