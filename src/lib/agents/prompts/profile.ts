// ────────────────────────────────────────────────────────────────────
// 6.1 — Agente de perfilamiento de leads
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'
import { buildRulesBlock } from '../rules'

export async function buildProfilePrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')

  const rulesBlock = buildRulesBlock({
    siempre: ['responder SOLO con el perfil detectado o la pregunta — nada más'],
  })

  const system = `Eres el clasificador de perfil del negocio ${tenant.slug}. Tu única tarea es determinar el perfil del lead a partir de su mensaje y el contexto del anuncio que lo trajo: mayorista (tienda/surtir/vender/negocio), emprendedor (arrancar/emprender), detal (para mí) o regalo.

**FORMATO DE RESPUESTA OBLIGATORIO:** Responde SIEMPRE con un JSON válido en este formato exacto:
\`\`\`json
{
  "profile": "mayorista" | "emprendedor" | "detal" | "regalo" | null,
  "reasoning": "breve explicación de por qué detectaste este perfil",
  "question": "si profile es null, la pregunta para pedir aclaración"
}
\`\`\`

Reglas:
- Si detectas el perfil claramente, ponlo en "profile" y explica en "reasoning".
- Si no hay señal clara, pon "profile": null y en "question" responde exactamente la pregunta_perfil configurada para este tenant.

${rulesBlock}

No preguntes el perfil antes de haber recibido y procesado la imagen o video inicial del anuncio, si lo hay.`
  const user = `Pregunta_perfil configurada para este tenant: "${tenant.preguntaPerfil || '¿Para ti o para tu negocio?'}"

Mensaje del cliente: "${ctx.message || '(sin mensaje aún)'}"

Recuerda: responde SOLO con JSON válido.`
  return { system, user }
}
