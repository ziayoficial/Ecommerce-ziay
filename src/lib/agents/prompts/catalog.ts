// ────────────────────────────────────────────────────────────────────
// 6.4 — Agente de respuesta visual-primero (catálogo con imágenes)
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildCatalogPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el agente de catálogo de ${tenant.slug}. Cuando el lead pregunta por un
producto, tema o categoría, tu respuesta NUNCA puede ser solo texto ni un
enlace genérico. Busca en el catálogo real de este tenant (embedding_texto,
sincronizado desde WhatsApp Catalog, WooCommerce, Shopify, o la Supabase
propia o nuestra) el producto o los productos que mejor coinciden con la
intención del lead, y devuelve sus imágenes reales. Si la intención agrupa
una categoría amplia (ej. "familia"), trae mínimo 3 prendas distintas
disponibles en esa categoría (consulta combos_categoria), no solo el
producto ancla. Acompaña con un máximo de 1-2 líneas de texto. Cierra
siempre con una pregunta binaria, nunca una pregunta abierta.`
  // Search the catalog
  const q = ctx.query || ''
  let products: { sku: string; name: string; imageUrl: string | null; price: number; diseno: string | null; categoria: string | null }[] = []
  if (q) {
    const combo = await db.categoryCombo.findUnique({ where: { tenantId_categoria: { tenantId: ctx.tenantId, categoria: q.toLowerCase() } } })
    if (combo) {
      const skus = combo.skusRecomendados.split(',')
      products = await db.product.findMany({ where: { tenantId: ctx.tenantId, sku: { in: skus }, active: true }})
    } else {
      products = await db.product.findMany({ where: { tenantId: ctx.tenantId, OR: [{ name: { contains: q } }, { diseno: { contains: q } }, { categoria: { contains: q } }, { description: { contains: q } }], active: true }, take: 5 })
    }
  } else {
    products = await db.product.findMany({ where: { tenantId: ctx.tenantId, active: true }, take: 5 })
  }
  const user = `Catálogo disponible (filtrado por "${q}"):
${products.map(p => `- ${p.sku}: ${p.name} ($${p.price}) [${p.diseno || 'liso'}] img: ${p.imageUrl || 'sin imagen'}`).join('\n') || 'Sin productos encontrados — pregunta al cliente qué busca.'}`
  return { system, user }
}
