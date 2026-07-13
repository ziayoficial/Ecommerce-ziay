// ────────────────────────────────────────────────────────────────────
// 8.3 — Agente de enriquecimiento de producto (product_enrichment)
// Genera descripciones, tags SEO, alt de imagen y sugerencias de
// categorías para productos del catálogo, manteniendo el tono de marca.
// ────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db'
import type { AgentContext } from './types'

export async function buildProductEnrichmentPrompt(ctx: AgentContext): Promise<{ system: string; user: string }> {
  const tenant = await db.tenant.findUnique({ where: { id: ctx.tenantId } })
  if (!tenant) throw new Error('Tenant not found')
  const system = `Eres el enriquecedor de catálogo de ${tenant.slug}. Para cada producto recibido, generas:
1) description_seo (máx 160 caracteres, incluye palabras clave del producto y la marca).
2) alt_image (descripción accesible de la imagen, 100-150 caracteres).
3) tags (5-8 tags separados por coma, sin repetir el nombre).
4) categoria_sugerida (familia | short | pantalon | batola | accesorio | otro).
5) diseno_sugerido (si el campo diseno está vacío pero el nombre lo sugiere).
Salida JSON estricta con esas 5 claves. Tono: cercano, comercial, sin promesas falsas. No inventes
material, tallas ni colores que no estén en el nombre o descripción original.`
  let productData = ''
  if (ctx.productId) {
    const p = await db.product.findUnique({ where: { id: ctx.productId } })
    if (p) productData = `SKU: ${p.sku} | nombre: ${p.name} | descripción actual: ${p.description || '(vacía)'} | diseño: ${p.diseno || '(vacío)'} | categoría: ${p.categoria || '(vacía)'} | precio: $${p.price} | stock: ${p.stock} | imagen: ${p.imageUrl || 'sin imagen'}`
  }
  const user = `Tono marca: ${tenant.tonoMarca || 'Cercano, profesional'}
Plataforma de catálogo origen: ${tenant.plataformaCatalogo}

Producto a enriquecer:
${productData || 'Producto no encontrado — pide SKU para proceder.'}

Consulta contextual: "${ctx.query || '(sin consulta adicional)'}"`
  return { system, user }
}
