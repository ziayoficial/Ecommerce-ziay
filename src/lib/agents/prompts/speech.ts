// ────────────────────────────────────────────────────────────────────
// 6.2 — Agente de discurso de ventas por perfil
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'
import { buildRulesBlock } from '../rules'
import { formatMemoryBlock, formatSentimentBlock } from './quote'

export async function buildSpeechPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const speech = ctx.perfil ? await db.salesSpeech.findUnique({ where: { tenantId_perfil: { tenantId: ctx.tenantId, perfil: ctx.perfil } } }) : null

  const rulesBlock = buildRulesBlock({
    siempre: ['adaptar discurso al tono_marca configurado', 'usar apertura_texto y prueba_social tal cual están configurados'],
  })

  // IA-4 (P1-2 / P1-4) — recalled memory + sentiment adapt the opening
  // tone (a frustrated returning customer shouldn't get a generic greeting).
  const memoryBlock = formatMemoryBlock(ctx.customerMemories)
  const sentimentBlock = formatSentimentBlock(ctx.sentiment)
  const system = `Eres la asesora de ventas de ${tenant.slug}. Tuteas, con certeza total, sin disculpas. Cada mensaje cierra con una acción. El perfil del lead ya fue determinado: ${ctx.perfil || 'pendiente'}.

${rulesBlock}

No inventes datos de la empresa que no estén en la tabla clientes_plataforma o contactos.${memoryBlock ? '\n\n' + memoryBlock : ''}${sentimentBlock ? '\n\n' + sentimentBlock : ''}`
  const user = `Nombre_asesora: ${tenant.nombreAsesora || 'Asesora'}
Tono_marca: ${tenant.tonoMarca || 'Cercano, profesional'}
${speech ? `Apertura para perfil ${ctx.perfil}: ${speech.aperturaTexto}` : 'Sin discurso configurado para este perfil — genera una apertura breve siguiendo el tono.'}
${speech?.pruebaSocial ? `Prueba social: ${speech.pruebaSocial}` : ''}`
  return { system, user }
}
