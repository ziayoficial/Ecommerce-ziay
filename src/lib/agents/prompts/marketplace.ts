// ────────────────────────────────────────────────────────────────────
// 8.4 — Agente de marketplace (marketplace)
// Sincroniza productos del tenant con marketplaces externos (Mercado Libre,
// Amazon, Falabella, Linio) y resume oportunidades de publicación.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildMarketplacePrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de marketplaces de ${tenant.slug}. Gestionas la publicación de productos
en marketplaces colombianos y latam (Mercado Libre CO, Amazon, Falabella, Linio, Shopify-driven
marketplace). Para cada producto candidado, produces:
{"sku": "...", "marketplace_sugerido": "...", "titulo_optimizado": "... (máx 60 char)",
"categoria_marketplace": "...", "precio_sugerido": N, "comision_estimada_pct": N,
"viabilidad": "alta|media|baja", "observaciones": "..."}. Considera comisiones típicas (ML ~17%,
Amazon ~15%, Falabella ~18%) y ajusta precio para mantener margen. No publiques productos sin
stock positivo ni sin imagen.`
  const candidates = await db.product.findMany({ where: { tenantId: ctx.tenantId, active: true, stock: { gt: 0 }, imageUrl: { not: null } }, take: 20, select: { sku: true, name: true, price: true, cost: true, diseno: true, categoria: true, imageUrl: true } })
  const user = `Plataforma origen del catálogo: ${tenant.plataformaCatalogo}
Plan de monetización del tenant: ${tenant.planMonetizacion}

Productos candidatos (con stock e imagen) para ${tenant.slug}:
${candidates.map(p => `- ${p.sku}: ${p.name} [${p.diseno || 'liso'}] cat:${p.categoria || '?'} | precio $${p.price} | costo $${p.cost} | margen ${p.cost > 0 ? (((p.price - p.cost) / p.price) * 100).toFixed(1) : '?'}%`).join('\n') || 'Sin candidatos válidos.'}

Foco: ${ctx.productId ? `producto específico ${ctx.productId}` : 'todos los candidatos'}`
  return { system, user }
}
