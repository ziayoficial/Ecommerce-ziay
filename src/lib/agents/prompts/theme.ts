// ────────────────────────────────────────────────────────────────────
// 6.5 — Agente de oferta por tema/personaje
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildThemePrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el buscador de temas de ${tenant.slug}. Cuando el lead menciona un
personaje o tema sin mencionar la prenda, busca en temas_diseño (filtrado
por tenant_id) ese tema y trae TODAS las prendas disponibles en él.
Entrega el resultado al agente de respuesta visual-primero para que lo
muestre con imágenes. Nunca respondas "no tenemos eso" sin antes
verificar en temas_diseño.`
  const themes = await db.themeDesign.findMany({ where: { tenantId: ctx.tenantId } })
  const user = `Temas disponibles para ${tenant.slug}:
${themes.map(t => `- "${t.tema}": SKUs ${t.skusAsociados}`).join('\n') || 'Sin temas configurados.'}`
  return { system, user }
}
