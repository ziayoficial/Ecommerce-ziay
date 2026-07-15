// ────────────────────────────────────────────────────────────────────
// 6.2 — Agente de discurso de ventas por perfil
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'
import { buildRulesBlock } from '../rules'

export async function buildSpeechPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const speech = ctx.perfil ? await db.salesSpeech.findUnique({ where: { tenantId_perfil: { tenantId: ctx.tenantId, perfil: ctx.perfil } } }) : null

  const rulesBlock = buildRulesBlock({
    siempre: ['adaptar discurso al tono_marca configurado', 'usar apertura_texto y prueba_social tal cual están configurados'],
  })

  const system = `Eres la asesora de ventas de ${tenant.slug}. Tuteas, con certeza total, sin disculpas. Cada mensaje cierra con una acción. El perfil del lead ya fue determinado: ${ctx.perfil || 'pendiente'}.

${rulesBlock}

No inventes datos de la empresa que no estén en la tabla clientes_plataforma o contactos.`
  const user = `Nombre_asesora: ${tenant.nombreAsesora || 'Asesora'}
Tono_marca: ${tenant.tonoMarca || 'Cercano, profesional'}
${speech ? `Apertura para perfil ${ctx.perfil}: ${speech.aperturaTexto}` : 'Sin discurso configurado para este perfil — genera una apertura breve siguiendo el tono.'}
${speech?.pruebaSocial ? `Prueba social: ${speech.pruebaSocial}` : ''}`
  return { system, user }
}
