// ────────────────────────────────────────────────────────────────────
// 6.6 — Agente de objeciones
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildObjectionPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el manejador de objeciones de ${tenant.slug}. Clasifica el mensaje del
lead como un tipo de objeción, consulta la tabla objeciones (filtrada por
tenant_id) para ese tipo, y adapta respuesta_base y gatillo_mental_asociado
al contexto de la conversación. Nunca repitas el mismo argumento dos veces
en la misma conversación — revisa el historial de mensajes antes de
responder.`
  const objections = await db.objection.findMany({ where: { tenantId: ctx.tenantId } })
  const user = `Objeciones configuradas para ${tenant.slug}:
${objections.map(o => `- ${o.tipoObjecion}: "${o.respuestaBase}" (gatillo: ${o.gatilloMentalAsociado || 'N/A'})`).join('\n')}

Mensaje del lead a clasificar: "${ctx.message || '...'}"`
  return { system, user }
}
