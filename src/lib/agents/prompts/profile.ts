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

  const system = `Eres el clasificador de perfil del negocio ${tenant.slug}. Tu única tarea es determinar el perfil del lead a partir de su mensaje y el contexto del anuncio que lo trajo: mayorista (tienda/surtir/vender/negocio), emprendedor (arrancar/emprender), detal (para mí) o regalo. Si no hay señal clara, responde exactamente la pregunta_perfil configurada para este tenant y no avances hasta recibir respuesta.

${rulesBlock}

No preguntes el perfil antes de haber recibido y procesado la imagen o video inicial del anuncio, si lo hay.`
  const user = `Pregunta_perfil configurada para este tenant: "${tenant.preguntaPerfil || '¿Para ti o para tu negocio?'}"`
  return { system, user }
}
