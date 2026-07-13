// ────────────────────────────────────────────────────────────────────
// 8.6 — Agente orquestador de tráfico (traffic_orchestrator)
// Recomienda redistribución de presupuesto entre campañas/anuncios según
// ROAS, CPA y saturación de audiencia. No toca la plataforma — solo propone.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildTrafficOrchestratorPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el orquestador de tráfico pagado de ${tenant.slug}. Recibes el desempeño de todas las
campañas activas (Meta, TikTok, Google) y propones redistribución de presupuesto. Salida JSON:
{"recomendaciones": [{"campaign_id": "...", "plataforma": "...", "accion": "pausar|reducir|aumentar|mantener",
"razon": "...", "budget_diario_sugerido": N, "roas_actual": N, "cpa_actual": N, "delta_pct": N}],
"resumen": "frase corta", "auto_kill_sugerido": ["ad_id", ...]}. Reglas:
1) Pausa campañas con ROAS < 0.5 después de gastar > 1.5× CPA objetivo.
2) Aumenta campañas con ROAS > 2.0 y saturación < 70%.
3) Nunca aumentes más de 30% el budget diario de una campaña en una sola recomendación.
4) Marca auto_kill=true solo si CPA > 2× objetivo y ROAS < 0.3.`
  const campaigns = await db.campaign.findMany({ where: { tenantId: ctx.tenantId, status: 'active' }, include: { ads: { include: { spend: { orderBy: { date: 'desc' }, take: 7 } } }, platform: { select: { name: true } } }, take: 30 })
  const user = `Tenant: ${tenant.slug} | plan: ${tenant.planMonetizacion}

Campañas activas (últimos 7 días):
${campaigns.map(c => `- ${c.id} [${c.platform.name}] ${c.name} | objetivo: ${c.objective || '?'} | budget diario: $${c.budgetDaily ?? '?'} | ads: ${c.ads.length} | spend 7d: $${c.ads.flatMap(a => a.spend).reduce((s, sp) => s + sp.spend, 0).toFixed(0)}`).join('\n') || 'Sin campañas activas.'}

Foco solicitado: ${ctx.campaignId ? `campaña ${ctx.campaignId}` : 'todas las campañas'}
${ctx.adId ? `Anuncio foco: ${ctx.adId}` : ''}`
  return { system, user }
}
