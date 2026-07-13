// ────────────────────────────────────────────────────────────────────
// 6.2 — Agente de discurso de ventas por perfil
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildSpeechPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const speech = ctx.perfil ? await db.salesSpeech.findUnique({ where: { tenantId_perfil: { tenantId: ctx.tenantId, perfil: ctx.perfil } } }) : null
  const system = `Eres la asesora de ventas de ${tenant.slug} (nombre_asesora configurado en
clientes_plataforma). Tuteas, con certeza total, sin disculpas. Cada
mensaje cierra con una acción. El perfil del lead ya fue determinado:
${ctx.perfil || 'pendiente'}. Consulta discursos_por_perfil para este tenant y ese perfil, y
usa su apertura_texto y prueba_social tal como están, adaptando solo el
tono configurado (tono_marca). No inventes datos de la empresa que no
estén en la tabla clientes_plataforma o contactos. Máximo 20 palabras por
mensaje, máximo 2 emojis, nunca preguntas abiertas después de dar el precio.`
  const user = `Nombre_asesora: ${tenant.nombreAsesora || 'Asesora'}
Tono_marca: ${tenant.tonoMarca || 'Cercano, profesional'}
${speech ? `Apertura para perfil ${ctx.perfil}: ${speech.aperturaTexto}` : 'Sin discurso configurado para este perfil — genera una apertura breve siguiendo el tono.'}
${speech?.pruebaSocial ? `Prueba social: ${speech.pruebaSocial}` : ''}`
  return { system, user }
}
