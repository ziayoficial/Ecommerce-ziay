// ────────────────────────────────────────────────────────────────────
// 6.4 / 6.5 — Agente de catálogo (catalog) + búsqueda por tema
// Consolidación IA-3: merge de catalog (§6.4) + theme (§6.5) en un único
// agente que hace las dos cosas.
// ────────────────────────────────────────────────────────────────────
// El catálogo ahora responde a dos tipos de consulta:
//   - Búsqueda general (§6.4): por producto, categoría o intención del
//     lead. La respuesta es visual-primero: máximo 1-2 líneas de texto
//     + imagen real + pregunta binaria al cierre.
//   - Búsqueda por tema/personaje (§6.5): cuando el lead menciona un
//     personaje (Stitch, Hello Kitty, Marvel, etc.) sin mencionar la
//     prenda, el agente busca en `temas_diseño` y trae TODAS las prendas
//     disponibles en ese tema.
// El contexto `ctx.theme` activa el modo "búsqueda por tema" si está
// presente. Si no, se hace la búsqueda general por `ctx.query`.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildCatalogPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')

  // ── Si ctx.theme viene, hacer búsqueda por tema (§6.5 mergeada) ──────
  if (ctx.theme) {
    return buildThemeBranch(tenant, ctx)
  }
  return buildCatalogBranch(tenant, ctx)
}

// ────────────────────────────────────────────────────────────────────
// Búsqueda general por query (§6.4 — catálogo visual-primero)
// ────────────────────────────────────────────────────────────────────
async function buildCatalogBranch(
  tenant: { slug: string },
  ctx: AgentContext,
): Promise<{ system: string; user: string }> {
  const system = `Eres el agente de catálogo de ${tenant.slug}. Cuando el lead pregunta por un
producto, tema o categoría, tu respuesta NUNCA puede ser solo texto ni un
enlace genérico. Busca en el catálogo real de este tenant (embedding_texto,
sincronizado desde WhatsApp Catalog, WooCommerce, Shopify, o la Supabase
propia o nuestra) el producto o los productos que mejor coinciden con la
intención del lead, y devuelve sus imágenes reales. Si la intención agrupa
una categoría amplia (ej. "familia"), trae mínimo 3 prendas distintas
disponibles en esa categoría (consulta combos_categoria), no solo el
producto ancla. Acompaña con un máximo de 1-2 líneas de texto. Cierra
siempre con una pregunta binaria, nunca una pregunta abierta.

Si el lead menciona un personaje o tema (Stitch, Hello Kitty, Marvel,
etc.) sin mencionar la prenda, busca en temas_diseño ese tema y trae
TODAS las prendas disponibles en él. Nunca respondas "no tenemos eso"
sin antes verificar en temas_diseño.`
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

// ────────────────────────────────────────────────────────────────────
// Búsqueda por tema/personaje (§6.5 mergeada)
// ────────────────────────────────────────────────────────────────────
async function buildThemeBranch(
  tenant: { slug: string },
  ctx: AgentContext,
): Promise<{ system: string; user: string }> {
  const system = `Eres el buscador de temas de ${tenant.slug}. Cuando el lead menciona un
personaje o tema sin mencionar la prenda, buscas en temas_diseño (filtrado
por tenant_id) ese tema y traes TODAS las prendas disponibles en él.
Entregas el resultado al agente de respuesta visual-primero para que lo
muestre con imágenes. Nunca respondes "no tenemos eso" sin antes
verificar en temas_diseño.`
  const themes = await db.themeDesign.findMany({ where: { tenantId: ctx.tenantId } })
  const user = `Temas disponibles para ${tenant.slug}:
${themes.map(t => `- "${t.tema}": SKUs ${t.skusAsociados}`).join('\n') || 'Sin temas configurados.'}

Tema solicitado por el lead: "${ctx.theme}"`
  return { system, user }
}
